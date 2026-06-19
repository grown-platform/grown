// Package desktops manages virtual desktop sessions backed by Apache Guacamole.
// GuacClient is a thin REST client for the Guacamole 1.5.x token-authenticated
// API. It caches the auth token and data-source name, re-authenticating
// automatically on 401/403.
package desktops

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// GuacClient is a minimal Apache Guacamole REST API client.
// It caches the authentication token so it only authenticates once per
// session, re-authenticating automatically when the server returns 401/403.
type GuacClient struct {
	baseURL    string // e.g. "https://guac.example.com" — no trailing slash
	user       string
	pass       string
	httpClient *http.Client

	mu         sync.Mutex
	authToken  string
	dataSource string
}

// NewGuacClient constructs a GuacClient. baseURL must not have a trailing
// slash. Authentication is deferred until the first API call.
func NewGuacClient(baseURL, user, pass string) *GuacClient {
	return &GuacClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		user:    user,
		pass:    pass,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// ConnSpec describes a Guacamole connection to create.
type ConnSpec struct {
	Name       string // unique connection name
	Protocol   string // "vnc" | "ssh"
	Host       string // target hostname (in-cluster)
	Port       int
	Parameters map[string]string // extra protocol params (e.g. password, username)
}

// CreateConnection creates a connection under ROOT and returns its identifier.
func (c *GuacClient) CreateConnection(ctx context.Context, spec ConnSpec) (string, error) {
	// Build the parameters map: hostname + port (as string) + caller extras.
	params := make(map[string]string, len(spec.Parameters)+2)
	for k, v := range spec.Parameters {
		params[k] = v
	}
	params["hostname"] = spec.Host
	params["port"] = fmt.Sprintf("%d", spec.Port)

	body := map[string]any{
		"parentIdentifier": "ROOT",
		"name":             spec.Name,
		"protocol":         spec.Protocol,
		"parameters":       params,
		"attributes":       map[string]any{},
	}

	status, respBody, err := c.doData(ctx, http.MethodPost, "/connections", body)
	if err != nil {
		return "", fmt.Errorf("guac.CreateConnection: %w", err)
	}
	if status != http.StatusOK && status != http.StatusCreated {
		return "", fmt.Errorf("guac.CreateConnection: unexpected status %d", status)
	}

	var result struct {
		Identifier string `json:"identifier"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("guac.CreateConnection: decode response: %w", err)
	}
	if result.Identifier == "" {
		return "", fmt.Errorf("guac.CreateConnection: empty identifier in response")
	}
	return result.Identifier, nil
}

// GrantConnectionToUser grants READ permission on connID to the Guacamole
// user identified by username.
func (c *GuacClient) GrantConnectionToUser(ctx context.Context, connID, username string) error {
	patch := []map[string]string{
		{
			"op":    "add",
			"path":  "/connectionPermissions/" + connID,
			"value": "READ",
		},
	}
	path := fmt.Sprintf("/users/%s/permissions", username)
	status, _, err := c.doData(ctx, http.MethodPatch, path, patch)
	if err != nil {
		return fmt.Errorf("guac.GrantConnectionToUser: %w", err)
	}
	if status != http.StatusNoContent && status != http.StatusOK {
		return fmt.Errorf("guac.GrantConnectionToUser: unexpected status %d", status)
	}
	return nil
}

// DeleteConnection removes a connection by identifier. A 404 from the server
// is treated as success (idempotent).
func (c *GuacClient) DeleteConnection(ctx context.Context, connID string) error {
	path := fmt.Sprintf("/connections/%s", connID)
	status, _, err := c.doData(ctx, http.MethodDelete, path, nil)
	if err != nil {
		return fmt.Errorf("guac.DeleteConnection: %w", err)
	}
	if status == http.StatusNoContent || status == http.StatusOK || status == http.StatusNotFound {
		return nil
	}
	return fmt.Errorf("guac.DeleteConnection: unexpected status %d", status)
}

// ── internal helpers ──────────────────────────────────────────────────────────

// authResponse matches the JSON returned by POST /api/tokens.
type authResponse struct {
	AuthToken  string `json:"authToken"`
	DataSource string `json:"dataSource"`
}

// ensureToken returns a valid (authToken, dataSource) pair, authenticating if
// needed. The caller must NOT hold c.mu.
func (c *GuacClient) ensureToken(ctx context.Context) (string, string, error) {
	c.mu.Lock()
	if c.authToken != "" && c.dataSource != "" {
		tok, ds := c.authToken, c.dataSource
		c.mu.Unlock()
		return tok, ds, nil
	}
	c.mu.Unlock()
	return c.authenticate(ctx)
}

// authenticate performs POST /api/tokens and stores the result.
func (c *GuacClient) authenticate(ctx context.Context) (string, string, error) {
	form := url.Values{}
	form.Set("username", c.user)
	form.Set("password", c.pass)

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/api/tokens",
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return "", "", fmt.Errorf("build auth request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("auth http: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("auth: unexpected status %d", resp.StatusCode)
	}

	var ar authResponse
	if err := json.Unmarshal(body, &ar); err != nil {
		return "", "", fmt.Errorf("auth: decode response: %w", err)
	}
	if ar.AuthToken == "" || ar.DataSource == "" {
		return "", "", fmt.Errorf("auth: empty token or dataSource in response")
	}

	c.mu.Lock()
	c.authToken = ar.AuthToken
	c.dataSource = ar.DataSource
	c.mu.Unlock()

	return ar.AuthToken, ar.DataSource, nil
}

// clearToken invalidates the cached token so the next call re-authenticates.
func (c *GuacClient) clearToken() {
	c.mu.Lock()
	c.authToken = ""
	c.dataSource = ""
	c.mu.Unlock()
}

// doData executes an authenticated request against a data-scoped Guacamole
// endpoint: {base}/api/session/data/{dataSource}{path}?token={authToken}.
// On 401/403 it re-authenticates once and retries. bodyData may be nil.
func (c *GuacClient) doData(ctx context.Context, method, path string, bodyData any) (int, []byte, error) {
	tok, ds, err := c.ensureToken(ctx)
	if err != nil {
		return 0, nil, err
	}

	status, body, err := c.rawDo(ctx, method, ds, path, tok, bodyData)
	if err != nil {
		return 0, nil, err
	}

	// Re-auth once on 401/403.
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		c.clearToken()
		tok, ds, err = c.authenticate(ctx)
		if err != nil {
			return 0, nil, fmt.Errorf("re-auth: %w", err)
		}
		status, body, err = c.rawDo(ctx, method, ds, path, tok, bodyData)
		if err != nil {
			return 0, nil, err
		}
	}

	return status, body, nil
}

// rawDo builds and executes one authenticated data-scoped HTTP request.
func (c *GuacClient) rawDo(ctx context.Context, method, dataSource, path, token string, bodyData any) (int, []byte, error) {
	var reqBody io.Reader
	if bodyData != nil {
		buf, err := json.Marshal(bodyData)
		if err != nil {
			return 0, nil, fmt.Errorf("marshal body: %w", err)
		}
		reqBody = bytes.NewReader(buf)
	}

	u := fmt.Sprintf("%s/api/session/data/%s%s?token=%s",
		c.baseURL,
		url.PathEscape(dataSource),
		path,
		url.QueryEscape(token),
	)
	req, err := http.NewRequestWithContext(ctx, method, u, reqBody)
	if err != nil {
		return 0, nil, fmt.Errorf("build request: %w", err)
	}
	if bodyData != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, respBody, nil
}
