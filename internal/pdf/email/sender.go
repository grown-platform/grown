package email

import (
	"bytes"
	"context"
	"fmt"
	"html/template"
	"log/slog"
	"net/smtp"
)

// Config holds email configuration
type Config struct {
	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	FromAddress  string
	FromName     string
	FrontendURL  string
}

// Sender handles sending emails
type Sender struct {
	cfg Config
}

// New creates a new email sender
func New(cfg Config) *Sender {
	return &Sender{cfg: cfg}
}

// SigningInvitation contains data for signing invitation email
type SigningInvitation struct {
	RecipientEmail string
	RecipientName  string
	SenderName     string
	DocumentName   string
	SigningURL     string
	ExpiresAt      string
	Message        string
}

// SigningComplete contains data for signing completion email
type SigningComplete struct {
	RecipientEmail string
	RecipientName  string
	DocumentName   string
	DownloadURL    string
	SignedAt       string
}

// SigningReminder contains data for reminder email
type SigningReminder struct {
	RecipientEmail string
	RecipientName  string
	SenderName     string
	DocumentName   string
	SigningURL     string
	ExpiresAt      string
}

// SendSigningInvitation sends an email inviting someone to sign a document
func (s *Sender) SendSigningInvitation(ctx context.Context, data SigningInvitation) error {
	subject := fmt.Sprintf("Please sign: %s", data.DocumentName)

	body, err := renderTemplate(signingInvitationTemplate, data)
	if err != nil {
		return fmt.Errorf("failed to render template: %w", err)
	}

	return s.sendEmail(data.RecipientEmail, subject, body)
}

// SendSigningComplete sends an email when a document is fully signed
func (s *Sender) SendSigningComplete(ctx context.Context, data SigningComplete) error {
	subject := fmt.Sprintf("Completed: %s", data.DocumentName)

	body, err := renderTemplate(signingCompleteTemplate, data)
	if err != nil {
		return fmt.Errorf("failed to render template: %w", err)
	}

	return s.sendEmail(data.RecipientEmail, subject, body)
}

// SendSigningReminder sends a reminder email
func (s *Sender) SendSigningReminder(ctx context.Context, data SigningReminder) error {
	subject := fmt.Sprintf("Reminder: Please sign %s", data.DocumentName)

	body, err := renderTemplate(signingReminderTemplate, data)
	if err != nil {
		return fmt.Errorf("failed to render template: %w", err)
	}

	return s.sendEmail(data.RecipientEmail, subject, body)
}

// SendDeclineNotification notifies the document owner that a signer declined
func (s *Sender) SendDeclineNotification(ctx context.Context, ownerEmail, ownerName, signerName, documentName, reason string) error {
	subject := fmt.Sprintf("Signing declined: %s", documentName)

	data := struct {
		OwnerName    string
		SignerName   string
		DocumentName string
		Reason       string
	}{ownerName, signerName, documentName, reason}

	body, err := renderTemplate(declineNotificationTemplate, data)
	if err != nil {
		return fmt.Errorf("failed to render template: %w", err)
	}

	return s.sendEmail(ownerEmail, subject, body)
}

func (s *Sender) sendEmail(to, subject, htmlBody string) error {
	if s.cfg.SMTPHost == "" {
		slog.Warn("Email not sent - SMTP not configured", "to", to, "subject", subject)
		return nil
	}

	from := s.cfg.FromAddress
	if s.cfg.FromName != "" {
		from = fmt.Sprintf("%s <%s>", s.cfg.FromName, s.cfg.FromAddress)
	}

	msg := fmt.Sprintf("From: %s\r\n"+
		"To: %s\r\n"+
		"Subject: %s\r\n"+
		"MIME-Version: 1.0\r\n"+
		"Content-Type: text/html; charset=UTF-8\r\n"+
		"\r\n"+
		"%s", from, to, subject, htmlBody)

	auth := smtp.PlainAuth("", s.cfg.SMTPUser, s.cfg.SMTPPassword, s.cfg.SMTPHost)
	addr := fmt.Sprintf("%s:%d", s.cfg.SMTPHost, s.cfg.SMTPPort)

	if err := smtp.SendMail(addr, auth, s.cfg.FromAddress, []string{to}, []byte(msg)); err != nil {
		slog.Error("Failed to send email", "to", to, "error", err)
		return fmt.Errorf("failed to send email: %w", err)
	}

	slog.Info("Email sent", "to", to, "subject", subject)
	return nil
}

func renderTemplate(tmplStr string, data interface{}) (string, error) {
	tmpl, err := template.New("email").Parse(tmplStr)
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", err
	}

	return buf.String(), nil
}

const signingInvitationTemplate = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; }
        .header { background: #1a1a1a; color: white; padding: 24px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 22px; font-weight: 500; }
        .content { padding: 32px 24px; background: #ffffff; }
        .document-name { font-size: 20px; font-weight: 600; color: #1a1a1a; margin: 16px 0; }
        .message-box { background: #f5f5f5; padding: 16px; border-radius: 6px; border-left: 4px solid #1a1a1a; margin: 20px 0; }
        .button-container { text-align: center; margin: 28px 0; }
        .footer { padding: 20px; font-size: 12px; color: #666; text-align: center; background: #f5f5f5; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 1px; margin-bottom: 12px;"><span style="color: #2563eb;">PDF</span><span style="color: #ffffff;">Sign</span></div>
            <h1>Document Signing Request</h1>
        </div>
        <div class="content">
            <p>Hello {{.RecipientName}},</p>
            <p><strong>{{.SenderName}}</strong> has requested your signature on:</p>
            <p class="document-name">{{.DocumentName}}</p>
            {{if .Message}}
            <div class="message-box"><em>"{{.Message}}"</em></div>
            {{end}}
            <div class="button-container">
                <a href="{{.SigningURL}}" style="display: inline-block; background: #2563eb; color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Review & Sign Document</a>
            </div>
            {{if .ExpiresAt}}
            <p style="color: #666; font-size: 14px; text-align: center;">This request expires on {{.ExpiresAt}}</p>
            {{end}}
        </div>
        <div class="footer">
            <p>Powered by <strong>Pdf</strong> &mdash; Secure Document Signing</p>
        </div>
    </div>
</body>
</html>
`

const signingCompleteTemplate = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; }
        .header { background: #1a1a1a; color: white; padding: 24px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 22px; font-weight: 500; }
        .success-badge { display: inline-block; background: #22c55e; color: white; padding: 4px 12px; border-radius: 20px; font-size: 14px; margin-top: 12px; }
        .content { padding: 32px 24px; background: #ffffff; }
        .document-name { font-size: 20px; font-weight: 600; color: #1a1a1a; margin: 16px 0; }
        .button-container { text-align: center; margin: 28px 0; }
        .footer { padding: 20px; font-size: 12px; color: #666; text-align: center; background: #f5f5f5; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 1px; margin-bottom: 12px;"><span style="color: #2563eb;">PDF</span><span style="color: #ffffff;">Sign</span></div>
            <h1>Document Signed!</h1>
            <span class="success-badge">Completed</span>
        </div>
        <div class="content">
            <p>Hello {{.RecipientName}},</p>
            <p>Great news! The following document has been fully signed by all parties:</p>
            <p class="document-name">{{.DocumentName}}</p>
            <p style="color: #666;">Completed on: {{.SignedAt}}</p>
            <div class="button-container">
                <a href="{{.DownloadURL}}" style="display: inline-block; background: #2563eb; color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Download Signed Document</a>
            </div>
        </div>
        <div class="footer">
            <p>Powered by <strong>Pdf</strong> &mdash; Secure Document Signing</p>
        </div>
    </div>
</body>
</html>
`

const signingReminderTemplate = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; }
        .header { background: #1a1a1a; color: white; padding: 24px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 22px; font-weight: 500; }
        .reminder-badge { display: inline-block; background: #f59e0b; color: white; padding: 4px 12px; border-radius: 20px; font-size: 14px; margin-top: 12px; }
        .content { padding: 32px 24px; background: #ffffff; }
        .document-name { font-size: 20px; font-weight: 600; color: #1a1a1a; margin: 16px 0; }
        .button-container { text-align: center; margin: 28px 0; }
        .footer { padding: 20px; font-size: 12px; color: #666; text-align: center; background: #f5f5f5; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 1px; margin-bottom: 12px;"><span style="color: #2563eb;">PDF</span><span style="color: #ffffff;">Sign</span></div>
            <h1>Reminder: Signature Needed</h1>
            <span class="reminder-badge">Action Required</span>
        </div>
        <div class="content">
            <p>Hello {{.RecipientName}},</p>
            <p>This is a friendly reminder that <strong>{{.SenderName}}</strong> is waiting for your signature on:</p>
            <p class="document-name">{{.DocumentName}}</p>
            <div class="button-container">
                <a href="{{.SigningURL}}" style="display: inline-block; background: #2563eb; color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Review & Sign Document</a>
            </div>
            {{if .ExpiresAt}}
            <p style="color: #ef4444; font-size: 14px; text-align: center;">This request expires on {{.ExpiresAt}}</p>
            {{end}}
        </div>
        <div class="footer">
            <p>Powered by <strong>Pdf</strong> &mdash; Secure Document Signing</p>
        </div>
    </div>
</body>
</html>
`

const declineNotificationTemplate = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; }
        .header { background: #1a1a1a; color: white; padding: 24px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 22px; font-weight: 500; }
        .declined-badge { display: inline-block; background: #ef4444; color: white; padding: 4px 12px; border-radius: 20px; font-size: 14px; margin-top: 12px; }
        .content { padding: 32px 24px; background: #ffffff; }
        .document-name { font-size: 20px; font-weight: 600; color: #1a1a1a; margin: 16px 0; }
        .reason-box { background: #fef2f2; padding: 16px; border-radius: 6px; border-left: 4px solid #ef4444; margin: 20px 0; }
        .footer { padding: 20px; font-size: 12px; color: #666; text-align: center; background: #f5f5f5; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 1px; margin-bottom: 12px;"><span style="color: #2563eb;">PDF</span><span style="color: #ffffff;">Sign</span></div>
            <h1>Signing Declined</h1>
            <span class="declined-badge">Declined</span>
        </div>
        <div class="content">
            <p>Hello {{.OwnerName}},</p>
            <p><strong>{{.SignerName}}</strong> has declined to sign:</p>
            <p class="document-name">{{.DocumentName}}</p>
            {{if .Reason}}
            <div class="reason-box">
                <strong>Reason:</strong> {{.Reason}}
            </div>
            {{end}}
        </div>
        <div class="footer">
            <p>Powered by <strong>Pdf</strong> &mdash; Secure Document Signing</p>
        </div>
    </div>
</body>
</html>
`
