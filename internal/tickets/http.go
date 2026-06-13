package tickets

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// AuthFuncs supplies the caller's identity from the request context.
type AuthFuncs struct {
	UserID    func(r *http.Request) (string, bool)
	OrgID     func(r *http.Request) (string, bool)
	UserName  func(r *http.Request) string
	UserEmail func(r *http.Request) string
}

// HTTPHandler serves the authenticated ticketing surface, mounted inside grown's
// auth middleware:
//
//	GET    /api/v1/tickets/projects               list projects
//	POST   /api/v1/tickets/projects               create {key,name,description,intake_mode}
//	GET    /api/v1/tickets/projects/{id}          get project (incl. public link)
//	PATCH  /api/v1/tickets/projects/{id}          update {name,description,intake_mode}
//	GET    /api/v1/tickets/projects/{id}/tickets  list tickets (?status=)
//	POST   /api/v1/tickets/projects/{id}/tickets  create {title,body,priority}
//	GET    /api/v1/tickets/items/{id}             get ticket + comments
//	PATCH  /api/v1/tickets/items/{id}             update {status,priority,title,body,assignee_user_id}
//	POST   /api/v1/tickets/items/{id}/comments    add {body,is_internal}
type HTTPHandler struct {
	repo *Repository
	auth AuthFuncs
}

// NewHTTPHandler constructs the authenticated handler.
func NewHTTPHandler(repo *Repository, auth AuthFuncs) *HTTPHandler {
	return &HTTPHandler{repo: repo, auth: auth}
}

const mount = "/api/v1/tickets"

// Match reports whether path belongs to the ticketing surface.
func (h *HTTPHandler) Match(path string) bool {
	return path == mount || strings.HasPrefix(path, mount+"/")
}

func (h *HTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.Match(r.URL.Path) {
		http.NotFound(w, r)
		return
	}
	orgID, ok := h.auth.OrgID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID, _ := h.auth.UserID(r)

	// Path segments after the mount prefix.
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, mount), "/")
	seg := strings.Split(rest, "/")
	if len(seg) == 1 && seg[0] == "" {
		seg = nil
	}

	switch {
	// /projects ...
	case len(seg) >= 1 && seg[0] == "projects":
		h.handleProjects(w, r, orgID, userID, seg[1:])
	// /items ...
	case len(seg) >= 1 && seg[0] == "items":
		h.handleItems(w, r, orgID, userID, seg[1:])
	default:
		http.NotFound(w, r)
	}
}

func (h *HTTPHandler) handleProjects(w http.ResponseWriter, r *http.Request, orgID, userID string, seg []string) {
	switch {
	case len(seg) == 0 && r.Method == http.MethodGet:
		list, err := h.repo.ListProjects(r.Context(), orgID)
		if err != nil {
			httpErr(w, err)
			return
		}
		out := make([]map[string]any, 0, len(list))
		for _, p := range list {
			out = append(out, projectJSON(p, r))
		}
		writeJSON(w, http.StatusOK, map[string]any{"projects": out})

	case len(seg) == 0 && r.Method == http.MethodPost:
		var b struct{ Key, Name, Description, IntakeMode string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		p, err := h.repo.CreateProject(r.Context(), orgID, userID, b.Key, b.Name, b.Description, b.IntakeMode)
		if err != nil {
			httpErr(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"project": projectJSON(p, r)})

	case len(seg) == 1 && r.Method == http.MethodGet:
		p, err := h.repo.GetProject(r.Context(), orgID, seg[0])
		if err != nil {
			httpErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"project": projectJSON(p, r)})

	case len(seg) == 1 && r.Method == http.MethodPatch:
		var b struct{ Name, Description, IntakeMode string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		p, err := h.repo.UpdateProject(r.Context(), orgID, seg[0], b.Name, b.Description, b.IntakeMode)
		if err != nil {
			httpErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"project": projectJSON(p, r)})

	// /projects/{id}/tickets
	case len(seg) == 2 && seg[1] == "tickets" && r.Method == http.MethodGet:
		list, err := h.repo.ListTickets(r.Context(), orgID, seg[0], r.URL.Query().Get("status"))
		if err != nil {
			httpErr(w, err)
			return
		}
		out := make([]map[string]any, 0, len(list))
		for _, t := range list {
			out = append(out, ticketJSON(t))
		}
		writeJSON(w, http.StatusOK, map[string]any{"tickets": out})

	case len(seg) == 2 && seg[1] == "tickets" && r.Method == http.MethodPost:
		var b struct{ Title, Body, Priority string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		var uid *string
		if userID != "" {
			uid = &userID
		}
		t, err := h.repo.CreateTicket(r.Context(), orgID, seg[0], b.Title, b.Body, b.Priority, uid, h.auth.UserName(r), h.auth.UserEmail(r), "web")
		if err != nil {
			httpErr(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"ticket": ticketJSON(t)})

	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func (h *HTTPHandler) handleItems(w http.ResponseWriter, r *http.Request, orgID, userID string, seg []string) {
	if len(seg) == 0 {
		http.NotFound(w, r)
		return
	}
	id := seg[0]
	switch {
	case len(seg) == 1 && r.Method == http.MethodGet:
		t, comments, err := h.repo.GetTicket(r.Context(), orgID, id)
		if err != nil {
			httpErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ticket": ticketJSON(t), "comments": commentsJSON(comments)})

	case len(seg) == 1 && r.Method == http.MethodPatch:
		var b struct {
			Status         *string `json:"status"`
			Priority       *string `json:"priority"`
			Title          *string `json:"title"`
			Body           *string `json:"body"`
			AssigneeUserID *string `json:"assignee_user_id"`
			ClearAssignee  bool    `json:"clear_assignee"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		t, err := h.repo.UpdateTicket(r.Context(), orgID, id, b.Status, b.Priority, b.Title, b.Body, b.AssigneeUserID, b.ClearAssignee)
		if err != nil {
			httpErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ticket": ticketJSON(t)})

	case len(seg) == 2 && seg[1] == "comments" && r.Method == http.MethodPost:
		var b struct {
			Body       string `json:"body"`
			IsInternal bool   `json:"is_internal"`
		}
		_ = json.NewDecoder(r.Body).Decode(&b)
		var uid *string
		if userID != "" {
			uid = &userID
		}
		c, err := h.repo.AddComment(r.Context(), orgID, id, uid, h.auth.UserName(r), b.Body, b.IsInternal)
		if err != nil {
			httpErr(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"comment": commentJSON(c)})

	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

// PublicHandler serves the unauthenticated intake surface, mounted BEFORE the
// auth wall (like the game-room relay):
//
//	GET   /api/v1/public/tickets/{token}   project info for the intake form
//	POST  /api/v1/public/tickets/{token}   submit {title,body,name,email} → {ref}
type PublicHandler struct {
	repo *Repository
}

// NewPublicHandler constructs the public intake handler.
func NewPublicHandler(repo *Repository) *PublicHandler {
	return &PublicHandler{repo: repo}
}

const publicMount = "/api/v1/public/tickets"

// Match reports whether path is a public intake request.
func (p *PublicHandler) Match(path string) bool {
	return strings.HasPrefix(path, publicMount+"/")
}

func (p *PublicHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token := strings.Trim(strings.TrimPrefix(r.URL.Path, publicMount+"/"), "/")
	if token == "" || strings.Contains(token, "/") {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		proj, err := p.repo.PublicProject(r.Context(), token)
		if err != nil {
			httpErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"name":        proj.Name,
			"description": proj.Description,
			"key":         proj.Key,
		})
	case http.MethodPost:
		var b struct{ Title, Body, Name, Email string }
		_ = json.NewDecoder(r.Body).Decode(&b)
		if strings.TrimSpace(b.Title) == "" {
			http.Error(w, "title required", http.StatusBadRequest)
			return
		}
		_, ref, err := p.repo.CreatePublicTicket(r.Context(), token, b.Title, b.Body, b.Name, b.Email)
		if err != nil {
			httpErr(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"ref": ref, "message": "Request submitted. Reference: " + ref})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// ---- JSON shaping ----------------------------------------------------------

func projectJSON(p Project, r *http.Request) map[string]any {
	m := map[string]any{
		"id":          p.ID,
		"key":         p.Key,
		"name":        p.Name,
		"description": p.Description,
		"intake_mode": p.IntakeMode,
		"statuses":    p.Statuses,
		"open_count":  p.OpenCount,
		"created_at":  p.CreatedAt.Unix(),
	}
	if p.PublicToken != "" {
		m["public_token"] = p.PublicToken
		// A convenient absolute submit URL for sharing.
		if r != nil {
			scheme := "https"
			if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") == "" {
				scheme = "http"
			}
			m["public_url"] = scheme + "://" + r.Host + "/tickets/submit/" + p.PublicToken
		}
	}
	return m
}

func ticketJSON(t Ticket) map[string]any {
	m := map[string]any{
		"id":              t.ID,
		"project_id":      t.ProjectID,
		"ref":             t.ProjectKey + "-" + itoa(t.Number),
		"number":          t.Number,
		"title":           t.Title,
		"body":            t.Body,
		"status":          t.Status,
		"priority":        t.Priority,
		"requester_name":  t.RequesterName,
		"requester_email": t.RequesterEmail,
		"source":          t.Source,
		"created_at":      t.CreatedAt.Unix(),
		"updated_at":      t.UpdatedAt.Unix(),
	}
	if t.RequesterUserID != nil {
		m["requester_user_id"] = *t.RequesterUserID
	}
	if t.AssigneeUserID != nil {
		m["assignee_user_id"] = *t.AssigneeUserID
	}
	return m
}

func commentsJSON(cs []Comment) []map[string]any {
	out := make([]map[string]any, 0, len(cs))
	for _, c := range cs {
		out = append(out, commentJSON(c))
	}
	return out
}

func commentJSON(c Comment) map[string]any {
	m := map[string]any{
		"id":          c.ID,
		"author_name": c.AuthorName,
		"body":        c.Body,
		"is_internal": c.IsInternal,
		"created_at":  c.CreatedAt.Unix(),
	}
	if c.AuthorUserID != nil {
		m["author_user_id"] = *c.AuthorUserID
	}
	return m
}

func httpErr(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	http.Error(w, err.Error(), http.StatusInternalServerError)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
