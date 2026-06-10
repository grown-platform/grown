// Package directory exposes a per-org user search used by member pickers
// (e.g. Chat's new-conversation dialog). Results always include grown's known
// users; when a Zitadel service token is configured it ALSO live-searches the
// Zitadel directory (the full org roster, including people who have not signed
// into grown yet) and lazily provisions a grown user row for each match so the
// returned ids are usable everywhere grown stores member ids.
package directory

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/users"
)

// Member is a directory entry returned to the frontend.
type Member struct {
	ID    string `json:"id"` // grown user id (usable as a member id)
	Name  string `json:"name"`
	Email string `json:"email"`
}

// Handler implements GET /api/v1/directory?q=<query>.
type Handler struct {
	users        *users.Repository
	issuer       string // OIDC issuer to stamp on lazily-provisioned users
	zitadelURL   string // Zitadel API base (empty disables live search)
	zitadelToken string // service-account PAT (empty disables live search)
	client       *http.Client
}

// NewHandler constructs the directory handler. zitadelURL/zitadelToken may be
// empty, in which case only grown's known users are searched.
func NewHandler(usersRepo *users.Repository, issuer, zitadelURL, zitadelToken string) *Handler {
	return &Handler{
		users:        usersRepo,
		issuer:       issuer,
		zitadelURL:   strings.TrimRight(zitadelURL, "/"),
		zitadelToken: zitadelToken,
		client:       &http.Client{Timeout: 10 * time.Second},
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := auth.UserFromContext(r.Context()); !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	org, ok := auth.OrgFromContext(r.Context())
	if !ok {
		http.Error(w, "no org context", http.StatusInternalServerError)
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))

	seen := map[string]bool{}
	out := []Member{}

	// Always include grown's known users (works without a Zitadel token).
	if known, err := h.users.SearchByOrg(r.Context(), org.ID, q, 50); err == nil {
		for _, u := range known {
			if seen[u.ID] {
				continue
			}
			seen[u.ID] = true
			out = append(out, Member{ID: u.ID, Name: displayName(u.DisplayName, u.Email), Email: u.Email})
		}
	}

	// Enrich with the live Zitadel directory when configured (best-effort: any
	// error just leaves the grown-known results in place).
	if h.zitadelURL != "" && h.zitadelToken != "" {
		h.appendZitadel(r.Context(), org.ID, q, seen, &out)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"members": out})
}

func displayName(name, email string) string {
	if strings.TrimSpace(name) != "" {
		return name
	}
	return email
}

// appendZitadel searches the Zitadel User API v2 and lazily upserts each match
// into grown.users so the returned id is a grown user id.
func (h *Handler) appendZitadel(ctx context.Context, orgID, q string, seen map[string]bool, out *[]Member) {
	body := map[string]any{"query": map[string]any{"limit": 50}}
	if q != "" {
		body["queries"] = []any{map[string]any{"orQuery": map[string]any{"queries": []any{
			map[string]any{"displayNameQuery": map[string]any{"displayName": q, "method": "TEXT_QUERY_METHOD_CONTAINS_IGNORE_CASE"}},
			map[string]any{"emailQuery": map[string]any{"emailAddress": q, "method": "TEXT_QUERY_METHOD_CONTAINS_IGNORE_CASE"}},
		}}}}
	}
	buf, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.zitadelURL+"/v2/users", bytes.NewReader(buf))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+h.zitadelToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return
	}

	var parsed struct {
		Result []struct {
			UserID string `json:"userId"`
			Human  struct {
				Profile struct {
					GivenName   string `json:"givenName"`
					FamilyName  string `json:"familyName"`
					DisplayName string `json:"displayName"`
				} `json:"profile"`
				Email struct {
					Email string `json:"email"`
				} `json:"email"`
			} `json:"human"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return
	}

	for _, z := range parsed.Result {
		if z.UserID == "" {
			continue
		}
		name := strings.TrimSpace(z.Human.Profile.DisplayName)
		if name == "" {
			name = strings.TrimSpace(z.Human.Profile.GivenName + " " + z.Human.Profile.FamilyName)
		}
		email := z.Human.Email.Email
		// SECURITY: only surface a Zitadel match if they ALREADY have a grown
		// row in THIS org. GetByOIDC is org-scoped, so users from other orgs (or
		// never-provisioned tenant users) are never leaked into the picker. We do
		// NOT upsert here — provisioning strangers into the caller's org on a
		// directory search was the cross-org leak.
		u, err := h.users.GetByOIDC(ctx, orgID, h.issuer, z.UserID)
		if err != nil {
			continue
		}
		if seen[u.ID] {
			continue
		}
		seen[u.ID] = true
		*out = append(*out, Member{ID: u.ID, Name: displayName(name, email), Email: email})
	}
}
