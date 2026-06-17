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
	if s.ForgejoWebhookSecret == "" {
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
	if !verifyForgejoSignature(body, sig, s.ForgejoWebhookSecret) {
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
		s.processPush(ctx, p)
	case "pull_request":
		var p pullRequestPayload
		if err := json.Unmarshal(body, &p); err != nil {
			http.Error(w, "bad payload", http.StatusBadRequest)
			return
		}
		s.processPullRequest(ctx, p)
	default:
		// Unknown/uninteresting event — acknowledge so Forgejo doesn't retry.
	}
	w.WriteHeader(http.StatusNoContent)
}

// resolveOrg maps a Forgejo repo owner (org slug) to a grown org id, or "".
func (s *Service) resolveOrg(ctx context.Context, repo forgejoRepo) string {
	slug := repo.Owner.Username
	if slug == "" {
		return ""
	}
	orgID, err := s.repo.OrgIDBySlug(ctx, slug)
	if err != nil {
		return ""
	}
	return orgID
}

// processPush links referenced issues to the pushed branch + each commit. Pushes
// never change issue status (status keys off the PR, mirroring Linear).
func (s *Service) processPush(ctx context.Context, p pushPayload) {
	orgID := s.resolveOrg(ctx, p.Repository)
	if orgID == "" {
		return
	}
	branch := p.Ref
	if i := lastSlash(branch); i >= 0 {
		branch = branch[i+1:]
	}
	for _, ref := range ParseRefs(p.Ref) {
		s.linkRef(ctx, orgID, ref, GitLink{
			Kind: "branch", Repo: p.Repository.FullName, Ref: branch, Title: branch,
			State: "open", IsMagic: ref.Magic,
		})
	}
	for _, c := range p.Commits {
		for _, ref := range ParseRefs(c.Message) {
			title := c.Message
			if i := firstNewline(title); i >= 0 {
				title = title[:i]
			}
			s.linkRef(ctx, orgID, ref, GitLink{
				Kind: "commit", Repo: p.Repository.FullName, Ref: c.ID, URL: c.URL,
				Title: title, State: "open", IsMagic: ref.Magic,
			})
		}
	}
}

// processPullRequest links the PR and applies the status rules.
func (s *Service) processPullRequest(ctx context.Context, p pullRequestPayload) {
	orgID := s.resolveOrg(ctx, p.Repository)
	if orgID == "" {
		return
	}
	pr := p.PullRequest
	refs := ParseRefs(pr.Head.Ref + " " + pr.Title + " " + pr.Body)
	prState := "open"
	switch {
	case p.Action == "closed" && pr.Merged:
		prState = "merged"
	case p.Action == "closed":
		prState = "closed"
	}
	for _, ref := range refs {
		issue := s.linkRef(ctx, orgID, ref, GitLink{
			Kind: "pr", Repo: p.Repository.FullName, Ref: strconv.FormatInt(pr.Number, 10),
			URL: pr.URL, Title: pr.Title, State: prState, IsMagic: ref.Magic,
		})
		if issue == nil {
			continue
		}
		switch {
		case (p.Action == "opened" || p.Action == "reopened") &&
			(issue.Status == "backlog" || issue.Status == "todo"):
			s.setIssueStatus(ctx, orgID, *issue, "in_progress")
		case p.Action == "closed" && pr.Merged && ref.Magic &&
			issue.Status != "done" && issue.Status != "canceled":
			s.setIssueStatus(ctx, orgID, *issue, "done")
		}
	}
}

// linkRef resolves an issue ref, upserts the git link, and returns the resolved
// issue (nil when it doesn't resolve). The passed link omits org/issue ids,
// which linkRef fills in.
func (s *Service) linkRef(ctx context.Context, orgID string, ref Ref, l GitLink) *Issue {
	issue, err := s.repo.FindIssueByKeyNumber(ctx, orgID, ref.Key, ref.Number)
	if err != nil {
		return nil // unknown identifier — ignore
	}
	l.OrgID = orgID
	l.IssueID = issue.ID
	if err := s.repo.UpsertGitLink(ctx, l); err != nil {
		slog.WarnContext(ctx, "projects: upsert git link failed", "err", err)
	}
	s.broadcastIssue(ctx, orgID, issue.ID)
	return &issue
}

// setIssueStatus patches an issue's status and broadcasts the change.
func (s *Service) setIssueStatus(ctx context.Context, orgID string, issue Issue, status string) {
	if issue.Status == status {
		return
	}
	if _, err := s.repo.UpdateIssue(ctx, orgID, issue.ID, IssuePatch{Status: status, StatusSet: true}); err != nil {
		slog.WarnContext(ctx, "projects: webhook status update failed", "err", err)
		return
	}
	s.broadcastIssue(ctx, orgID, issue.ID)
}

// broadcastIssue re-reads an issue and pushes it over the collab hub.
func (s *Service) broadcastIssue(ctx context.Context, orgID, issueID string) {
	if s.hub == nil {
		return
	}
	fresh, err := s.repo.GetIssue(ctx, orgID, issueID)
	if err != nil {
		return
	}
	s.hub.BroadcastIssue(fresh.TeamID, issueProto(fresh))
}

func lastSlash(s string) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == '/' {
			return i
		}
	}
	return -1
}

func firstNewline(s string) int {
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			return i
		}
	}
	return -1
}
