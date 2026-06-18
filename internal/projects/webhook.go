package projects

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
)

// ── Forgejo webhook payloads (only the fields we use) ────────────────────────

type forgejoRepo struct {
	FullName string `json:"full_name"` // "owner/name"
	Owner    struct {
		Username string `json:"username"` // == grown org slug
	} `json:"owner"`
}

type forgejoCommit struct {
	ID      string `json:"id"`
	Message string `json:"message"`
	URL     string `json:"url"`
}

type pushPayload struct {
	Ref        string          `json:"ref"` // refs/heads/<branch>
	Commits    []forgejoCommit `json:"commits"`
	Repository forgejoRepo     `json:"repository"`
}

type pullRequestPayload struct {
	Action      string `json:"action"` // opened|reopened|closed|edited|...
	PullRequest struct {
		Number int64  `json:"number"`
		Title  string `json:"title"`
		Body   string `json:"body"`
		URL    string `json:"html_url"`
		Merged bool   `json:"merged"`
		Head   struct {
			Ref string `json:"ref"` // source branch name
		} `json:"head"`
	} `json:"pull_request"`
	Repository forgejoRepo `json:"repository"`
}

// webhookStore is the narrow slice of the repository the webhook processor needs.
// *Repository satisfies it; tests supply an in-memory fake so the processing
// rules can be exercised without a database.
type webhookStore interface {
	OrgIDBySlug(ctx context.Context, slug string) (string, error)
	FindIssueByKeyNumber(ctx context.Context, orgID, key string, number int32) (Issue, error)
	UpsertGitLink(ctx context.Context, l GitLink) error
	GetIssue(ctx context.Context, orgID, id string) (Issue, error)
	UpdateIssue(ctx context.Context, orgID, id string, p IssuePatch) (Issue, error)
}

// verifyForgejoSignature reports whether hexSig equals HMAC-SHA256(body, secret).
func verifyForgejoSignature(body []byte, hexSig, secret string) bool {
	want, err := hex.DecodeString(hexSig)
	if err != nil {
		return false
	}
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(body)
	return hmac.Equal(want, m.Sum(nil))
}

// HandleForgejoWebhook is the public (unauthenticated, signature-verified) HTTP
// entry point for Forgejo org webhooks. Registered at POST /api/v1/forgejo/webhook.
func (s *Service) HandleForgejoWebhook(w http.ResponseWriter, r *http.Request) {
	serveForgejoWebhook(w, r, s.ForgejoWebhookSecret, &webhookProcessor{store: s.repo, hub: s.hub})
}

// serveForgejoWebhook verifies the signature, parses the event, and dispatches
// to proc. Split out from HandleForgejoWebhook so tests can drive the full path
// (signature → dispatch → processing) with an in-memory store. When secret is
// empty the endpoint is disabled (503).
func serveForgejoWebhook(w http.ResponseWriter, r *http.Request, secret string, proc *webhookProcessor) {
	if secret == "" {
		http.Error(w, "forgejo webhook disabled", http.StatusServiceUnavailable)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20)) // 4 MiB cap
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	sig := r.Header.Get("X-Forgejo-Signature")
	if !verifyForgejoSignature(body, sig, secret) {
		http.Error(w, "bad signature", http.StatusUnauthorized)
		return
	}
	ctx := r.Context()
	switch r.Header.Get("X-Forgejo-Event") {
	case "push":
		var p pushPayload
		if err := json.Unmarshal(body, &p); err != nil {
			http.Error(w, "bad payload", http.StatusBadRequest)
			return
		}
		proc.processPush(ctx, p)
	case "pull_request":
		var p pullRequestPayload
		if err := json.Unmarshal(body, &p); err != nil {
			http.Error(w, "bad payload", http.StatusBadRequest)
			return
		}
		proc.processPullRequest(ctx, p)
	default:
		// Unknown/uninteresting event — acknowledge so Forgejo doesn't retry.
	}
	w.WriteHeader(http.StatusNoContent)
}

// webhookProcessor applies Forgejo webhook events to issues: it links branches /
// PRs / commits and advances issue status per the Linear-style rules. It depends
// only on webhookStore (+ an optional broadcast hub), so it is unit-testable.
type webhookProcessor struct {
	store webhookStore
	hub   *Hub
}

// resolveOrg maps a Forgejo repo owner (org slug) to a grown org id, or "".
func (p *webhookProcessor) resolveOrg(ctx context.Context, repo forgejoRepo) string {
	slug := repo.Owner.Username
	if slug == "" {
		return ""
	}
	orgID, err := p.store.OrgIDBySlug(ctx, slug)
	if err != nil {
		return ""
	}
	return orgID
}

// processPush links referenced issues to the pushed branch + each commit. Pushes
// never change issue status (status keys off the PR, mirroring Linear).
func (p *webhookProcessor) processPush(ctx context.Context, ev pushPayload) {
	orgID := p.resolveOrg(ctx, ev.Repository)
	if orgID == "" {
		return
	}
	branch := branchFromRef(ev.Ref)
	for _, ref := range ParseRefs(ev.Ref) {
		p.linkRef(ctx, orgID, ref, GitLink{
			Kind: "branch", Repo: ev.Repository.FullName, Ref: branch, Title: branch,
			State: "open", IsMagic: ref.Magic,
		})
	}
	for _, c := range ev.Commits {
		for _, ref := range ParseRefs(c.Message) {
			title := c.Message
			if i := strings.IndexByte(title, '\n'); i >= 0 {
				title = title[:i] // first line only
			}
			p.linkRef(ctx, orgID, ref, GitLink{
				Kind: "commit", Repo: ev.Repository.FullName, Ref: c.ID, URL: c.URL,
				Title: title, State: "open", IsMagic: ref.Magic,
			})
		}
	}
}

// processPullRequest links the PR and applies the status rules.
func (p *webhookProcessor) processPullRequest(ctx context.Context, ev pullRequestPayload) {
	orgID := p.resolveOrg(ctx, ev.Repository)
	if orgID == "" {
		return
	}
	pr := ev.PullRequest
	refs := ParseRefs(pr.Head.Ref + " " + pr.Title + " " + pr.Body)
	prState := "open"
	switch {
	case ev.Action == "closed" && pr.Merged:
		prState = "merged"
	case ev.Action == "closed":
		prState = "closed"
	}
	for _, ref := range refs {
		issue := p.linkRef(ctx, orgID, ref, GitLink{
			Kind: "pr", Repo: ev.Repository.FullName, Ref: strconv.FormatInt(pr.Number, 10),
			URL: pr.URL, Title: pr.Title, State: prState, IsMagic: ref.Magic,
		})
		if issue == nil {
			continue
		}
		switch {
		case (ev.Action == "opened" || ev.Action == "reopened") &&
			(issue.Status == "backlog" || issue.Status == "todo"):
			p.setIssueStatus(ctx, orgID, *issue, "in_progress")
		case ev.Action == "closed" && pr.Merged && ref.Magic &&
			issue.Status != "done" && issue.Status != "canceled":
			p.setIssueStatus(ctx, orgID, *issue, "done")
		}
	}
}

// linkRef resolves an issue ref, upserts the git link, and returns the resolved
// issue (nil when it doesn't resolve). The passed link omits org/issue ids,
// which linkRef fills in.
func (p *webhookProcessor) linkRef(ctx context.Context, orgID string, ref Ref, l GitLink) *Issue {
	issue, err := p.store.FindIssueByKeyNumber(ctx, orgID, ref.Key, ref.Number)
	if err != nil {
		return nil // unknown identifier — ignore
	}
	l.OrgID = orgID
	l.IssueID = issue.ID
	if err := p.store.UpsertGitLink(ctx, l); err != nil {
		slog.WarnContext(ctx, "projects: upsert git link failed", "err", err)
	}
	p.broadcastIssue(ctx, orgID, issue.ID)
	return &issue
}

// setIssueStatus patches an issue's status and broadcasts the change.
func (p *webhookProcessor) setIssueStatus(ctx context.Context, orgID string, issue Issue, status string) {
	if issue.Status == status {
		return
	}
	if _, err := p.store.UpdateIssue(ctx, orgID, issue.ID, IssuePatch{Status: status, StatusSet: true}); err != nil {
		slog.WarnContext(ctx, "projects: webhook status update failed", "err", err)
		return
	}
	p.broadcastIssue(ctx, orgID, issue.ID)
}

// broadcastIssue re-reads an issue and pushes it over the collab hub.
func (p *webhookProcessor) broadcastIssue(ctx context.Context, orgID, issueID string) {
	if p.hub == nil {
		return
	}
	fresh, err := p.store.GetIssue(ctx, orgID, issueID)
	if err != nil {
		return
	}
	p.hub.BroadcastIssue(fresh.TeamID, issueProto(fresh))
}

// branchFromRef turns a git ref ("refs/heads/alice/eng-42-fix") into a branch
// name ("alice/eng-42-fix") by stripping only the refs/heads/ prefix — keeping
// any user/topic slashes so distinct branches don't collide on the link key.
func branchFromRef(ref string) string {
	return strings.TrimPrefix(ref, "refs/heads/")
}
