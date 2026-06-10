package cloudimport

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
)

// CallerResolver returns the authenticated user's (orgID, userID) from the
// request context, injected by server.go so this package stays decoupled from
// internal/auth and its generated-proto dependency.
type CallerResolver func(ctx context.Context) (orgID, userID string, ok bool)

// Handler implements the Cloud Import HTTP surface (no gRPC).
//
//	POST /api/v1/import/upload
//	GET  /api/v1/import/jobs
//	GET  /api/v1/import/jobs/{id}
type Handler struct {
	repo     *Repository
	orch     *Orchestrator
	callerOf CallerResolver
}

// NewHandler constructs the Handler.
func NewHandler(repo *Repository, orch *Orchestrator, caller CallerResolver) *Handler {
	return &Handler{repo: repo, orch: orch, callerOf: caller}
}

const mountPrefix = "/api/v1/import"

// ServeHTTP routes on method + path.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	orgID, userID, ok := h.callerOf(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "no session")
		return
	}

	rest := strings.TrimPrefix(r.URL.Path, mountPrefix)
	rest = strings.Trim(rest, "/")

	switch {
	case rest == "upload" && r.Method == http.MethodPost:
		h.handleUpload(w, r, orgID, userID)

	case rest == "jobs" && r.Method == http.MethodGet:
		h.handleListJobs(w, r, orgID, userID)

	case strings.HasPrefix(rest, "jobs/") && r.Method == http.MethodGet:
		jobID := strings.TrimPrefix(rest, "jobs/")
		h.handleGetJob(w, r, orgID, jobID)

	default:
		writeErr(w, http.StatusNotFound, "not found")
	}
}

// ---- Upload ---------------------------------------------------------------

// handleUpload accepts a multipart archive, spools it to a temp file, creates
// a Job, and kicks the async worker.
func (h *Handler) handleUpload(w http.ResponseWriter, r *http.Request, orgID, userID string) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "parse multipart: "+err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing file part")
		return
	}
	defer file.Close()

	// Spool to temp file (avoids holding the whole thing in memory).
	tmp, err := os.CreateTemp("", "cloudimport-*.upload")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "spool temp file: "+err.Error())
		return
	}
	// Copy up to maxArchiveSize + 1 byte to detect oversized uploads.
	written, copyErr := limitedCopy(tmp, file)
	if copyErr != nil {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		writeErr(w, http.StatusInternalServerError, "spool: "+copyErr.Error())
		return
	}
	if written > maxArchiveSize {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		writeErr(w, http.StatusRequestEntityTooLarge, "archive exceeds 500 MB limit")
		return
	}

	// Detect source from the filename.
	source := string(detectSourceFromFilename(header.Filename))

	job, err := h.repo.CreateJob(r.Context(), orgID, userID, source, header.Filename)
	if err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		writeErr(w, http.StatusInternalServerError, "create job: "+err.Error())
		return
	}

	// Seek back to start for the worker.
	if _, err := tmp.Seek(0, 0); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
		writeErr(w, http.StatusInternalServerError, "seek: "+err.Error())
		return
	}

	// Kick async worker — ownership of tmp transfers.
	go h.orch.ProcessJob(job.ID, orgID, userID, header.Filename, tmp)

	writeJSON(w, http.StatusAccepted, jobToJSON(job))
}

func detectSourceFromFilename(name string) ArchiveSource {
	low := strings.ToLower(name)
	if strings.Contains(low, "takeout") {
		return SourceGoogleTakeout
	}
	return SourceFile
}

// ---- Jobs -----------------------------------------------------------------

func (h *Handler) handleListJobs(w http.ResponseWriter, _ *http.Request, orgID, userID string) {
	jobs, err := h.repo.ListJobs(context.Background(), orgID, userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]any, 0, len(jobs))
	for _, j := range jobs {
		out = append(out, jobToJSON(j))
	}
	writeJSON(w, http.StatusOK, map[string]any{"jobs": out})
}

func (h *Handler) handleGetJob(w http.ResponseWriter, r *http.Request, orgID, jobID string) {
	job, err := h.repo.GetJob(r.Context(), orgID, jobID)
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, "job not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, jobToJSON(job))
}

// ---- Helpers --------------------------------------------------------------

func jobToJSON(j Job) map[string]any {
	items := make([]map[string]any, 0, len(j.Items))
	for _, it := range j.Items {
		items = append(items, map[string]any{
			"id": it.ID, "kind": it.Kind, "count": it.Count,
			"status": it.Status, "detail": it.Detail,
		})
	}
	return map[string]any{
		"id":         j.ID,
		"org_id":     j.OrgID,
		"user_id":    j.UserID,
		"source":     j.Source,
		"filename":   j.Filename,
		"status":     j.Status,
		"created_at": j.CreatedAt.Unix(),
		"updated_at": j.UpdatedAt.Unix(),
		"items":      items,
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}

// limitedCopy copies at most maxArchiveSize+1 bytes from src to dst,
// returning the number of bytes written.
func limitedCopy(dst io.Writer, src io.Reader) (int64, error) {
	return io.Copy(dst, io.LimitReader(src, maxArchiveSize+1))
}
