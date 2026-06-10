package email

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ---------- test helpers ------------------------------------------------------

// captureServer returns a test server that records the last request body/headers
// and responds with statusCode.
func captureServer(statusCode int) (*httptest.Server, *capturedReq) {
	cap := &capturedReq{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap.method = r.Method
		cap.auth = r.Header.Get("Authorization")
		cap.ct = r.Header.Get("Content-Type")
		data, _ := io.ReadAll(r.Body)
		cap.body = data
		w.WriteHeader(statusCode)
		_, _ = w.Write([]byte(`{"id":"test-id"}`))
	}))
	return srv, cap
}

type capturedReq struct {
	method, auth, ct string
	body             []byte
}

// testSender builds a Sender that routes HTTP calls to srv.
func testSender(srv *httptest.Server, apiKey string) *Sender {
	return &Sender{
		apiKey: apiKey,
		from:   "noreply@pick.haus",
		client: srv.Client(),
	}
}

// ---------- NewSenderFromEnv -------------------------------------------------

func TestNewSenderFromEnv_DefaultFrom(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("GROWN_EMAIL_FROM", "")
	s := NewSenderFromEnv()
	if s.from != defaultFromAddress {
		t.Errorf("from = %q, want %q", s.from, defaultFromAddress)
	}
}

func TestNewSenderFromEnv_CustomFrom(t *testing.T) {
	t.Setenv("GROWN_EMAIL_FROM", "Grown <workspace@example.com>")
	s := NewSenderFromEnv()
	if s.from != "Grown <workspace@example.com>" {
		t.Errorf("from = %q", s.from)
	}
}

// ---------- Configured -------------------------------------------------------

func TestConfigured_WithKey(t *testing.T) {
	s := NewSender("some-key", "", nil)
	if !s.Configured() {
		t.Error("want Configured() = true when key is set")
	}
}

func TestConfigured_WithoutKey(t *testing.T) {
	s := NewSender("", "", nil)
	if s.Configured() {
		t.Error("want Configured() = false when key is empty")
	}
}

// ---------- Send — unconfigured no-op ----------------------------------------

// TestSend_NoOp_WhenUnconfigured verifies that calling Send without a key
// returns nil (no-op) and does NOT make any HTTP call. The test uses a real
// http.Client with no transport override; if a real request were made it would
// try to dial api.resend.com, which would timeout/fail in CI — a reliable
// canary that the no-op path is taken.
func TestSend_NoOp_WhenUnconfigured(t *testing.T) {
	s := NewSender("", "noreply@pick.haus", &http.Client{
		Transport: &panicTransport{t: t},
	})
	err := s.Send(context.Background(), Message{
		To:      []string{"alice@example.com"},
		Subject: "Hello",
		Text:    "Test body",
	})
	if err != nil {
		t.Errorf("unconfigured sender should not error, got: %v", err)
	}
}

// panicTransport is an http.RoundTripper that fails the test if called.
type panicTransport struct{ t *testing.T }

func (p *panicTransport) RoundTrip(*http.Request) (*http.Response, error) {
	p.t.Fatal("http request made when sender should be a no-op")
	return nil, nil
}

// ---------- Send — request shape ---------------------------------------------

func TestSend_RequestShape(t *testing.T) {
	srv, cap := captureServer(http.StatusOK)
	defer srv.Close()

	s := testSender(srv, "re_test_key")
	err := s.sendTo(context.Background(), srv.URL+"/emails", Message{
		To:      []string{"bob@example.com", "carol@example.com"},
		Subject: "Welcome",
		HTML:    "<p>Hi</p>",
		Text:    "Hi",
	})
	if err != nil {
		t.Fatalf("sendTo: %v", err)
	}

	if cap.method != http.MethodPost {
		t.Errorf("method = %q, want POST", cap.method)
	}
	if cap.auth != "Bearer re_test_key" {
		t.Errorf("Authorization = %q, want Bearer re_test_key", cap.auth)
	}
	if !strings.HasPrefix(cap.ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", cap.ct)
	}

	var payload map[string]any
	if err := json.Unmarshal(cap.body, &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if payload["from"] != "noreply@pick.haus" {
		t.Errorf("from = %v", payload["from"])
	}
	if payload["subject"] != "Welcome" {
		t.Errorf("subject = %v", payload["subject"])
	}
	if payload["html"] != "<p>Hi</p>" {
		t.Errorf("html = %v", payload["html"])
	}
	if payload["text"] != "Hi" {
		t.Errorf("text = %v", payload["text"])
	}
	tos, ok := payload["to"].([]any)
	if !ok || len(tos) != 2 {
		t.Errorf("to = %v, want 2 recipients", payload["to"])
	}
}

// TestSend_HTMLOnly verifies that when Text is empty the payload omits "text".
func TestSend_HTMLOnly(t *testing.T) {
	srv, cap := captureServer(http.StatusOK)
	defer srv.Close()

	s := testSender(srv, "key")
	err := s.sendTo(context.Background(), srv.URL, Message{
		To: []string{"x@y.com"}, Subject: "s", HTML: "<b>hi</b>",
	})
	if err != nil {
		t.Fatalf("sendTo: %v", err)
	}
	var payload map[string]any
	_ = json.Unmarshal(cap.body, &payload)
	if _, hasText := payload["text"]; hasText {
		t.Error("payload should not contain 'text' when Text is empty")
	}
}

// ---------- Send — non-2xx surfaces error ------------------------------------

func TestSend_NonOK_ReturnsError(t *testing.T) {
	srv, _ := captureServer(http.StatusUnprocessableEntity)
	defer srv.Close()

	s := testSender(srv, "key")
	err := s.sendTo(context.Background(), srv.URL+"/emails", Message{
		To: []string{"x@example.com"}, Subject: "s", Text: "t",
	})
	if err == nil {
		t.Fatal("expected error for non-2xx response")
	}
	if !strings.Contains(err.Error(), "422") {
		t.Errorf("error %q should mention status 422", err.Error())
	}
}

// ---------- Send — input validation ------------------------------------------

func TestSend_NoRecipients(t *testing.T) {
	s := NewSender("key", "", nil)
	err := s.Send(context.Background(), Message{Subject: "hi", Text: "body"})
	if err == nil || !strings.Contains(err.Error(), "recipient") {
		t.Errorf("expected recipient error, got %v", err)
	}
}

func TestSend_NoSubject(t *testing.T) {
	s := NewSender("key", "", nil)
	err := s.Send(context.Background(), Message{To: []string{"a@b.com"}, Text: "body"})
	if err == nil || !strings.Contains(err.Error(), "subject") {
		t.Errorf("expected subject error, got %v", err)
	}
}

func TestSend_NoBody(t *testing.T) {
	s := NewSender("key", "", nil)
	err := s.Send(context.Background(), Message{To: []string{"a@b.com"}, Subject: "hi"})
	if err == nil || !strings.Contains(err.Error(), "body") {
		t.Errorf("expected body error, got %v", err)
	}
}

// ---------- SendInvite -------------------------------------------------------

func TestSendInvite_RequestShape(t *testing.T) {
	srv, cap := captureServer(http.StatusOK)
	defer srv.Close()

	s := testSender(srv, "key")
	err := s.sendInviteTo(context.Background(), srv.URL+"/emails",
		"alice@example.com", "Alice", "https://auth.pick.haus/invite?code=abc", "Acme")
	if err != nil {
		t.Fatalf("sendInviteTo: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(cap.body, &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	subj, _ := payload["subject"].(string)
	if !strings.Contains(subj, "Acme") {
		t.Errorf("subject %q should contain org name", subj)
	}
	htmlBody, _ := payload["html"].(string)
	if !strings.Contains(htmlBody, "https://auth.pick.haus/invite?code=abc") {
		t.Errorf("html body should contain invite URL")
	}
	if !strings.Contains(htmlBody, "Alice") {
		t.Errorf("html body should contain recipient name")
	}
}

func TestSendInvite_NoOp_WhenUnconfigured(t *testing.T) {
	s := NewSender("", "noreply@pick.haus", &http.Client{
		Transport: &panicTransport{t: t},
	})
	// Should return nil without making any HTTP call.
	err := s.SendInvite(context.Background(),
		"bob@example.com", "Bob", "https://auth.pick.haus/invite?code=xyz", "Test Org")
	if err != nil {
		t.Errorf("unconfigured SendInvite should not error, got: %v", err)
	}
}
