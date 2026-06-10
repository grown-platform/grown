package forgejo

import (
	"context"
	"log/slog"
	"os"
)

// OrgEvent carries the details of a newly-created grown org. It is the payload
// delivered to the OnCreate hook on internal/orgs.Repository.
type OrgEvent struct {
	// OrgID is the grown org's UUID.
	OrgID string
	// Slug is the org's URL-safe identifier (used as the Forgejo org name).
	Slug string
	// DisplayName is the human-readable org name (used as Forgejo full_name).
	DisplayName string
	// CreatorEmail is the email of the grown user who created the org. The
	// Forgejo username is derived from its local-part (see UsernameFromEmail).
	// Empty when bootstrapping without a creator (no Forgejo owner is then set).
	CreatorEmail string
}

// Provisioner mirrors a newly-created grown org into Forgejo. It is
// best-effort: errors are logged but never propagated to the caller so that a
// Forgejo outage never blocks grown org creation.
type Provisioner struct {
	client *Client
}

// NewProvisionerFromEnv constructs a Provisioner whose Client reads
// GROWN_FORGEJO_URL and GROWN_FORGEJO_ADMIN_TOKEN from the environment. When
// either is empty, the provisioner is a no-op.
func NewProvisionerFromEnv() *Provisioner {
	return &Provisioner{
		client: NewClient(
			os.Getenv("GROWN_FORGEJO_URL"),
			os.Getenv("GROWN_FORGEJO_ADMIN_TOKEN"),
		),
	}
}

// OnOrgCreated is the callback to assign to orgs.Repository.OnCreate. It
// provisions the Forgejo org in the background (best-effort, non-blocking):
// it creates the org, then optionally adds the creator as an Owners-team
// member. Errors are logged via slog and silently swallowed.
func (p *Provisioner) OnOrgCreated(ctx context.Context, e OrgEvent) {
	if !p.client.configured() {
		return
	}

	// Personal orgs (slug starts with "personal-") are single-user workspaces
	// that have no meaningful Forgejo analogue. Skip them.
	if len(e.Slug) > 9 && e.Slug[:9] == "personal-" {
		return
	}

	log := slog.Default().With("forgejo_org", e.Slug, "grown_org_id", e.OrgID)

	if err := p.client.CreateOrg(ctx, e.Slug, e.DisplayName); err != nil {
		log.WarnContext(ctx, "forgejo: create org failed (non-fatal)", "err", err)
		return
	}
	log.InfoContext(ctx, "forgejo: org provisioned")

	if e.CreatorEmail == "" {
		return
	}
	username := UsernameFromEmail(e.CreatorEmail)
	if err := p.client.AddOrgOwner(ctx, e.Slug, username); err != nil {
		log.WarnContext(ctx, "forgejo: add org owner failed (non-fatal)",
			"username", username, "err", err)
	}
}
