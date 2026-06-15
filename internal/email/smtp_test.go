package email

import (
	"context"
	"strings"
	"testing"
)

// ---------- bareAddr ---------------------------------------------------------

func TestBareAddr(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"bare address", "addr@pick.haus", "addr@pick.haus"},
		{"display name", "Name <addr@pick.haus>", "addr@pick.haus"},
		{"display name with spaces inside angles", "Grown < workspace@example.com >", "workspace@example.com"},
		{"surrounding whitespace", "  addr@pick.haus  ", "addr@pick.haus"},
		{"empty", "", ""},
		{"open angle without close falls through to trim", "Name <addr@pick.haus", "Name <addr@pick.haus"},
		{"multiple angles uses last open", "a <b> <real@x.com>", "real@x.com"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := bareAddr(tt.in); got != tt.want {
				t.Errorf("bareAddr(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

// ---------- normalizeCRLF ----------------------------------------------------

func TestNormalizeCRLF(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"bare LF becomes CRLF", "a\nb", "a\r\nb"},
		{"existing CRLF preserved (not doubled)", "a\r\nb", "a\r\nb"},
		{"mixed", "a\nb\r\nc", "a\r\nb\r\nc"},
		{"no newline unchanged", "abc", "abc"},
		{"empty", "", ""},
		{"trailing LF", "abc\n", "abc\r\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizeCRLF(tt.in); got != tt.want {
				t.Errorf("normalizeCRLF(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

// ---------- buildMIME --------------------------------------------------------

func TestBuildMIME_Multipart(t *testing.T) {
	m := Message{
		To:      []string{"bob@example.com", "carol@example.com"},
		Cc:      []string{"cc@example.com"},
		ReplyTo: "reply@example.com",
		Subject: "Welcome",
		HTML:    "<p>Hi</p>",
		Text:    "Hi there",
	}
	got := string(buildMIME("noreply@pick.haus", m))

	wantSubstrings := []string{
		"From: noreply@pick.haus\r\n",
		"To: bob@example.com, carol@example.com\r\n",
		"Cc: cc@example.com\r\n",
		"Reply-To: reply@example.com\r\n",
		"Subject: Welcome\r\n",
		"MIME-Version: 1.0\r\n",
		"Date: ",
		"multipart/alternative; boundary=",
		"Content-Type: text/plain; charset=utf-8\r\n",
		"Content-Type: text/html; charset=utf-8\r\n",
		"Hi there",
		"<p>Hi</p>",
	}
	for _, sub := range wantSubstrings {
		if !strings.Contains(got, sub) {
			t.Errorf("multipart MIME missing %q\n--- got ---\n%s", sub, got)
		}
	}

	// The body must contain a closing boundary delimiter "--<boundary>--".
	if !strings.Contains(got, "--grown-alt-boundary-7c1f--\r\n") {
		t.Errorf("multipart MIME missing closing boundary\n%s", got)
	}
	// Plain part should appear before HTML part in alternative.
	plainIdx := strings.Index(got, "text/plain")
	htmlIdx := strings.Index(got, "text/html")
	if plainIdx < 0 || htmlIdx < 0 || plainIdx > htmlIdx {
		t.Errorf("expected text/plain before text/html, plain=%d html=%d", plainIdx, htmlIdx)
	}
}

func TestBuildMIME_HTMLOnly(t *testing.T) {
	m := Message{
		To:      []string{"x@y.com"},
		Subject: "s",
		HTML:    "<b>hi</b>",
	}
	got := string(buildMIME("from@pick.haus", m))

	if !strings.Contains(got, "Content-Type: text/html; charset=utf-8\r\n") {
		t.Errorf("html-only MIME missing html content type\n%s", got)
	}
	if strings.Contains(got, "multipart/alternative") {
		t.Errorf("html-only MIME should not be multipart\n%s", got)
	}
	if strings.Contains(got, "text/plain") {
		t.Errorf("html-only MIME should not include text/plain part\n%s", got)
	}
	if !strings.Contains(got, "<b>hi</b>") {
		t.Errorf("html-only MIME missing body\n%s", got)
	}
}

func TestBuildMIME_TextOnly(t *testing.T) {
	m := Message{
		To:      []string{"x@y.com"},
		Subject: "s",
		Text:    "plain body",
	}
	got := string(buildMIME("from@pick.haus", m))

	if !strings.Contains(got, "Content-Type: text/plain; charset=utf-8\r\n") {
		t.Errorf("text-only MIME missing plain content type\n%s", got)
	}
	if strings.Contains(got, "multipart/alternative") {
		t.Errorf("text-only MIME should not be multipart\n%s", got)
	}
	if strings.Contains(got, "text/html") {
		t.Errorf("text-only MIME should not include html part\n%s", got)
	}
	if !strings.Contains(got, "plain body") {
		t.Errorf("text-only MIME missing body\n%s", got)
	}
}

func TestBuildMIME_OmitsOptionalHeaders(t *testing.T) {
	m := Message{
		To:      []string{"x@y.com"},
		Subject: "s",
		Text:    "t",
	}
	got := string(buildMIME("from@pick.haus", m))
	if strings.Contains(got, "Cc:") {
		t.Errorf("MIME should omit Cc header when no Cc\n%s", got)
	}
	if strings.Contains(got, "Reply-To:") {
		t.Errorf("MIME should omit Reply-To header when empty\n%s", got)
	}
}

func TestBuildMIME_NormalizesBareLF(t *testing.T) {
	m := Message{
		To:      []string{"x@y.com"},
		Subject: "s",
		Text:    "line1\nline2",
	}
	got := string(buildMIME("from@pick.haus", m))
	if strings.Contains(got, "line1\nline2") {
		t.Errorf("body should have CRLF-normalized newlines\n%q", got)
	}
	if !strings.Contains(got, "line1\r\nline2") {
		t.Errorf("body should contain CRLF newlines\n%q", got)
	}
}

// ---------- sendSMTP validation ----------------------------------------------

// smtpSender builds a Sender configured for the smtp transport.
func smtpSender(addr string) *Sender {
	return &Sender{
		from:      "noreply@pick.haus",
		transport: "smtp",
		smtpAddr:  addr,
	}
}

func TestSendSMTP_Validation(t *testing.T) {
	tests := []struct {
		name    string
		addr    string
		msg     Message
		wantSub string
	}{
		{
			name:    "no recipients",
			addr:    "mail.example.com:587",
			msg:     Message{Subject: "s", Text: "t"},
			wantSub: "recipient",
		},
		{
			name:    "no subject",
			addr:    "mail.example.com:587",
			msg:     Message{To: []string{"a@b.com"}, Text: "t"},
			wantSub: "subject",
		},
		{
			name:    "no body",
			addr:    "mail.example.com:587",
			msg:     Message{To: []string{"a@b.com"}, Subject: "s"},
			wantSub: "body",
		},
		{
			name:    "no smtp addr",
			addr:    "",
			msg:     Message{To: []string{"a@b.com"}, Subject: "s", Text: "t"},
			wantSub: "GROWN_SMTP_ADDR",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := smtpSender(tt.addr)
			err := s.sendSMTP(context.Background(), tt.msg)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tt.wantSub)
			}
			if !strings.Contains(err.Error(), tt.wantSub) {
				t.Errorf("error %q should contain %q", err.Error(), tt.wantSub)
			}
		})
	}
}

// TestSend_SMTPTransport_RoutesToSMTP verifies that Send dispatches to the SMTP
// path when transport is "smtp": validation runs there (so an unset addr yields
// the GROWN_SMTP_ADDR error rather than a Resend error), and no network is used.
func TestSend_SMTPTransport_RoutesToSMTP(t *testing.T) {
	s := smtpSender("")
	err := s.Send(context.Background(), Message{
		To: []string{"a@b.com"}, Subject: "s", Text: "t",
	})
	if err == nil || !strings.Contains(err.Error(), "GROWN_SMTP_ADDR") {
		t.Errorf("expected SMTP addr error from smtp transport, got %v", err)
	}
}
