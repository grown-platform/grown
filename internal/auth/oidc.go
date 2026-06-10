package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// OIDC bundles the configured provider, verifier, and OAuth2 config.
type OIDC struct {
	provider     *oidc.Provider
	verifier     *oidc.IDTokenVerifier
	oauth2Config oauth2.Config
}

// NewOIDC discovers the issuer's endpoints and constructs an OIDC helper
// ready to drive the authorization-code flow.
func NewOIDC(ctx context.Context, cfg Config) (*OIDC, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	prov, err := oidc.NewProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("oidc.NewProvider: %w", err)
	}
	scopes := cfg.Scopes
	if len(scopes) == 0 {
		scopes = []string{oidc.ScopeOpenID, "profile", "email"}
	}
	o := &OIDC{
		provider: prov,
		verifier: prov.Verifier(&oidc.Config{ClientID: cfg.ClientID}),
		oauth2Config: oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			RedirectURL:  cfg.RedirectURL,
			Endpoint:     prov.Endpoint(),
			Scopes:       scopes,
		},
	}
	return o, nil
}

// AuthCodeURL returns the IdP authorization URL for the given state token.
// prompt (optional) is forwarded as the OIDC `prompt` param — e.g.
// "select_account" to make the IdP show the account chooser.
func (o *OIDC) AuthCodeURL(state, prompt string) string {
	opts := []oauth2.AuthCodeOption{oauth2.AccessTypeOnline}
	if prompt != "" {
		opts = append(opts, oauth2.SetAuthURLParam("prompt", prompt))
	}
	return o.oauth2Config.AuthCodeURL(state, opts...)
}

// AuthCodeURLWithHint is like AuthCodeURL but also forwards a login_hint so
// the IdP pre-fills the username field. Used by the demo-login handler to
// skip the account-selection step for the configured demo account.
func (o *OIDC) AuthCodeURLWithHint(state, loginHint string) string {
	opts := []oauth2.AuthCodeOption{
		oauth2.AccessTypeOnline,
		oauth2.SetAuthURLParam("login_hint", loginHint),
	}
	return o.oauth2Config.AuthCodeURL(state, opts...)
}

// Exchange swaps the authorization code for OAuth tokens and verifies the
// returned ID token. Returns the verified ID token's claims as a JSON object.
func (o *OIDC) Exchange(ctx context.Context, code string) (Claims, error) {
	tok, err := o.oauth2Config.Exchange(ctx, code)
	if err != nil {
		return Claims{}, fmt.Errorf("oauth2 exchange: %w", err)
	}
	rawIDToken, ok := tok.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		return Claims{}, fmt.Errorf("id_token missing from token response")
	}
	idTok, err := o.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return Claims{}, fmt.Errorf("verify id_token: %w", err)
	}
	var c Claims
	if err := idTok.Claims(&c); err != nil {
		return Claims{}, fmt.Errorf("decode claims: %w", err)
	}
	c.Issuer = idTok.Issuer
	return c, nil
}

// Claims is the subset of OIDC ID token claims we care about.
type Claims struct {
	Issuer        string `json:"-"`
	Subject       string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	PreferredName string `json:"preferred_username"`
}

// DisplayName returns the best human-readable name from the claims.
func (c Claims) DisplayName() string {
	if c.Name != "" {
		return c.Name
	}
	if c.PreferredName != "" {
		return c.PreferredName
	}
	return c.Email
}

// NewState generates a CSRF state token for the authorization flow.
func NewState() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
