package server

// Shared fixture for the authorization regression suite (authz_*_test.go).
// It builds the real HTTP handler (auth middleware → raw routes → gateway)
// over a fresh schema with users in three orgs:
//
//	alice    owner of every seeded document, in the DEFAULT org (so an
//	         anonymous request, which carries the default org in context,
//	         would expose any handler that checks the org but not the user)
//	bob      another member of alice's org (full edit, not owner)
//	mallory  a user of an unrelated org, with no grants
//	viv      another org, viewer grant on every seeded document
//	cara     another org, commenter grant on every seeded document
//	ed       another org, editor grant on every seeded document
//
// Needs GROWN_TEST_DSN (and drops that database's grown schema).

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5/pgxpool"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/convert"
	"code.pick.haus/grown/grown/internal/docs"
	"code.pick.haus/grown/grown/internal/forms"
	"code.pick.haus/grown/grown/internal/notifications"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/sheets"
	"code.pick.haus/grown/grown/internal/slides"
	"code.pick.haus/grown/grown/internal/storage"
	"code.pick.haus/grown/grown/internal/users"
	"code.pick.haus/grown/grown/internal/whiteboards"
)

type authzUser struct {
	Name, ID, OrgID, Token string
}

type authzEnv struct {
	t      *testing.T
	ctx    context.Context
	pool   *pgxpool.Pool
	cfg    Config
	ts     *httptest.Server
	users  map[string]authzUser
	grants *sharing.Repository
	// Seeded documents, all owned by alice and granted to viv/cara/ed.
	docID, sheetID, deckID, boardID string
}

// anon is the pseudo-user name for requests without a session.
const anon = ""

// authzSetup builds the fixture. opts may adjust the Config before New.
func authzSetup(t *testing.T, opts ...func(*Config)) *authzEnv {
	t.Helper()
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping integration test")
	}
	t.Setenv("GROWN_RATELIMIT_ENABLED", "false")
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS grown CASCADE"); err != nil {
		t.Fatalf("drop schema: %v", err)
	}
	if err := storage.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	orgsRepo := orgs.NewRepository(pool)
	defaultOrg, err := orgsRepo.GetBySlug(ctx, "default")
	if err != nil {
		t.Fatalf("default org: %v", err)
	}
	mkOrg := func(slug string) string {
		var id string
		if err := pool.QueryRow(ctx, `INSERT INTO grown.orgs (slug, display_name) VALUES ($1,$1) RETURNING id::text`, slug).Scan(&id); err != nil {
			t.Fatalf("org %s: %v", slug, err)
		}
		return id
	}
	orgM, orgG := mkOrg("mallory-org"), mkOrg("guest-org")
	sessions := auth.NewSessionStore(pool)
	e := &authzEnv{t: t, ctx: ctx, pool: pool, users: map[string]authzUser{}}
	for _, u := range []struct{ name, org string }{
		{"alice", defaultOrg.ID}, {"bob", defaultOrg.ID}, {"mallory", orgM},
		{"viv", orgG}, {"cara", orgG}, {"ed", orgG},
	} {
		var id string
		if err := pool.QueryRow(ctx,
			`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
			 VALUES ($1,'test',$2,$2||'@authz.test',$2) RETURNING id::text`, u.org, u.name).Scan(&id); err != nil {
			t.Fatalf("user %s: %v", u.name, err)
		}
		tok, err := sessions.Create(ctx, id, time.Hour)
		if err != nil {
			t.Fatalf("session %s: %v", u.name, err)
		}
		e.users[u.name] = authzUser{Name: u.name, ID: id, OrgID: u.org, Token: tok}
	}

	e.grants = sharing.NewRepository(pool)
	e.cfg = Config{
		AuthConfig:        auth.Config{CookieName: "grown_session", SessionLifetime: time.Hour},
		Sessions:          sessions,
		UsersRepo:         users.NewRepository(pool),
		OrgsRepo:          orgsRepo,
		DocsRepo:          docs.NewRepository(pool),
		SheetsRepo:        sheets.NewRepository(pool),
		SlidesRepo:        slides.NewRepository(pool),
		WhiteboardsRepo:   whiteboards.NewRepository(pool),
		FormsRepo:         forms.NewRepository(pool),
		SharingRepo:       e.grants,
		NotificationsRepo: notifications.NewRepository(pool),
		Pool:              pool,
		DefaultOrg:        defaultOrg,
		OfficeConverter:   convert.New(convert.Config{}),
	}
	for _, o := range opts {
		o(&e.cfg)
	}
	e.ts = httptest.NewServer(New(e.cfg).HTTPHandler())
	t.Cleanup(e.ts.Close)

	alice := e.users["alice"]
	d, err := e.cfg.DocsRepo.Create(ctx, alice.OrgID, alice.ID, "Doc")
	if err != nil {
		t.Fatal(err)
	}
	sh, err := e.cfg.SheetsRepo.Create(ctx, alice.OrgID, alice.ID, "Sheet")
	if err != nil {
		t.Fatal(err)
	}
	dk, err := e.cfg.SlidesRepo.Create(ctx, alice.OrgID, alice.ID, "Deck")
	if err != nil {
		t.Fatal(err)
	}
	wb, err := e.cfg.WhiteboardsRepo.Create(ctx, alice.OrgID, alice.ID, "Board")
	if err != nil {
		t.Fatal(err)
	}
	e.docID, e.sheetID, e.deckID, e.boardID = d.ID, sh.ID, dk.ID, wb.ID
	for _, g := range []struct{ typ, id string }{
		{sharing.TypeDocsDoc, d.ID}, {sharing.TypeSheetsSheet, sh.ID},
		{sharing.TypeSlidesDeck, dk.ID}, {sharing.TypeWhiteboardBoard, wb.ID},
	} {
		for user, role := range map[string]string{"viv": sharing.RoleViewer, "cara": sharing.RoleCommenter, "ed": sharing.RoleEditor} {
			if err := e.grants.GrantAccess(ctx, g.typ, g.id, e.users[user].ID, role, alice.ID); err != nil {
				t.Fatalf("grant %s %s: %v", user, g.typ, err)
			}
		}
	}
	return e
}

// req builds a request as user (anon for none) against the test server.
func (e *authzEnv) req(user, method, path string, body io.Reader) *http.Request {
	e.t.Helper()
	r, err := http.NewRequest(method, e.ts.URL+path, body)
	if err != nil {
		e.t.Fatalf("request %s %s: %v", method, path, err)
	}
	if user != anon {
		u, ok := e.users[user]
		if !ok {
			e.t.Fatalf("unknown user %q", user)
		}
		r.Header.Set("Cookie", "grown_session="+u.Token)
	}
	return r
}

// do sends a request and returns the status and body.
func (e *authzEnv) do(user, method, path, contentType string, body []byte) (int, string) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	r := e.req(user, method, path, rd)
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		e.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

// expect asserts a status for user, and returns the body.
func (e *authzEnv) expect(want int, user, method, path, body string) string {
	e.t.Helper()
	var b []byte
	ct := ""
	if body != "" {
		b, ct = []byte(body), "application/json"
	}
	code, got := e.do(user, method, path, ct, b)
	if code != want {
		e.t.Errorf("%s %s as %q: status %d, want %d (%.200s)", method, path, user, code, want, got)
	}
	return got
}

// noLeak asserts a refusal body carries none of the given secrets.
func (e *authzEnv) noLeak(body string, secrets ...string) {
	e.t.Helper()
	for _, s := range secrets {
		if s != "" && strings.Contains(body, s) {
			e.t.Errorf("refusal leaked %q: %.200s", s, body)
		}
	}
}

// injectedIDs are path-parameter values that must never reach storage as-is
// nor produce a 5xx.
var injectedIDs = []string{
	"..",
	"..%2F..%2Fetc%2Fpasswd",
	"%2e%2e",
	"not-a-uuid",
	"00000000-0000-0000-0000-000000000000",
	"'%20OR%20'1'%3D'1",
	"%00",
}

// dial opens a collab WebSocket as user.
func (e *authzEnv) dial(user, path string) (*websocket.Conn, error) {
	e.t.Helper()
	hdr := http.Header{}
	if user != anon {
		hdr.Set("Cookie", "grown_session="+e.users[user].Token)
	}
	ctx, cancel := context.WithTimeout(e.ctx, 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(e.ts.URL, "http")+path, &websocket.DialOptions{HTTPHeader: hdr})
	if err == nil {
		c.SetReadLimit(64 << 20)
		e.t.Cleanup(func() { c.CloseNow() })
	}
	return c, err
}

func (e *authzEnv) mustDial(user, path string) *websocket.Conn {
	e.t.Helper()
	c, err := e.dial(user, path)
	if err != nil {
		e.t.Fatalf("dial %s as %s: %v", path, user, err)
	}
	return c
}

// wsSend writes a text (or binary) message.
func wsSend(t *testing.T, c *websocket.Conn, typ websocket.MessageType, msg string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := c.Write(ctx, typ, []byte(msg)); err != nil {
		t.Fatalf("ws write: %v", err)
	}
}

// wsRead returns the next message within d, or ok=false on timeout. A
// timed-out read closes the connection (coder/websocket semantics), so it is
// used last on a connection, or on connections expected to receive.
func wsRead(c *websocket.Conn, d time.Duration) (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	_, b, err := c.Read(ctx)
	if err != nil {
		return "", false
	}
	return string(b), true
}

// wsReadUntil reads messages until one contains needle, within d.
func wsReadUntil(c *websocket.Conn, needle string, d time.Duration) (string, bool) {
	deadline := time.Now().Add(d)
	for {
		left := time.Until(deadline)
		if left <= 0 {
			return "", false
		}
		m, ok := wsRead(c, left)
		if !ok {
			return "", false
		}
		if strings.Contains(m, needle) {
			return m, true
		}
	}
}
