package forgejo

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"
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

	// webhookURL is grown's public webhook endpoint (GROWN_PUBLIC_URL +
	// "/api/v1/forgejo/webhook"); webhookSecret is the shared HMAC secret.
	// Both empty → webhook auto-registration is skipped.
	webhookURL    string
	webhookSecret string

	// accessCache deduplicates access-time provisioning (EnsureAccess) so we
	// don't hit the Forgejo API on every /git request. Keyed by
	// "email|slug|admin"; an entry means "provisioned within accessTTL ago".
	accessMu    sync.Mutex
	accessCache map[string]time.Time
}

// accessTTL is how long an EnsureAccess result is cached before we re-run the
// (idempotent) provisioning for the same user+org+role.
const accessTTL = 10 * time.Minute

// NewProvisionerFromEnv constructs a Provisioner whose Client reads
// GROWN_FORGEJO_URL and GROWN_FORGEJO_ADMIN_TOKEN from the environment. When
// either is empty, the provisioner is a no-op.
func NewProvisionerFromEnv() *Provisioner {
	publicURL := strings.TrimRight(os.Getenv("GROWN_PUBLIC_URL"), "/")
	secret := os.Getenv("GROWN_FORGEJO_WEBHOOK_SECRET")
	webhookURL := ""
	if publicURL != "" && secret != "" {
		webhookURL = publicURL + "/api/v1/forgejo/webhook"
	}
	return &Provisioner{
		client: NewClient(
			os.Getenv("GROWN_FORGEJO_URL"),
			os.Getenv("GROWN_FORGEJO_ADMIN_TOKEN"),
		),
		webhookURL:    webhookURL,
		webhookSecret: secret,
		accessCache:   make(map[string]time.Time),
	}
}

// Configured reports whether the underlying client can make real Forgejo API
// calls (both GROWN_FORGEJO_URL and GROWN_FORGEJO_ADMIN_TOKEN set). When false,
// every method is a safe no-op — this is what keeps the access-time provisioning
// inert on prod pick.haus, which has no admin token.
func (p *Provisioner) Configured() bool {
	return p != nil && p.client.configured()
}

// shouldProvision reports whether EnsureAccess should run for key (cache miss or
// stale) and, if so, records the attempt so concurrent/subsequent requests skip
// it for accessTTL.
func (p *Provisioner) shouldProvision(key string) bool {
	p.accessMu.Lock()
	defer p.accessMu.Unlock()
	if last, ok := p.accessCache[key]; ok && time.Since(last) < accessTTL {
		return false
	}
	p.accessCache[key] = time.Now()
	return true
}

// clearProvision drops a cache entry so a failed EnsureAccess is retried on the
// next request instead of being suppressed for the full TTL.
func (p *Provisioner) clearProvision(key string) {
	p.accessMu.Lock()
	delete(p.accessCache, key)
	p.accessMu.Unlock()
}

// ensureWebhook registers the org-level grown webhook (best-effort, idempotent).
// No-op when webhook env is unset.
func (p *Provisioner) ensureWebhook(ctx context.Context, slug string, log *slog.Logger) {
	if p.webhookURL == "" {
		return
	}
	if err := p.client.EnsureOrgWebhook(ctx, slug, p.webhookURL, p.webhookSecret); err != nil {
		log.WarnContext(ctx, "forgejo: ensure webhook failed (non-fatal)", "err", err)
	}
}

// EnsureAccess is the access-time provisioning hook: when an authenticated grown
// user reaches /git, it guarantees (best-effort, idempotent) that the Forgejo
// org named after their grown org slug exists and that the user is a member with
// the right role:
//
//   - grown admin  → Owners team (org owner / admin rights)
//   - otherwise     → Maintainers team (write access)
//
// It is rate-limited by an in-memory TTL cache keyed on user+org+role, so it
// touches the Forgejo API at most once per accessTTL per (user, org, role).
// Personal orgs (slug "personal-*") and unconfigured clients are skipped. This
// method NEVER blocks the caller meaningfully — callers should still invoke it
// in a goroutine — and never returns an error (it logs instead).
func (p *Provisioner) EnsureAccess(ctx context.Context, slug, displayName, email string, isAdmin bool) {
	if !p.Configured() || email == "" || slug == "" {
		return
	}
	if strings.HasPrefix(slug, "personal-") {
		return
	}

	key := email + "|" + slug + "|" + boolKey(isAdmin)
	if !p.shouldProvision(key) {
		return
	}

	username := UsernameFromEmail(email)
	log := slog.Default().With(
		"forgejo_org", slug, "forgejo_user", username, "admin", isAdmin)

	// 1. Ensure the org exists (idempotent; 422 = already there → success).
	if err := p.client.CreateOrg(ctx, slug, displayName); err != nil {
		log.WarnContext(ctx, "forgejo: ensure-access create org failed", "err", err)
		p.clearProvision(key) // retry next time
		return
	}
	p.ensureWebhook(ctx, slug, log)

	// 2. Add the user to the right team.
	if isAdmin {
		if err := p.client.AddOrgOwner(ctx, slug, username); err != nil {
			log.WarnContext(ctx, "forgejo: ensure-access add owner failed", "err", err)
			p.clearProvision(key)
		}
		return
	}
	teamID, err := p.client.EnsureMaintainersTeam(ctx, slug)
	if err != nil {
		log.WarnContext(ctx, "forgejo: ensure-access ensure maintainers team failed", "err", err)
		p.clearProvision(key)
		return
	}
	if err := p.client.AddTeamMember(ctx, teamID, username); err != nil {
		log.WarnContext(ctx, "forgejo: ensure-access add maintainer failed", "err", err)
		p.clearProvision(key)
	}
}

func boolKey(b bool) string {
	if b {
		return "admin"
	}
	return "member"
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
	p.ensureWebhook(ctx, e.Slug, log)

	if e.CreatorEmail == "" {
		return
	}
	username := UsernameFromEmail(e.CreatorEmail)
	if err := p.client.AddOrgOwner(ctx, e.Slug, username); err != nil {
		log.WarnContext(ctx, "forgejo: add org owner failed (non-fatal)",
			"username", username, "err", err)
	}
}
