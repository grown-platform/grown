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

// maintainersTeamName is the name of the team we create for non-admin members:
// a WRITE-access team granting push/pull on all org repos.
const maintainersTeamName = "Maintainers"

// EnsureMaintainersTeam makes sure a WRITE-access "Maintainers" team exists in
// orgName and returns its numeric ID. It is idempotent: if the team already
// exists (POST returns 422) it is looked up and its ID returned. The team is
// created with `permission: write` and `includes_all_repositories: true` so
// members get push/pull on every repo in the org.
func (c *Client) EnsureMaintainersTeam(ctx context.Context, orgName string) (int64, error) {
	if !c.configured() {
		return 0, nil
	}
	// Fast path: already present.
	if id, err := c.teamIDByName(ctx, orgName, maintainersTeamName); err != nil {
		return 0, fmt.Errorf("forgejo.EnsureMaintainersTeam lookup: %w", err)
	} else if id != 0 {
		return id, nil
	}
	// Create it. Units mirror Forgejo's defaults for a write team.
	body := map[string]any{
		"name":                      maintainersTeamName,
		"description":               "grown-managed maintainers (write access)",
		"permission":                "write",
		"includes_all_repositories": true,
		"can_create_org_repo":       true,
		"units": []string{
			"repo.code", "repo.issues", "repo.pulls", "repo.releases",
			"repo.wiki", "repo.projects", "repo.packages",
		},
	}
	path := fmt.Sprintf("/api/v1/orgs/%s/teams", orgName)
	status, _, err := c.do(ctx, http.MethodPost, path, body)
	if err != nil {
		return 0, fmt.Errorf("forgejo.EnsureMaintainersTeam create: %w", err)
	}
	switch status {
	case http.StatusCreated, http.StatusOK, http.StatusUnprocessableEntity:
		// 201/200 created, 422 already exists → re-resolve the ID either way.
		id, lerr := c.teamIDByName(ctx, orgName, maintainersTeamName)
		if lerr != nil {
			return 0, fmt.Errorf("forgejo.EnsureMaintainersTeam re-lookup: %w", lerr)
		}
		return id, nil
	default:
		return 0, fmt.Errorf("forgejo.EnsureMaintainersTeam: unexpected status %d", status)
	}
}

// AddTeamMember adds username to the team identified by teamID via
// PUT /api/v1/teams/{id}/members/{username}. Idempotent: 204/200 = added,
// 404 (user not yet in Forgejo) is treated as non-fatal (the reverse-proxy
// auto-register creates the user on their first /git hit; a momentary race is
// expected and swallowed).
func (c *Client) AddTeamMember(ctx context.Context, teamID int64, username string) error {
	if !c.configured() || teamID == 0 {
		return nil
	}
	path := fmt.Sprintf("/api/v1/teams/%d/members/%s", teamID, username)
	status, _, err := c.do(ctx, http.MethodPut, path, nil)
	if err != nil {
		return fmt.Errorf("forgejo.AddTeamMember: %w", err)
	}
	if status == http.StatusNoContent || status == http.StatusOK || status == http.StatusNotFound {
		return nil
	}
	return fmt.Errorf("forgejo.AddTeamMember: unexpected status %d", status)
}

// teamIDByName returns the numeric ID of the team named teamName in orgName, or
// 0 when not found.
func (c *Client) teamIDByName(ctx context.Context, orgName, teamName string) (int64, error) {
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
		if strings.EqualFold(t.Name, teamName) {
			return t.ID, nil
		}
	}
	return 0, nil
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

// EnsureOrgWebhook makes sure an org-level webhook targeting targetURL exists on
// orgName. It is idempotent: it lists existing hooks (GET /api/v1/orgs/{org}/hooks)
// and creates one (POST same path) only when none already points at targetURL.
// The hook fires push + pull_request events as JSON, signed with secret
// (Forgejo sends X-Forgejo-Signature = HMAC-SHA256(body, secret)). Best-effort:
// callers log and continue.
func (c *Client) EnsureOrgWebhook(ctx context.Context, orgName, targetURL, secret string) error {
	if !c.configured() || targetURL == "" || secret == "" {
		return nil
	}
	// 1. Already present?
	path := fmt.Sprintf("/api/v1/orgs/%s/hooks", orgName)
	status, body, err := c.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return fmt.Errorf("forgejo.EnsureOrgWebhook list: %w", err)
	}
	if status == http.StatusOK {
		var hooks []struct {
			Config struct {
				URL string `json:"url"`
			} `json:"config"`
		}
		if err := json.Unmarshal(body, &hooks); err == nil {
			for _, h := range hooks {
				if h.Config.URL == targetURL {
					return nil // already configured
				}
			}
		}
	} else if status != http.StatusNotFound {
		return fmt.Errorf("forgejo.EnsureOrgWebhook list: unexpected status %d", status)
	}
	// 2. Create it.
	create := map[string]any{
		"type":   "forgejo",
		"active": true,
		"events": []string{"push", "pull_request"},
		"config": map[string]string{
			"url":          targetURL,
			"content_type": "json",
			"secret":       secret,
		},
	}
	cstatus, _, cerr := c.do(ctx, http.MethodPost, path, create)
	if cerr != nil {
		return fmt.Errorf("forgejo.EnsureOrgWebhook create: %w", cerr)
	}
	switch cstatus {
	case http.StatusCreated, http.StatusOK, http.StatusUnprocessableEntity:
		return nil // 201/200 created, 422 already exists → success
	default:
		return fmt.Errorf("forgejo.EnsureOrgWebhook create: unexpected status %d", cstatus)
	}
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
