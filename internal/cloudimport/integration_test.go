package cloudimport

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupCI brings up a throwaway Postgres (gated on GROWN_TEST_DSN) with the
// grown schema migrated, and returns a pool plus a seeded org/user.
func setupCI(t *testing.T) (*pgxpool.Pool, string, string) {
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
		t.Fatalf("RunMigrations: %v", err)
	}
	var orgID, userID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&orgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','subject-1','tester@grown.test','Tester') RETURNING id::text`,
		orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return pool, orgID, userID
}

// writeTempArchive spools bytes to a temp *os.File seeked to 0.
func writeTempArchive(t *testing.T, data []byte) *os.File {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "ci-*.upload")
	if err != nil {
		t.Fatalf("temp: %v", err)
	}
	if _, err := f.Write(data); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := f.Seek(0, 0); err != nil {
		t.Fatalf("seek: %v", err)
	}
	return f
}

func buildZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatalf("zip write: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

func buildTarGz(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	for name, body := range files {
		hdr := &tar.Header{Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatalf("tar header: %v", err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatalf("tar write: %v", err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("tar close: %v", err)
	}
	if err := gw.Close(); err != nil {
		t.Fatalf("gz close: %v", err)
	}
	return buf.Bytes()
}

const ciVCF = "BEGIN:VCARD\nFN:Zed Zoo\nEMAIL:zed@example.com\nEND:VCARD\n"
const ciICS = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:e1\nSUMMARY:Sync\nDTSTART:20240601T100000Z\nDTEND:20240601T110000Z\nEND:VEVENT\nEND:VCALENDAR\n"

// multipartFile builds a multipart/form-data body with one file field.
func multipartFile(t *testing.T, field, filename, body string) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	w, err := mw.CreateFormFile(field, filename)
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := w.Write([]byte(body)); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	return &buf, mw.FormDataContentType()
}

// findItem returns the item with the given kind from a job.
func findItem(items []Item, kind string) (Item, bool) {
	for _, it := range items {
		if it.Kind == kind {
			return it, true
		}
	}
	return Item{}, false
}

// ---- Full orchestrator pipeline: ZIP --------------------------------------

func TestProcessJob_Zip(t *testing.T) {
	pool, orgID, userID := setupCI(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	ci := &stubContactImporter{}
	ei := &stubEventImporter{}
	fi := &stubFileImporter{}
	orch := NewOrchestrator(repo, ci, ei, fi)

	zipData := buildZip(t, map[string]string{
		"Takeout/Contacts/all.vcf":      ciVCF,
		"Takeout/Calendar/cal.ics":      ciICS,
		"Takeout/Drive/report.pdf":      "%PDF-1.4 fake",
		"Takeout/Google Photos/p.jpg":   "jpegbytes",
		"Takeout/archive_browser.html":  "<html></html>",
	})

	job, err := repo.CreateJob(ctx, orgID, userID, "google_takeout", "takeout.zip")
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if job.Status != StatusPending {
		t.Errorf("initial status = %q, want pending", job.Status)
	}

	f := writeTempArchive(t, zipData)
	// ProcessJob owns and removes f; copy its path first for cleanup safety.
	orch.ProcessJob(job.ID, orgID, userID, "takeout.zip", f)

	got, err := repo.GetJob(ctx, orgID, job.ID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if got.Status != StatusDone {
		t.Errorf("status = %q, want done", got.Status)
	}
	if c, ok := findItem(got.Items, "contacts"); !ok || c.Count != 1 {
		t.Errorf("contacts item = %+v ok=%v", c, ok)
	}
	if c, ok := findItem(got.Items, "calendar"); !ok || c.Count != 1 {
		t.Errorf("calendar item = %+v ok=%v", c, ok)
	}
	if c, ok := findItem(got.Items, "drive"); !ok || c.Count != 1 {
		t.Errorf("drive item = %+v ok=%v", c, ok)
	}
	if p, ok := findItem(got.Items, "photos"); !ok || p.Status != ItemSkipped {
		t.Errorf("photos item = %+v ok=%v", p, ok)
	}
	if len(ci.contacts) != 1 || len(ei.events) != 1 || len(fi.files) != 1 {
		t.Errorf("importers: contacts=%d events=%d files=%d", len(ci.contacts), len(ei.events), len(fi.files))
	}
}

// ---- Full pipeline: tar.gz -------------------------------------------------

func TestProcessJob_TarGz(t *testing.T) {
	pool, orgID, userID := setupCI(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	ci := &stubContactImporter{}
	orch := NewOrchestrator(repo, ci, nil, nil)

	data := buildTarGz(t, map[string]string{"Takeout/Contacts/all.vcf": ciVCF})
	job, _ := repo.CreateJob(ctx, orgID, userID, "google_takeout", "takeout.tar.gz")
	f := writeTempArchive(t, data)
	orch.ProcessJob(job.ID, orgID, userID, "takeout.tar.gz", f)

	got, err := repo.GetJob(ctx, orgID, job.ID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if got.Status != StatusDone {
		t.Errorf("status = %q, want done", got.Status)
	}
	if c, ok := findItem(got.Items, "contacts"); !ok || c.Count != 1 {
		t.Errorf("contacts item = %+v ok=%v", c, ok)
	}
}

// ---- Full pipeline: single file -------------------------------------------

func TestProcessJob_SingleFile(t *testing.T) {
	pool, orgID, userID := setupCI(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	ci := &stubContactImporter{}
	orch := NewOrchestrator(repo, ci, nil, nil)

	job, _ := repo.CreateJob(ctx, orgID, userID, "file", "contacts.vcf")
	f := writeTempArchive(t, []byte(ciVCF))
	orch.ProcessJob(job.ID, orgID, userID, "contacts.vcf", f)

	got, _ := repo.GetJob(ctx, orgID, job.ID)
	if got.Status != StatusDone {
		t.Errorf("status = %q, want done", got.Status)
	}
	if len(ci.contacts) != 1 {
		t.Errorf("imported %d contacts, want 1", len(ci.contacts))
	}
}

// ---- Single file, unrecognised type ---------------------------------------

func TestProcessJob_SingleFileUnknown(t *testing.T) {
	pool, orgID, userID := setupCI(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	orch := NewOrchestrator(repo, nil, nil, nil)

	job, _ := repo.CreateJob(ctx, orgID, userID, "file", "mystery.bin")
	f := writeTempArchive(t, []byte("\x00\x01\x02"))
	orch.ProcessJob(job.ID, orgID, userID, "mystery.bin", f)

	got, _ := repo.GetJob(ctx, orgID, job.ID)
	if got.Status != StatusDone {
		t.Errorf("status = %q, want done", got.Status)
	}
	if it, ok := findItem(got.Items, "unknown"); !ok || it.Status != ItemSkipped {
		t.Errorf("unknown item = %+v ok=%v", it, ok)
	}
}

// ---- Corrupt zip → job marked failed --------------------------------------

func TestProcessJob_CorruptZipFails(t *testing.T) {
	pool, orgID, userID := setupCI(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	orch := NewOrchestrator(repo, nil, nil, nil)

	job, _ := repo.CreateJob(ctx, orgID, userID, "file", "broken.zip")
	f := writeTempArchive(t, []byte("PK\x03\x04 not a real zip"))
	orch.ProcessJob(job.ID, orgID, userID, "broken.zip", f)

	got, _ := repo.GetJob(ctx, orgID, job.ID)
	if got.Status != StatusFailed {
		t.Errorf("status = %q, want failed", got.Status)
	}
	if it, ok := findItem(got.Items, "error"); !ok || it.Status != ItemError {
		t.Errorf("error item = %+v ok=%v", it, ok)
	}
}

// ---- Repository CRUD + isolation ------------------------------------------

func TestRepository_CRUDAndIsolation(t *testing.T) {
	pool, orgID, userID := setupCI(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	job, err := repo.CreateJob(ctx, orgID, userID, "file", "a.vcf")
	if err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if err := repo.SetStatus(ctx, job.ID, StatusProcessing); err != nil {
		t.Fatalf("SetStatus: %v", err)
	}
	if _, err := repo.AddItem(ctx, Item{JobID: job.ID, Kind: "contacts", Count: 3, Status: ItemDone, Detail: "ok"}); err != nil {
		t.Fatalf("AddItem: %v", err)
	}

	got, err := repo.GetJob(ctx, orgID, job.ID)
	if err != nil {
		t.Fatalf("GetJob: %v", err)
	}
	if got.Status != StatusProcessing {
		t.Errorf("status = %q", got.Status)
	}
	if len(got.Items) != 1 || got.Items[0].Count != 3 {
		t.Errorf("items = %+v", got.Items)
	}

	// GetJob with wrong org → ErrNotFound.
	if _, err := repo.GetJob(ctx, "00000000-0000-0000-0000-000000000000", job.ID); err == nil {
		t.Error("GetJob with wrong org should fail")
	}

	jobs, err := repo.ListJobs(ctx, orgID, userID)
	if err != nil {
		t.Fatalf("ListJobs: %v", err)
	}
	if len(jobs) != 1 {
		t.Errorf("ListJobs = %d, want 1", len(jobs))
	}
}

func TestRepository_GetJobNotFound(t *testing.T) {
	pool, orgID, _ := setupCI(t)
	repo := NewRepository(pool)
	_, err := repo.GetJob(context.Background(), orgID, "00000000-0000-0000-0000-000000000000")
	if err == nil {
		t.Fatal("want ErrNotFound, got nil")
	}
}

// ---- Handler repo-backed routes -------------------------------------------

func TestHandler_ListAndGetJobs(t *testing.T) {
	pool, orgID, userID := setupCI(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	job, _ := repo.CreateJob(ctx, orgID, userID, "file", "a.vcf")
	_, _ = repo.AddItem(ctx, Item{JobID: job.ID, Kind: "contacts", Count: 2, Status: ItemDone, Detail: "ok"})

	caller := func(_ context.Context) (string, string, bool) { return orgID, userID, true }
	h := NewHandler(repo, nil, caller)

	// List
	{
		req := httptest.NewRequest(http.MethodGet, mountPrefix+"/jobs", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("list status = %d", rec.Code)
		}
		var body struct {
			Jobs []map[string]any `json:"jobs"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if len(body.Jobs) != 1 {
			t.Errorf("jobs = %d, want 1", len(body.Jobs))
		}
	}

	// Get by id
	{
		req := httptest.NewRequest(http.MethodGet, mountPrefix+"/jobs/"+job.ID, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("get status = %d", rec.Code)
		}
		var got map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &got)
		if got["id"] != job.ID {
			t.Errorf("id = %v, want %v", got["id"], job.ID)
		}
	}

	// Get missing id → 404
	{
		req := httptest.NewRequest(http.MethodGet, mountPrefix+"/jobs/00000000-0000-0000-0000-000000000000", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("missing job status = %d, want 404", rec.Code)
		}
	}
}

// ---- Handler upload happy path (exercises CreateJob + async worker) --------

func TestHandler_UploadCreatesJob(t *testing.T) {
	pool, orgID, userID := setupCI(t)
	repo := NewRepository(pool)
	orch := NewOrchestrator(repo, &stubContactImporter{}, nil, nil)
	caller := func(_ context.Context) (string, string, bool) { return orgID, userID, true }
	h := NewHandler(repo, orch, caller)

	body, contentType := multipartFile(t, "file", "contacts.vcf", ciVCF)
	req := httptest.NewRequest(http.MethodPost, mountPrefix+"/upload", body)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("upload status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	jobID, _ := got["id"].(string)
	if jobID == "" {
		t.Fatal("no job id returned")
	}

	// The worker runs asynchronously; poll until it reaches a terminal state.
	deadline := time.Now().Add(5 * time.Second)
	for {
		j, err := repo.GetJob(context.Background(), orgID, jobID)
		if err == nil && (j.Status == StatusDone || j.Status == StatusFailed) {
			if j.Status != StatusDone {
				t.Errorf("final status = %q, want done", j.Status)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("worker did not finish in time")
		}
		time.Sleep(25 * time.Millisecond)
	}
}
