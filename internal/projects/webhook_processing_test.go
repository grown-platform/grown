package projects

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ── In-memory webhookStore fake ──────────────────────────────────────────────
//
// fakeStore implements webhookStore without a database so the webhook processing
// rules can be exercised hermetically. It mirrors the real repository's
// org-scoping and the UpsertGitLink (issue_id, kind, repo, ref) + is_magic-OR
// semantics, so a test passing here reflects the real behavior.

type fakeStore struct {
	orgsBySlug map[string]string // slug -> orgID
	issues     []Issue           // seeded issues (org-scoped)
	links      []GitLink
	updates    int // count of UpdateIssue calls that changed status
}

func newFakeStore() *fakeStore {
	return &fakeStore{orgsBySlug: map[string]string{}}
}

func (f *fakeStore) seedOrg(slug, orgID string) { f.orgsBySlug[slug] = orgID }

func (f *fakeStore) seedIssue(orgID, id, teamID, teamKey string, number int32, status string) {
	f.issues = append(f.issues, Issue{
		ID: id, OrgID: orgID, TeamID: teamID, TeamKey: teamKey, Number: number, Status: status,
	})
}

func (f *fakeStore) OrgIDBySlug(_ context.Context, slug string) (string, error) {
	if id, ok := f.orgsBySlug[slug]; ok {
		return id, nil
	}
	return "", ErrNotFound
}

func (f *fakeStore) FindIssueByKeyNumber(_ context.Context, orgID, key string, number int32) (Issue, error) {
	for _, i := range f.issues {
		if i.OrgID == orgID && strings.EqualFold(i.TeamKey, key) && i.Number == number {
			return i, nil
		}
	}
	return Issue{}, ErrNotFound
}

func (f *fakeStore) UpsertGitLink(_ context.Context, l GitLink) error {
	for idx := range f.links {
		e := &f.links[idx]
		if e.IssueID == l.IssueID && e.Kind == l.Kind && e.Repo == l.Repo && e.Ref == l.Ref {
			e.URL, e.Title, e.State = l.URL, l.Title, l.State
			e.IsMagic = e.IsMagic || l.IsMagic // never downgrade a magic ref
			return nil
		}
	}
	f.links = append(f.links, l)
	return nil
}

func (f *fakeStore) GetIssue(_ context.Context, orgID, id string) (Issue, error) {
	for _, i := range f.issues {
		if i.OrgID == orgID && i.ID == id {
			return i, nil
		}
	}
	return Issue{}, ErrNotFound
}

func (f *fakeStore) UpdateIssue(_ context.Context, orgID, id string, p IssuePatch) (Issue, error) {
	for idx := range f.issues {
		i := &f.issues[idx]
		if i.OrgID == orgID && i.ID == id {
			if p.StatusSet {
				i.Status = p.Status
				f.updates++
			}
			return *i, nil
		}
	}
	return Issue{}, ErrNotFound
}

// ── test helpers ─────────────────────────────────────────────────────────────

func (f *fakeStore) statusOf(id string) string {
	for _, i := range f.issues {
		if i.ID == id {
			return i.Status
		}
	}
	return ""
}

func (f *fakeStore) link(issueID, kind string) (GitLink, bool) {
	for _, l := range f.links {
		if l.IssueID == issueID && l.Kind == kind {
			return l, true
		}
	}
	return GitLink{}, false
}

// deliver drives the full webhook path (signature → dispatch → processing) with
// a signed body, exactly as the public endpoint would.
func deliver(t *testing.T, store webhookStore, secret, event, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/forgejo/webhook", bytes.NewReader([]byte(body)))
	req.Header.Set("X-Forgejo-Event", event)
	req.Header.Set("X-Forgejo-Signature", sign(body, secret))
	rec := httptest.NewRecorder()
	serveForgejoWebhook(rec, req, secret, &webhookProcessor{store: store})
	return rec
}

// prJSON builds a realistic Forgejo pull_request webhook payload (the exact
// field names Forgejo sends, so this also guards our struct tags).
func prJSON(action, owner, fullName string, number int, title, body, headRef string, merged bool) string {
	return fmt.Sprintf(`{
		"action": %q,
		"pull_request": {
			"number": %d,
			"title": %q,
			"body": %q,
			"html_url": "https://git.example/%s/pulls/%d",
			"merged": %t,
			"head": { "ref": %q }
		},
		"repository": { "full_name": %q, "owner": { "username": %q } }
	}`, action, number, title, body, fullName, number, merged, headRef, fullName, owner)
}

// pushJSON builds a realistic Forgejo push webhook payload with one commit.
func pushJSON(owner, fullName, ref, commitID, commitMsg string) string {
	return fmt.Sprintf(`{
		"ref": %q,
		"commits": [ { "id": %q, "message": %q, "url": "https://git.example/%s/commit/%s" } ],
		"repository": { "full_name": %q, "owner": { "username": %q } }
	}`, ref, commitID, commitMsg, fullName, commitID, fullName, owner)
}

const (
	tSecret = "whsecret"
	tOrg    = "org-acme"
	tSlug   = "acme"
	tRepo   = "acme/web"
)

// seedAcme returns a fakeStore with org "acme" → tOrg and one ENG-1 issue.
func seedAcme(t *testing.T, status string) (*fakeStore, string) {
	t.Helper()
	f := newFakeStore()
	f.seedOrg(tSlug, tOrg)
	const issueID = "issue-eng-1"
	f.seedIssue(tOrg, issueID, "team-eng", "ENG", 1, status)
	return f, issueID
}

// ── Pull-request status transition tests ─────────────────────────────────────

func TestWebhook_PROpened_AdvancesBacklogAndTodo(t *testing.T) {
	for _, start := range []string{"backlog", "todo"} {
		t.Run(start, func(t *testing.T) {
			f, id := seedAcme(t, start)
			rec := deliver(t, f, tSecret, "pull_request",
				prJSON("opened", tSlug, tRepo, 7, "Add widget", "implements ENG-1", "feat/widget", false))
			if rec.Code != http.StatusNoContent {
				t.Fatalf("status=%d want 204", rec.Code)
			}
			if got := f.statusOf(id); got != "in_progress" {
				t.Errorf("issue status=%q want in_progress", got)
			}
			l, ok := f.link(id, "pr")
			if !ok || l.State != "open" || l.Ref != "7" {
				t.Errorf("pr link=%+v ok=%v want open #7", l, ok)
			}
		})
	}
}

func TestWebhook_PROpened_DoesNotDowngradeAdvancedIssue(t *testing.T) {
	for _, start := range []string{"in_progress", "done", "canceled"} {
		t.Run(start, func(t *testing.T) {
			f, id := seedAcme(t, start)
			deliver(t, f, tSecret, "pull_request",
				prJSON("opened", tSlug, tRepo, 7, "x", "ENG-1", "b", false))
			if got := f.statusOf(id); got != start {
				t.Errorf("status changed to %q; want unchanged %q", got, start)
			}
			if f.updates != 0 {
				t.Errorf("UpdateIssue called %d times; want 0", f.updates)
			}
		})
	}
}

func TestWebhook_PRMergedWithMagicWord_ClosesIssue(t *testing.T) {
	f, id := seedAcme(t, "in_progress")
	deliver(t, f, tSecret, "pull_request",
		prJSON("closed", tSlug, tRepo, 7, "Fixes ENG-1", "", "feat/x", true))
	if got := f.statusOf(id); got != "done" {
		t.Errorf("status=%q want done", got)
	}
	if l, ok := f.link(id, "pr"); !ok || l.State != "merged" {
		t.Errorf("pr link state=%q ok=%v want merged", l.State, ok)
	}
}

func TestWebhook_PRMergedWithoutMagicWord_LeavesStatus(t *testing.T) {
	f, id := seedAcme(t, "in_progress")
	deliver(t, f, tSecret, "pull_request",
		prJSON("closed", tSlug, tRepo, 7, "Relates to ENG-1", "", "feat/x", true))
	if got := f.statusOf(id); got != "in_progress" {
		t.Errorf("status=%q want unchanged in_progress (bare ref must not auto-close)", got)
	}
	if l, _ := f.link(id, "pr"); l.State != "merged" {
		t.Errorf("pr link state=%q want merged", l.State)
	}
}

func TestWebhook_PRClosedNotMerged_NoStatusChange(t *testing.T) {
	f, id := seedAcme(t, "in_progress")
	deliver(t, f, tSecret, "pull_request",
		prJSON("closed", tSlug, tRepo, 7, "Fixes ENG-1", "", "feat/x", false))
	if got := f.statusOf(id); got != "in_progress" {
		t.Errorf("status=%q want in_progress (closed-unmerged must not close issue)", got)
	}
	if l, _ := f.link(id, "pr"); l.State != "closed" {
		t.Errorf("pr link state=%q want closed", l.State)
	}
}

func TestWebhook_IdentifierFromBranchNameOnly(t *testing.T) {
	f, id := seedAcme(t, "backlog")
	// No identifier in title/body; only in the lowercase branch name.
	deliver(t, f, tSecret, "pull_request",
		prJSON("opened", tSlug, tRepo, 7, "no id here", "none", "lucas/eng-1-fix", false))
	if got := f.statusOf(id); got != "in_progress" {
		t.Errorf("status=%q want in_progress (branch-name identifier should link)", got)
	}
}

func TestWebhook_MultipleIdentifiers_AllAdvance(t *testing.T) {
	f := newFakeStore()
	f.seedOrg(tSlug, tOrg)
	f.seedIssue(tOrg, "i1", "team-eng", "ENG", 1, "todo")
	f.seedIssue(tOrg, "i2", "team-eng", "ENG", 2, "todo")
	deliver(t, f, tSecret, "pull_request",
		prJSON("opened", tSlug, tRepo, 7, "ENG-1 and ENG-2 together", "", "feat/x", false))
	if f.statusOf("i1") != "in_progress" || f.statusOf("i2") != "in_progress" {
		t.Errorf("statuses=%q/%q want both in_progress", f.statusOf("i1"), f.statusOf("i2"))
	}
}

func TestWebhook_UnknownIdentifier_NoOp(t *testing.T) {
	f, id := seedAcme(t, "backlog")
	rec := deliver(t, f, tSecret, "pull_request",
		prJSON("opened", tSlug, tRepo, 7, "fixes ENG-999", "", "feat/x", false))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status=%d want 204", rec.Code)
	}
	if f.statusOf(id) != "backlog" || len(f.links) != 0 {
		t.Errorf("unknown identifier mutated state: status=%q links=%d", f.statusOf(id), len(f.links))
	}
}

// Cross-org isolation: the org is resolved from the signed payload's owner.
// An issue with the same KEY-N in a *different* org must be untouched.
func TestWebhook_CrossOrgIsolation(t *testing.T) {
	f := newFakeStore()
	f.seedOrg("acme", "org-acme")
	f.seedOrg("other", "org-other")
	f.seedIssue("org-other", "victim", "team-eng", "ENG", 1, "backlog") // ENG-1 lives in org-other
	// Webhook arrives for acme's repo, referencing ENG-1.
	deliver(t, f, tSecret, "pull_request",
		prJSON("closed", "acme", "acme/web", 7, "Fixes ENG-1", "", "feat/x", true))
	if got := f.statusOf("victim"); got != "backlog" {
		t.Errorf("cross-org issue status=%q; want untouched backlog", got)
	}
	if len(f.links) != 0 {
		t.Errorf("cross-org issue got %d links; want 0", len(f.links))
	}
}

// ── Push event tests ─────────────────────────────────────────────────────────

func TestWebhook_Push_LinksBranchAndCommit_NoStatusChange(t *testing.T) {
	f, id := seedAcme(t, "backlog")
	deliver(t, f, tSecret, "push",
		pushJSON(tSlug, tRepo, "refs/heads/lucas/eng-1-fix", "abc123", "ENG-1 start work"))
	if got := f.statusOf(id); got != "backlog" {
		t.Errorf("push changed status to %q; pushes must never change status", got)
	}
	if l, ok := f.link(id, "branch"); !ok || l.Ref != "lucas/eng-1-fix" {
		t.Errorf("branch link=%+v ok=%v want ref lucas/eng-1-fix", l, ok)
	}
	if l, ok := f.link(id, "commit"); !ok || l.Ref != "abc123" {
		t.Errorf("commit link=%+v ok=%v want ref abc123", l, ok)
	}
}

func TestWebhook_Push_MagicWordInCommit_DoesNotCloseIssue(t *testing.T) {
	f, id := seedAcme(t, "in_progress")
	deliver(t, f, tSecret, "push",
		pushJSON(tSlug, tRepo, "refs/heads/feat/x", "def456", "fixes ENG-1"))
	if got := f.statusOf(id); got != "in_progress" {
		t.Errorf("status=%q; a magic word in a *commit* must not close the issue (only a merged PR does)", got)
	}
}

// is_magic OR semantics across events: a bare PR link, then the same PR merged
// with a magic word, must end up magic and close the issue.
func TestWebhook_MagicOrAcrossEvents(t *testing.T) {
	f, id := seedAcme(t, "in_progress")
	// First: opened with a bare reference → link is non-magic, stays open.
	deliver(t, f, tSecret, "pull_request",
		prJSON("opened", tSlug, tRepo, 7, "relates ENG-1", "", "feat/x", false))
	if l, _ := f.link(id, "pr"); l.IsMagic {
		t.Fatalf("link should start non-magic")
	}
	// Then: merged with a magic word in the title → is_magic OR-s true, issue → done.
	deliver(t, f, tSecret, "pull_request",
		prJSON("closed", tSlug, tRepo, 7, "Fixes ENG-1", "", "feat/x", true))
	l, _ := f.link(id, "pr")
	if !l.IsMagic || l.State != "merged" {
		t.Errorf("link magic=%v state=%q want magic/merged", l.IsMagic, l.State)
	}
	if f.statusOf(id) != "done" {
		t.Errorf("status=%q want done", f.statusOf(id))
	}
}

// ── Transport-level guards through the full path ─────────────────────────────

func TestWebhook_UnknownEvent_Acknowledged(t *testing.T) {
	f, id := seedAcme(t, "backlog")
	rec := deliver(t, f, tSecret, "issues", // not push/pull_request
		`{"action":"opened","repository":{"owner":{"username":"acme"}}}`)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status=%d want 204 (unknown events are acked)", rec.Code)
	}
	if f.statusOf(id) != "backlog" || len(f.links) != 0 {
		t.Errorf("unknown event mutated state")
	}
}

func TestWebhook_BadSignature_RejectedBeforeProcessing(t *testing.T) {
	f, id := seedAcme(t, "backlog")
	body := prJSON("opened", tSlug, tRepo, 7, "Fixes ENG-1", "", "feat/x", false)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/forgejo/webhook", strings.NewReader(body))
	req.Header.Set("X-Forgejo-Event", "pull_request")
	req.Header.Set("X-Forgejo-Signature", sign(body, "WRONG-SECRET"))
	rec := httptest.NewRecorder()
	serveForgejoWebhook(rec, req, tSecret, &webhookProcessor{store: f})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}
	if f.statusOf(id) != "backlog" || len(f.links) != 0 {
		t.Errorf("processing ran despite bad signature")
	}
}
