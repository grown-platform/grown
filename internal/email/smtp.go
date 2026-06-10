package email

import (
	"context"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// sendSMTP delivers m via a plain SMTP server (e.g. self-hosted Mailu) instead
// of the Resend HTTP API. Uses STARTTLS + PLAIN auth on submission (587) when
// credentials are set; sends unauthenticated otherwise (internal relay).
//
// No Resend dependency: this is the "send without Resend" path.
func (s *Sender) sendSMTP(_ context.Context, m Message) error {
	if len(m.To) == 0 {
		return fmt.Errorf("email: at least one recipient is required")
	}
	if strings.TrimSpace(m.Subject) == "" {
		return fmt.Errorf("email: subject is required")
	}
	if strings.TrimSpace(m.HTML) == "" && strings.TrimSpace(m.Text) == "" {
		return fmt.Errorf("email: HTML or Text body is required")
	}
	if s.smtpAddr == "" {
		return fmt.Errorf("email: GROWN_SMTP_ADDR not set")
	}

	from := s.from
	if strings.TrimSpace(m.From) != "" {
		from = m.From
	}
	envelopeFrom := bareAddr(from)

	rcpts := make([]string, 0, len(m.To)+len(m.Cc))
	for _, a := range append(append([]string{}, m.To...), m.Cc...) {
		if b := bareAddr(a); b != "" {
			rcpts = append(rcpts, b)
		}
	}

	host := s.smtpAddr
	if h, _, err := net.SplitHostPort(s.smtpAddr); err == nil {
		host = h
	}
	var auth smtp.Auth
	if s.smtpUser != "" {
		auth = smtp.PlainAuth("", s.smtpUser, s.smtpPass, host)
	}

	msg := buildMIME(from, m)
	if err := smtp.SendMail(s.smtpAddr, auth, envelopeFrom, rcpts, msg); err != nil {
		return fmt.Errorf("email: smtp send via %s: %w", s.smtpAddr, err)
	}
	return nil
}

// buildMIME renders an RFC 5322 message. If both HTML and Text are present it
// emits a multipart/alternative body; otherwise a single text or html part.
func buildMIME(from string, m Message) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", strings.Join(m.To, ", "))
	if len(m.Cc) > 0 {
		fmt.Fprintf(&b, "Cc: %s\r\n", strings.Join(m.Cc, ", "))
	}
	if strings.TrimSpace(m.ReplyTo) != "" {
		fmt.Fprintf(&b, "Reply-To: %s\r\n", m.ReplyTo)
	}
	fmt.Fprintf(&b, "Subject: %s\r\n", m.Subject)
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	b.WriteString("MIME-Version: 1.0\r\n")

	hasHTML := strings.TrimSpace(m.HTML) != ""
	hasText := strings.TrimSpace(m.Text) != ""

	switch {
	case hasHTML && hasText:
		boundary := "grown-alt-boundary-7c1f"
		fmt.Fprintf(&b, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", boundary)
		fmt.Fprintf(&b, "--%s\r\n", boundary)
		b.WriteString("Content-Type: text/plain; charset=utf-8\r\n\r\n")
		b.WriteString(normalizeCRLF(m.Text))
		b.WriteString("\r\n")
		fmt.Fprintf(&b, "--%s\r\n", boundary)
		b.WriteString("Content-Type: text/html; charset=utf-8\r\n\r\n")
		b.WriteString(normalizeCRLF(m.HTML))
		b.WriteString("\r\n")
		fmt.Fprintf(&b, "--%s--\r\n", boundary)
	case hasHTML:
		b.WriteString("Content-Type: text/html; charset=utf-8\r\n\r\n")
		b.WriteString(normalizeCRLF(m.HTML))
	default:
		b.WriteString("Content-Type: text/plain; charset=utf-8\r\n\r\n")
		b.WriteString(normalizeCRLF(m.Text))
	}
	return []byte(b.String())
}

// bareAddr extracts the bare address from "Name <addr>" or "addr".
func bareAddr(s string) string {
	if i := strings.LastIndex(s, "<"); i >= 0 {
		if j := strings.Index(s[i:], ">"); j >= 0 {
			return strings.TrimSpace(s[i+1 : i+j])
		}
	}
	return strings.TrimSpace(s)
}

func normalizeCRLF(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.ReplaceAll(s, "\n", "\r\n")
}
