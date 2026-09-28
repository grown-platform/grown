// Package integrationinfo serves the "who am I" endpoint external integrations
// (the Home Assistant `grown` custom integration) use to validate a Grown URL +
// API token pair during setup:
//
//	GET /api/v1/integrations/homeassistant/info
//	→ 200 {"user_id","email","name","org_id","org_name","scopes":[...],"version"}
//
// Any valid session or API token may call it; apitokens.ScopeFreePaths exempts
// it from token scope gating so a token holding only e.g. calendar/tasks scopes
// can still validate itself.
package integrationinfo

import (
	"encoding/json"
	"net/http"

	"code.pick.haus/grown/grown/internal/auth"
)

// HomeAssistantInfoPath is the mount path (also listed in apitokens.ScopeFreePaths).
const HomeAssistantInfoPath = "/api/v1/integrations/homeassistant/info"

// Info is the response body.
type Info struct {
	UserID  string   `json:"user_id"`
	Email   string   `json:"email"`
	Name    string   `json:"name"`
	OrgID   string   `json:"org_id"`
	OrgName string   `json:"org_name"`
	Scopes  []string `json:"scopes"`
	Version string   `json:"version"`
}

// Handler serves HomeAssistantInfoPath. Mount it inside auth.HTTPMiddleware.
type Handler struct {
	Version string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthenticated"})
		return
	}
	info := Info{UserID: u.ID, Email: u.Email, Name: u.DisplayName, OrgID: u.OrgID, Version: h.Version, Scopes: []string{"*"}}
	if o, ok := auth.OrgFromContext(r.Context()); ok {
		info.OrgID, info.OrgName = o.ID, o.DisplayName
	}
	if auth.IsTokenAuth(r.Context()) {
		scopes, _ := auth.ScopesFromContext(r.Context())
		info.Scopes = append([]string{}, scopes...)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, info)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
