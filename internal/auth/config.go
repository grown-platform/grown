// Package auth implements OIDC login, session lifecycle, and the gRPC AuthService.
package auth

import (
	"net/url"
	"time"
)

// Config bundles all the knobs the auth package needs.
//
// All fields are required. Validate via Config.Validate before passing to
// the constructors in this package.
type Config struct {
	// IssuerURL is the OIDC issuer (Zitadel by default for grown-workspace).
	IssuerURL string
	// ClientID is the OIDC client identifier registered with the issuer.
	ClientID string
	// ClientSecret is the OIDC client secret.
	ClientSecret string
	// RedirectURL is the OIDC callback URL that the issuer redirects back to.
	RedirectURL string
	// Scopes requested in the OIDC authorization request.
	Scopes []string
	// CookieName is the HTTP cookie name carrying the session token.
	CookieName string
	// CookieSecure sets the Secure attribute on the session cookie.
	CookieSecure bool
	// CookieDomain, when non-empty, sets the Domain attribute on the session
	// and OIDC-state cookies so they are shared across subdomains of that
	// domain (e.g. "workspace.localtest.me" shares the session with
	// crm.workspace.localtest.me). Empty = host-only (the default).
	CookieDomain string
	// SessionLifetime is how long a session token remains valid.
	SessionLifetime time.Duration
	// DefaultOrgSlug is the slug of the org that all sessions belong to in
	// single-org mode.
	DefaultOrgSlug string
	// PersonalOrgs, when true, gives every first-ever sign-in its own personal
	// (org-per-user) org instead of the shared default org. Returning users keep
	// whatever org they were provisioned into. Gated by GROWN_PERSONAL_ORGS
	// (default on). See docs/sharing-and-personal-orgs.md.
	PersonalOrgs bool
}

// Validate returns nil if all fields are populated correctly.
func (c Config) Validate() error {
	if c.IssuerURL == "" {
		return errMissing("IssuerURL")
	}
	if _, err := url.Parse(c.IssuerURL); err != nil {
		return err
	}
	if c.ClientID == "" {
		return errMissing("ClientID")
	}
	if c.ClientSecret == "" {
		return errMissing("ClientSecret")
	}
	if c.RedirectURL == "" {
		return errMissing("RedirectURL")
	}
	if _, err := url.Parse(c.RedirectURL); err != nil {
		return err
	}
	if c.CookieName == "" {
		return errMissing("CookieName")
	}
	if c.SessionLifetime <= 0 {
		return errMissing("SessionLifetime")
	}
	if c.DefaultOrgSlug == "" {
		return errMissing("DefaultOrgSlug")
	}
	return nil
}

type missingFieldError struct{ field string }

func (e missingFieldError) Error() string { return "auth.Config." + e.field + " is required" }

func errMissing(f string) error { return missingFieldError{field: f} }
