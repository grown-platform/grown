package audit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestHandler builds a Handler with an empty allowlist (or the supplied
// comma-separated list) and no repo. Handlers under test here short-circuit
// before ever touching the repo, so a nil repo is fine.
func newTestHandler(adminEmails string) *Handler {
	return NewHandler(nil, adminEmails)
}

func TestNewHandler_AllowlistParsing(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []string // lowercased, trimmed entries that must be present
		miss []string // entries that must NOT be present
	}{
		{"empty", "", nil, []string{""}},
		{"single", "Admin@Example.com", []string{"admin@example.com"}, nil},
		{"trim+lower", "  Foo@Bar.COM , baz@qux.io ", []string{"foo@bar.com", "baz@qux.io"}, nil},
		{"blanks dropped", "a@b.com,,  ,c@d.com", []string{"a@b.com", "c@d.com"}, []string{""}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := NewHandler(nil, c.in)
			for _, w := range c.want {
				if _, ok := h.adminEmails[w]; !ok {
					t.Errorf("allowlist missing %q (got %v)", w, h.adminEmails)
				}
			}
			for _, m := range c.miss {
				if _, ok := h.adminEmails[m]; ok {
					t.Errorf("allowlist unexpectedly has %q", m)
				}
			}
		})
	}
}

func TestHandler_WithResolverAndAdminChecker_Chaining(t *testing.T) {
	h := newTestHandler("")
	resolver := EmailResolver(func(context.Context) (string, string, bool) { return "", "", false })
	checker := AdminChecker(func(context.Context) bool { return true })
	if got := h.WithResolver(resolver); got != h {
		t.Fatal("WithResolver should return the same handler for chaining")
	}
	if h.resolve == nil {
		t.Fatal("WithResolver did not set resolver")
	}
	if got := h.WithAdminChecker(checker); got != h {
		t.Fatal("WithAdminChecker should return the same handler for chaining")
	}
	if h.isOrgAdmin == nil {
		t.Fatal("WithAdminChecker did not set checker")
	}
}

func TestHandler_ServeHTTP_ShortCircuits(t *testing.T) {
	resolveOK := func(email, org string) EmailResolver {
		return func(context.Context) (string, string, bool) { return email, org, true }
	}
	resolveFail := EmailResolver(func(context.Context) (string, string, bool) { return "", "", false })

	cases := []struct {
		name       string
		method     string
		resolver   EmailResolver
		checker    AdminChecker
		allowlist  string
		wantStatus int
		wantErr    string
	}{
		{
			name:       "non-GET rejected",
			method:     http.MethodPost,
			wantStatus: http.StatusMethodNotAllowed,
			wantErr:    "method not allowed",
		},
		{
			name:       "no resolver => unauthorized",
			method:     http.MethodGet,
			resolver:   nil,
			wantStatus: http.StatusUnauthorized,
			wantErr:    "no session",
		},
		{
			name:       "resolver reports not-ok => unauthorized",
			method:     http.MethodGet,
			resolver:   resolveFail,
			wantStatus: http.StatusUnauthorized,
			wantErr:    "no session",
		},
		{
			name:       "authed but not admin => forbidden",
			method:     http.MethodGet,
			resolver:   resolveOK("user@x.com", "org1"),
			allowlist:  "",
			wantStatus: http.StatusForbidden,
			wantErr:    "admin privileges required",
		},
		{
			name:       "admin checker says no => forbidden",
			method:     http.MethodGet,
			resolver:   resolveOK("user@x.com", "org1"),
			checker:    func(context.Context) bool { return false },
			wantStatus: http.StatusForbidden,
			wantErr:    "admin privileges required",
		},
		{
			name:       "admin via allowlist but empty org => bad request",
			method:     http.MethodGet,
			resolver:   resolveOK("Admin@X.com", ""),
			allowlist:  "admin@x.com",
			wantStatus: http.StatusBadRequest,
			wantErr:    "no org context",
		},
		{
			name:       "admin via checker but empty org => bad request",
			method:     http.MethodGet,
			resolver:   resolveOK("user@x.com", ""),
			checker:    func(context.Context) bool { return true },
			wantStatus: http.StatusBadRequest,
			wantErr:    "no org context",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := newTestHandler(c.allowlist)
			if c.resolver != nil {
				h.WithResolver(c.resolver)
			}
			if c.checker != nil {
				h.WithAdminChecker(c.checker)
			}
			req := httptest.NewRequest(c.method, mountPath, nil)
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, req)

			if rr.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", rr.Code, c.wantStatus, rr.Body.String())
			}
			if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}
			var body map[string]any
			if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
				t.Fatalf("response not JSON: %v", err)
			}
			if got, _ := body["error"].(string); !strings.Contains(got, c.wantErr) {
				t.Errorf("error = %q, want contains %q", got, c.wantErr)
			}
		})
	}
}

// TestHandler_ServeHTTP_AdminReachesRepo confirms an authorized admin with a
// valid org passes every short-circuit and reaches the repo layer. With a nil
// repo, Repository.List returns (nil,nil), so the handler emits an empty events
// list with 200.
func TestHandler_ServeHTTP_AuthorizedEmptyList(t *testing.T) {
	h := NewHandler(NewRepository(nil), "admin@x.com").
		WithResolver(func(context.Context) (string, string, bool) {
			return "admin@x.com", "org-1", true
		})
	req := httptest.NewRequest(http.MethodGet, mountPath+"?service=video&actor=a@b.com&action=create&limit=5&before=2026-01-02T03:04:05Z", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Events []eventOut `json:"events"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("response not JSON: %v", err)
	}
	if body.Events == nil {
		t.Error("events should be a non-nil (empty) array")
	}
	if len(body.Events) != 0 {
		t.Errorf("events = %v, want empty", body.Events)
	}
}

// TestHandler_ServeHTTP_AdminViaChecker exercises the checker branch reaching
// the repo (also nil repo => empty list).
func TestHandler_ServeHTTP_AdminViaChecker(t *testing.T) {
	h := NewHandler(NewRepository(nil), "").
		WithResolver(func(context.Context) (string, string, bool) {
			return "member@x.com", "org-2", true
		}).
		WithAdminChecker(func(context.Context) bool { return true })
	req := httptest.NewRequest(http.MethodGet, mountPath, nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
}

// TestHandler_ServeHTTP_QueryParsing_BadValues ensures malformed limit/before
// are ignored gracefully (handler still returns 200).
func TestHandler_ServeHTTP_QueryParsing_BadValues(t *testing.T) {
	h := NewHandler(NewRepository(nil), "admin@x.com").
		WithResolver(func(context.Context) (string, string, bool) {
			return "admin@x.com", "org-1", true
		})
	req := httptest.NewRequest(http.MethodGet, mountPath+"?limit=notanumber&before=not-a-time", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rr.Code, rr.Body.String())
	}
}

func TestWriteJSON(t *testing.T) {
	rr := httptest.NewRecorder()
	writeJSON(rr, http.StatusTeapot, map[string]any{"hello": "world"})
	if rr.Code != http.StatusTeapot {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusTeapot)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
	var got map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("not JSON: %v", err)
	}
	if got["hello"] != "world" {
		t.Errorf("body = %v", got)
	}
}

// TestEventOut_JSONShaping verifies the omitempty / field-name contract of the
// JSON shape returned to the viewer.
func TestEventOut_JSONShaping(t *testing.T) {
	t.Run("omitempty drops actor_id/detail", func(t *testing.T) {
		b, err := json.Marshal(eventOut{ID: "1", ActorEmail: "a@b.com"})
		if err != nil {
			t.Fatal(err)
		}
		s := string(b)
		for _, mustNot := range []string{"actor_id", "detail"} {
			if strings.Contains(s, mustNot) {
				t.Errorf("expected %q omitted, got %s", mustNot, s)
			}
		}
		for _, must := range []string{"\"id\"", "\"actor_email\"", "\"service\"", "\"created_at\""} {
			if !strings.Contains(s, must) {
				t.Errorf("expected %q present, got %s", must, s)
			}
		}
	})
	t.Run("populated detail+actor_id present", func(t *testing.T) {
		b, _ := json.Marshal(eventOut{ID: "1", ActorID: "u1", Detail: map[string]any{"k": "v"}})
		s := string(b)
		if !strings.Contains(s, "actor_id") || !strings.Contains(s, "detail") {
			t.Errorf("expected actor_id+detail present, got %s", s)
		}
	})
}
