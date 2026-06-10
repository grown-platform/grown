// Package email provides grown's transactional outbound email path.
//
// When RESEND_API_KEY is set, Send dispatches email via the Resend HTTP API
// (https://api.resend.com/emails). When the key is absent the sender is a
// no-op that logs the message so development keeps working without credentials.
//
// The sending address defaults to "noreply@pick.haus" and can be overridden
// with GROWN_EMAIL_FROM.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	// resendEndpoint is the Resend email delivery endpoint. It is a var (not
	// const) so unit tests can substitute a local httptest.Server URL via
	// sendTo without patching the global.
	resendEndpoint     = "https://api.resend.com/emails"
	defaultFromAddress = "noreply@pick.haus"
	requestTimeout     = 15 * time.Second
)

// Message is an outbound transactional email.
type Message struct {
	// To is the list of recipient addresses (required, at least one).
	To []string
	// Subject is the email subject line (required).
	Subject string
	// HTML is the HTML body. Either HTML or Text (or both) must be non-empty.
	HTML string
	// Text is the plain-text body.
	Text string
	// From optionally overrides the sender's default From address. It must use a
	// Resend-verified domain (e.g. an @pick.haus address); a display name is
	// allowed ("Name <addr@pick.haus>"). When empty the Sender's default is used.
	From string
	// Cc is the optional list of carbon-copy recipients.
	Cc []string
	// ReplyTo optionally sets the Reply-To address (e.g. the composing user's
	// real address, so replies reach them even when From is a noreply sender).
	ReplyTo string
}

// Sender dispatches transactional emails. It is safe for concurrent use.
//
// Transport: by default it uses the Resend HTTP API. Set GROWN_EMAIL_TRANSPORT=smtp
// (with GROWN_SMTP_ADDR/USER/PASS) to send via a plain SMTP server instead — e.g.
// the self-hosted Mailu instance — with no Resend dependency.
type Sender struct {
	apiKey    string // empty = no Resend key
	from      string // RFC 5322 "Name <addr>" or bare address
	client    *http.Client
	transport string // "resend" (default) or "smtp"
	smtpAddr  string // host:port (587 submission/STARTTLS)
	smtpUser  string
	smtpPass  string
}

// NewSenderFromEnv constructs a Sender from environment variables.
//
//   - GROWN_EMAIL_FROM      – From address (default "noreply@pick.haus").
//   - GROWN_EMAIL_TRANSPORT – "resend" (default) or "smtp".
//   - RESEND_API_KEY        – Resend secret key (resend transport).
//   - GROWN_SMTP_ADDR/USER/PASS – SMTP server + creds (smtp transport, e.g. Mailu).
//
// When neither transport is configured the sender is a no-op that logs.
func NewSenderFromEnv() *Sender {
	from := os.Getenv("GROWN_EMAIL_FROM")
	if from == "" {
		from = defaultFromAddress
	}
	transport := strings.ToLower(strings.TrimSpace(os.Getenv("GROWN_EMAIL_TRANSPORT")))
	if transport == "" {
		transport = "resend"
	}
	return &Sender{
		apiKey:    os.Getenv("RESEND_API_KEY"),
		from:      from,
		client:    &http.Client{Timeout: requestTimeout},
		transport: transport,
		smtpAddr:  os.Getenv("GROWN_SMTP_ADDR"),
		smtpUser:  os.Getenv("GROWN_SMTP_USER"),
		smtpPass:  os.Getenv("GROWN_SMTP_PASS"),
	}
}

// NewSender constructs a Sender with explicit parameters. Pass an empty apiKey
// to get the no-op behaviour (useful in tests that verify the unconfigured path).
func NewSender(apiKey, from string, client *http.Client) *Sender {
	if from == "" {
		from = defaultFromAddress
	}
	if client == nil {
		client = &http.Client{Timeout: requestTimeout}
	}
	return &Sender{apiKey: apiKey, from: from, client: client}
}

// Configured reports whether the sender will actually deliver email (as opposed
// to logging a no-op): a Resend key for the resend transport, or an SMTP addr
// for the smtp transport.
func (s *Sender) Configured() bool {
	if s.transport == "smtp" {
		return s.smtpAddr != ""
	}
	return s.apiKey != ""
}

// From returns the sender's default From address (RFC 5322 form).
func (s *Sender) From() string { return s.from }

// Send dispatches m via the configured transport (Resend HTTP API or SMTP), or
// logs it when unconfigured.
func (s *Sender) Send(ctx context.Context, m Message) error {
	if s.transport == "smtp" {
		return s.sendSMTP(ctx, m)
	}
	return s.sendTo(ctx, resendEndpoint, m)
}

// sendTo is the internal implementation that accepts an explicit endpoint URL.
// Tests call this directly to substitute a local httptest.Server URL.
func (s *Sender) sendTo(ctx context.Context, endpoint string, m Message) error {
	if len(m.To) == 0 {
		return fmt.Errorf("email: at least one recipient is required")
	}
	if strings.TrimSpace(m.Subject) == "" {
		return fmt.Errorf("email: subject is required")
	}
	if strings.TrimSpace(m.HTML) == "" && strings.TrimSpace(m.Text) == "" {
		return fmt.Errorf("email: HTML or Text body is required")
	}

	if !s.Configured() {
		slog.Info("email: no RESEND_API_KEY — skipping send (no-op)",
			"to", m.To, "subject", m.Subject)
		return nil
	}

	from := s.from
	if strings.TrimSpace(m.From) != "" {
		from = m.From
	}
	payload := map[string]any{
		"from":    from,
		"to":      m.To,
		"subject": m.Subject,
	}
	if len(m.Cc) > 0 {
		payload["cc"] = m.Cc
	}
	if strings.TrimSpace(m.ReplyTo) != "" {
		payload["reply_to"] = m.ReplyTo
	}
	if m.HTML != "" {
		payload["html"] = m.HTML
	}
	if m.Text != "" {
		payload["text"] = m.Text
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("email: marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("email: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("email: http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("email: resend %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	return nil
}
