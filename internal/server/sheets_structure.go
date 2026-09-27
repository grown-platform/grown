package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/sheets"
)

// maxStructureBody bounds the op a client may post (the workbook is loaded
// from storage, not posted).
const maxStructureBody = 64 << 10

// sheetsStructureID returns the sheet id from /api/v1/sheets/d/{id}/structure.
func sheetsStructureID(path string) (string, bool) {
	const prefix = "/api/v1/sheets/d/"
	const suffix = "/structure"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// serveSheetsStructure applies a structure op (insert/delete/move rows or
// columns, insert/delete cells with shift) to the stored workbook, rewrites
// formula references, recomputes and saves it. The caller must be able to edit
// the sheet (org member, or a grantee whose role can write).
//
//	POST /api/v1/sheets/d/{id}/structure   {"op": StructureOp}
//	→ 200 {"data": "<workbook JSON>"}
func serveSheetsStructure(w http.ResponseWriter, r *http.Request, id string, repo *sheets.Repository, grants *sharing.Repository) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ctx := r.Context()
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var sh sheets.Sheet
	found, canWrite := false, false
	if org, ok := auth.OrgFromContext(ctx); ok {
		if s, err := repo.Get(ctx, org.ID, id); err == nil {
			sh, found, canWrite = s, true, true
		}
	}
	if !found && grants != nil {
		if role, ok, err := grants.RoleFor(ctx, u.ID, sharing.TypeSheetsSheet, id); err == nil && ok {
			if s, err := repo.GetByID(ctx, id); err == nil {
				sh, found, canWrite = s, true, sharing.CanWrite(role)
			}
		}
	}
	if !found {
		http.Error(w, "sheet not found", http.StatusNotFound)
		return
	}
	if !canWrite {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxStructureBody+1))
	if err != nil || len(body) > maxStructureBody {
		http.Error(w, "request too large", http.StatusRequestEntityTooLarge)
		return
	}
	var req struct {
		Op *sheets.StructureOp `json:"op"`
	}
	if err := json.Unmarshal(body, &req); err != nil || req.Op == nil {
		http.Error(w, "invalid JSON: expected {\"op\": {...}}", http.StatusBadRequest)
		return
	}
	data, err := sheets.ApplyStructureOpJSON(sh.Data, *req.Op)
	switch {
	case errors.Is(err, sheets.ErrNotWorkbook):
		http.Error(w, "stored sheet is not a workbook", http.StatusConflict)
		return
	case errors.Is(err, sheets.ErrSheetNotFound):
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	case err != nil:
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// Same persistence as SaveSheet: recompute formula values, then store.
	data = sheets.RecomputeWorkbook(data)
	if err := repo.Save(ctx, sh.OrgID, id, data); err != nil {
		if errors.Is(err, sheets.ErrNotFound) {
			http.Error(w, "sheet not found", http.StatusNotFound)
			return
		}
		http.Error(w, "save sheet failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"data": data})
}
