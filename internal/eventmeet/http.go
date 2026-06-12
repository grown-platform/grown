package eventmeet

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// linkJSON is the JSON shape returned for an event's meeting.
type linkJSON struct {
	RoomID string `json:"room_id"`
	Code   string `json:"code"`
}

// HTTPHandler serves the per-event meeting surface, mounted inside grown's auth
// middleware so the caller's org/user are already on the request context:
//
//	GET    /api/v1/calendar/events/{id}/meet  → resolve the attached meeting
//	PUT    /api/v1/calendar/events/{id}/meet  → attach {room_id, code}
//	DELETE /api/v1/calendar/events/{id}/meet  → detach
type HTTPHandler struct {
	repo        *Repository
	orgFromCtx  func(r *http.Request) (string, bool)
	userFromCtx func(r *http.Request) (string, bool)
}

// NewHTTPHandler constructs an HTTPHandler.
func NewHTTPHandler(
	repo *Repository,
	orgFromCtx func(r *http.Request) (string, bool),
	userFromCtx func(r *http.Request) (string, bool),
) *HTTPHandler {
	return &HTTPHandler{repo: repo, orgFromCtx: orgFromCtx, userFromCtx: userFromCtx}
}

const (
	prefix = "/api/v1/calendar/events/"
	suffix = "/meet"
)

// Match reports whether path is the per-event meeting surface and returns the
// event id when so.
func (h *HTTPHandler) Match(path string) (eventID string, ok bool) {
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

func (h *HTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	eventID, ok := h.Match(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	orgID, ok := h.orgFromCtx(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		l, err := h.repo.Get(r.Context(), orgID, eventID)
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "no meeting", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, linkJSON{RoomID: l.RoomID, Code: l.Code})

	case http.MethodPut:
		var body linkJSON
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if body.RoomID == "" || body.Code == "" {
			http.Error(w, "room_id and code required", http.StatusBadRequest)
			return
		}
		err := h.repo.Set(r.Context(), orgID, eventID, body.RoomID, body.Code)
		if errors.Is(err, ErrEventNotFound) {
			http.Error(w, "event not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, body)

	case http.MethodDelete:
		if err := h.repo.Delete(r.Context(), orgID, eventID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
