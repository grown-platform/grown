package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"code.pick.haus/grown/grown/internal/pdf/auth"
	"code.pick.haus/grown/grown/internal/pdf/database"
	"code.pick.haus/grown/grown/internal/pdf/sqlc"
)

// AdminHandler exposes super_admin-only operations registered directly on
// the root HTTP mux (no proto / gRPC gateway, to keep the surface small).
type AdminHandler struct {
	db *database.DB
}

func NewAdminHandler(db *database.DB) *AdminHandler {
	return &AdminHandler{db: db}
}

type superadminJSON struct {
	Email     string `json:"email"`
	GrantedBy string `json:"grantedBy"`
	GrantedAt string `json:"grantedAt"`
}

// ListSuperadmins handles GET /api/admin/superadmins.
func (h *AdminHandler) ListSuperadmins(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Queries.ListSuperadmins(r.Context())
	if err != nil {
		slog.Error("ListSuperadmins query failed", "error", err)
		http.Error(w, "failed to list superadmins", http.StatusInternalServerError)
		return
	}
	out := make([]superadminJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, superadminJSON{
			Email:     row.Email,
			GrantedBy: row.GrantedBy,
			GrantedAt: row.GrantedAt.Time.Format(time.RFC3339),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"superadmins": out})
}

// GrantSuperadmin handles POST /api/admin/superadmins/{email}.
func (h *AdminHandler) GrantSuperadmin(w http.ResponseWriter, r *http.Request) {
	email := emailFromPath(r.URL.Path, "/api/admin/superadmins/")
	if email == "" {
		http.Error(w, "email path segment required", http.StatusBadRequest)
		return
	}
	caller := auth.UserEmailFromContext(r.Context())
	if err := h.db.Queries.GrantSuperadmin(r.Context(), sqlc.GrantSuperadminParams{
		Lower:     email,
		GrantedBy: caller,
	}); err != nil {
		slog.Error("GrantSuperadmin failed", "email", email, "error", err)
		http.Error(w, "grant failed", http.StatusInternalServerError)
		return
	}
	slog.Info("Granted superadmin", "email", email, "by", caller)
	w.WriteHeader(http.StatusNoContent)
}

// RevokeSuperadmin handles DELETE /api/admin/superadmins/{email}.
func (h *AdminHandler) RevokeSuperadmin(w http.ResponseWriter, r *http.Request) {
	email := emailFromPath(r.URL.Path, "/api/admin/superadmins/")
	if email == "" {
		http.Error(w, "email path segment required", http.StatusBadRequest)
		return
	}
	if err := h.db.Queries.RevokeSuperadmin(r.Context(), email); err != nil {
		slog.Error("RevokeSuperadmin failed", "email", email, "error", err)
		http.Error(w, "revoke failed", http.StatusInternalServerError)
		return
	}
	caller := auth.UserEmailFromContext(r.Context())
	slog.Info("Revoked superadmin", "email", email, "by", caller)
	w.WriteHeader(http.StatusNoContent)
}

// ListAllDocuments handles GET /api/admin/documents — returns every
// document in the DB regardless of created_by, **metadata only**. No PDF
// content, no presigned URLs. Gated by RequireSuperadmin.
func (h *AdminHandler) ListAllDocuments(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Pool().Query(r.Context(),
		"SELECT id, name, status, created_by, created_at FROM documents ORDER BY created_at DESC LIMIT 200")
	if err != nil {
		slog.Error("admin ListAllDocuments query failed", "error", err)
		http.Error(w, "query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	type docJSON struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Status    string `json:"status"`
		CreatedBy string `json:"createdBy"`
		CreatedAt string `json:"createdAt"`
	}
	out := make([]docJSON, 0, 32)
	for rows.Next() {
		var d docJSON
		var createdAt time.Time
		var status sqlc.DocumentStatus
		if err := rows.Scan(&d.ID, &d.Name, &status, &d.CreatedBy, &createdAt); err != nil {
			slog.Error("admin scan failed", "error", err)
			continue
		}
		d.Status = string(status)
		d.CreatedAt = createdAt.Format(time.RFC3339)
		out = append(out, d)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"documents": out})
}

// emailFromPath extracts the trailing `{email}` segment from a path like
// `/api/admin/superadmins/foo@bar.com`. Returns "" if the path doesn't
// match the given prefix or the segment is empty or nested.
func emailFromPath(path, prefix string) string {
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	rest := strings.TrimPrefix(path, prefix)
	if rest == "" || strings.Contains(rest, "/") {
		return ""
	}
	return strings.ToLower(rest)
}
