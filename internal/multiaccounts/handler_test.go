package multiaccounts_test

import (
	"code.pick.haus/grown/grown/internal/multiaccounts"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// --- stubs ---

// memStore is an in-memory implementation of the account store for testing.
type memStore struct {
	rows []struct{ browserID, token string }
}

func (m *memStore) AddAccount(_ context.Context, browserID, token string) error {
	for _, r := range m.rows {
		if r.browserID == browserID && r.token == token {
			return nil // already present
		}
	}
	m.rows = append(m.rows, struct{ browserID, token string }{browserID, token})
	return nil
}

func (m *memStore) TokensForBrowser(_ context.Context, browserID string) ([]string, error) {
	var out []string
	for _, r := range m.rows {
		if r.browserID == browserID {
			out = append(out, r.token)
		}
	}
	return out, nil
}

func (m *memStore) HasSession(_ context.Context, browserID, token string) (bool, error) {
	for _, r := range m.rows {
		if r.browserID == browserID && r.token == token {
			return true, nil
		}
	}
	return false, nil
}

func (m *memStore) RemoveSession(_ context.Context, browserID, token string) error {
	var out []struct{ browserID, token string }
	for _, r := range m.rows {
		if !(r.browserID == browserID && r.token == token) {
			out = append(out, r)
		}
	}
	m.rows = out
	return nil
}

// stubSessions is a fake SessionLookup.
type stubSessions struct {
	// publicID → token
	byPublicID map[string]string
	// token → full info
	byToken map[string]accountEntry
}

type accountEntry struct {
	userID, email, displayName, orgID, orgName, orgSlug, publicID string
}

func newStubSessions() *stubSessions {
	return &stubSessions{
		byPublicID: make(map[string]string),
		byToken:    make(map[string]accountEntry),
	}
}

func (s *stubSessions) add(token string, e accountEntry) {
	s.byToken[token] = e
	s.byPublicID[e.publicID] = token
}

func (s *stubSessions) LookupFull(_ context.Context, token string) (userID, email, displayName, orgID, orgName, orgSlug, publicID string, ok bool) {
	e, found := s.byToken[token]
	if !found {
		return
	}
	return e.userID, e.email, e.displayName, e.orgID, e.orgName, e.orgSlug, e.publicID, true
}

func (s *stubSessions) LookupTokenByPublicID(_ context.Context, publicID string) (string, error) {
	if tok, ok := s.byPublicID[publicID]; ok {
		return tok, nil
	}
	return "", nil
}

// --- helpers ---

const testCookieName = "grown_session"

// --- tests ---

// TestListAccounts_NoBrowserID returns an empty list when no browser id is present.
func TestListAccounts_NoBrowserID(t *testing.T) {
	store := &memStore{}
	sess := newStubSessions()
	h := multiaccounts.NewHandler(
		func(_ context.Context) multiaccounts.CallerInfo { return multiaccounts.CallerInfo{} },
		&memStore{},
		sess,
		multiaccounts.CookieConfig{Name: testCookieName},
	)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/accounts", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	_ = store
}

// TestActivateAccount_NoBrowserID rejects activation without a browser_id cookie.
func TestActivateAccount_NoBrowserID(t *testing.T) {
	sess := newStubSessions()
	h := multiaccounts.NewHandler(
		func(_ context.Context) multiaccounts.CallerInfo { return multiaccounts.CallerInfo{} },
		&memStore{},
		sess,
		multiaccounts.CookieConfig{Name: testCookieName},
	)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/me/accounts/somepublicid/activate", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("want 403 without browser id, got %d", rec.Code)
	}
}

// TestEnsureBrowserID mints a new cookie when none is present.
func TestEnsureBrowserID_Mint(t *testing.T) {
	cfg := multiaccounts.CookieConfig{Name: testCookieName, Secure: false}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	bid := multiaccounts.EnsureBrowserID(rec, req, cfg)
	if bid == "" {
		t.Fatal("expected a browser id to be minted")
	}
	// Cookie should be set on the response.
	found := false
	for _, c := range rec.Result().Cookies() {
		if c.Name == "grown_bid" && c.Value == bid {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("grown_bid cookie not set on response; cookies: %v", rec.Result().Cookies())
	}
}

// TestEnsureBrowserID_Existing returns the existing value without setting a new one.
func TestEnsureBrowserID_Existing(t *testing.T) {
	cfg := multiaccounts.CookieConfig{Name: testCookieName}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "grown_bid", Value: "existing-id"})
	rec := httptest.NewRecorder()
	bid := multiaccounts.EnsureBrowserID(rec, req, cfg)
	if bid != "existing-id" {
		t.Errorf("want existing-id, got %q", bid)
	}
	// No new cookie should be set.
	if len(rec.Result().Cookies()) > 0 {
		t.Errorf("unexpected cookie set when bid was already present")
	}
}

// TestListAccounts_JSON returns valid JSON with an accounts key.
func TestListAccounts_JSON(t *testing.T) {
	sess := newStubSessions()
	h := multiaccounts.NewHandler(
		func(_ context.Context) multiaccounts.CallerInfo { return multiaccounts.CallerInfo{Present: false} },
		&memStore{},
		sess,
		multiaccounts.CookieConfig{Name: testCookieName},
	)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/accounts", nil)
	req.AddCookie(&http.Cookie{Name: "grown_bid", Value: "somebrowserid"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := body["accounts"]; !ok {
		t.Errorf("response missing 'accounts' key: %v", body)
	}
}
