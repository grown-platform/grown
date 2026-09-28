package server

// DB-backed tests for the Home Assistant integration surface:
//   POST /api/v1/notifications/push
//   GET  /api/v1/integrations/homeassistant/info
// Driven through the real handler (auth middleware + token scope gating).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/apitokens"
)

var haPresetScopes = []string{"calendar:read", "calendar:write", "tasks:read", "tasks:write", "notifications:read", "notifications:write"}

// mintToken creates a grw_ token for user with scopes.
func (e *authzEnv) mintToken(user string, scopes []string) string {
	e.t.Helper()
	u := e.users[user]
	plain, _, err := apitokens.NewRepository(e.pool).Create(e.ctx, u.ID, u.OrgID, "test", scopes, nil)
	if err != nil {
		e.t.Fatalf("mint token: %v", err)
	}
	return plain
}

// bearer sends a request authenticated with an API token.
func (e *authzEnv) bearer(token, method, path, body string) (int, string) {
	e.t.Helper()
	var rd io.Reader
	if body != "" {
		rd = bytes.NewReader([]byte(body))
	}
	r, err := http.NewRequest(method, e.ts.URL+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	r.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		e.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

type notifList struct {
	Notifications []struct {
		ID        string `json:"id"`
		Type      string `json:"type"`
		Title     string `json:"title"`
		Body      string `json:"body"`
		TargetURL string `json:"target_url"`
		UserID    string `json:"user_id"`
	} `json:"notifications"`
}

func TestHomeAssistantPush(t *testing.T) {
	e := authzSetup(t)
	const path = "/api/v1/notifications/push"
	good := `{"title":"Front door","message":"Someone is at the door","link":"/calendar"}`

	t.Run("scope enforcement", func(t *testing.T) {
		for _, scopes := range [][]string{{"calendar:read"}, {"notifications:read"}, {"drive"}} {
			tok := e.mintToken("alice", scopes)
			if code, body := e.bearer(tok, "POST", path, good); code != http.StatusForbidden {
				t.Errorf("scopes %v: status %d, want 403 (%s)", scopes, code, body)
			}
		}
		// Anonymous: unauthenticated.
		e.expect(http.StatusUnauthorized, anon, "POST", path, good)
		// GET is not a thing.
		e.expect(http.StatusMethodNotAllowed, "alice", "GET", path, "")
	})

	t.Run("validation", func(t *testing.T) {
		tok := e.mintToken("alice", haPresetScopes)
		for _, body := range []string{
			`not json`,
			`{"message":"no title"}`,
			`{"title":"   "}`,
			fmt.Sprintf(`{"title":%q}`, strings.Repeat("t", 201)),
			fmt.Sprintf(`{"title":"t","message":%q}`, strings.Repeat("m", 2001)),
			`{"title":"t","link":"javascript:alert(1)"}`,
			`{"title":"t","link":"//evil.example"}`,
			`{"title":"t","link":"calendar"}`,
		} {
			if code, resp := e.bearer(tok, "POST", path, body); code != http.StatusBadRequest {
				t.Errorf("body %.60s: status %d, want 400 (%s)", body, code, resp)
			}
		}
	})

	t.Run("creates for caller only", func(t *testing.T) {
		tok := e.mintToken("alice", haPresetScopes)
		code, body := e.bearer(tok, "POST", path, good)
		if code != http.StatusCreated {
			t.Fatalf("push: %d %s", code, body)
		}
		var created struct{ ID string }
		if err := json.Unmarshal([]byte(body), &created); err != nil || created.ID == "" {
			t.Fatalf("bad create body %q: %v", body, err)
		}
		// Session push works too (scopes n/a), with an absolute link.
		e.expect(http.StatusCreated, "alice", "POST", path, `{"title":"Session push","link":"https://ha.example.com/lovelace"}`)

		var list notifList
		code, body = e.bearer(tok, "GET", "/api/v1/notifications", "")
		if code != 200 {
			t.Fatalf("list: %d %s", code, body)
		}
		if err := json.Unmarshal([]byte(body), &list); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, n := range list.Notifications {
			if n.ID == created.ID {
				found = true
				if n.Type != "homeassistant" || n.Title != "Front door" || n.Body != "Someone is at the door" || n.TargetURL != "/calendar" || n.UserID != e.users["alice"].ID {
					t.Errorf("stored notification mismatch: %+v", n)
				}
			}
		}
		if !found || len(list.Notifications) != 2 {
			t.Errorf("alice sees %d notifications (found=%v), want 2 incl. the push", len(list.Notifications), found)
		}
		// Nobody else sees it: same-org bob and other-org mallory.
		for _, other := range []string{"bob", "mallory"} {
			body := e.expect(200, other, "GET", "/api/v1/notifications", "")
			if strings.Contains(body, created.ID) || strings.Contains(body, "Front door") {
				t.Errorf("%s can see alice's pushed notification: %.200s", other, body)
			}
		}
	})

	t.Run("rate limit", func(t *testing.T) {
		tok := e.mintToken("bob", haPresetScopes)
		for i := 0; i < 60; i++ {
			if code, body := e.bearer(tok, "POST", path, `{"title":"n"}`); code != http.StatusCreated {
				t.Fatalf("push %d: %d %s", i, code, body)
			}
		}
		if code, _ := e.bearer(tok, "POST", path, `{"title":"n"}`); code != http.StatusTooManyRequests {
			t.Errorf("61st push: status %d, want 429", code)
		}
		// Per user: bob's session is the same user, so also limited...
		e.expect(http.StatusTooManyRequests, "bob", "POST", path, `{"title":"n"}`)
		// ...but another user is not.
		e.expect(http.StatusCreated, "mallory", "POST", path, `{"title":"n"}`)
	})
}

func TestHomeAssistantInfo(t *testing.T) {
	e := authzSetup(t, func(c *Config) { c.Version = "v9.9.9-test" })
	const path = "/api/v1/integrations/homeassistant/info"

	var info struct {
		UserID  string   `json:"user_id"`
		Email   string   `json:"email"`
		Name    string   `json:"name"`
		OrgID   string   `json:"org_id"`
		OrgName string   `json:"org_name"`
		Scopes  []string `json:"scopes"`
		Version string   `json:"version"`
	}

	// A token with only the HA preset scopes (no "integrations" scope) works.
	tok := e.mintToken("mallory", haPresetScopes)
	code, body := e.bearer(tok, "GET", path, "")
	if code != 200 {
		t.Fatalf("token info: %d %s", code, body)
	}
	if err := json.Unmarshal([]byte(body), &info); err != nil {
		t.Fatal(err)
	}
	m := e.users["mallory"]
	if info.UserID != m.ID || info.Email != "mallory@authz.test" || info.Name != "mallory" ||
		info.OrgID != m.OrgID || info.OrgName != "mallory-org" || info.Version != "v9.9.9-test" ||
		strings.Join(info.Scopes, " ") != strings.Join(haPresetScopes, " ") {
		t.Errorf("token info mismatch: %+v", info)
	}

	// Any scope at all is fine (identity endpoint).
	if code, body := e.bearer(e.mintToken("alice", []string{"drive:read"}), "GET", path, ""); code != 200 {
		t.Errorf("drive:read token: %d %s", code, body)
	}

	// Session: scopes ["*"].
	body = e.expect(200, "alice", "GET", path, "")
	info.Scopes = nil
	if err := json.Unmarshal([]byte(body), &info); err != nil {
		t.Fatal(err)
	}
	if info.UserID != e.users["alice"].ID || len(info.Scopes) != 1 || info.Scopes[0] != "*" {
		t.Errorf("session info mismatch: %+v", info)
	}

	// Unauthenticated / bad token / wrong method.
	e.expect(http.StatusUnauthorized, anon, "GET", path, "")
	if code, _ := e.bearer("grw_not_a_real_token", "GET", path, ""); code != http.StatusUnauthorized {
		t.Errorf("bogus token: %d, want 401", code)
	}
	if code, _ := e.bearer(tok, "POST", path, "{}"); code != http.StatusForbidden {
		t.Errorf("token POST: %d, want 403 (scope-free is read-only)", code)
	}
	e.expect(http.StatusMethodNotAllowed, "alice", "POST", path, "{}")
}
