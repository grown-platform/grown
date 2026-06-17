# Forgejo ↔ Projects Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the projects service (a Linear-style tracker) link issues to Forgejo branches/PRs/commits and auto-advance issue status from Forgejo webhook activity, mirroring Linear's GitHub integration.

**Architecture:** A new org-level Forgejo webhook (auto-registered with the existing admin token) POSTs `push`/`pull_request` events to a new public, signature-verified endpoint `POST /api/v1/forgejo/webhook`. A parser extracts `KEY-N` issue identifiers (org-wide, any repo) from branch refs, PR titles/bodies, and commit messages. Bare references create git links and move issues `backlog`/`todo` → `in_progress` on PR open; magic-word references (`closes`/`fixes`/`resolves`) additionally move issues → `done` on merge. Links are stored in a new `grown.project_git_links` table, surfaced in the issue detail UI, and broadcast over the existing collab WebSocket so open boards update live.

**Tech Stack:** Go (pgx/v5, stdlib net/http, gRPC + grpc-gateway via buf), React + MUI Joy (TypeScript), PostgreSQL.

---

## Design decisions locked in (from the spec)

- **Org-wide matching by identifier** — any repo in an org's Forgejo org matches issues by `KEY-N`. No explicit per-repo linking.
- **Auto-registered webhooks** — grown uses the existing admin token to create one org-level hook per Forgejo org.
- **Global webhook secret** — one env var `GROWN_FORGEJO_WEBHOOK_SECRET` (not per-org). Shared between hook creation and signature verification.
- **Hardcoded status rules** (no per-team config UI in v1):
  - PR `opened`/`reopened` → linked issues in `backlog`/`todo` move to `in_progress`.
  - PR `closed` with `merged=true` → magic-word-linked issues move to `done`.
  - Bare references never change status beyond the PR-open rule; pushes never change status.
- **No-op when unconfigured** — if admin token, public URL, or webhook secret is empty, the whole subsystem is inert (matching the existing forgejo package convention).

## File structure

**Create:**
- `internal/storage/migrations/0091_project_git_links.sql` — the git-links table.
- `internal/projects/gitref.go` — pure identifier/magic-word parser.
- `internal/projects/gitref_test.go` — parser tests.
- `internal/projects/webhook.go` — payload structs, signature verify, event handler (methods on `*Service`).
- `internal/projects/webhook_test.go` — handler/processing tests.

**Modify:**
- `internal/forgejo/client.go` — add `EnsureOrgWebhook`.
- `internal/forgejo/client_test.go` — test `EnsureOrgWebhook`.
- `internal/forgejo/provisioner.go` — read webhook env, call `EnsureOrgWebhook` from `OnOrgCreated` + `EnsureAccess`.
- `internal/projects/repository.go` — add `GitLink` struct, `FindIssueByKeyNumber`, `UpsertGitLink`, `ListGitLinks`, `OrgIDBySlug`.
- `internal/projects/repository_test.go` — tests for the new repo methods.
- `internal/projects/service.go` — add `ForgejoWebhookSecret` field; implement `ListIssueGitLinks` RPC.
- `proto/grown/v1/projects.proto` — add `ListIssueGitLinks` RPC + messages; regenerate.
- `internal/server/server.go` — register the public webhook route; wire the secret onto the service.
- `cmd/server/main.go` — pass `GROWN_FORGEJO_WEBHOOK_SECRET` to the service config.
- `web/app/src/pages/projects/types.ts` — `GitLink` type.
- `web/app/src/pages/projects/api.ts` — `listIssueGitLinks`, `gitBranchName` helper.
- `web/app/src/pages/projects/IssueDetail.tsx` — "Git" section + "Copy branch name" button.

---

## Task 1: Migration — `grown.project_git_links` table

**Files:**
- Create: `internal/storage/migrations/0091_project_git_links.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0091_project_git_links.sql
-- Links a projects issue to a Forgejo branch / pull request / commit discovered
-- via webhook. Org-wide: any repo in the org's Forgejo org can reference an
-- issue by its KEY-N identifier. One row per (issue, kind, repo, ref).

CREATE TABLE IF NOT EXISTS grown.project_git_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES grown.orgs(id) ON DELETE CASCADE,
    issue_id    UUID NOT NULL REFERENCES grown.project_issues(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,            -- 'branch' | 'pr' | 'commit'
    repo        TEXT NOT NULL,            -- "owner/name"
    ref         TEXT NOT NULL,            -- branch name | PR number (text) | commit sha
    url         TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL DEFAULT '',
    state       TEXT NOT NULL DEFAULT 'open', -- 'open' | 'merged' | 'closed'
    is_magic    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (issue_id, kind, repo, ref)
);

CREATE INDEX IF NOT EXISTS project_git_links_issue_idx
    ON grown.project_git_links (issue_id);
```

- [ ] **Step 2: Apply migrations and verify the table exists**

Run the project's migration step, then confirm. (The repo applies `internal/storage/migrations/*.sql` on server start; for a direct check use the dev DB.)

Run: `grep -rn "project_git_links" internal/storage/migrations/0091_project_git_links.sql`
Expected: prints the `CREATE TABLE` line — file is present and well-formed.

- [ ] **Step 3: Commit**

```bash
git add internal/storage/migrations/0091_project_git_links.sql
git commit -m "feat(projects): add project_git_links table"
```

---

## Task 2: Identifier + magic-word parser (`gitref.go`)

A pure function with no DB/network dependency — TDD it first. Identifiers are `KEY-N` where `KEY` is an uppercase team key. Branch names use a lowercase form (`username/eng-42-slug`), so matching is case-insensitive and the key is upper-cased before lookup.

**Files:**
- Create: `internal/projects/gitref.go`
- Test: `internal/projects/gitref_test.go`

- [ ] **Step 1: Write the failing test**

```go
package projects

import "testing"

func TestParseRefs(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []Ref
	}{
		{"bare", "ENG-42 tweak", []Ref{{Key: "ENG", Number: 42, Magic: false}}},
		{"magic fixes", "fixes ENG-7", []Ref{{Key: "ENG", Number: 7, Magic: true}}},
		{"magic closes caps", "Closes ENG-7", []Ref{{Key: "ENG", Number: 7, Magic: true}}},
		{"branch lowercase", "lucas/eng-42-fix-thing", []Ref{{Key: "ENG", Number: 42, Magic: false}}},
		{"multiple", "fix ENG-1 and ENG-2", []Ref{{Key: "ENG", Number: 1, Magic: true}, {Key: "ENG", Number: 2, Magic: false}}},
		{"dedupe keeps magic", "ENG-3 closes ENG-3", []Ref{{Key: "ENG", Number: 3, Magic: true}}},
		{"none", "no refs here", nil},
		{"word boundary", "foo-ENG-9", []Ref{{Key: "ENG", Number: 9, Magic: false}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ParseRefs(c.in)
			if len(got) != len(c.want) {
				t.Fatalf("len=%d want %d (%v)", len(got), len(c.want), got)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Errorf("ref[%d]=%+v want %+v", i, got[i], c.want[i])
				}
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/projects/ -run TestParseRefs -v`
Expected: FAIL — `undefined: ParseRefs` / `undefined: Ref`.

- [ ] **Step 3: Write the parser**

```go
package projects

import (
	"regexp"
	"strconv"
	"strings"
)

// Ref is a parsed reference to an issue found in git text (branch, PR title/body,
// commit message). Key is upper-cased; Magic is true when preceded by a closing
// keyword (close/fix/resolve and inflections).
type Ref struct {
	Key    string
	Number int32
	Magic  bool
}

// refPattern matches an optional magic keyword followed by a KEY-N identifier.
// Case-insensitive: branch names use a lowercase form (eng-42). The key segment
// is [A-Za-z][A-Za-z0-9]+ and is upper-cased by ParseRefs before use.
var refPattern = regexp.MustCompile(`(?i)\b(?:(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+)?([a-z][a-z0-9]+)-([0-9]+)\b`)

// ParseRefs extracts every issue reference from s. Duplicates (same Key+Number)
// are merged; if any occurrence is magic the merged ref is magic. Order follows
// first appearance.
func ParseRefs(s string) []Ref {
	matches := refPattern.FindAllStringSubmatch(s, -1)
	if len(matches) == 0 {
		return nil
	}
	order := make([]Ref, 0, len(matches))
	idx := map[string]int{}
	for _, m := range matches {
		num, err := strconv.Atoi(m[3])
		if err != nil {
			continue
		}
		key := strings.ToUpper(m[2])
		magic := m[1] != ""
		k := key + "-" + m[3]
		if i, ok := idx[k]; ok {
			if magic {
				order[i].Magic = true
			}
			continue
		}
		idx[k] = len(order)
		order = append(order, Ref{Key: key, Number: int32(num), Magic: magic})
	}
	return order
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/projects/ -run TestParseRefs -v`
Expected: PASS (all sub-tests).

- [ ] **Step 5: Commit**

```bash
git add internal/projects/gitref.go internal/projects/gitref_test.go
git commit -m "feat(projects): parse KEY-N issue refs and magic words from git text"
```

---

## Task 3: Repository methods (`repository.go`)

Add the `GitLink` domain type and four queries: resolve org by Forgejo slug, find an issue by team key + number, upsert a git link, list links for an issue. Follow the existing `issueSelect` / `add()` / `scanIssue` patterns (org isolation via `org_id`).

**Files:**
- Modify: `internal/projects/repository.go`
- Test: `internal/projects/repository_test.go` (add cases; if the file does not exist, create it following the package's existing DB-test harness)

- [ ] **Step 1: Add the `GitLink` struct and methods**

Add near the other domain structs and methods in `repository.go`:

```go
// GitLink is a stored reference from an issue to a Forgejo branch/PR/commit.
type GitLink struct {
	ID        string
	OrgID     string
	IssueID   string
	Kind      string // "branch" | "pr" | "commit"
	Repo      string // "owner/name"
	Ref       string // branch name | PR number | commit sha
	URL       string
	Title     string
	State     string // "open" | "merged" | "closed"
	IsMagic   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

// OrgIDBySlug resolves a grown org UUID from its URL slug (which is also the
// Forgejo org name). Returns ErrNotFound when no such org exists.
func (r *Repository) OrgIDBySlug(ctx context.Context, slug string) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`SELECT id::text FROM grown.orgs WHERE slug=$1`, slug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("projects.OrgIDBySlug: %w", err)
	}
	return id, nil
}

// FindIssueByKeyNumber resolves an issue from its team key + per-team number
// within an org (the two halves of a KEY-N identifier). Returns ErrNotFound
// when no matching live issue exists.
func (r *Repository) FindIssueByKeyNumber(ctx context.Context, orgID, key string, number int32) (Issue, error) {
	i, err := scanIssue(r.pool.QueryRow(ctx,
		issueSelect+` WHERE i.org_id=$1 AND upper(t.key)=upper($2) AND i.number=$3 AND i.trashed_at IS NULL`,
		orgID, key, number))
	if errors.Is(err, pgx.ErrNoRows) {
		return Issue{}, ErrNotFound
	}
	return i, err
}

// UpsertGitLink inserts or updates a git link, keyed by (issue, kind, repo, ref).
// On conflict it refreshes url/title/state and OR-s is_magic so a later magic
// reference is never downgraded.
func (r *Repository) UpsertGitLink(ctx context.Context, l GitLink) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.project_git_links
		   (org_id, issue_id, kind, repo, ref, url, title, state, is_magic)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 ON CONFLICT (issue_id, kind, repo, ref) DO UPDATE SET
		   url       = EXCLUDED.url,
		   title     = EXCLUDED.title,
		   state     = EXCLUDED.state,
		   is_magic  = grown.project_git_links.is_magic OR EXCLUDED.is_magic,
		   updated_at = now()`,
		l.OrgID, l.IssueID, l.Kind, l.Repo, l.Ref, l.URL, l.Title, l.State, l.IsMagic)
	if err != nil {
		return fmt.Errorf("projects.UpsertGitLink: %w", err)
	}
	return nil
}

// ListGitLinks returns all git links for an issue, newest first.
func (r *Repository) ListGitLinks(ctx context.Context, orgID, issueID string) ([]GitLink, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, org_id::text, issue_id::text, kind, repo, ref, url, title, state, is_magic, created_at, updated_at
		   FROM grown.project_git_links
		  WHERE org_id=$1 AND issue_id=$2
		  ORDER BY updated_at DESC`, orgID, issueID)
	if err != nil {
		return nil, fmt.Errorf("projects.ListGitLinks: %w", err)
	}
	defer rows.Close()
	var out []GitLink
	for rows.Next() {
		var l GitLink
		if err := rows.Scan(&l.ID, &l.OrgID, &l.IssueID, &l.Kind, &l.Repo, &l.Ref,
			&l.URL, &l.Title, &l.State, &l.IsMagic, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}
```

- [ ] **Step 2: Write a DB test for round-trip upsert/list**

Add to `repository_test.go` (use the package's existing test DB helper — search the file for how other tests obtain a `*Repository`; reuse that exact setup function rather than inventing one):

```go
func TestGitLinkUpsertAndList(t *testing.T) {
	repo, orgID, issueID := setupIssueForTest(t) // existing helper that seeds org + team + issue
	ctx := context.Background()

	link := GitLink{
		OrgID: orgID, IssueID: issueID, Kind: "pr", Repo: "acme/web",
		Ref: "12", URL: "https://git/acme/web/pulls/12", Title: "Fix thing",
		State: "open", IsMagic: false,
	}
	if err := repo.UpsertGitLink(ctx, link); err != nil {
		t.Fatalf("insert: %v", err)
	}
	// Re-upsert as merged + magic; is_magic must stick true, state must update.
	link.State, link.IsMagic = "merged", true
	if err := repo.UpsertGitLink(ctx, link); err != nil {
		t.Fatalf("update: %v", err)
	}
	got, err := repo.ListGitLinks(ctx, orgID, issueID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len=%d want 1", len(got))
	}
	if got[0].State != "merged" || !got[0].IsMagic {
		t.Errorf("got state=%s magic=%v want merged/true", got[0].State, got[0].IsMagic)
	}
}
```

> If no `setupIssueForTest`-style helper exists in `repository_test.go`, write the seed inline using the existing `CreateTeam`/`CreateIssue` repo methods and an org row created by the test harness already used elsewhere in the file.

- [ ] **Step 3: Run the test**

Run: `go test ./internal/projects/ -run TestGitLink -v`
Expected: PASS (requires the test DB the other repository tests use; if they are build-tagged/integration, run with the same tag, e.g. `-tags=integration`).

- [ ] **Step 4: Commit**

```bash
git add internal/projects/repository.go internal/projects/repository_test.go
git commit -m "feat(projects): repository methods for git links + issue lookup by KEY-N"
```

---

## Task 4: Forgejo client — `EnsureOrgWebhook`

Idempotent org-hook creation: list existing hooks, create only if none targets our URL. Mirrors the existing `EnsureMaintainersTeam` shape.

**Files:**
- Modify: `internal/forgejo/client.go`
- Test: `internal/forgejo/client_test.go`

- [ ] **Step 1: Write the failing test**

Follow the existing `client_test.go` pattern (it uses `httptest.Server` to stand in for Forgejo — check the file for the exact helper that builds a `*Client` pointed at the test server, and reuse it).

```go
func TestEnsureOrgWebhook_CreatesWhenAbsent(t *testing.T) {
	var listed, created bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/orgs/acme/hooks":
			listed = true
			_, _ = w.Write([]byte(`[]`)) // no hooks yet
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/orgs/acme/hooks":
			created = true
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":1}`))
		default:
			t.Fatalf("unexpected %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	if err := c.EnsureOrgWebhook(context.Background(), "acme", "https://grown/api/v1/forgejo/webhook", "secret"); err != nil {
		t.Fatalf("EnsureOrgWebhook: %v", err)
	}
	if !listed || !created {
		t.Fatalf("listed=%v created=%v want both true", listed, created)
	}
}

func TestEnsureOrgWebhook_IdempotentWhenPresent(t *testing.T) {
	var created bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/api/v1/orgs/acme/hooks" {
			_, _ = w.Write([]byte(`[{"id":1,"config":{"url":"https://grown/api/v1/forgejo/webhook"}}]`))
			return
		}
		if r.Method == http.MethodPost {
			created = true
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	if err := c.EnsureOrgWebhook(context.Background(), "acme", "https://grown/api/v1/forgejo/webhook", "secret"); err != nil {
		t.Fatalf("EnsureOrgWebhook: %v", err)
	}
	if created {
		t.Fatalf("created a duplicate hook; should have been a no-op")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/forgejo/ -run TestEnsureOrgWebhook -v`
Expected: FAIL — `c.EnsureOrgWebhook undefined`.

- [ ] **Step 3: Implement `EnsureOrgWebhook`**

Add to `client.go`:

```go
// EnsureOrgWebhook makes sure an org-level webhook targeting targetURL exists on
// orgName. It is idempotent: it lists existing hooks (GET /api/v1/orgs/{org}/hooks)
// and creates one (POST same path) only when none already points at targetURL.
// The hook fires push + pull_request events as JSON, signed with secret
// (Forgejo sends X-Forgejo-Signature = HMAC-SHA256(body, secret)). Best-effort:
// callers log and continue.
func (c *Client) EnsureOrgWebhook(ctx context.Context, orgName, targetURL, secret string) error {
	if !c.configured() || targetURL == "" || secret == "" {
		return nil
	}
	// 1. Already present?
	path := fmt.Sprintf("/api/v1/orgs/%s/hooks", orgName)
	status, body, err := c.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return fmt.Errorf("forgejo.EnsureOrgWebhook list: %w", err)
	}
	if status == http.StatusOK {
		var hooks []struct {
			Config struct {
				URL string `json:"url"`
			} `json:"config"`
		}
		if err := json.Unmarshal(body, &hooks); err == nil {
			for _, h := range hooks {
				if h.Config.URL == targetURL {
					return nil // already configured
				}
			}
		}
	} else if status != http.StatusNotFound {
		return fmt.Errorf("forgejo.EnsureOrgWebhook list: unexpected status %d", status)
	}
	// 2. Create it.
	create := map[string]any{
		"type":   "forgejo",
		"active": true,
		"events": []string{"push", "pull_request"},
		"config": map[string]string{
			"url":          targetURL,
			"content_type": "json",
			"secret":       secret,
		},
	}
	cstatus, _, cerr := c.do(ctx, http.MethodPost, path, create)
	if cerr != nil {
		return fmt.Errorf("forgejo.EnsureOrgWebhook create: %w", cerr)
	}
	switch cstatus {
	case http.StatusCreated, http.StatusOK, http.StatusUnprocessableEntity:
		return nil // 201/200 created, 422 already exists → success
	default:
		return fmt.Errorf("forgejo.EnsureOrgWebhook create: unexpected status %d", cstatus)
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/forgejo/ -run TestEnsureOrgWebhook -v`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add internal/forgejo/client.go internal/forgejo/client_test.go
git commit -m "feat(forgejo): EnsureOrgWebhook (idempotent org-level hook)"
```

---

## Task 5: Provisioner — read webhook env + register hook

Auto-register the webhook from both provisioning entry points (`OnOrgCreated`, `EnsureAccess`). Read `GROWN_PUBLIC_URL` + `GROWN_FORGEJO_WEBHOOK_SECRET` from env; when either is empty, skip hook registration but keep the existing org/member provisioning working.

**Files:**
- Modify: `internal/forgejo/provisioner.go`
- Test: `internal/forgejo/provisioner_test.go` (extend existing)

- [ ] **Step 1: Add fields + env wiring**

In `provisioner.go`, extend the struct and `NewProvisionerFromEnv`:

```go
type Provisioner struct {
	client *Client

	// webhookURL is grown's public webhook endpoint (GROWN_PUBLIC_URL +
	// "/api/v1/forgejo/webhook"); webhookSecret is the shared HMAC secret.
	// Both empty → webhook auto-registration is skipped.
	webhookURL    string
	webhookSecret string

	accessMu    sync.Mutex
	accessCache map[string]time.Time
}

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
```

- [ ] **Step 2: Call `ensureWebhook` from `OnOrgCreated`**

In `OnOrgCreated`, after the successful `CreateOrg` log line (`log.InfoContext(ctx, "forgejo: org provisioned")`), add:

```go
	p.ensureWebhook(ctx, e.Slug, log)
```

- [ ] **Step 3: Call `ensureWebhook` from `EnsureAccess`**

In `EnsureAccess`, immediately after the successful `CreateOrg` block (after step 1's `if err := p.client.CreateOrg(...)` returns nil), add:

```go
	p.ensureWebhook(ctx, slug, log)
```

(`log` is already defined in `EnsureAccess` as `slog.Default().With(...)`.)

- [ ] **Step 4: Extend the provisioner test**

Add a case asserting that when `webhookURL` is set, `OnOrgCreated` issues the hook list+create calls. Reuse the existing `provisioner_test.go` httptest harness; set the provisioner's `webhookURL`/`webhookSecret` fields directly in the test (same-package access) and assert the `/hooks` endpoints were hit.

```go
func TestOnOrgCreated_RegistersWebhook(t *testing.T) {
	var hookCreated bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/hooks") && r.Method == http.MethodGet:
			_, _ = w.Write([]byte(`[]`))
		case strings.HasSuffix(r.URL.Path, "/hooks") && r.Method == http.MethodPost:
			hookCreated = true
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":1}`))
		default:
			w.WriteHeader(http.StatusOK) // CreateOrg etc.
		}
	}))
	defer srv.Close()

	p := &Provisioner{
		client:        NewClient(srv.URL, "tok"),
		webhookURL:    "https://grown/api/v1/forgejo/webhook",
		webhookSecret: "secret",
		accessCache:   map[string]time.Time{},
	}
	p.OnOrgCreated(context.Background(), OrgEvent{OrgID: "o1", Slug: "acme", DisplayName: "Acme"})
	if !hookCreated {
		t.Fatalf("expected webhook to be registered")
	}
}
```

- [ ] **Step 5: Run tests**

Run: `go test ./internal/forgejo/ -v`
Expected: PASS (existing + new).

- [ ] **Step 6: Commit**

```bash
git add internal/forgejo/provisioner.go internal/forgejo/provisioner_test.go
git commit -m "feat(forgejo): auto-register org webhook during provisioning"
```

---

## Task 6: Webhook payload structs, signature verification, event processing (`webhook.go`)

The core. Methods on `*Service` so they reuse `repo`, `hub`, and `issueProto`. Add a `ForgejoWebhookSecret` field to `Service`. Verify the HMAC, dispatch on event type, parse refs, upsert links, apply status rules, broadcast.

**Files:**
- Modify: `internal/projects/service.go` (add the secret field)
- Create: `internal/projects/webhook.go`
- Test: `internal/projects/webhook_test.go`

- [ ] **Step 1: Add the secret field to `Service`**

In `service.go`, change the struct and leave `NewService` as-is (the field is set by the server wiring):

```go
type Service struct {
	repo *Repository
	hub  *Hub
	// ForgejoWebhookSecret is the shared HMAC-SHA256 secret for verifying
	// inbound Forgejo webhook signatures. Empty disables the webhook endpoint
	// (handler returns 503). Set by the server during wiring.
	ForgejoWebhookSecret string
}
```

- [ ] **Step 2: Write the failing test**

```go
package projects

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func sign(body, secret string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(body))
	return hex.EncodeToString(m.Sum(nil))
}

func TestVerifySignature(t *testing.T) {
	body := `{"x":1}`
	sig := sign(body, "s3cr3t")
	if !verifyForgejoSignature([]byte(body), sig, "s3cr3t") {
		t.Fatal("valid signature rejected")
	}
	if verifyForgejoSignature([]byte(body), sig, "wrong") {
		t.Fatal("invalid secret accepted")
	}
	if verifyForgejoSignature([]byte(body), "deadbeef", "s3cr3t") {
		t.Fatal("bad signature accepted")
	}
}

func TestHandleForgejoWebhook_RejectsBadSignature(t *testing.T) {
	s := &Service{ForgejoWebhookSecret: "s3cr3t"}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/forgejo/webhook", strings.NewReader(`{}`))
	req.Header.Set("X-Forgejo-Event", "push")
	req.Header.Set("X-Forgejo-Signature", "deadbeef")
	rec := httptest.NewRecorder()
	s.HandleForgejoWebhook(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401", rec.Code)
	}
}

func TestHandleForgejoWebhook_DisabledWhenNoSecret(t *testing.T) {
	s := &Service{} // no secret
	req := httptest.NewRequest(http.MethodPost, "/api/v1/forgejo/webhook", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	s.HandleForgejoWebhook(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d want 503", rec.Code)
	}
}
```

> Status-mapping logic (PR opened → in_progress, merged+magic → done) is exercised by a higher-level test once a `*Service` with a test DB is available. Add `TestProcessPullRequest_*` cases alongside the repository DB tests, reusing the same seed helper to create an issue, then calling `s.processPullRequest` with a synthetic `pullRequestPayload` and asserting the issue status + link state. Keep the signature/dispatch tests above DB-free.

- [ ] **Step 3: Run test to verify it fails**

Run: `go test ./internal/projects/ -run 'TestVerifySignature|TestHandleForgejoWebhook' -v`
Expected: FAIL — `verifyForgejoSignature` / `HandleForgejoWebhook` undefined.

- [ ] **Step 4: Implement `webhook.go`**

```go
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
	Action      string      `json:"action"` // opened|reopened|closed|edited|...
	PullRequest struct {
		Number  int64  `json:"number"`
		Title   string `json:"title"`
		Body    string `json:"body"`
		URL     string `json:"html_url"`
		Merged  bool   `json:"merged"`
		Head    struct {
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
	// Branch-level links from branch name refs.
	for _, ref := range ParseRefs(p.Ref) {
		s.linkRef(ctx, orgID, ref, GitLink{
			Kind: "branch", Repo: p.Repository.FullName, Ref: branch, Title: branch,
			State: "open", IsMagic: ref.Magic,
		})
	}
	// Commit-level links from commit messages.
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
// issue (nil when it doesn't resolve). The returned link omits org/issue ids,
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
	// Broadcast the (unchanged) issue so open clients refresh the links panel.
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
```

> Confirm the patch type name + status setter field used by `UpdateIssue`. The exploration shows `UpdateIssue(ctx, orgID, id, IssuePatch)` with a `StatusSet` field and `Status`. If the actual type is named differently (e.g. `IssueUpdate`), use that name consistently here and in Task 3's references.

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./internal/projects/ -run 'TestVerifySignature|TestHandleForgejoWebhook|TestParseRefs' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/projects/webhook.go internal/projects/webhook_test.go internal/projects/service.go
git commit -m "feat(projects): Forgejo webhook receiver — link issues, auto-advance status"
```

---

## Task 7: Server wiring — public webhook route + secret

Register `/api/v1/forgejo/webhook` as a public route **before** the `/api/` auth fallthrough (it authenticates via HMAC, not a session), and set the secret onto the service.

**Files:**
- Modify: `internal/server/server.go`
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Set the secret onto the projects service**

In `server.go`, where the projects service is constructed (the `if cfg.ProjectsRepo != nil { ... projects.NewService(...) }` block), set the field from a new config value:

```go
	projectsSvc = projects.NewService(cfg.ProjectsRepo, projectsHub)
	projectsSvc.ForgejoWebhookSecret = cfg.ForgejoWebhookSecret
	grownv1.RegisterProjectsServiceServer(grpcSrv, projectsSvc)
```

Add the field to the server `Config` struct (near `ForgejoURL`):

```go
	// ForgejoWebhookSecret is the shared HMAC-SHA256 secret for verifying inbound
	// Forgejo webhook signatures (GROWN_FORGEJO_WEBHOOK_SECRET). Empty disables
	// the /api/v1/forgejo/webhook endpoint.
	ForgejoWebhookSecret string
```

- [ ] **Step 2: Register the public route before the auth fallthrough**

In the main router in `server.go`, add a branch alongside the other server-to-server webhook special-cases (e.g. near the MediaMTX `liveWebhooks` block, which sits **before** the `/api/` auth-wrapped fallthrough at the `strings.HasPrefix(r.URL.Path, "/api/")` check):

```go
		// Forgejo → grown webhook (server-to-server, HMAC-verified, NOT
		// session-auth-wrapped). MUST precede the /api/ auth fallthrough.
		if projectsSvc != nil && r.URL.Path == "/api/v1/forgejo/webhook" {
			projectsSvc.HandleForgejoWebhook(w, r)
			return
		}
```

> `projectsSvc` is in scope in the router closure (it's used for the gateway registration earlier in `server.New`). If it is not, hoist it to a closure-captured variable the same way `liveWebhooks`/`forgejoProxy` are.

- [ ] **Step 3: Pass the env var from main.go**

In `cmd/server/main.go`, where `server.Config{...}` is built (the block with `ForgejoProvisioner: forgejoProvisioner`), add:

```go
		ForgejoWebhookSecret: os.Getenv("GROWN_FORGEJO_WEBHOOK_SECRET"),
```

(`os` is already imported in main.go.)

- [ ] **Step 4: Build and vet**

Run: `go build ./... && go vet ./internal/server/ ./internal/projects/ ./cmd/server/`
Expected: no errors.

- [ ] **Step 5: Manual route check (smoke)**

With the server built, a POST with no/invalid signature must be rejected, proving the route is wired and bypasses session auth (no 302/login redirect):

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8080/api/v1/forgejo/webhook -H 'X-Forgejo-Event: push' -d '{}'`
Expected: `401` when `GROWN_FORGEJO_WEBHOOK_SECRET` is set (bad signature), or `503` when unset — **not** `302`/`401`-from-auth-middleware/`404`.

- [ ] **Step 6: Commit**

```bash
git add internal/server/server.go cmd/server/main.go
git commit -m "feat(server): wire public Forgejo webhook route + secret"
```

---

## Task 8: `ListIssueGitLinks` RPC (proto + service)

Expose stored links to the frontend over the existing gateway.

**Files:**
- Modify: `proto/grown/v1/projects.proto`
- Modify: `internal/projects/service.go`
- Generated (do not hand-edit): `gen/go/grown/v1/projects*.pb.go`

- [ ] **Step 1: Add the RPC + messages to the proto**

In the `ProjectsService` service block (after `CreateComment`), add:

```proto
  // ── Git links ──────────────────────────────────────────────────────────────
  rpc ListIssueGitLinks(ListIssueGitLinksRequest) returns (ListIssueGitLinksResponse) {
    option (google.api.http) = { get: "/api/v1/projects/issues/{issue_id}/links" };
  }
```

And add the messages near the other message definitions:

```proto
// GitLink ties an issue to a Forgejo branch / pull request / commit.
message GitLink {
  string id = 1;
  string issue_id = 2;
  string kind = 3;   // branch | pr | commit
  string repo = 4;   // owner/name
  string ref = 5;    // branch name | PR number | commit sha
  string url = 6;
  string title = 7;
  string state = 8;  // open | merged | closed
  bool is_magic = 9;
  string created_at = 10;
  string updated_at = 11;
}

message ListIssueGitLinksRequest  { string issue_id = 1; }
message ListIssueGitLinksResponse { repeated GitLink links = 1; }
```

- [ ] **Step 2: Regenerate Go + gateway code**

Run: `buf generate`
Expected: `gen/go/grown/v1/projects.pb.go`, `projects_grpc.pb.go`, `projects.pb.gw.go` updated; `git status` shows them modified.

- [ ] **Step 3: Implement the RPC in service.go**

Add a proto mapper and the method:

```go
func gitLinkProto(l GitLink) *grownv1.GitLink {
	return &grownv1.GitLink{
		Id: l.ID, IssueId: l.IssueID, Kind: l.Kind, Repo: l.Repo, Ref: l.Ref,
		Url: l.URL, Title: l.Title, State: l.State, IsMagic: l.IsMagic,
		CreatedAt: l.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: l.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// ── Git links ──────────────────────────────────────────────────────────────

func (s *Service) ListIssueGitLinks(ctx context.Context, req *grownv1.ListIssueGitLinksRequest) (*grownv1.ListIssueGitLinksResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	links, err := s.repo.ListGitLinks(ctx, orgID, req.GetIssueId())
	if err != nil {
		return nil, toStatus(err, "list git links")
	}
	resp := &grownv1.ListIssueGitLinksResponse{Links: make([]*grownv1.GitLink, 0, len(links))}
	for _, l := range links {
		resp.Links = append(resp.Links, gitLinkProto(l))
	}
	return resp, nil
}
```

- [ ] **Step 4: Build**

Run: `go build ./...`
Expected: no errors (the generated `ProjectsServiceServer` interface now includes `ListIssueGitLinks`, satisfied by the method above).

- [ ] **Step 5: Commit**

```bash
git add proto/grown/v1/projects.proto gen/go/grown/v1/ internal/projects/service.go
git commit -m "feat(projects): ListIssueGitLinks RPC"
```

---

## Task 9: Frontend — types, API, IssueDetail "Git" section

**Files:**
- Modify: `web/app/src/pages/projects/types.ts`
- Modify: `web/app/src/pages/projects/api.ts`
- Modify: `web/app/src/pages/projects/IssueDetail.tsx`

- [ ] **Step 1: Add the `GitLink` type**

Append to `types.ts` (mirrors the proto JSON shape):

```typescript
// Git link: ties an issue to a Forgejo branch / PR / commit (from webhooks).
export interface GitLink {
  id: string;
  issue_id: string;
  kind: "branch" | "pr" | "commit";
  repo: string;       // "owner/name"
  ref: string;        // branch name | PR number | commit sha
  url: string;
  title: string;
  state: "open" | "merged" | "closed";
  is_magic: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Add the API call + branch-name helper**

Append to `api.ts` (follow the existing `listMembers` GET pattern):

```typescript
export async function listIssueGitLinks(issueId: string): Promise<GitLink[]> {
  const r = await jsonFetch<{ links: GitLink[] }>(`/projects/issues/${issueId}/links`);
  return r.links ?? [];
}

// gitBranchName builds a Forgejo-friendly branch name from an issue, e.g.
// "eng-42-fix-the-thing". Pushing a branch with this name auto-links the issue.
export function gitBranchName(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug ? `${identifier.toLowerCase()}-${slug}` : identifier.toLowerCase();
}
```

Ensure `GitLink` is imported in `api.ts` from `./types` (add to the existing type import).

- [ ] **Step 3: Add the "Git" section to IssueDetail**

In `IssueDetail.tsx`:

1. Add imports at the top (alongside existing React/api imports):

```typescript
import { useEffect, useState } from "react";
import { listIssueGitLinks, gitBranchName } from "./api";
import type { GitLink } from "./types";
```

2. Inside the `IssueDetail` component body, add state + fetch (place near the existing comments fetching):

```typescript
  const [gitLinks, setGitLinks] = useState<GitLink[]>([]);
  useEffect(() => {
    let live = true;
    listIssueGitLinks(issue.id)
      .then((ls) => live && setGitLinks(ls))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [issue.id, issue.updated_at]);

  const copyBranch = () => {
    void navigator.clipboard.writeText(gitBranchName(issue.identifier, issue.title));
  };
```

3. Render the section. Insert a new block before the "Activity"/comments `<Divider>` (mirroring the Sub-issues section header style):

```tsx
      <Divider sx={{ my: 1.5 }} />
      <Box sx={{ display: "flex", alignItems: "center", mb: 0.75 }}>
        <Typography level="title-sm" sx={{ flex: 1 }}>
          Git
        </Typography>
        <Button size="sm" variant="plain" onClick={copyBranch}>
          Copy branch name
        </Button>
      </Box>
      {gitLinks.length === 0 ? (
        <Typography level="body-xs" sx={{ opacity: 0.6 }}>
          No linked branches or pull requests yet. Reference{" "}
          <code>{issue.identifier}</code> in a branch, commit, or PR.
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {gitLinks.map((l) => (
            <Box
              key={l.id}
              component="a"
              href={l.url || undefined}
              target="_blank"
              rel="noreferrer"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                textDecoration: "none",
                color: "inherit",
                fontSize: 13,
                "&:hover": { textDecoration: "underline" },
              }}
            >
              <Chip
                size="sm"
                variant="soft"
                color={
                  l.state === "merged"
                    ? "success"
                    : l.state === "closed"
                      ? "danger"
                      : "primary"
                }
              >
                {l.kind === "pr" ? `PR #${l.ref}` : l.kind}
              </Chip>
              <Typography level="body-sm" noWrap sx={{ flex: 1 }}>
                {l.title || l.ref}
              </Typography>
              <Typography level="body-xs" sx={{ opacity: 0.5 }} noWrap>
                {l.repo}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
```

> Confirm `Button` and `Chip` are imported from `@mui/joy` in `IssueDetail.tsx`; add them to the existing `@mui/joy` import if missing.

- [ ] **Step 4: Typecheck the frontend**

Run: `cd web/app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/app/src/pages/projects/types.ts web/app/src/pages/projects/api.ts web/app/src/pages/projects/IssueDetail.tsx
git commit -m "feat(projects): show linked Forgejo branches/PRs + copy-branch-name button"
```

---

## Task 10: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full backend build + tests**

Run: `go build ./... && go test ./internal/projects/... ./internal/forgejo/...`
Expected: PASS.

- [ ] **Step 2: Frontend build**

Run: `cd web/app && npx tsc --noEmit && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Live smoke (requires a configured Forgejo + the env vars)**

With `GROWN_FORGEJO_URL`, `GROWN_FORGEJO_ADMIN_TOKEN`, `GROWN_PUBLIC_URL`, and `GROWN_FORGEJO_WEBHOOK_SECRET` set:

1. Create/visit an org → confirm an org-level webhook appears in Forgejo (`/git/<org>/-/settings` or via API `GET /api/v1/orgs/<slug>/hooks`).
2. In a repo under that org, push a branch named `eng-1-test` (with an existing issue `ENG-1` in `backlog`/`todo`) and open a PR titled `Fixes ENG-1`.
3. Confirm: the issue moves to `in_progress` on PR open; the issue detail "Git" section shows the PR link; merging the PR moves the issue to `done` (because the title carried the magic word).
4. Confirm an open board/list view updates live (collab WebSocket broadcast).

- [ ] **Step 4: Confirm no-op safety**

Unset `GROWN_FORGEJO_WEBHOOK_SECRET` and restart: `POST /api/v1/forgejo/webhook` returns `503`, org provisioning still works, no webhook is registered. This proves the subsystem is inert when unconfigured.

---

## Self-review notes

- **Spec coverage:** webhook auto-registration (Tasks 4–5), org-wide identifier matching (Tasks 2–3, 6), full status behavior incl. magic words (Task 6), link display + copy-branch (Task 9), global secret + no-op safety (Tasks 5–7), live updates via collab hub (Task 6 `broadcastIssue`). All spec points map to a task.
- **Type consistency:** `IssuePatch{Status, StatusSet}` is used in Tasks 3 & 6 — verify the real type name in `repository.go` before implementing and keep it identical across both tasks (flagged inline in Task 6 Step 4).
- **Open assumption to verify during Task 3/6:** the exact name of the issue-update patch struct and its status setter field. The exploration reported `IssuePatch` with `StatusSet`; if the codebase uses a different name, substitute consistently.
- **Branch-name format:** v1 uses `key-n-slug` (no `username/` prefix) to avoid depending on current-user context in `IssueDetail`; still auto-links. Revisit if a username prefix is wanted.
