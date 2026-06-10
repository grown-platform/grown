package meet

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// MeetingJSON is the JSON shape returned by the codes HTTP surface.
type MeetingJSON struct {
	ID        string `json:"id"`
	OrgID     string `json:"org_id"`
	OwnerID   string `json:"owner_id"`
	Name      string `json:"name"`
	Code      string `json:"code"`
	CreatedAt string `json:"created_at"`
}

func roomToJSON(r Room) MeetingJSON {
	return MeetingJSON{
		ID:        r.ID,
		OrgID:     r.OrgID,
		OwnerID:   r.OwnerID,
		Name:      r.Name,
		Code:      r.Code,
		CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339),
	}
}

// CodesHandler is a pure-HTTP handler for the short-code surface:
//
//	POST /api/v1/meet/codes           → create a meeting + code
//	GET  /api/v1/meet/codes/{code}    → resolve code → meeting
//
// It is mounted inside grown's auth middleware so the caller's user/org are
// already on the request context (via internal/auth).
type CodesHandler struct {
	repo        *Repository
	orgFromCtx  func(r *http.Request) (orgID string, ok bool)
	userFromCtx func(r *http.Request) (userID string, ok bool)
}

// codesMount is the path prefix for the codes HTTP surface.
const codesMount = "/api/v1/meet/codes"

// NewCodesHandler constructs a CodesHandler. orgFromCtx and userFromCtx extract
// the caller's org/user IDs from the request context (supplied by server.go
// using closures over auth.OrgFromContext / auth.UserFromContext so this
// package stays free of the auth gen/ dependency).
func NewCodesHandler(
	repo *Repository,
	orgFromCtx func(r *http.Request) (orgID string, ok bool),
	userFromCtx func(r *http.Request) (userID string, ok bool),
) *CodesHandler {
	return &CodesHandler{repo: repo, orgFromCtx: orgFromCtx, userFromCtx: userFromCtx}
}

// Match reports whether path is routed to this handler, and returns the code
// segment (empty for the collection route).
func (h *CodesHandler) Match(path string) (code string, ok bool) {
	if path == codesMount || path == codesMount+"/" {
		return "", true
	}
	if strings.HasPrefix(path, codesMount+"/") {
		rest := strings.TrimPrefix(path, codesMount+"/")
		if rest != "" && !strings.Contains(rest, "/") {
			return rest, true
		}
	}
	return "", false
}

func (h *CodesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	code, _ := h.Match(r.URL.Path)

	switch {
	case r.Method == http.MethodPost && code == "":
		h.handleCreate(w, r)
	case r.Method == http.MethodGet && code != "":
		h.handleResolve(w, r, code)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

// handleCreate creates a new meeting with a generated short code.
//
//	POST /api/v1/meet/codes
//	Body (optional JSON): {"name": "..."}
//	Returns 201 + MeetingJSON.
func (h *CodesHandler) handleCreate(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgFromCtx(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID, ok := h.userFromCtx(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}

	room, err := h.repo.Create(r.Context(), orgID, userID, body.Name)
	if err != nil {
		http.Error(w, "create meeting: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(roomToJSON(room))
}

// handleResolve resolves a short code to a meeting.
//
//	GET /api/v1/meet/codes/{code}
//	Returns 200 + MeetingJSON, or 400 / 404.
func (h *CodesHandler) handleResolve(w http.ResponseWriter, r *http.Request, code string) {
	orgID, ok := h.orgFromCtx(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	room, err := h.repo.GetByCode(r.Context(), orgID, code)
	if errors.Is(err, ErrInvalidCode) {
		http.Error(w, "invalid code format", http.StatusBadRequest)
		return
	}
	if errors.Is(err, ErrNotFound) {
		http.Error(w, "meeting not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "resolve code: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(roomToJSON(room))
}
