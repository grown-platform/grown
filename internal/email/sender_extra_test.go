package email

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

// ---------- From() -----------------------------------------------------------

func TestFrom_ReturnsDefault(t *testing.T) {
	s := NewSender("key", "", nil)
	if s.From() != defaultFromAddress {
		t.Errorf("From() = %q, want %q", s.From(), defaultFromAddress)
	}
}

func TestFrom_ReturnsOverride(t *testing.T) {
	s := NewSender("key", "Grown <hi@pick.haus>", nil)
	if s.From() != "Grown <hi@pick.haus>" {
		t.Errorf("From() = %q", s.From())
	}
}

// ---------- NewSenderFromEnv — transport & smtp settings ---------------------

func TestNewSenderFromEnv_DefaultTransport(t *testing.T) {
	t.Setenv("GROWN_EMAIL_TRANSPORT", "")
	s := NewSenderFromEnv()
	if s.transport != "resend" {
		t.Errorf("transport = %q, want resend", s.transport)
	}
}

func TestNewSenderFromEnv_SMTPTransport(t *testing.T) {
	t.Setenv("GROWN_EMAIL_TRANSPORT", "  SMTP  ")
	t.Setenv("GROWN_SMTP_ADDR", "mail.example.com:587")
	t.Setenv("GROWN_SMTP_USER", "user")
	t.Setenv("GROWN_SMTP_PASS", "pass")
	s := NewSenderFromEnv()
	if s.transport != "smtp" {
		t.Errorf("transport = %q, want smtp (trimmed+lowered)", s.transport)
	}
	if s.smtpAddr != "mail.example.com:587" {
		t.Errorf("smtpAddr = %q", s.smtpAddr)
	}
	if s.smtpUser != "user" || s.smtpPass != "pass" {
		t.Errorf("smtp creds not loaded: user=%q pass=%q", s.smtpUser, s.smtpPass)
	}
}

// ---------- Configured — smtp transport --------------------------------------

func TestConfigured_SMTPTransport(t *testing.T) {
	tests := []struct {
		name string
		addr string
		want bool
	}{
		{"smtp with addr is configured", "mail.example.com:587", true},
		{"smtp without addr is no-op", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &Sender{transport: "smtp", smtpAddr: tt.addr}
			if got := s.Configured(); got != tt.want {
				t.Errorf("Configured() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestConfigured_SMTPIgnoresAPIKey verifies the smtp branch does not consult
// apiKey: a Resend key present but smtp transport selected with no addr is NOT
// configured.
func TestConfigured_SMTPIgnoresAPIKey(t *testing.T) {
	s := &Sender{transport: "smtp", apiKey: "re_key", smtpAddr: ""}
	if s.Configured() {
		t.Error("smtp transport with no addr should be unconfigured despite apiKey")
	}
}

// ---------- sendTo — optional payload fields (cc, reply_to, from override) ----

func TestSend_PayloadIncludesCcReplyToAndFromOverride(t *testing.T) {
	srv, cap := captureServer(http.StatusOK)
	defer srv.Close()

	s := testSender(srv, "key")
	err := s.sendTo(context.Background(), srv.URL, Message{
		To:      []string{"a@b.com"},
		Cc:      []string{"cc1@b.com", "cc2@b.com"},
		ReplyTo: "reply@b.com",
		From:    "Override <over@pick.haus>",
		Subject: "s",
		Text:    "t",
	})
	if err != nil {
		t.Fatalf("sendTo: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(cap.body, &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["from"] != "Override <over@pick.haus>" {
		t.Errorf("from = %v, want override", payload["from"])
	}
	if payload["reply_to"] != "reply@b.com" {
		t.Errorf("reply_to = %v", payload["reply_to"])
	}
	cc, ok := payload["cc"].([]any)
	if !ok || len(cc) != 2 {
		t.Errorf("cc = %v, want 2 entries", payload["cc"])
	}
}

// TestSend_PayloadOmitsOptionalFields verifies cc/reply_to are absent when unset.
func TestSend_PayloadOmitsOptionalFields(t *testing.T) {
	srv, cap := captureServer(http.StatusOK)
	defer srv.Close()

	s := testSender(srv, "key")
	err := s.sendTo(context.Background(), srv.URL, Message{
		To: []string{"a@b.com"}, Subject: "s", Text: "t",
	})
	if err != nil {
		t.Fatalf("sendTo: %v", err)
	}
	var payload map[string]any
	_ = json.Unmarshal(cap.body, &payload)
	if _, ok := payload["cc"]; ok {
		t.Error("payload should omit cc when none set")
	}
	if _, ok := payload["reply_to"]; ok {
		t.Error("payload should omit reply_to when empty")
	}
	// from should fall back to the sender default.
	if payload["from"] != "noreply@pick.haus" {
		t.Errorf("from = %v, want sender default", payload["from"])
	}
}

// ---------- SendPasswordReset ------------------------------------------------

// TestSendPasswordReset_Validation exercises SendPasswordReset's body building
// and the input validation it inherits from Send. SendPasswordReset always
// provides To/Subject/Body so it should reach the configured check; with an
// unconfigured sender it is a logged no-op returning nil.
func TestSendPasswordReset_NoOp_WhenUnconfigured(t *testing.T) {
	s := NewSender("", "noreply@pick.haus", &http.Client{
		Transport: &panicTransport{t: t},
	})
	err := s.SendPasswordReset(context.Background(),
		"user@example.com", "User", "https://auth.pick.haus/reset?code=abc")
	if err != nil {
		t.Errorf("unconfigured SendPasswordReset should not error, got: %v", err)
	}
}

// captureTransport records the body of any request it sees and returns 200,
// regardless of the request URL. This lets us capture requests that target the
// hard-coded resendEndpoint (e.g. SendPasswordReset, which goes through Send).
type captureTransport struct{ body []byte }

func (c *captureTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.Body != nil {
		c.body, _ = io.ReadAll(r.Body)
		_ = r.Body.Close()
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       http.NoBody,
		Header:     make(http.Header),
		Request:    r,
	}, nil
}

// TestSendPasswordReset_RendersBody verifies SendPasswordReset builds a payload
// with the reset subject, the (HTML-escaped) reset URL in the HTML body, the
// recipient in To, and that an empty name falls back to the address in the
// greeting. It uses a transport that captures the request to the hard-coded
// Resend endpoint without any network access.
func TestSendPasswordReset_RendersBody(t *testing.T) {
	ct := &captureTransport{}
	s := NewSender("re_key", "noreply@pick.haus", &http.Client{Transport: ct})

	resetURL := "https://auth.pick.haus/reset?a=1&b=2"
	if err := s.SendPasswordReset(context.Background(),
		"user@example.com", "", resetURL); err != nil {
		t.Fatalf("SendPasswordReset: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(ct.body, &payload); err != nil {
		t.Fatalf("decode payload: %v\nbody=%s", err, ct.body)
	}

	subj, _ := payload["subject"].(string)
	if !strings.Contains(subj, "Reset your Grown Workspace password") {
		t.Errorf("subject = %q", subj)
	}
	tos, ok := payload["to"].([]any)
	if !ok || len(tos) != 1 || tos[0] != "user@example.com" {
		t.Errorf("to = %v", payload["to"])
	}
	htmlBody, _ := payload["html"].(string)
	// URL is HTML-escaped: "&" -> "&amp;".
	if !strings.Contains(htmlBody, "https://auth.pick.haus/reset?a=1&amp;b=2") {
		t.Errorf("html body should contain escaped reset URL\n%s", htmlBody)
	}
	// Empty name -> greeting falls back to the recipient address.
	if !strings.Contains(htmlBody, "user@example.com") {
		t.Errorf("html body should greet by address when name empty\n%s", htmlBody)
	}
	textBody, _ := payload["text"].(string)
	if !strings.Contains(textBody, resetURL) {
		t.Errorf("text body should contain raw reset URL\n%s", textBody)
	}
}
