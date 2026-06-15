package tickets

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func strptr(s string) *string { return &s }

// TestProjectJSONTeam verifies a team-intake project omits the public link
// fields and shapes the rest of the payload as the frontend expects.
func TestProjectJSONTeam(t *testing.T) {
	created := time.Unix(1700000000, 0)
	p := Project{
		ID:          "p1",
		Key:         "OPS",
		Name:        "Operations",
		Description: "desc",
		IntakeMode:  "team",
		Statuses:    []string{"open", "closed"},
		OpenCount:   3,
		CreatedAt:   created,
	}
	m := projectJSON(p, nil)

	if m["id"] != "p1" || m["key"] != "OPS" || m["name"] != "Operations" {
		t.Errorf("basic fields wrong: %v", m)
	}
	if m["intake_mode"] != "team" {
		t.Errorf("intake_mode = %v, want team", m["intake_mode"])
	}
	if m["open_count"] != 3 {
		t.Errorf("open_count = %v, want 3", m["open_count"])
	}
	if m["created_at"] != created.Unix() {
		t.Errorf("created_at = %v, want %d", m["created_at"], created.Unix())
	}
	if _, ok := m["public_token"]; ok {
		t.Error("team project should not expose public_token")
	}
	if _, ok := m["public_url"]; ok {
		t.Error("team project should not expose public_url")
	}
}

// TestProjectJSONPublicURL verifies a public project surfaces its token and a
// shareable absolute submit URL derived from the request host/scheme.
func TestProjectJSONPublicURL(t *testing.T) {
	p := Project{
		ID:          "p2",
		Key:         "SUP",
		Name:        "Support",
		IntakeMode:  "public",
		PublicToken: "pt_abc123",
		Statuses:    []string{"open"},
		CreatedAt:   time.Unix(1700000000, 0),
	}

	// Plain HTTP request (no TLS, no forwarded proto) -> http scheme.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tickets/projects", nil)
	req.Host = "tickets.example.com"
	m := projectJSON(p, req)

	if m["public_token"] != "pt_abc123" {
		t.Errorf("public_token = %v, want pt_abc123", m["public_token"])
	}
	wantURL := "http://tickets.example.com/tickets/submit/pt_abc123"
	if m["public_url"] != wantURL {
		t.Errorf("public_url = %v, want %v", m["public_url"], wantURL)
	}

	// With X-Forwarded-Proto set, scheme should be https.
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/tickets/projects", nil)
	req2.Host = "tickets.example.com"
	req2.Header.Set("X-Forwarded-Proto", "https")
	m2 := projectJSON(p, req2)
	wantHTTPS := "https://tickets.example.com/tickets/submit/pt_abc123"
	if m2["public_url"] != wantHTTPS {
		t.Errorf("public_url (forwarded) = %v, want %v", m2["public_url"], wantHTTPS)
	}
}

// TestProjectJSONPublicNilRequest verifies a public project still exposes the
// token even when there is no request to build an absolute URL from.
func TestProjectJSONPublicNilRequest(t *testing.T) {
	p := Project{IntakeMode: "public", PublicToken: "pt_xyz"}
	m := projectJSON(p, nil)
	if m["public_token"] != "pt_xyz" {
		t.Errorf("public_token = %v, want pt_xyz", m["public_token"])
	}
	if _, ok := m["public_url"]; ok {
		t.Error("public_url should be absent when request is nil")
	}
}

// TestTicketJSON verifies ref formatting (KEY-number) and the conditional
// inclusion of nullable requester/assignee ids.
func TestTicketJSON(t *testing.T) {
	created := time.Unix(1700000000, 0)
	updated := time.Unix(1700000500, 0)
	tk := Ticket{
		ID:             "t1",
		ProjectID:      "p1",
		ProjectKey:     "OPS",
		Number:         42,
		Title:          "Broken thing",
		Body:           "details",
		Status:         "open",
		Priority:       "high",
		RequesterName:  "Jane",
		RequesterEmail: "jane@example.com",
		Source:         "web",
		CreatedAt:      created,
		UpdatedAt:      updated,
	}
	m := ticketJSON(tk)

	if m["ref"] != "OPS-42" {
		t.Errorf("ref = %v, want OPS-42", m["ref"])
	}
	if m["number"] != int64(42) {
		t.Errorf("number = %v, want 42", m["number"])
	}
	if m["status"] != "open" || m["priority"] != "high" {
		t.Errorf("status/priority wrong: %v", m)
	}
	if m["created_at"] != created.Unix() || m["updated_at"] != updated.Unix() {
		t.Errorf("timestamps wrong: %v", m)
	}
	if _, ok := m["requester_user_id"]; ok {
		t.Error("requester_user_id should be absent when nil")
	}
	if _, ok := m["assignee_user_id"]; ok {
		t.Error("assignee_user_id should be absent when nil")
	}

	// Now with both ids set.
	tk.RequesterUserID = strptr("u-req")
	tk.AssigneeUserID = strptr("u-asg")
	m = ticketJSON(tk)
	if m["requester_user_id"] != "u-req" {
		t.Errorf("requester_user_id = %v, want u-req", m["requester_user_id"])
	}
	if m["assignee_user_id"] != "u-asg" {
		t.Errorf("assignee_user_id = %v, want u-asg", m["assignee_user_id"])
	}
}

// TestCommentJSON verifies comment shaping and conditional author id.
func TestCommentJSON(t *testing.T) {
	created := time.Unix(1700000000, 0)
	c := Comment{
		ID:         "c1",
		AuthorName: "Bob",
		Body:       "looking into it",
		IsInternal: true,
		CreatedAt:  created,
	}
	m := commentJSON(c)
	if m["id"] != "c1" || m["author_name"] != "Bob" || m["body"] != "looking into it" {
		t.Errorf("basic fields wrong: %v", m)
	}
	if m["is_internal"] != true {
		t.Errorf("is_internal = %v, want true", m["is_internal"])
	}
	if m["created_at"] != created.Unix() {
		t.Errorf("created_at = %v, want %d", m["created_at"], created.Unix())
	}
	if _, ok := m["author_user_id"]; ok {
		t.Error("author_user_id should be absent when nil")
	}

	c.AuthorUserID = strptr("u-1")
	m = commentJSON(c)
	if m["author_user_id"] != "u-1" {
		t.Errorf("author_user_id = %v, want u-1", m["author_user_id"])
	}
}

// TestCommentsJSON verifies the slice wrapper preserves order and never returns
// a nil slice (always at least an empty, non-nil slice for JSON).
func TestCommentsJSON(t *testing.T) {
	out := commentsJSON(nil)
	if out == nil {
		t.Fatal("commentsJSON(nil) = nil, want non-nil empty slice")
	}
	if len(out) != 0 {
		t.Fatalf("commentsJSON(nil) len = %d, want 0", len(out))
	}

	cs := []Comment{
		{ID: "c1", Body: "first"},
		{ID: "c2", Body: "second"},
	}
	out = commentsJSON(cs)
	if len(out) != 2 {
		t.Fatalf("len = %d, want 2", len(out))
	}
	if out[0]["id"] != "c1" || out[1]["id"] != "c2" {
		t.Errorf("order not preserved: %v", out)
	}
}

// TestHTTPErrStatus verifies error-to-status mapping: ErrNotFound -> 404,
// anything else -> 500.
func TestHTTPErrStatus(t *testing.T) {
	rr := httptest.NewRecorder()
	httpErr(rr, ErrNotFound)
	if rr.Code != http.StatusNotFound {
		t.Errorf("ErrNotFound -> %d, want 404", rr.Code)
	}

	rr = httptest.NewRecorder()
	httpErr(rr, errSentinel("boom"))
	if rr.Code != http.StatusInternalServerError {
		t.Errorf("generic error -> %d, want 500", rr.Code)
	}
}

type errSentinel string

func (e errSentinel) Error() string { return string(e) }
