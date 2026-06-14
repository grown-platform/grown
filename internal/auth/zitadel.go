package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ZitadelClient makes service-account calls against the Zitadel API v2.
// It is used by the in-app password and demo login handlers to authenticate
// users without a browser redirect to the Zitadel UI.
type ZitadelClient struct {
	apiURL       string
	serviceToken string
	httpClient   *http.Client
}

// NewZitadelClient constructs a ZitadelClient.
// apiURL is the Zitadel base URL (e.g. "https://auth.pick.haus").
// serviceToken is the GROWN_ZITADEL_SERVICE_TOKEN PAT.
func NewZitadelClient(apiURL, serviceToken string) *ZitadelClient {
	return &ZitadelClient{
		apiURL:       strings.TrimRight(apiURL, "/"),
		serviceToken: serviceToken,
		httpClient:   &http.Client{Timeout: 15 * time.Second},
	}
}

// zitadelSessionRequest is the request body for POST /v2/sessions.
type zitadelSessionRequest struct {
	Checks zitadelChecks `json:"checks"`
}

type zitadelChecks struct {
	User     *zitadelUserCheck     `json:"user,omitempty"`
	Password *zitadelPasswordCheck `json:"password,omitempty"`
}

type zitadelUserCheck struct {
	LoginName string `json:"loginName"`
}

type zitadelPasswordCheck struct {
	Password string `json:"password"`
}

// ZitadelSessionResult holds the fields returned by a successful
// POST /v2/sessions call.
type ZitadelSessionResult struct {
	SessionID    string
	SessionToken string
	UserID       string // factors.user.id
}

// zitadelSessionResponse is the JSON shape of the POST /v2/sessions success
// response. Only the fields we use are decoded.
type zitadelSessionResponse struct {
	SessionID    string `json:"sessionId"`
	SessionToken string `json:"sessionToken"`
	Details      struct {
		ID string `json:"id"`
	} `json:"details"`
	Factors struct {
		User *struct {
			ID string `json:"id"`
		} `json:"user,omitempty"`
	} `json:"factors"`
}

// AuthenticatePassword authenticates a user by loginName + password against
// the Zitadel Session API v2. On success it returns a ZitadelSessionResult
// containing the Zitadel user id. On bad credentials it returns
// ErrZitadelUnauthorized. Network/server errors return a wrapped error.
func (c *ZitadelClient) AuthenticatePassword(ctx context.Context, loginName, password string) (ZitadelSessionResult, error) {
	reqBody := zitadelSessionRequest{
		Checks: zitadelChecks{
			User:     &zitadelUserCheck{LoginName: loginName},
			Password: &zitadelPasswordCheck{Password: password},
		},
	}
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return ZitadelSessionResult{}, fmt.Errorf("zitadel: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.apiURL+"/v2/sessions", bytes.NewReader(bodyBytes))
	if err != nil {
		return ZitadelSessionResult{}, fmt.Errorf("zitadel: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.serviceToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return ZitadelSessionResult{}, fmt.Errorf("zitadel: POST /v2/sessions: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return ZitadelSessionResult{}, fmt.Errorf("zitadel: read response: %w", err)
	}

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusNotFound {
		return ZitadelSessionResult{}, ErrZitadelUnauthorized
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ZitadelSessionResult{}, fmt.Errorf("zitadel: POST /v2/sessions status %d: %s",
			resp.StatusCode, truncate(string(respBytes), 200))
	}

	var parsed zitadelSessionResponse
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return ZitadelSessionResult{}, fmt.Errorf("zitadel: decode response: %w", err)
	}

	userID := ""
	if parsed.Factors.User != nil {
		userID = parsed.Factors.User.ID
	}
	if userID == "" {
		// Fall back to details.id (some Zitadel versions use this layout).
		userID = parsed.Details.ID
	}
	if userID == "" || parsed.SessionID == "" {
		return ZitadelSessionResult{}, fmt.Errorf("zitadel: session created but user id or session id absent in response")
	}

	return ZitadelSessionResult{
		SessionID:    parsed.SessionID,
		SessionToken: parsed.SessionToken,
		UserID:       userID,
	}, nil
}

// LookupUserByLoginName looks up the Zitadel user id for a loginName using the
// Zitadel User API v2 POST /v2/users/_search endpoint.
// ZitadelUser is the subset of a Zitadel user we surface from a login-name
// lookup: the user id plus the profile fields needed to provision a grown row.
type ZitadelUser struct {
	UserID      string
	Email       string
	DisplayName string
}

// LookupUserDetailsByLoginName resolves a Zitadel user by login name and returns
// the user id, email, and display name. It is used by the demo-login path to
// provision the grown user with a real email (required for downstream features
// such as Forgejo reverse-proxy SSO, which keys off the user's email). Returns
// ErrZitadelUnauthorized when no user matches.
func (c *ZitadelClient) LookupUserDetailsByLoginName(ctx context.Context, loginName string) (ZitadelUser, error) {
	respBytes, err := c.searchUserByLoginName(ctx, loginName)
	if err != nil {
		return ZitadelUser{}, err
	}
	var parsed struct {
		Result []struct {
			UserID string `json:"userId"`
			Human  struct {
				Profile struct {
					DisplayName string `json:"displayName"`
					GivenName   string `json:"givenName"`
					FamilyName  string `json:"familyName"`
				} `json:"profile"`
				Email struct {
					Email string `json:"email"`
				} `json:"email"`
			} `json:"human"`
		} `json:"result"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return ZitadelUser{}, fmt.Errorf("zitadel: decode user search response: %w", err)
	}
	if len(parsed.Result) == 0 {
		return ZitadelUser{}, ErrZitadelUnauthorized
	}
	r := parsed.Result[0]
	display := r.Human.Profile.DisplayName
	if display == "" {
		display = strings.TrimSpace(r.Human.Profile.GivenName + " " + r.Human.Profile.FamilyName)
	}
	return ZitadelUser{
		UserID:      r.UserID,
		Email:       r.Human.Email.Email,
		DisplayName: display,
	}, nil
}

// searchUserByLoginName POSTs a Zitadel v2 user search by login name and returns
// the raw response body. Shared by LookupUserByLoginName and
// LookupUserDetailsByLoginName.
func (c *ZitadelClient) searchUserByLoginName(ctx context.Context, loginName string) ([]byte, error) {
	type query struct {
		LoginNameQuery struct {
			LoginName string `json:"loginName"`
			Method    string `json:"method"`
		} `json:"loginNameQuery"`
	}
	type reqBody struct {
		Queries []query `json:"queries"`
	}
	body := reqBody{
		Queries: []query{
			{
				LoginNameQuery: struct {
					LoginName string `json:"loginName"`
					Method    string `json:"method"`
				}{LoginName: loginName, Method: "LOGIN_NAME_METHOD_EQUALS"},
			},
		},
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("zitadel: marshal user search: %w", err)
	}
	// Zitadel v2 user search is POST /v2/users (the /_search suffix is the v1
	// path and returns 405 Method Not Allowed on this instance).
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.apiURL+"/v2/users", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("zitadel: build user search request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.serviceToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("zitadel: user search: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return nil, fmt.Errorf("zitadel: read user search response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("zitadel: user search status %d: %s",
			resp.StatusCode, truncate(string(respBytes), 200))
	}
	return respBytes, nil
}

func (c *ZitadelClient) LookupUserByLoginName(ctx context.Context, loginName string) (string, error) {
	respBytes, err := c.searchUserByLoginName(ctx, loginName)
	if err != nil {
		return "", err
	}
	var parsed struct {
		Result []struct {
			UserID string `json:"userId"`
		} `json:"result"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return "", fmt.Errorf("zitadel: decode user search response: %w", err)
	}
	if len(parsed.Result) == 0 {
		return "", ErrZitadelUnauthorized
	}
	return parsed.Result[0].UserID, nil
}

// ErrZitadelUnauthorized is returned when Zitadel rejects the credentials.
var ErrZitadelUnauthorized = fmt.Errorf("invalid credentials")

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
