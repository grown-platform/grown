package desktops

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// MountPrefix is the path prefix the handler is mounted under (inside grown auth).
const MountPrefix = "/api/v1/desktops"

// Caller resolves the authenticated user from the request context. server.go
// supplies a closure backed by auth.UserFromContext / auth.OrgFromContext.
// Returns ok=false when there is no session.
type Caller func(ctx context.Context) (User, bool)

// Handler serves /api/v1/desktops/*. Routes 404 when the subsystem is disabled.
type Handler struct {
	svc      *Service
	callerOf Caller
}

// NewHandler constructs a Handler over the service.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// WithCaller injects the identity resolver and returns the handler for chaining.
func (h *Handler) WithCaller(c Caller) *Handler { h.callerOf = c; return h }

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil || !h.svc.Enabled() || h.callerOf == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	u, ok := h.callerOf(r.Context())
	if !ok || u.ID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "no session"})
		return
	}
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, MountPrefix), "/")
	ctx := r.Context()

	switch {
	case rest == "flavors" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"flavors": h.svc.ListFlavors()})

	case rest == "sessions" && r.Method == http.MethodGet:
		sess, err := h.svc.ListSessions(ctx, u)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if sess == nil {
			sess = []Session{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"sessions": sess})

	case rest == "launch" && r.Method == http.MethodPost:
		var in struct{ Flavor, Mode string }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad body"})
			return
		}
		sess, err := h.svc.Launch(ctx, u, in.Flavor, in.Mode)
		if err != nil {
			writeJSON(w, launchStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusAccepted, sess)

	case strings.HasPrefix(rest, "sessions/") && r.Method == http.MethodPost:
		// sessions/{id}/stop | sessions/{id}/heartbeat
		parts := strings.Split(rest, "/")
		if len(parts) != 3 || parts[1] == "" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		id, action := parts[1], parts[2]
		var err error
		switch action {
		case "stop":
			err = h.svc.Stop(ctx, u, id)
		case "heartbeat":
			err = h.svc.Touch(ctx, u, id)
		default:
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func launchStatus(err error) int {
	switch {
	case errors.Is(err, ErrBadRequest):
		return http.StatusBadRequest
	case errors.Is(err, ErrAtCapacity):
		return http.StatusConflict
	case errors.Is(err, ErrDisabled):
		return http.StatusNotFound
	default:
		return http.StatusInternalServerError
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
