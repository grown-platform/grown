// Package forgejo provides a thin Forgejo admin API client used to
// auto-provision a Forgejo organisation when a grown organisation is created.
//
// Configuration is read from two environment variables:
//
//	GROWN_FORGEJO_URL          – base URL of the Forgejo instance
//	                             (e.g. https://code.pick.haus)
//	GROWN_FORGEJO_ADMIN_TOKEN  – a Forgejo admin personal-access token
//
// When either variable is empty the Client is unconfigured and every method
// returns nil immediately (best-effort, no-op behaviour).
//
// # Username mapping assumption
//
// grown users are identified by email address. Forgejo usernames are derived
// from the local-part of the email (the text before the first "@"). For example
// user@example.com → username "user". This is a best-effort heuristic; if the
// Forgejo account was created under a different username the AddOrgOwner and
// SetSiteAdmin calls will return a 404 from the Forgejo API, which is logged
// and treated as a non-fatal error so org creation is never blocked.
//
// Operators who need a different mapping should set up Forgejo user accounts
// whose username matches the local-part of the corresponding grown user's email.
package forgejo

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Client is a minimal Forgejo admin API client. The zero value is valid and
// acts as a no-op (unconfigured) client.
type Client struct {
	baseURL    string // e.g. "https://code.pick.haus" — no trailing slash
	token      string // Forgejo admin personal-access token
	httpClient *http.Client
}

// NewClient constructs a Client from explicit values. Both must be non-empty
// for the client to make real API calls; if either is empty the client is
// returned in no-op mode.
func NewClient(baseURL, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// configured reports whether the client has the required settings.
func (c *Client) configured() bool {
	return c != nil && c.baseURL != "" && c.token != ""
}

// CreateOrg creates a Forgejo organisation owned by the admin token's user.
// It uses POST /api/v1/orgs. HTTP 422 (already exists) is treated as success
// (idempotent). Any Forgejo API failure is returned as an error; callers
// should log and continue — never block grown org creation on this.
func (c *Client) CreateOrg(ctx context.Context, name, fullName string) error {
	if !c.configured() {
		return nil
	}
	body := map[string]any{
		"username":                      name,
		"full_name":                     fullName,
		"visibility":                    "private",
		"repo_admin_change_team_access": true,
	}
	status, _, err := c.do(ctx, http.MethodPost, "/api/v1/orgs", body)
	if err != nil {
		return fmt.Errorf("forgejo.CreateOrg: %w", err)
	}
	if status == http.StatusCreated || status == http.StatusOK || status == http.StatusUnprocessableEntity {
		// 201 = created, 200 = ok, 422 = already exists → all treated as success.
		return nil
	}
	return fmt.Errorf("forgejo.CreateOrg: unexpected status %d", status)
}

// AddOrgOwner adds username to the Owners team of the Forgejo organisation
// identified by orgName. It fetches the Owners team via
// GET /api/v1/orgs/{org}/teams and then adds the user via
// PUT /api/v1/teams/{id}/members/{username}. HTTP 404 on any step (e.g. the
// user doesn't exist in Forgejo yet) is logged and silently swallowed.
func (c *Client) AddOrgOwner(ctx context.Context, orgName, username string) error {
	if !c.configured() {
		return nil
	}
	teamID, err := c.ownersTeamID(ctx, orgName)
	if err != nil {
		return fmt.Errorf("forgejo.AddOrgOwner find-team: %w", err)
	}
	if teamID == 0 {
		slog.WarnContext(ctx, "forgejo: owners team not found", "org", orgName)
		return nil
	}
	path := fmt.Sprintf("/api/v1/teams/%d/members/%s", teamID, username)
	status, _, err := c.do(ctx, http.MethodPut, path, nil)
	if err != nil {
		return fmt.Errorf("forgejo.AddOrgOwner add-member: %w", err)
	}
	if status == http.StatusNoContent || status == http.StatusOK || status == http.StatusNotFound {
		// 204 = added, 200 = ok, 404 = user not found in Forgejo → non-fatal.
		return nil
	}
	return fmt.Errorf("forgejo.AddOrgOwner: unexpected status %d", status)
}

// SetSiteAdmin grants or revokes Forgejo instance-admin privileges for username
// via PATCH /api/v1/admin/users/{username} with {"admin": isAdmin}.
// HTTP 404 (user not in Forgejo) is treated as non-fatal.
func (c *Client) SetSiteAdmin(ctx context.Context, username string, isAdmin bool) error {
	if !c.configured() {
		return nil
	}
	path := fmt.Sprintf("/api/v1/admin/users/%s", username)
	body := map[string]any{
		"admin":      isAdmin,
		"source_id":  0,
		"login_name": username,
	}
	status, _, err := c.do(ctx, http.MethodPatch, path, body)
	if err != nil {
		return fmt.Errorf("forgejo.SetSiteAdmin: %w", err)
	}
	if status == http.StatusOK || status == http.StatusNotFound {
		return nil
	}
	return fmt.Errorf("forgejo.SetSiteAdmin: unexpected status %d", status)
}

// ownersTeamID looks up the numeric ID of the "Owners" team for orgName.
// Returns 0 if the team is not found. The Owners team is the built-in team
// Forgejo creates for every org; its name is always "Owners".
func (c *Client) ownersTeamID(ctx context.Context, orgName string) (int64, error) {
	path := fmt.Sprintf("/api/v1/orgs/%s/teams", orgName)
	status, body, err := c.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return 0, err
	}
	if status == http.StatusNotFound {
		return 0, nil
	}
	if status != http.StatusOK {
		return 0, fmt.Errorf("list teams status %d", status)
	}
	var teams []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(body, &teams); err != nil {
		return 0, fmt.Errorf("decode teams: %w", err)
	}
	for _, t := range teams {
		if strings.EqualFold(t.Name, "Owners") {
			return t.ID, nil
		}
	}
	return 0, nil
}

// do executes an authenticated JSON request against the Forgejo API.
// It returns the HTTP status code, the raw response body, and any transport
// or encoding error. A non-2xx status is NOT returned as an error; callers
// inspect the status themselves so they can implement their own idempotency
// rules (e.g. treat 422 as success).
func (c *Client) do(ctx context.Context, method, path string, bodyData any) (int, []byte, error) {
	var reqBody io.Reader
	if bodyData != nil {
		buf, err := json.Marshal(bodyData)
		if err != nil {
			return 0, nil, fmt.Errorf("marshal body: %w", err)
		}
		reqBody = bytes.NewReader(buf)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reqBody)
	if err != nil {
		return 0, nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "token "+c.token)
	if bodyData != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1 MiB cap
	return resp.StatusCode, respBody, nil
}

// UsernameFromEmail derives a Forgejo username from a grown user's email by
// taking the local-part (text before the first "@"). This is the username
// mapping convention documented in this package's package comment.
func UsernameFromEmail(email string) string {
	if idx := strings.IndexByte(email, '@'); idx > 0 {
		return email[:idx]
	}
	return email
}
