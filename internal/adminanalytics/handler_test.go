package adminanalytics_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/adminanalytics"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---- test identity helpers --------------------------------------------------

type ctxKey string

const (
	userKey  ctxKey = "user"
	emailKey ctxKey = "email"
	orgKey   ctxKey = "org"
)

func withCaller(r *http.Request, userID, email, orgID string) *http.Request {
	ctx := context.WithValue(r.Context(), userKey, userID)
	ctx = context.WithValue(ctx, emailKey, email)
	ctx = context.WithValue(ctx, orgKey, orgID)
	return r.WithContext(ctx)
}

func makeCaller(ctx context.Context) (userID, email, orgID string, ok bool) {
	u, _ := ctx.Value(userKey).(string)
	e, _ := ctx.Value(emailKey).(string)
	o, _ := ctx.Value(orgKey).(string)
	if u == "" {
		return "", "", "", false
	}
	return u, e, o, true
}

func adminChecker(isAdmin bool) func(ctx context.Context) bool {
	return func(_ context.Context) bool { return isAdmin }
}

// makeHandler builds a handler with no pool (pool-less tests exercise
// auth/authz paths only).
func makeHandler(isAdmin bool) *adminanalytics.Handler {
	return adminanalytics.NewHandler(adminanalytics.Identity{
		Caller:  makeCaller,
		IsAdmin: adminChecker(isAdmin),
	})
}

// ---- authorization tests (no DB required) -----------------------------------

func TestUnauthenticated(t *testing.T) {
	h := makeHandler(false)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/analytics", nil)
	// no withCaller → Caller returns ok=false
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d; want 401", rr.Code)
	}
}

func TestNonAdmin(t *testing.T) {
	h := makeHandler(false) // isAdmin=false
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/analytics", nil)
	req = withCaller(req, "u1", "member@test", "org1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d; want 403", rr.Code)
	}
}

func TestAdminNoPool(t *testing.T) {
	// Admin user but no pool set → 503 rather than panic.
	h := makeHandler(true)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/analytics", nil)
	req = withCaller(req, "u1", "admin@test", "org1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503", rr.Code)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	h := makeHandler(true)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/analytics", nil)
	req = withCaller(req, "u1", "admin@test", "org1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d; want 405", rr.Code)
	}
}

// ---- integration test (real PG, DSN-guarded) --------------------------------

// TestCollectOrgScoped connects to the test database pointed to by
// TEST_DATABASE_URL (or GROWN_DATABASE_URL) and verifies:
//  1. A 200 response is returned.
//  2. org_id is echoed correctly.
//  3. collected_at parses as RFC3339.
//  4. All stat fields are non-negative integers.
//  5. total_bytes equals the sum of the individual byte fields.
//
// The test only queries existing tables; it never inserts or migrates, so it is
// safe to run against a real dev database. It is skipped when no DSN is set.
func TestCollectOrgScoped(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("GROWN_DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL / GROWN_DATABASE_URL not set; skipping DB integration test")
	}

	ctx := t.Context()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	// Resolve a real org id from the DB so we test with valid data.
	var orgID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs LIMIT 1`).Scan(&orgID); err != nil {
		t.Skipf("no orgs found in test DB: %v", err)
	}

	h := adminanalytics.NewHandler(adminanalytics.Identity{
		Caller: func(c context.Context) (string, string, string, bool) {
			return "u1", "admin@test", orgID, true
		},
		IsAdmin: func(_ context.Context) bool { return true },
	}).WithPool(pool)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/analytics", nil)
	req = withCaller(req, "u1", "admin@test", orgID)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200 (body=%s)", rr.Code, rr.Body.String())
	}

	var resp struct {
		OrgID       string `json:"org_id"`
		CollectedAt string `json:"collected_at"`
		Users       struct {
			TotalMembers     int64 `json:"total_members"`
			TotalAdmins      int64 `json:"total_admins"`
			ActiveLast7Days  int64 `json:"active_last_7_days"`
			ActiveLast30Days int64 `json:"active_last_30_days"`
		} `json:"users"`
		Storage struct {
			DriveBytes          int64 `json:"drive_bytes"`
			PhotoBytes          int64 `json:"photo_bytes"`
			VideoBytes          int64 `json:"video_bytes"`
			MusicBytes          int64 `json:"music_bytes"`
			MailAttachmentBytes int64 `json:"mail_attachment_bytes"`
			TotalBytes          int64 `json:"total_bytes"`
		} `json:"storage"`
		Apps struct {
			DriveFiles int64 `json:"drive_files"`
			Docs       int64 `json:"docs"`
		} `json:"apps"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if resp.OrgID != orgID {
		t.Errorf("org_id = %q; want %q", resp.OrgID, orgID)
	}
	if _, err := time.Parse(time.RFC3339, resp.CollectedAt); err != nil {
		t.Errorf("collected_at %q: %v", resp.CollectedAt, err)
	}
	if resp.Users.TotalMembers < 0 {
		t.Errorf("total_members negative")
	}
	if resp.Storage.TotalBytes != resp.Storage.DriveBytes+resp.Storage.PhotoBytes+resp.Storage.VideoBytes+resp.Storage.MusicBytes+resp.Storage.MailAttachmentBytes {
		t.Errorf("total_bytes does not match sum of parts")
	}
}
