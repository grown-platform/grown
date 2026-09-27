package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/sheets"
	"code.pick.haus/grown/grown/internal/slides"
	"code.pick.haus/grown/grown/internal/storage"
	"code.pick.haus/grown/grown/internal/users"
	"code.pick.haus/grown/grown/internal/whiteboards"
)

func TestVersionsWiringDisabledWithoutPool(t *testing.T) {
	w := newVersionsWiring(Config{})
	if w != nil {
		t.Fatal("wiring without a pool")
	}
	svc := sheets.NewService(nil)
	if got := w.sheetsServer(svc); got != grownv1.SheetsServiceServer(svc) {
		t.Fatal("nil wiring must register the plain service")
	}
	w.afterSave(context.Background(), versionsSheets, "x", "")
	w.sessionEnded(httptest.NewRequest(http.MethodGet, "/", nil), versionsSheets, "x")
}

func versionsCtx(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: userID, OrgID: orgID, DisplayName: userID})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID})
}

// TestVersionsEndToEnd saves through the wrapped gRPC services and drives the
// HTTP API as owner, stranger, viewer grantee and editor grantee. Needs
// GROWN_TEST_DSN (and drops that database's grown schema).
func TestVersionsEndToEnd(t *testing.T) {
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS grown CASCADE"); err != nil {
		t.Fatal(err)
	}
	if err := storage.RunMigrations(ctx, pool); err != nil {
		t.Fatal(err)
	}
	mk := func(slug string) (string, string) {
		var orgID, userID string
		if err := pool.QueryRow(ctx, `INSERT INTO grown.orgs (slug, display_name) VALUES ($1,$1) RETURNING id::text`, slug).Scan(&orgID); err != nil {
			t.Fatal(err)
		}
		if err := pool.QueryRow(ctx, `INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		    VALUES ($1,'test',$2,$2||'@t','') RETURNING id::text`, orgID, slug).Scan(&userID); err != nil {
			t.Fatal(err)
		}
		return orgID, userID
	}
	orgA, alice := mk("alice-org")
	orgE, eve := mk("eve-org")
	orgV, viv := mk("viv-org")
	orgD, dan := mk("dan-org")

	grants := sharing.NewRepository(pool)
	cfg := Config{
		Pool: pool, SharingRepo: grants,
		SheetsRepo: sheets.NewRepository(pool), SlidesRepo: slides.NewRepository(pool),
		WhiteboardsRepo: whiteboards.NewRepository(pool),
	}
	w := newVersionsWiring(cfg)
	sheetSrv := w.sheetsServer(sheets.NewService(cfg.SheetsRepo))
	deckSrv := w.slidesServer(slides.NewService(cfg.SlidesRepo))
	boardSrv := w.whiteboardsServer(whiteboards.NewService(cfg.WhiteboardsRepo))

	actx := versionsCtx(orgA, alice)
	sh, err := sheetSrv.CreateSheet(actx, &grownv1.CreateSheetRequest{Title: "S"})
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{`[{"name":"Sheet1","celldata":[{"r":0,"c":0,"v":{"v":1}}]}]`, `[{"name":"Sheet1","celldata":[]}]`} {
		if _, err := sheetSrv.SaveSheet(actx, &grownv1.SaveSheetRequest{Id: sh.GetId(), Data: d}); err != nil {
			t.Fatal(err)
		}
	}
	deck, _ := deckSrv.CreateDeck(actx, &grownv1.CreateDeckRequest{})
	if _, err := deckSrv.SaveDeck(actx, &grownv1.SaveDeckRequest{Id: deck.GetId(), Data: `{"slides":[{"id":"a"}]}`}); err != nil {
		t.Fatal(err)
	}
	board, _ := boardSrv.CreateWhiteboard(actx, &grownv1.CreateWhiteboardRequest{})
	if _, err := boardSrv.SaveWhiteboard(actx, &grownv1.SaveWhiteboardRequest{Id: board.GetId(), Data: `{"elements":[]}`}); err != nil {
		t.Fatal(err)
	}

	do := func(c context.Context, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body)).WithContext(c)
		rec := httptest.NewRecorder()
		w.handler.ServeHTTP(rec, req)
		return rec
	}
	type listResp struct {
		Versions []struct {
			ID         string `json:"id"`
			Label      string `json:"label"`
			IsAuto     bool   `json:"is_auto"`
			AuthorName string `json:"author_name"`
		} `json:"versions"`
		CanEdit bool `json:"can_edit"`
	}
	list := func(c context.Context, kind, id string) (int, listResp) {
		rec := do(c, http.MethodGet, "/api/v1/versions/"+kind+"/"+id, "")
		var l listResp
		_ = json.Unmarshal(rec.Body.Bytes(), &l)
		return rec.Code, l
	}

	// Two quick saves → one throttled auto snapshot, holding the first save.
	code, l := list(actx, "sheets", sh.GetId())
	if code != 200 || len(l.Versions) != 1 || !l.Versions[0].IsAuto || !l.CanEdit || l.Versions[0].AuthorName != "alice-org@t" {
		t.Fatalf("sheet versions: %d %+v", code, l)
	}
	firstID := l.Versions[0].ID
	for kind, id := range map[string]string{"slides": deck.GetId(), "whiteboards": board.GetId()} {
		if code, l := list(actx, kind, id); code != 200 || len(l.Versions) != 1 {
			t.Fatalf("%s versions: %d %+v", kind, code, l)
		}
	}

	// A stranger in another org sees nothing, and can't use a sheet version id
	// through a document of their own.
	ectx := versionsCtx(orgE, eve)
	if code, _ := list(ectx, "sheets", sh.GetId()); code != 404 {
		t.Fatalf("stranger list: %d", code)
	}
	if rec := do(ectx, http.MethodPost, "/api/v1/versions/sheets/"+sh.GetId()+"/"+firstID+"/restore", ""); rec.Code != 404 {
		t.Fatalf("stranger restore: %d", rec.Code)
	}
	evesSheet, _ := sheetSrv.CreateSheet(ectx, &grownv1.CreateSheetRequest{})
	if rec := do(ectx, http.MethodGet, "/api/v1/versions/sheets/"+evesSheet.GetId()+"/"+firstID, ""); rec.Code != 404 {
		t.Fatalf("cross-document version read: %d", rec.Code)
	}

	// A viewer grantee (other org) may list and preview but not name/restore.
	if err := grants.GrantAccess(ctx, sharing.TypeSheetsSheet, sh.GetId(), viv, sharing.RoleViewer, alice); err != nil {
		t.Fatal(err)
	}
	vctx := versionsCtx(orgV, viv)
	if code, l := list(vctx, "sheets", sh.GetId()); code != 200 || l.CanEdit {
		t.Fatalf("viewer list: %d %+v", code, l)
	}
	if rec := do(vctx, http.MethodGet, "/api/v1/versions/sheets/"+sh.GetId()+"/"+firstID, ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), `\"v\":1`) {
		t.Fatalf("viewer get: %d %s", rec.Code, rec.Body)
	}
	for _, c := range []struct{ method, path, body string }{
		{http.MethodPost, "/api/v1/versions/sheets/" + sh.GetId(), `{"label":"x"}`},
		{http.MethodPatch, "/api/v1/versions/sheets/" + sh.GetId() + "/" + firstID, `{"label":"x"}`},
		{http.MethodPost, "/api/v1/versions/sheets/" + sh.GetId() + "/" + firstID + "/restore", ""},
	} {
		if rec := do(vctx, c.method, c.path, c.body); rec.Code != 403 {
			t.Fatalf("viewer %s %s: %d", c.method, c.path, rec.Code)
		}
	}

	// The owner names the current (second) state.
	if rec := do(actx, http.MethodPost, "/api/v1/versions/sheets/"+sh.GetId(), `{"label":"Empty"}`); rec.Code != 200 {
		t.Fatalf("name: %d %s", rec.Code, rec.Body)
	}

	// An editor grantee in another org restores the first version: the live
	// sheet (in alice's org) gets the old content back.
	if err := grants.GrantAccess(ctx, sharing.TypeSheetsSheet, sh.GetId(), dan, sharing.RoleEditor, alice); err != nil {
		t.Fatal(err)
	}
	dctx := versionsCtx(orgD, dan)
	rec := do(dctx, http.MethodPost, "/api/v1/versions/sheets/"+sh.GetId()+"/"+firstID+"/restore", "")
	if rec.Code != 200 {
		t.Fatalf("editor restore: %d %s", rec.Code, rec.Body)
	}
	live, err := cfg.SheetsRepo.GetByID(ctx, sh.GetId())
	if err != nil || !strings.Contains(live.Data, `"v":1`) {
		t.Fatalf("live sheet after restore: %q %v", live.Data, err)
	}
	_, l = list(actx, "sheets", sh.GetId())
	if len(l.Versions) != 3 || !strings.HasPrefix(l.Versions[0].Label, "Restored") || l.Versions[1].Label != "Empty" {
		t.Fatalf("history after restore: %+v", l)
	}
}
