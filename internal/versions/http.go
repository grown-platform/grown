package versions

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Doc is a document resolved for the calling user.
type Doc struct {
	// OrgID is the document's own org (a grantee may be in another org).
	OrgID string
	// Data is the document's current stored JSON.
	Data string
	// CanWrite reports whether the caller may edit the document (and so name,
	// rename and restore its versions). Readers may list and preview.
	CanWrite bool
}

// Kind plugs one app (sheets, slides, whiteboards) into Handler.
type Kind struct {
	// Resolve loads the document for the caller, applying the app's own
	// read/write rules. ok=false means not found or not readable (the two are
	// indistinguishable to the caller).
	Resolve func(r *http.Request, id string) (doc Doc, ok bool, err error)
	// Save writes restored content to the live document.
	Save func(ctx context.Context, orgID, id, data string) error
}

// Handler serves the versions JSON API:
//
//	GET   /api/v1/versions/{kind}/{id}                   list (+ can_edit)
//	POST  /api/v1/versions/{kind}/{id}        {label}    name the current version
//	GET   /api/v1/versions/{kind}/{id}/{vid}             one version with data
//	PATCH /api/v1/versions/{kind}/{id}/{vid}  {label}    rename
//	POST  /api/v1/versions/{kind}/{id}/{vid}/restore     restore → {version, data}
//
// The caller's user must already be in the request context (UserID resolves
// it); every call resolves the document through its Kind first.
type Handler struct {
	M      *Manager
	Kinds  map[string]Kind
	UserID func(r *http.Request) (string, bool)
}

// Prefix is the path prefix Handler serves.
const Prefix = "/api/v1/versions/"

// Match reports whether path belongs to Handler.
func Match(path string) bool { return strings.HasPrefix(path, Prefix) }

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// VersionJSON is the wire form of a version.
type VersionJSON struct {
	ID           string `json:"id"`
	AuthorID     string `json:"author_id"`
	AuthorName   string `json:"author_name"`
	Label        string `json:"label"`
	IsAuto       bool   `json:"is_auto"`
	SizeBytes    int    `json:"size_bytes"`
	RestoredFrom string `json:"restored_from,omitempty"`
	CreatedAt    string `json:"created_at"`
	Data         string `json:"data,omitempty"`
}

func toJSON(v Version) VersionJSON {
	return VersionJSON{
		ID: v.ID, AuthorID: v.AuthorID, AuthorName: v.AuthorName, Label: v.Label,
		IsAuto: v.IsAuto, SizeBytes: v.SizeBytes, RestoredFrom: v.RestoredFrom,
		CreatedAt: v.CreatedAt.UTC().Format(time.RFC3339), Data: v.Data,
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func readLabel(r *http.Request) (string, bool) {
	var body struct {
		Label string `json:"label"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&body); err != nil {
		return "", false
	}
	return strings.TrimSpace(body.Label), true
}

func (h *Handler) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		http.Error(w, "version not found", http.StatusNotFound)
	case errors.Is(err, ErrTooManyNamed):
		http.Error(w, err.Error(), http.StatusConflict)
	case errors.Is(err, ErrTooLarge):
		http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
	case errors.Is(err, ErrForbidden):
		http.Error(w, ErrForbidden.Error(), http.StatusForbidden)
	default:
		slog.Error("versions", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.UserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, Prefix), "/")
	if len(parts) < 2 || len(parts) > 4 {
		http.NotFound(w, r)
		return
	}
	kindName, id := parts[0], parts[1]
	kind, ok := h.Kinds[kindName]
	if !ok || !uuidRe.MatchString(id) {
		http.NotFound(w, r)
		return
	}
	vid, action := "", ""
	if len(parts) >= 3 {
		vid = parts[2]
		if !uuidRe.MatchString(vid) {
			http.NotFound(w, r)
			return
		}
	}
	if len(parts) == 4 {
		action = parts[3]
		if action != "restore" {
			http.NotFound(w, r)
			return
		}
	}

	doc, found, err := kind.Resolve(r, id)
	if err != nil {
		h.fail(w, err)
		return
	}
	if !found {
		http.Error(w, "document not found", http.StatusNotFound)
		return
	}
	needWrite := r.Method != http.MethodGet
	if needWrite && !doc.CanWrite {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	ctx := r.Context()

	switch {
	case vid == "" && r.Method == http.MethodGet:
		list, err := h.M.List(ctx, kindName, id)
		if err != nil {
			h.fail(w, err)
			return
		}
		out := make([]VersionJSON, 0, len(list))
		for _, v := range list {
			out = append(out, toJSON(v))
		}
		writeJSON(w, http.StatusOK, map[string]any{"versions": out, "can_edit": doc.CanWrite})

	case vid == "" && r.Method == http.MethodPost:
		label, ok := readLabel(r)
		if !ok || label == "" {
			http.Error(w, "label required", http.StatusBadRequest)
			return
		}
		v, err := h.M.NameCurrent(ctx, kindName, id, userID, label, doc.Data)
		if err != nil {
			h.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, toJSON(v))

	case vid != "" && action == "" && r.Method == http.MethodGet:
		v, err := h.M.Get(ctx, kindName, id, vid)
		if err != nil {
			h.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, toJSON(v))

	case vid != "" && action == "" && r.Method == http.MethodPatch:
		label, ok := readLabel(r)
		if !ok {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		v, err := h.M.Rename(ctx, kindName, id, vid, label)
		if err != nil {
			h.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, toJSON(v))

	case action == "restore" && r.Method == http.MethodPost:
		v, err := h.M.Restore(ctx, kindName, id, userID, vid, doc.Data, func(data string) error {
			return kind.Save(ctx, doc.OrgID, id, data)
		})
		if err != nil {
			h.fail(w, err)
			return
		}
		vj := toJSON(v)
		vj.Data = ""
		writeJSON(w, http.StatusOK, map[string]any{"version": vj, "data": v.Data})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
