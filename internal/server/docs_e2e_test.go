package server

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5/pgxpool"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/docs"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/storage"
	"code.pick.haus/grown/grown/internal/users"
)

// This exercises the full Docs backend through the real HTTP handler: auth
// middleware → DocsService REST → collab WebSocket → persistence/replay. It
// stands in for a manual click-through while the nix stack is unavailable.
func docsTestServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping integration test")
	}
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

	var orgID, userID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&orgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','sub','tester@grown.localtest.me','Tester') RETURNING id::text`,
		orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	defaultOrg, _ := orgs.NewRepository(pool).GetBySlug(ctx, "default")
	sessions := auth.NewSessionStore(pool)
	token, err := sessions.Create(ctx, userID, time.Hour)
	if err != nil {
		t.Fatalf("session: %v", err)
	}

	srv := New(Config{
		AuthConfig: auth.Config{CookieName: "grown_session", SessionLifetime: time.Hour},
		Sessions:   sessions,
		UsersRepo:  users.NewRepository(pool),
		DocsRepo:   docs.NewRepository(pool),
		DefaultOrg: defaultOrg,
	})
	ts := httptest.NewServer(srv.HTTPHandler())
	t.Cleanup(ts.Close)
	return ts, token
}

func syncUpdate(payload []byte) []byte {
	out := make([]byte, 0, len(payload)+2)
	var b [binary.MaxVarintLen64]byte
	n := binary.PutUvarint(b[:], 0) // messageSync
	out = append(out, b[:n]...)
	n = binary.PutUvarint(b[:], 2) // syncUpdate
	out = append(out, b[:n]...)
	return append(out, payload...)
}

func TestDocsE2E_RESTAndCollab(t *testing.T) {
	ts, token := docsTestServer(t)
	cookie := "grown_session=" + token
	ctx := context.Background()

	// --- REST: create a document ---
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/docs",
		strings.NewReader(`{"title":"Integration Doc"}`))
	req.Header.Set("Cookie", cookie)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("create status: %d", resp.StatusCode)
	}
	var created struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()
	if created.ID == "" || created.Title != "Integration Doc" {
		t.Fatalf("unexpected created doc: %+v", created)
	}

	// --- REST: list returns it ---
	lreq, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/v1/docs", nil)
	lreq.Header.Set("Cookie", cookie)
	lresp, err := http.DefaultClient.Do(lreq)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var listed struct {
		Docs []struct {
			ID string `json:"id"`
		} `json:"docs"`
	}
	_ = json.NewDecoder(lresp.Body).Decode(&listed)
	lresp.Body.Close()
	if len(listed.Docs) != 1 || listed.Docs[0].ID != created.ID {
		t.Fatalf("list mismatch: %+v", listed)
	}

	// --- Auth: unauthenticated REST is rejected ---
	uresp, _ := http.Get(ts.URL + "/api/v1/docs")
	if uresp.StatusCode != 401 {
		t.Errorf("unauth list: got %d want 401", uresp.StatusCode)
	}
	uresp.Body.Close()

	// --- WebSocket collab: live relay between two clients ---
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/v1/docs/d/" + created.ID + "/connect"
	hdr := http.Header{"Cookie": {cookie}}

	connA, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatalf("dial A: %v", err)
	}
	defer connA.CloseNow()
	connB, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatalf("dial B: %v", err)
	}
	defer connB.CloseNow()

	time.Sleep(150 * time.Millisecond) // let both peers join the room

	msg := syncUpdate([]byte("hello-collab"))
	if err := connA.Write(ctx, websocket.MessageBinary, msg); err != nil {
		t.Fatalf("A write: %v", err)
	}

	rctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	typ, got, err := connB.Read(rctx)
	if err != nil {
		t.Fatalf("B read (live relay): %v", err)
	}
	if typ != websocket.MessageBinary || string(got) != string(msg) {
		t.Fatalf("B got %q want %q", got, msg)
	}

	// --- Persistence + replay: a fresh client receives the stored update ---
	time.Sleep(150 * time.Millisecond) // let the server persist A's update
	connC, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatalf("dial C: %v", err)
	}
	defer connC.CloseNow()

	cctx, ccancel := context.WithTimeout(ctx, 3*time.Second)
	defer ccancel()
	_, replayed, err := connC.Read(cctx)
	if err != nil {
		t.Fatalf("C read (replay): %v", err)
	}
	if string(replayed) != string(msg) {
		t.Fatalf("C replay got %q want %q", replayed, msg)
	}

	// --- WebSocket without auth is rejected (no user context) ---
	if _, _, err := websocket.Dial(ctx, wsURL, nil); err == nil {
		t.Errorf("expected unauth ws dial to fail")
	}
}
