package slides

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/users"
)

func newTestMentions(read, write bool, sent *[]Notification) *Mentions {
	return NewMentions(
		func(*http.Request, string) (bool, bool) { return read, write },
		func(_ context.Context, _ string, uid string) (string, bool) {
			if uid == "stranger" {
				return "", false
			}
			return "org-" + uid, true
		},
		func(context.Context, string) string { return "Q3 plan" },
		func(_ context.Context, n Notification) error {
			*sent = append(*sent, n)
			return nil
		},
	)
}

func mentionReqFor(method, body string) *http.Request {
	r := httptest.NewRequest(method, "/api/v1/slides/d/deck-1/mentions", strings.NewReader(body))
	return r.WithContext(auth.WithUser(r.Context(), users.User{ID: "me", DisplayName: "Ann"}))
}

func TestMentions_NotifiesReadersOnly(t *testing.T) {
	var sent []Notification
	m := newTestMentions(true, true, &sent)
	rec := httptest.NewRecorder()
	m.ServeHTTP(rec, mentionReqFor(http.MethodPost,
		`{"user_ids":["bob","me","bob","stranger","cy"],"comment_id":"c1","text":"hey  @Bob\nlook"}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if len(sent) != 2 || sent[0].UserID != "bob" || sent[1].UserID != "cy" {
		t.Fatalf("sent = %+v", sent)
	}
	n := sent[0]
	if n.OrgID != "org-bob" || n.ActorUserID != "me" || n.Body != "hey @Bob look" ||
		n.TargetURL != "/slides/d/deck-1?comment=c1" || !strings.Contains(n.Title, "Ann mentioned you in “Q3 plan”") {
		t.Fatalf("notification = %+v", n)
	}
	if !strings.Contains(rec.Body.String(), `"notified":2`) {
		t.Fatalf("body %s", rec.Body)
	}
}

func TestMentions_RequiresWriteAndPost(t *testing.T) {
	var sent []Notification
	for _, tc := range []struct {
		read, write bool
		method      string
		want        int
	}{
		{true, false, http.MethodPost, http.StatusForbidden},
		{false, false, http.MethodPost, http.StatusNotFound},
		{true, true, http.MethodGet, http.StatusMethodNotAllowed},
	} {
		rec := httptest.NewRecorder()
		newTestMentions(tc.read, tc.write, &sent).ServeHTTP(rec, mentionReqFor(tc.method, `{"user_ids":["bob"]}`))
		if rec.Code != tc.want {
			t.Errorf("%+v: status %d", tc, rec.Code)
		}
	}
	if len(sent) != 0 {
		t.Fatalf("sent %v", sent)
	}
	rec := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/slides/d/deck-1/mentions", strings.NewReader(`{}`))
	newTestMentions(true, true, &sent).ServeHTTP(rec, r)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d", rec.Code)
	}
}

func TestMentions_CapsRecipients(t *testing.T) {
	var sent []Notification
	ids := make([]string, 0, 50)
	for i := 0; i < 50; i++ {
		ids = append(ids, `"u`+string(rune('a'+i%26))+string(rune('a'+i/26))+`"`)
	}
	rec := httptest.NewRecorder()
	newTestMentions(true, true, &sent).ServeHTTP(rec, mentionReqFor(http.MethodPost, `{"user_ids":[`+strings.Join(ids, ",")+`]}`))
	if len(sent) != MaxMentions {
		t.Fatalf("sent %d want %d", len(sent), MaxMentions)
	}
}

func TestMentionPath(t *testing.T) {
	if id, ok := MentionPath("/api/v1/slides/d/abc/mentions"); !ok || id != "abc" {
		t.Fatal(id, ok)
	}
	for _, p := range []string{"/api/v1/slides/d//mentions", "/api/v1/slides/d/a/b/mentions", "/api/v1/slides/d/a/connect"} {
		if _, ok := MentionPath(p); ok {
			t.Errorf("%s matched", p)
		}
	}
}
