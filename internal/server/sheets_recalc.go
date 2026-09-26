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

// maxRecalcBody bounds the workbook a client may post for recalculation.
const maxRecalcBody = 32 << 20

// sheetsRecalcID returns the sheet id from /api/v1/sheets/d/{id}/recalc.
func sheetsRecalcID(path string) (string, bool) {
	const prefix = "/api/v1/sheets/d/"
	const suffix = "/recalc"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// serveSheetsRecalc evaluates a posted workbook with the server formula
// engine and returns the computed formula/spill cells; nothing is stored.
// The caller must be able to open the sheet (org member or any grantee).
//
//	POST /api/v1/sheets/d/{id}/recalc   {"data": "<workbook JSON>"}
//	→ 200 {"cells": [{"sheetId","sheetIndex","r","c","v","m","spill"}]}
func serveSheetsRecalc(w http.ResponseWriter, r *http.Request, id string, repo *sheets.Repository, grants *sharing.Repository) {
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
	authorized := false
	if org, ok := auth.OrgFromContext(ctx); ok {
		if _, err := repo.Get(ctx, org.ID, id); err == nil {
			authorized = true
		}
	}
	if !authorized && grants != nil {
		if _, ok, err := grants.RoleFor(ctx, u.ID, sharing.TypeSheetsSheet, id); err == nil && ok {
			if _, derr := repo.GetByID(ctx, id); derr == nil {
				authorized = true
			}
		}
	}
	if !authorized {
		http.Error(w, "sheet not found", http.StatusNotFound)
		return
	}
	var req struct {
		Data string `json:"data"`
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxRecalcBody+1))
	if err != nil || len(body) > maxRecalcBody {
		http.Error(w, "request too large", http.StatusRequestEntityTooLarge)
		return
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	cells, err := sheets.RecalcWorkbook(req.Data)
	if errors.Is(err, sheets.ErrNotWorkbook) {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if cells == nil {
		cells = []sheets.RecalcCell{}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"cells": cells})
}
