package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// TestForgejoProxy_StripsForgedHeaders_SetsForAuthedUser verifies the core
// security property of the /git SSO director: any client-supplied X-WEBAUTH-*
// headers are dropped, and the trusted values are set server-side only for an
// authenticated grown session.
func TestForgejoProxy_StripsForgedHeaders_SetsForAuthedUser(t *testing.T) {
	proxy := newForgejoProxy("http://forgejo.invalid:3000", "/git", nil, nil)
	if proxy == nil {
		t.Fatal("newForgejoProxy returned nil")
	}

	t.Run("authed user: forged headers replaced with trusted identity", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/git/some/repo", nil)
		// Attacker tries to impersonate someone else.
		req.Header.Set("X-WEBAUTH-USER", "attacker")
		req.Header.Set("X-WEBAUTH-EMAIL", "attacker@evil.com")

		ctx := auth.WithUser(req.Context(), users.User{Email: "victim@grown.haus"})
		ctx = auth.WithOrg(ctx, orgs.Org{Slug: "default", DisplayName: "Default"})
		req = req.WithContext(ctx)

		proxy.Director(req)

		if got := req.Header.Get("X-WEBAUTH-USER"); got != "victim" {
			t.Errorf("X-WEBAUTH-USER = %q, want %q (forged value must be replaced)", got, "victim")
		}
		if got := req.Header.Get("X-WEBAUTH-EMAIL"); got != "victim@grown.haus" {
			t.Errorf("X-WEBAUTH-EMAIL = %q, want %q", got, "victim@grown.haus")
		}
		if req.URL.Path != "/some/repo" {
			t.Errorf("path = %q, want /some/repo (/git stripped)", req.URL.Path)
		}
	})

	t.Run("anonymous: forged headers stripped, none set", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/git/", nil)
		req.Header.Set("X-WEBAUTH-USER", "attacker")
		req.Header.Set("X-WEBAUTH-EMAIL", "attacker@evil.com")
		// No user in context → anonymous.

		proxy.Director(req)

		if got := req.Header.Get("X-WEBAUTH-USER"); got != "" {
			t.Errorf("X-WEBAUTH-USER = %q, want empty (anonymous must carry no SSO header)", got)
		}
		if got := req.Header.Get("X-WEBAUTH-EMAIL"); got != "" {
			t.Errorf("X-WEBAUTH-EMAIL = %q, want empty", got)
		}
	})
}
