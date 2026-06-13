package apitokens

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// AuthFuncs supplies the caller's identity + auth kind from the request context.
type AuthFuncs struct {
	UserID      func(r *http.Request) (string, bool)
	OrgID       func(r *http.Request) (string, bool)
	IsTokenAuth func(r *http.Request) bool
}

// HTTPHandler serves the personal-access-token management surface, mounted
// inside grown's auth middleware:
//
//	GET    /api/v1/me/tokens        → list the caller's tokens (no plaintext)
//	POST   /api/v1/me/tokens        → create {name, scopes[], expires_in_days?}; returns plaintext once
//	DELETE /api/v1/me/tokens/{id}   → revoke
type HTTPHandler struct {
	repo *Repository
	auth AuthFuncs
}

// NewHTTPHandler constructs the handler.
func NewHTTPHandler(repo *Repository, auth AuthFuncs) *HTTPHandler {
	return &HTTPHandler{repo: repo, auth: auth}
}

const mount = "/api/v1/me/tokens"

// Match reports whether path is the token surface, returning the token id (if any).
func (h *HTTPHandler) Match(path string) (id string, ok bool) {
	if path == mount || path == mount+"/" {
		return "", true
	}
	if strings.HasPrefix(path, mount+"/") {
		return strings.TrimPrefix(path, mount+"/"), true
	}
	return "", false
}

type tokenJSON struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Prefix     string   `json:"prefix"`
	Scopes     []string `json:"scopes"`
	LastUsedAt int64    `json:"last_used_at,omitempty"`
	ExpiresAt  int64    `json:"expires_at,omitempty"`
	CreatedAt  int64    `json:"created_at"`
}

func toJSON(t Token) tokenJSON {
	j := tokenJSON{ID: t.ID, Name: t.Name, Prefix: t.Prefix, Scopes: t.Scopes, CreatedAt: t.CreatedAt.Unix()}
	if t.LastUsedAt != nil {
		j.LastUsedAt = t.LastUsedAt.Unix()
	}
	if t.ExpiresAt != nil {
		j.ExpiresAt = t.ExpiresAt.Unix()
	}
	return j
}

func (h *HTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	id, ok := h.Match(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	userID, ok := h.auth.UserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	// Managing tokens must use an interactive session, never another token —
	// otherwise a narrow token could mint a full-access one.
	if h.auth.IsTokenAuth != nil && h.auth.IsTokenAuth(r) {
		http.Error(w, "token management requires an interactive session", http.StatusForbidden)
		return
	}

	switch {
	case r.Method == http.MethodGet && id == "":
		list, err := h.repo.List(r.Context(), userID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		out := make([]tokenJSON, 0, len(list))
		for _, t := range list {
			out = append(out, toJSON(t))
		}
		writeJSON(w, http.StatusOK, map[string]any{"tokens": out})

	case r.Method == http.MethodPost && id == "":
		orgID, _ := h.auth.OrgID(r)
		var body struct {
			Name         string   `json:"name"`
			Scopes       []string `json:"scopes"`
			ExpiresInDay int      `json:"expires_in_days"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.TrimSpace(body.Name) == "" {
			body.Name = "API token"
		}
		var expiresAt *time.Time
		if body.ExpiresInDay > 0 {
			t := time.Now().Add(time.Duration(body.ExpiresInDay) * 24 * time.Hour)
			expiresAt = &t
		}
		plain, tok, err := h.repo.Create(r.Context(), userID, orgID, body.Name, body.Scopes, expiresAt)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		resp := toJSON(tok)
		writeJSON(w, http.StatusCreated, map[string]any{"token": plain, "info": resp})

	case r.Method == http.MethodDelete && id != "":
		if err := h.repo.Revoke(r.Context(), userID, id); err != nil {
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
