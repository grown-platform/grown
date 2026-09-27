package server

// Sheets analysis endpoints: precedents/dependents tracing and goal seek.
// Both read a workbook (the stored one, or the editor's live copy posted in
// the body) and never write it.

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/sheets"
)

// sheetsActionID returns the sheet id from /api/v1/sheets/d/{id}/{action}.
func sheetsActionID(path, action string) (string, bool) {
	const prefix = "/api/v1/sheets/d/"
	suffix := "/" + action
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// readableSheet loads a sheet the caller may open (org member or grantee).
func readableSheet(r *http.Request, id string, repo *sheets.Repository, grants *sharing.Repository) (sheets.Sheet, int) {
	ctx := r.Context()
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return sheets.Sheet{}, http.StatusUnauthorized
	}
	if org, ok := auth.OrgFromContext(ctx); ok {
		if s, err := repo.Get(ctx, org.ID, id); err == nil {
			return s, 0
		}
	}
	if grants != nil {
		if _, ok, err := grants.RoleFor(ctx, u.ID, sharing.TypeSheetsSheet, id); err == nil && ok {
			if s, derr := repo.GetByID(ctx, id); derr == nil {
				return s, 0
			}
		}
	}
	return sheets.Sheet{}, http.StatusNotFound
}

func readBody(w http.ResponseWriter, r *http.Request, into interface{}) bool {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxRecalcBody+1))
	if err != nil || len(body) > maxRecalcBody {
		http.Error(w, "request too large", http.StatusRequestEntityTooLarge)
		return false
	}
	if err := json.Unmarshal(body, into); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// serveSheetsDeps traces a cell's precedents and dependents.
//
//	GET  /api/v1/sheets/d/{id}/deps?cell=B2[&sheet=<id|name>][&levels=N][&precedents=N][&dependents=N]
//	POST /api/v1/sheets/d/{id}/deps  {"data","cell","sheet","precedents","dependents"}
//	→ 200 {"cell","formula","precedents":[{level,from,to,external}],"dependents":[…]}
//
// GET reads the stored workbook; POST traces the posted (live) one.
func serveSheetsDeps(w http.ResponseWriter, r *http.Request, id string, repo *sheets.Repository, grants *sharing.Repository) {
	s, status := readableSheet(r, id, repo, grants)
	if status != 0 {
		http.Error(w, http.StatusText(status), status)
		return
	}
	var req struct {
		Data       string `json:"data"`
		Cell       string `json:"cell"`
		Sheet      string `json:"sheet"`
		Precedents int    `json:"precedents"`
		Dependents int    `json:"dependents"`
	}
	switch r.Method {
	case http.MethodGet:
		q := r.URL.Query()
		req.Data, req.Cell, req.Sheet = s.Data, q.Get("cell"), q.Get("sheet")
		levels, _ := strconv.Atoi(q.Get("levels"))
		req.Precedents, req.Dependents = levels, levels
		if n, err := strconv.Atoi(q.Get("precedents")); err == nil {
			req.Precedents = n
		}
		if n, err := strconv.Atoi(q.Get("dependents")); err == nil {
			req.Dependents = n
		}
	case http.MethodPost:
		if !readBody(w, r, &req) {
			return
		}
		if req.Data == "" {
			req.Data = s.Data
		}
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if req.Cell == "" {
		http.Error(w, "cell is required", http.StatusBadRequest)
		return
	}
	res, err := sheets.TraceDeps(req.Data, req.Sheet, req.Cell, req.Precedents, req.Dependents)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, res)
}

// serveSheetsGoalSeek runs Data ▸ What-if analysis ▸ Goal seek.
//
//	POST /api/v1/sheets/d/{id}/goalseek
//	  {"data"?, "sheet"?, "formulaCell", "target", "changingCell", "maxIterations"?, "maxChange"?}
//	→ 200 {"found","value","result","iterations","sheetId","changingCell","formulaCell"}
//
// Without "data" the stored workbook is used. Nothing is saved: the editor
// writes the found value into the changing cell when the user accepts it.
func serveSheetsGoalSeek(w http.ResponseWriter, r *http.Request, id string, repo *sheets.Repository, grants *sharing.Repository) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s, status := readableSheet(r, id, repo, grants)
	if status != 0 {
		http.Error(w, http.StatusText(status), status)
		return
	}
	var req sheets.GoalSeekRequest
	if !readBody(w, r, &req) {
		return
	}
	if req.Data == "" {
		req.Data = s.Data
	}
	res, err := sheets.GoalSeek(req)
	if err != nil {
		code := http.StatusBadRequest
		if !errors.Is(err, sheets.ErrNotWorkbook) && !errors.Is(err, sheets.ErrGoalSeekCell) &&
			!errors.Is(err, sheets.ErrGoalSeekFormula) && !errors.Is(err, sheets.ErrGoalSeekChanging) {
			code = http.StatusInternalServerError
		}
		http.Error(w, err.Error(), code)
		return
	}
	writeJSON(w, res)
}
