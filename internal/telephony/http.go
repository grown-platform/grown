package telephony

import (
	"encoding/json"
	"net/http"
	"time"
)

// connectPath is the WebSocket connect URL path for the telephony signaling hub.
const connectPath = "/api/v1/telephony/connect"

// ConnectPath reports whether path targets the telephony signaling WebSocket.
func ConnectPath(path string) bool {
	return path == connectPath
}

// logCallMount is the path for the call-logging HTTP surface.
const logCallMount = "/api/v1/telephony/calls/log"

// LogCallHandler is a pure-HTTP handler the frontend POSTs to when a call ends,
// recording the outcome in the call log. It is mounted inside grown's auth
// middleware so the caller's user/org are already on the request context.
//
//	POST /api/v1/telephony/calls/log
//	Body: {"peer_id": "...", "direction": "outgoing|incoming",
//	       "status": "completed|missed|rejected",
//	       "started_at": "<RFC3339>", "ended_at": "<RFC3339>"}
//
// The recorded caller/callee are derived from direction relative to the
// authenticated user, so a client cannot forge a call on someone else's behalf.
type LogCallHandler struct {
	repo        *Repository
	orgFromCtx  func(r *http.Request) (orgID string, ok bool)
	userFromCtx func(r *http.Request) (userID string, ok bool)
}

// NewLogCallHandler constructs a LogCallHandler. orgFromCtx and userFromCtx
// extract the caller's org/user IDs from the request context (supplied by
// server.go via closures over auth.OrgFromContext / auth.UserFromContext so
// this package stays free of the auth gen/ dependency).
func NewLogCallHandler(
	repo *Repository,
	orgFromCtx func(r *http.Request) (orgID string, ok bool),
	userFromCtx func(r *http.Request) (userID string, ok bool),
) *LogCallHandler {
	return &LogCallHandler{repo: repo, orgFromCtx: orgFromCtx, userFromCtx: userFromCtx}
}

// Match reports whether path is routed to this handler.
func (h *LogCallHandler) Match(path string) bool {
	return path == logCallMount
}

func (h *LogCallHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
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
		PeerID    string `json:"peer_id"`
		Direction string `json:"direction"`
		Status    string `json:"status"`
		StartedAt string `json:"started_at"`
		EndedAt   string `json:"ended_at"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	if body.PeerID == "" {
		http.Error(w, "peer_id required", http.StatusBadRequest)
		return
	}

	switch body.Status {
	case "completed", "missed", "rejected":
	default:
		body.Status = "completed"
	}

	// Map direction to caller/callee relative to the authenticated user.
	callerID, calleeID := userID, body.PeerID
	if body.Direction == "incoming" {
		callerID, calleeID = body.PeerID, userID
	}

	startedAt := parseTime(body.StartedAt, time.Now())
	var endedAt *time.Time
	if t := parseTimePtr(body.EndedAt); t != nil {
		endedAt = t
	}

	if _, err := h.repo.LogCall(r.Context(), orgID, callerID, calleeID, body.Status, startedAt, endedAt); err != nil {
		http.Error(w, "log call: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseTime(s string, fallback time.Time) time.Time {
	if s == "" {
		return fallback
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	return fallback
}

func parseTimePtr(s string) *time.Time {
	if s == "" {
		return nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return &t
	}
	return nil
}
