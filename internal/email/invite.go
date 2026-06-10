package email

import (
	"context"
	"fmt"
	"html"
)

// SendInvite delivers an account-invite email to the given address. The invite
// link is produced by Zitadel's invite_code flow (see adminusers.sendInvite),
// which returns a URL grown can optionally intercept and redirect. When the
// Sender is unconfigured (no RESEND_API_KEY) this is a no-op logged to slog
// so dev environments keep working without credentials.
//
// Parameters:
//   - to         – recipient address (the new user's primary or recovery email)
//   - name       – recipient's display name (used in the greeting)
//   - inviteURL  – the Zitadel-generated invite/verification URL
//   - orgName    – human-readable org name shown in the email body
func (s *Sender) SendInvite(ctx context.Context, to, name, inviteURL, orgName string) error {
	return s.sendInviteTo(ctx, resendEndpoint, to, name, inviteURL, orgName)
}

// sendInviteTo is the testable implementation that accepts an explicit endpoint.
func (s *Sender) sendInviteTo(ctx context.Context, endpoint, to, name, inviteURL, orgName string) error {
	greeting := name
	if greeting == "" {
		greeting = to
	}
	safeURL := html.EscapeString(inviteURL)
	safeName := html.EscapeString(greeting)
	safeOrg := html.EscapeString(orgName)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="margin-bottom:8px">You've been invited to %s</h2>
  <p>Hi %s,</p>
  <p>An administrator has created a Grown workspace account for you.
     Click the button below to set your password and get started.</p>
  <p style="margin:32px 0">
    <a href="%s"
       style="background:#4f46e5;color:#fff;text-decoration:none;
              padding:12px 24px;border-radius:6px;font-weight:600;display:inline-block">
      Accept invitation
    </a>
  </p>
  <p style="color:#6b7280;font-size:0.9em">
    If you weren't expecting this email you can safely ignore it.
    The link expires in 24 hours.
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb">
  <p style="color:#9ca3af;font-size:0.8em">Sent by Grown Workspace · pick.haus</p>
</body>
</html>`, safeOrg, safeName, safeURL)

	textBody := fmt.Sprintf(
		"You've been invited to %s\n\nHi %s,\n\n"+
			"An administrator has created a Grown workspace account for you.\n"+
			"Accept your invitation here:\n%s\n\n"+
			"The link expires in 24 hours.\n",
		orgName, greeting, inviteURL,
	)

	return s.sendTo(ctx, endpoint, Message{
		To:      []string{to},
		Subject: fmt.Sprintf("You've been invited to %s on Grown", orgName),
		HTML:    htmlBody,
		Text:    textBody,
	})
}

// SendPasswordReset delivers a password-reset link to the given address.
// The reset URL is Zitadel's verification code URL returned via returnCode
// from the Zitadel password endpoint.
func (s *Sender) SendPasswordReset(ctx context.Context, to, name, resetURL string) error {
	greeting := name
	if greeting == "" {
		greeting = to
	}
	safeURL := html.EscapeString(resetURL)
	safeName := html.EscapeString(greeting)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2>Reset your Grown password</h2>
  <p>Hi %s,</p>
  <p>A password reset was requested for your account.
     Click the button below to choose a new password.</p>
  <p style="margin:32px 0">
    <a href="%s"
       style="background:#4f46e5;color:#fff;text-decoration:none;
              padding:12px 24px;border-radius:6px;font-weight:600;display:inline-block">
      Reset password
    </a>
  </p>
  <p style="color:#6b7280;font-size:0.9em">
    If you didn't request this you can safely ignore it.
    The link expires in 24 hours.
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb">
  <p style="color:#9ca3af;font-size:0.8em">Sent by Grown Workspace · pick.haus</p>
</body>
</html>`, safeName, safeURL)

	textBody := fmt.Sprintf(
		"Reset your Grown password\n\nHi %s,\n\n"+
			"A password reset was requested for your account.\n"+
			"Reset it here:\n%s\n\n"+
			"The link expires in 24 hours.\n",
		greeting, resetURL,
	)

	return s.Send(ctx, Message{
		To:      []string{to},
		Subject: "Reset your Grown Workspace password",
		HTML:    htmlBody,
		Text:    textBody,
	})
}
