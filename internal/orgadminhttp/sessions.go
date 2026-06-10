package orgadminhttp

import (
	"net/http"
	"time"
)

// sessionOut is the JSON session shape for the admin + own-sessions views. The
// bearer token is never included — only the public id (for the revoke route).
type sessionOut struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	CreatedAt   string `json:"created_at"`
	ExpiresAt   string `json:"expires_at"`
	LastSeenAt  string `json:"last_seen_at,omitempty"`
	IP          string `json:"ip"`
	UserAgent   string `json:"user_agent"`
	Active      bool   `json:"active"`
	Revoked     bool   `json:"revoked"`
	Current     bool   `json:"current"`
}

// toSessionOut flattens a SessionInfo, deriving active/revoked from revoked_at
// and expiry.
func toSessionOut(s SessionInfo) sessionOut {
	revoked := s.RevokedAt != nil
	active := !revoked && time.Now().Before(s.ExpiresAt)
	out := sessionOut{
		ID:          s.ID,
		UserID:      s.UserID,
		Email:       s.Email,
		DisplayName: s.DisplayName,
		CreatedAt:   s.CreatedAt.UTC().Format(time.RFC3339),
		ExpiresAt:   s.ExpiresAt.UTC().Format(time.RFC3339),
		IP:          s.IP,
		UserAgent:   s.UserAgent,
		Active:      active,
		Revoked:     revoked,
		Current:     s.Current,
	}
	if s.LastSeenAt != nil {
		out.LastSeenAt = s.LastSeenAt.UTC().Format(time.RFC3339)
	}
	return out
}

// adminListSessions lists every session in the caller's org (admin-gated).
func (h *Handler) adminListSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	c, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}
	if h.sessions == nil {
		writeError(w, http.StatusServiceUnavailable, "sessions unavailable")
		return
	}
	infos, err := h.sessions.ListByOrg(r.Context(), c.orgID, c.sessionToken)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": mapSessions(infos)})
}

// adminRevokeSession revokes a session by public id, scoped to the caller's org.
func (h *Handler) adminRevokeSession(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	c, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}
	if h.sessions == nil {
		writeError(w, http.StatusServiceUnavailable, "sessions unavailable")
		return
	}
	if id == "" {
		writeError(w, http.StatusBadRequest, "session id required")
		return
	}
	revoked, err := h.sessions.RevokeByOrgAndID(r.Context(), c.orgID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !revoked {
		writeError(w, http.StatusNotFound, "session not found or already revoked")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// listOwnSessions lists the caller's own sessions (any authenticated member).
func (h *Handler) listOwnSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	c, ok := h.caller(w, r)
	if !ok {
		return
	}
	if h.sessions == nil {
		writeError(w, http.StatusServiceUnavailable, "sessions unavailable")
		return
	}
	infos, err := h.sessions.ListByUser(r.Context(), c.userID, c.sessionToken)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": mapSessions(infos)})
}

// revokeOwnSession lets the caller sign out one of their own devices.
func (h *Handler) revokeOwnSession(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	c, ok := h.caller(w, r)
	if !ok {
		return
	}
	if h.sessions == nil {
		writeError(w, http.StatusServiceUnavailable, "sessions unavailable")
		return
	}
	if id == "" {
		writeError(w, http.StatusBadRequest, "session id required")
		return
	}
	revoked, err := h.sessions.RevokeByUserAndID(r.Context(), c.userID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !revoked {
		writeError(w, http.StatusNotFound, "session not found or already revoked")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func mapSessions(infos []SessionInfo) []sessionOut {
	out := make([]sessionOut, 0, len(infos))
	for _, s := range infos {
		out = append(out, toSessionOut(s))
	}
	return out
}
