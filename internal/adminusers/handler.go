// Package adminusers exposes an admin-gated HTTP surface for managing the org's
// users in Zitadel. It proxies a narrow slice of the Zitadel User API v2 using a
// service-account PAT (GROWN_ZITADEL_SERVICE_TOKEN), so org admins can create,
// edit, (de)activate, reset-password, and delete users without leaving grown.
//
// Trust model (mirrors internal/directory and internal/zitadelproxy): the
// handler is mounted INSIDE grown's auth middleware, so the caller's grown user
// — including its email — is already resolved on the request context. The
// caller's email is read via an injected EmailResolver closure (so this package
// avoids importing internal/auth, exactly like zitadelproxy's SubjectResolver).
// On top of that authentication, every route is gated on ADMIN privileges (see
// docs/rbac-design.md): the caller is an admin iff their email appears in
// GROWN_ADMIN_EMAILS (bootstrap super-admins) OR they hold a per-org admin role
// (an org_admins row), surfaced here via an injected AdminChecker so this package
// stays decoupled from gen/. There is NO open fallback — an empty allowlist no
// longer grants every member admin.
//
// All upstream calls are hand-rolled net/http + encoding/json — no Zitadel SDK,
// and crucially NO dependency on the generated protos (gen/), so this package
// builds standalone.
//
// Routes (mounted under /api/v1/admin/users):
//
//	GET    /api/v1/admin/users?q=         → search users   (POST {api}/v2/users)
//	POST   /api/v1/admin/users            → create human    (POST {api}/v2/users/human)
//	PATCH  /api/v1/admin/users/{id}       → update profile  (PUT  {api}/v2/users/human/{id})
//	POST   /api/v1/admin/users/{id}/deactivate  (POST {api}/v2/users/{id}/deactivate)
//	POST   /api/v1/admin/users/{id}/reactivate  (POST {api}/v2/users/{id}/reactivate)
//	POST   /api/v1/admin/users/{id}/password    (POST {api}/v2/users/{id}/password)
//	DELETE /api/v1/admin/users/{id}        → REMOVE from org  (grown DB only; no Zitadel)
//	DELETE /api/v1/admin/users/{id}/zitadel → hard-delete from Zitadel (super-admin only)
//	POST   /api/v1/admin/users/{id}/admin → grant org-admin role  (grown DB only)
//	DELETE /api/v1/admin/users/{id}/admin → revoke org-admin role (grown DB only)
//
// The user LIST is scoped to the caller's org: it returns only the grown users
// who are members of the caller's org (via an injected OrgMemberResolver),
// enriched from Zitadel — NOT a global Zitadel search.
package adminusers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// mountPrefix is the public path under which this handler is mounted.
const mountPrefix = "/api/v1/admin/users"

// requestTimeout bounds each upstream Zitadel call.
const requestTimeout = 15 * time.Second

// EmailResolver returns the caller's grown email from the request context, and
// whether a caller is present. The wiring in server.go supplies a closure backed
// by auth.UserFromContext, keeping this package decoupled from the auth package
// (and its generated-proto dependency) so it builds and tests standalone — the
// same pattern internal/zitadelproxy uses with SubjectResolver.
type EmailResolver func(ctx context.Context) (email string, ok bool)

// AdminChecker reports whether the caller (resolved from the request context) is
// an admin of their org. server.go supplies a closure backed by the org_admins
// repository + the GROWN_ADMIN_EMAILS allowlist, so this package stays decoupled
// from gen/ exactly like EmailResolver. When no AdminChecker is injected the
// handler relies on the allowlist alone (and an empty allowlist denies all — the
// open "any member" fallback is gone).
type AdminChecker func(ctx context.Context) bool

// OrgMemberResolver scopes the user list to the caller's org. server.go injects
// a closure backed by the users repository: given the caller's request context,
// it returns the Zitadel user ids (oidc_subject values) of the grown users who
// are members of the caller's org (org_id = caller org, oidc_issuer = the
// configured issuer). The q hint lets the closure pre-filter on grown's own
// display_name/email; the handler still filters the Zitadel-enriched rows to
// this set. Keeping this a closure keeps adminusers free of gen/ and the repo.
type OrgMemberResolver func(ctx context.Context, q string) (zitadelIDs []string, ok bool)

// OrgMembershipStore is the small DB surface the remove-from-org delete needs:
// drop the caller-org's grown.users row (and any org_admins grant) for a given
// Zitadel user id. It NEVER touches Zitadel. server.go supplies an adapter over
// the users + org_admins repositories so adminusers stays gen-free.
type OrgMembershipStore interface {
	// RemoveFromOrg deletes the grown.users row for zitadelID in orgID (and any
	// org_admins grant for that user). Removing a non-member is a harmless no-op
	// (removed=false, err=nil).
	RemoveFromOrg(ctx context.Context, orgID, zitadelID string) (removed bool, err error)
}

// AdminRoster is the org-admin management surface server.go injects so the
// grant/revoke routes (and the isAdmin enrichment of the user list) can reach
// org_admins without this package importing gen/. All ids are GROWN user ids
// except AdminZitadelIDs, which maps the Zitadel user ids returned by the list
// route to a bool for users who are admins.
type AdminRoster interface {
	// CallerUserID returns the caller's grown user id from the request context.
	CallerUserID(ctx context.Context) (string, bool)
	// CallerOrgID returns the caller's org id from the request context.
	CallerOrgID(ctx context.Context) (string, bool)
	// GrownUserIDForZitadel maps a Zitadel user id (oidc_subject) to the grown
	// user id within the caller's org, lazily provisioning a row if needed.
	GrownUserIDForZitadel(ctx context.Context, orgID, zitadelID string) (string, error)
	// AdminZitadelIDs returns, for the given Zitadel user ids, the subset that
	// map to grown users who are admins of orgID (keyed by Zitadel user id).
	AdminZitadelIDs(ctx context.Context, orgID string, zitadelIDs []string) (map[string]bool, error)
	// Grant grants targetUserID admin of orgID, recorded as granted by byUserID.
	Grant(ctx context.Context, orgID, targetUserID, byUserID string) error
	// Revoke removes targetUserID's admin role for orgID.
	Revoke(ctx context.Context, orgID, targetUserID string) error
	// CountAdmins returns how many admins orgID currently has.
	CountAdmins(ctx context.Context, orgID string) (int, error)
}

// InviteSender delivers transactional invite emails to newly-created users.
// server.go injects a closure backed by internal/email.Sender so this package
// stays free of that import (and the net/http dependency it brings is already
// present here). When nil the invite step is silently skipped.
//
// Parameters mirror email.Sender.SendInvite:
//   - ctx      — request context
//   - to       — destination address (recovery email preferred, else primary)
//   - name     — recipient display name
//   - inviteURL — Zitadel-generated invite/verification URL
//   - orgName  — human-readable org name for the email body
type InviteSender func(ctx context.Context, to, name, inviteURL, orgName string) error

// Handler implements the admin user-management routes. It is dependency-light by
// design: net/http + encoding/json only, with the caller's identity supplied via
// an injected EmailResolver (no import of internal/auth, hence no gen/ dep).
type Handler struct {
	// adminEmails is the lower-cased allowlist of bootstrap super-admins. A
	// caller is an admin iff their email is here OR isOrgAdmin reports true for
	// their org. There is NO open fallback when the allowlist is empty.
	adminEmails  map[string]struct{}
	zitadelURL   string // Zitadel API base (no trailing slash)
	zitadelToken string // service-account PAT (empty ⇒ 503)
	emailOf      EmailResolver
	isOrgAdmin   AdminChecker
	roster       AdminRoster
	orgMembers   OrgMemberResolver
	membership   OrgMembershipStore
	isPersonal   PersonalOrgChecker
	// sendInvite is the optional transactional email sender for invites.
	// nil = skip email (dev mode or no RESEND_API_KEY).
	sendInvite InviteSender
	client     *http.Client
}

// PersonalOrgChecker reports whether the caller's org is a single-user
// (personal) org. server.go injects a closure backed by the auth context's org.
// Surfaced on WhoAmI so the SPA hides the Admin app in personal orgs.
type PersonalOrgChecker func(ctx context.Context) bool

// NewHandler constructs the admin-users handler.
//
//   - adminEmails is the raw GROWN_ADMIN_EMAILS value (comma-separated); pass ""
//     to leave the allowlist empty (any member allowed, with a TODO).
//   - zitadelURL is the Zitadel API base; the caller resolves the fallback to the
//     OIDC issuer, matching directory.NewHandler / the zitadel proxy wiring.
//   - zitadelToken is the service-account PAT. When empty every mutating/reading
//     route returns 503 ("user management requires GROWN_ZITADEL_SERVICE_TOKEN").
func NewHandler(adminEmails, zitadelURL, zitadelToken string) *Handler {
	allow := make(map[string]struct{})
	for _, e := range strings.Split(adminEmails, ",") {
		e = strings.ToLower(strings.TrimSpace(e))
		if e != "" {
			allow[e] = struct{}{}
		}
	}
	return &Handler{
		adminEmails:  allow,
		zitadelURL:   strings.TrimRight(zitadelURL, "/"),
		zitadelToken: zitadelToken,
		client:       &http.Client{Timeout: requestTimeout},
	}
}

// WithResolver injects the caller-email resolver and returns the handler for
// chaining. server.go calls this with a closure backed by auth.UserFromContext.
// When no resolver is set, every request is treated as unauthenticated (401),
// failing closed.
func (h *Handler) WithResolver(r EmailResolver) *Handler {
	h.emailOf = r
	return h
}

// WithAdminChecker injects the org-admin predicate (allowlist OR org_admins row,
// resolved in server.go). Returns the handler for chaining.
func (h *Handler) WithAdminChecker(c AdminChecker) *Handler {
	h.isOrgAdmin = c
	return h
}

// WithRoster injects the org-admin management surface backing the grant/revoke
// routes and the isAdmin enrichment of the user list. Returns the handler.
func (h *Handler) WithRoster(r AdminRoster) *Handler {
	h.roster = r
	return h
}

// WithOrgMembers injects the resolver that scopes the user list to the caller's
// org. Without it, the list falls back to a global Zitadel search (the legacy
// behavior); with it, only the caller-org's members are returned.
func (h *Handler) WithOrgMembers(r OrgMemberResolver) *Handler {
	h.orgMembers = r
	return h
}

// WithMembershipStore injects the DB surface backing the remove-from-org delete.
// Without it, DELETE /{id} returns 503 (it must NOT fall back to a Zitadel
// delete).
func (h *Handler) WithMembershipStore(s OrgMembershipStore) *Handler {
	h.membership = s
	return h
}

// WithPersonalOrgChecker injects the predicate reporting whether the caller's
// org is personal (surfaced on WhoAmI). Returns the handler for chaining.
func (h *Handler) WithPersonalOrgChecker(c PersonalOrgChecker) *Handler {
	h.isPersonal = c
	return h
}

// WithInviteSender injects the transactional email function used to deliver
// invite emails after a user is created with SendInvite=true. When s is nil
// (or this method is never called) the email step is skipped silently so the
// handler works without RESEND_API_KEY in development.
func (h *Handler) WithInviteSender(s InviteSender) *Handler {
	h.sendInvite = s
	return h
}

// ServeHTTP routes on method + path. Authorization (auth + admin allowlist) and
// the service-token check run first for every route.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.authorize(w, r) {
		return
	}

	// Sub-path after the mount prefix: "" for the collection, "/{id}" for a
	// single user, "/{id}/{action}" for state changes.
	rest := strings.TrimPrefix(r.URL.Path, mountPrefix)
	rest = strings.Trim(rest, "/")

	// The /{id}/admin grant/revoke routes touch only grown's org_admins table —
	// no Zitadel — so they're served BEFORE the service-token gate below.
	if adminParts := strings.Split(rest, "/"); len(adminParts) == 2 && adminParts[1] == "admin" && adminParts[0] != "" {
		switch r.Method {
		case http.MethodPost:
			h.grantAdmin(w, r, adminParts[0])
		case http.MethodDelete:
			h.revokeAdmin(w, r, adminParts[0])
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}

	// DELETE /{id} is REMOVE-FROM-ORG: it only deletes the caller-org's grown
	// rows (users + org_admins) and MUST NOT touch Zitadel. So it is served
	// BEFORE the service-token gate, exactly like the grant/revoke routes.
	if dp := strings.Split(rest, "/"); len(dp) == 1 && dp[0] != "" && r.Method == http.MethodDelete {
		h.removeFromOrg(w, r, dp[0])
		return
	}

	if h.zitadelToken == "" {
		writeError(w, http.StatusServiceUnavailable,
			"user management requires GROWN_ZITADEL_SERVICE_TOKEN")
		return
	}

	switch {
	case rest == "":
		switch r.Method {
		case http.MethodGet:
			h.list(w, r)
		case http.MethodPost:
			h.create(w, r)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}

	parts := strings.Split(rest, "/")
	id := parts[0]
	if id == "" {
		writeError(w, http.StatusNotFound, "user id required")
		return
	}

	// /{id} — DELETE is handled before the token gate above (remove-from-org).
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodPatch:
			h.update(w, r, id)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}

	// /{id}/{action}
	if len(parts) == 2 {
		// DELETE /{id}/zitadel is the destructive whole-IdP hard delete. It is
		// super-admin-only (a distinct, stronger guard than the org-admin gate).
		if parts[1] == "zitadel" && r.Method == http.MethodDelete {
			h.hardDelete(w, r, id)
			return
		}
		if r.Method == http.MethodPost {
			switch parts[1] {
			case "deactivate":
				h.setState(w, r, id, "deactivate")
			case "reactivate":
				h.setState(w, r, id, "reactivate")
			case "password":
				h.password(w, r, id)
			default:
				writeError(w, http.StatusNotFound, "unknown action")
			}
			return
		}
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	writeError(w, http.StatusNotFound, "not found")
}

// authorize enforces an authenticated session AND admin privileges. It writes
// the error response and returns false on denial. Authorization rule (see
// docs/rbac-design.md): admin iff the caller's email is in GROWN_ADMIN_EMAILS OR
// they hold an org_admins row (via the injected AdminChecker). NO open fallback.
func (h *Handler) authorize(w http.ResponseWriter, r *http.Request) bool {
	if h.emailOf == nil {
		writeError(w, http.StatusUnauthorized, "no session")
		return false
	}
	_, ok := h.emailOf(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return false
	}
	if !h.IsAdmin(r.Context()) {
		writeError(w, http.StatusForbidden, "admin privileges required")
		return false
	}
	return true
}

// IsAdmin reports whether the caller may manage users. The caller is an admin
// iff their email is in the GROWN_ADMIN_EMAILS allowlist (bootstrap super-admins)
// OR the injected AdminChecker reports an org_admins grant. There is no open
// fallback: with no allowlist entry and no grant, the caller is NOT an admin.
func (h *Handler) IsAdmin(ctx context.Context) bool {
	if h.emailOf == nil {
		return false
	}
	email, ok := h.emailOf(ctx)
	if !ok {
		return false
	}
	if _, ok := h.adminEmails[strings.ToLower(strings.TrimSpace(email))]; ok {
		return true
	}
	if h.isOrgAdmin != nil && h.isOrgAdmin(ctx) {
		return true
	}
	return false
}

// IsSuperAdmin reports whether the caller is a BOOTSTRAP super-admin — i.e. their
// email is in the GROWN_ADMIN_EMAILS allowlist. This is strictly stronger than
// IsAdmin (which also accepts a per-org org_admins grant): an org-admin is NOT a
// super-admin. It gates the destructive whole-IdP Zitadel hard-delete.
func (h *Handler) IsSuperAdmin(ctx context.Context) bool {
	if h.emailOf == nil {
		return false
	}
	email, ok := h.emailOf(ctx)
	if !ok {
		return false
	}
	_, ok = h.adminEmails[strings.ToLower(strings.TrimSpace(email))]
	return ok
}

// WhoAmI is a lightweight, NON-gated endpoint (mounted at /api/v1/admin/whoami)
// the SPA polls to decide whether to surface admin-only affordances (e.g. the
// dashboard "Add user" button). Returns {isAdmin} for any authenticated caller;
// also reports whether user-management is actually wired (service token present).
func (h *Handler) WhoAmI(w http.ResponseWriter, r *http.Request) {
	isPersonal := false
	if h.isPersonal != nil {
		isPersonal = h.isPersonal(r.Context())
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"isAdmin":         h.IsAdmin(r.Context()),
		"isSuperAdmin":    h.IsSuperAdmin(r.Context()),
		"isPersonal":      isPersonal,
		"userMgmtEnabled": h.zitadelToken != "",
	})
}

// ---- Route handlers ---------------------------------------------------------

// userOut is the flattened user shape returned to the frontend.
type userOut struct {
	ID            string `json:"id"`
	Username      string `json:"username"`
	GivenName     string `json:"givenName"`
	FamilyName    string `json:"familyName"`
	DisplayName   string `json:"displayName"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"emailVerified"`
	State         string `json:"state"`
	// IsAdmin is true when this Zitadel user maps to a grown user holding an
	// org_admins grant in the caller's org. Computed via the injected roster by
	// joining Zitadel ids (oidc_subject) to grown users. Users who have never
	// signed into grown have no grown row yet, so they report false until they do.
	IsAdmin bool `json:"isAdmin"`
}

// list returns the caller-org's members, enriched from Zitadel. The set of users
// is scoped to the caller's org via the injected OrgMemberResolver: only Zitadel
// users whose oidc_subject maps to a grown.users row in the caller's org appear —
// NOT a global Zitadel search. ?q= filters by display name / email / username
// (contains, case-insensitive) WITHIN that member set. When no resolver is
// injected the list returns empty (fail-closed) rather than leaking the whole IdP.
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))

	// Org scoping is mandatory: without the resolver we cannot bound the list to
	// the caller's org, so we refuse to fall back to a global search.
	if h.orgMembers == nil {
		writeJSON(w, http.StatusOK, map[string]any{"users": []userOut{}})
		return
	}
	memberIDs, ok := h.orgMembers(r.Context(), q)
	if !ok || len(memberIDs) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"users": []userOut{}})
		return
	}
	// allow is the authoritative org-membership set; the Zitadel results are
	// filtered to it so a user outside the org can never appear, even if Zitadel
	// returns extras.
	allow := make(map[string]struct{}, len(memberIDs))
	for _, id := range memberIDs {
		allow[id] = struct{}{}
	}

	// Query Zitadel for exactly the org's member ids (inUserIdsQuery), plus the
	// optional text filter. Both are AND-ed so search stays within the org set.
	queries := []any{
		map[string]any{"inUserIdsQuery": map[string]any{"userIds": memberIDs}},
	}
	if q != "" {
		queries = append(queries, map[string]any{"orQuery": map[string]any{"queries": []any{
			map[string]any{"displayNameQuery": map[string]any{"displayName": q, "method": "TEXT_QUERY_METHOD_CONTAINS_IGNORE_CASE"}},
			map[string]any{"emailQuery": map[string]any{"emailAddress": q, "method": "TEXT_QUERY_METHOD_CONTAINS_IGNORE_CASE"}},
			map[string]any{"userNameQuery": map[string]any{"userName": q, "method": "TEXT_QUERY_METHOD_CONTAINS_IGNORE_CASE"}},
		}}})
	}
	body := map[string]any{
		"query":   map[string]any{"limit": 100, "asc": true},
		"queries": queries,
	}

	resp, err := h.upstream(r.Context(), http.MethodPost, "/v2/users", body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "zitadel search failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		relayError(w, resp, "search users")
		return
	}

	var parsed struct {
		Result []struct {
			UserID   string `json:"userId"`
			State    string `json:"state"`
			Username string `json:"username"`
			Human    struct {
				Profile struct {
					GivenName   string `json:"givenName"`
					FamilyName  string `json:"familyName"`
					DisplayName string `json:"displayName"`
				} `json:"profile"`
				Email struct {
					Email      string `json:"email"`
					IsVerified bool   `json:"isVerified"`
				} `json:"email"`
			} `json:"human"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		writeError(w, http.StatusBadGateway, "decode zitadel response: "+err.Error())
		return
	}

	out := make([]userOut, 0, len(parsed.Result))
	ids := make([]string, 0, len(parsed.Result))
	for _, z := range parsed.Result {
		// Defense in depth: only surface users in the org-membership set, even if
		// Zitadel returned extras for any reason.
		if _, member := allow[z.UserID]; !member {
			continue
		}
		out = append(out, userOut{
			ID:            z.UserID,
			Username:      z.Username,
			GivenName:     z.Human.Profile.GivenName,
			FamilyName:    z.Human.Profile.FamilyName,
			DisplayName:   z.Human.Profile.DisplayName,
			Email:         z.Human.Email.Email,
			EmailVerified: z.Human.Email.IsVerified,
			State:         z.State,
		})
		if z.UserID != "" {
			ids = append(ids, z.UserID)
		}
	}

	// Enrich with the per-user isAdmin flag by joining the Zitadel ids to grown
	// users → org_admins. Best-effort: a roster/DB error leaves every row at
	// isAdmin=false rather than failing the whole listing.
	if h.roster != nil && len(ids) > 0 {
		if orgID, ok := h.roster.CallerOrgID(r.Context()); ok && orgID != "" {
			if admins, err := h.roster.AdminZitadelIDs(r.Context(), orgID, ids); err == nil {
				for i := range out {
					out[i].IsAdmin = admins[out[i].ID]
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

// createRequest is the frontend payload for creating a human user.
type createRequest struct {
	Username   string `json:"username"`
	GivenName  string `json:"givenName"`
	FamilyName string `json:"familyName"`
	Email      string `json:"email"`
	// RecoveryEmail is a secondary address used for account recovery and as the
	// destination for the invite (the workspace mailbox often doesn't exist yet
	// when a user is provisioned). Stored as Zitadel user metadata `recovery_email`.
	RecoveryEmail string `json:"recoveryEmail"`
	Password      string `json:"password"`   // optional initial password
	SendInvite    bool   `json:"sendInvite"` // when true, email is left unverified so Zitadel can invite
}

// create provisions a human user via POST {api}/v2/users/human and returns the
// new user id. When a password is supplied it is set (change-on-first-login);
// otherwise, if sendInvite is set the email is created unverified so Zitadel's
// invite/verification flow can take over.
func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var in createRequest
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	in.Email = strings.TrimSpace(in.Email)
	if in.Email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	username := strings.TrimSpace(in.Username)
	if username == "" {
		username = in.Email // Zitadel allows the email as the username
	}

	body := map[string]any{
		"username": username,
		"profile": map[string]any{
			"givenName":  orDash(in.GivenName),
			"familyName": orDash(in.FamilyName),
		},
		// When inviting, leave the email unverified so Zitadel drives the
		// verification/invite; otherwise mark it verified (admin-created).
		"email": map[string]any{
			"email":      in.Email,
			"isVerified": !in.SendInvite,
		},
	}
	if in.Password != "" {
		body["password"] = map[string]any{"password": in.Password, "changeRequired": true}
	}

	resp, err := h.upstream(r.Context(), http.MethodPost, "/v2/users/human", body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "zitadel create failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		relayError(w, resp, "create user")
		return
	}
	var parsed struct {
		UserID string `json:"userId"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&parsed)

	// Best-effort post-create steps (failures are non-fatal: the user exists).
	if parsed.UserID != "" {
		if rec := strings.TrimSpace(in.RecoveryEmail); rec != "" {
			h.setMetadata(r.Context(), parsed.UserID, "recovery_email", rec)
		}
		// Trigger Zitadel's invite/verification flow so the new user gets a set-up
		// link. With SMTP configured Zitadel emails the code; otherwise this is a
		// no-op the admin can follow up on (password reset / resend invite).
		if in.SendInvite {
			h.triggerZitadelInvite(r.Context(), parsed.UserID)
			// Also send a branded invite email via Resend (best-effort; never blocks).
			if h.sendInvite != nil {
				dest := strings.TrimSpace(in.RecoveryEmail)
				if dest == "" {
					dest = in.Email
				}
				displayName := strings.TrimSpace(in.GivenName + " " + in.FamilyName)
				orgName := h.callerOrgName(r.Context())
				// inviteURL: Zitadel's invite link lands at Zitadel's own verification
				// UI. The operator configures Zitadel's app_url / redirect to grown.
				// We pass a placeholder that works as long as Zitadel has an
				// app_url pointing at workspace.pick.haus; the operator can override
				// by configuring Zitadel's notification template instead.
				inviteURL := h.zitadelURL + "/ui/login"
				_ = h.sendInvite(r.Context(), dest, displayName, inviteURL, orgName)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": parsed.UserID})
}

// setMetadata stores a key/value on a Zitadel user (management API; value is
// base64-encoded per the API contract). Best-effort: errors are swallowed.
func (h *Handler) setMetadata(ctx context.Context, userID, key, value string) {
	body := map[string]any{"value": base64.StdEncoding.EncodeToString([]byte(value))}
	resp, err := h.upstream(ctx, http.MethodPost, "/management/v1/users/"+userID+"/metadata/"+key, body)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}

// triggerZitadelInvite asks Zitadel to create + send a user invite code
// (v2 user API). Best-effort: errors are swallowed (no SMTP in local dev →
// silently a no-op). Named to avoid shadowing the injected sendInvite field.
func (h *Handler) triggerZitadelInvite(ctx context.Context, userID string) {
	resp, err := h.upstream(ctx, http.MethodPost, "/v2/users/"+userID+"/invite_code",
		map[string]any{"sendCode": map[string]any{}})
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}

// callerOrgName resolves a human-readable org display name for use in invite
// emails. Falls back to "Grown Workspace" when the org context is unavailable.
// This is a best-effort lookup; errors result in the generic fallback, which is
// fine since the email is always sent regardless.
func (h *Handler) callerOrgName(ctx context.Context) string {
	if h.roster == nil {
		return "Grown Workspace"
	}
	// roster.CallerOrgID returns the org UUID; we use it as a fallback label
	// since this package has no direct access to the org's display name.
	// server.go can inject a richer OrgNameResolver if desired in a future pass.
	if orgID, ok := h.roster.CallerOrgID(ctx); ok && orgID != "" {
		return orgID
	}
	return "Grown Workspace"
}

// updateRequest is the partial profile/email update payload.
type updateRequest struct {
	Username   *string `json:"username,omitempty"`
	GivenName  *string `json:"givenName,omitempty"`
	FamilyName *string `json:"familyName,omitempty"`
	Email      *string `json:"email,omitempty"`
}

// update edits a human user's username/profile/email via
// PUT {api}/v2/users/human/{id}. Only the provided fields are forwarded.
func (h *Handler) update(w http.ResponseWriter, r *http.Request, id string) {
	var in updateRequest
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	body := map[string]any{}
	if in.Username != nil {
		body["username"] = *in.Username
	}
	if in.GivenName != nil || in.FamilyName != nil {
		profile := map[string]any{}
		if in.GivenName != nil {
			profile["givenName"] = *in.GivenName
		}
		if in.FamilyName != nil {
			profile["familyName"] = *in.FamilyName
		}
		body["profile"] = profile
	}
	if in.Email != nil {
		body["email"] = map[string]any{"email": *in.Email, "isVerified": true}
	}
	if len(body) == 0 {
		writeError(w, http.StatusBadRequest, "no updatable fields supplied")
		return
	}

	resp, err := h.upstream(r.Context(), http.MethodPut, "/v2/users/human/"+id, body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "zitadel update failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		relayError(w, resp, "update user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// setState deactivates or reactivates a user via POST {api}/v2/users/{id}/{action}.
func (h *Handler) setState(w http.ResponseWriter, r *http.Request, id, action string) {
	resp, err := h.upstream(r.Context(), http.MethodPost, "/v2/users/"+id+"/"+action, map[string]any{})
	if err != nil {
		writeError(w, http.StatusBadGateway, "zitadel "+action+" failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		relayError(w, resp, action+" user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// passwordRequest sets a new password OR (when password is empty) requests a
// reset link be returned so the admin can deliver it.
type passwordRequest struct {
	Password string `json:"password"` // empty ⇒ request a reset link instead
}

// password sets a user's password (change-on-next-login) via
// POST {api}/v2/users/{id}/password. When no password is supplied it instead
// asks Zitadel to RETURN a reset code/link (verification.returnCode) so the
// admin can pass it on — Zitadel emails the link directly when configured.
func (h *Handler) password(w http.ResponseWriter, r *http.Request, id string) {
	var in passwordRequest
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var body map[string]any
	if strings.TrimSpace(in.Password) != "" {
		body = map[string]any{
			"newPassword": map[string]any{"password": in.Password, "changeRequired": true},
		}
	} else {
		// Reset flow: ask Zitadel to return a verification code so the admin can
		// relay it (or rely on Zitadel's configured notification to email it).
		body = map[string]any{
			"newPassword":  map[string]any{"changeRequired": true},
			"verification": map[string]any{"returnCode": map[string]any{}},
		}
	}

	resp, err := h.upstream(r.Context(), http.MethodPost, "/v2/users/"+id+"/password", body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "zitadel password failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		relayError(w, resp, "set password")
		return
	}
	// Pass any returned verification code through so the UI can show it.
	var parsed struct {
		VerificationCode string `json:"verificationCode"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&parsed)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "verificationCode": parsed.VerificationCode})
}

// removeFromOrg removes a user from the caller's org: it deletes the matching
// grown.users row (by oidc_subject in the caller's org) and any org_admins grant.
// It NEVER calls Zitadel — the user keeps their IdP account and can still sign
// into any other org they belong to. This is the default DELETE /{id} semantics.
func (h *Handler) removeFromOrg(w http.ResponseWriter, r *http.Request, zitadelID string) {
	if h.membership == nil {
		writeError(w, http.StatusServiceUnavailable, "org membership management is not configured")
		return
	}
	orgID, ok := h.callerOrgID(r)
	if !ok || orgID == "" {
		writeError(w, http.StatusBadRequest, "no org context")
		return
	}
	removed, err := h.membership.RemoveFromOrg(r.Context(), orgID, zitadelID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "remove from org: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "removed": removed})
}

// hardDelete destroys the user's whole IdP account via DELETE {api}/v2/users/{id}.
// This is irreversible and affects EVERY org, so it is super-admin-only (email in
// GROWN_ADMIN_EMAILS) — a plain org-admin gets 403. It does NOT clean up grown
// rows itself; the removed user's grown rows are reaped on next access / via the
// remove-from-org flow. Mounted at DELETE /{id}/zitadel.
func (h *Handler) hardDelete(w http.ResponseWriter, r *http.Request, id string) {
	if !h.IsSuperAdmin(r.Context()) {
		writeError(w, http.StatusForbidden, "super-admin privileges required for Zitadel delete")
		return
	}
	resp, err := h.upstream(r.Context(), http.MethodDelete, "/v2/users/"+id, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "zitadel delete failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		relayError(w, resp, "delete user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// callerOrgID resolves the caller's org id from the roster (preferred) so the
// remove-from-org path can scope its DB writes without a separate injection.
func (h *Handler) callerOrgID(r *http.Request) (string, bool) {
	if h.roster == nil {
		return "", false
	}
	return h.roster.CallerOrgID(r.Context())
}

// ---- Org-admin grant / revoke ----------------------------------------------

// grantAdmin grants the org-admin role to the user identified by the Zitadel id
// in the path. The Zitadel id is mapped to a grown user id (lazily provisioning
// a grown row if the user has not signed in yet) before the grant is recorded.
func (h *Handler) grantAdmin(w http.ResponseWriter, r *http.Request, zitadelID string) {
	if h.roster == nil {
		writeError(w, http.StatusServiceUnavailable, "admin-role management is not configured")
		return
	}
	orgID, ok := h.roster.CallerOrgID(r.Context())
	if !ok || orgID == "" {
		writeError(w, http.StatusBadRequest, "no org context")
		return
	}
	target, err := h.roster.GrownUserIDForZitadel(r.Context(), orgID, zitadelID)
	if err != nil || target == "" {
		writeError(w, http.StatusBadGateway, "resolve target user: "+errMsg(err))
		return
	}
	by, _ := h.roster.CallerUserID(r.Context())
	if err := h.roster.Grant(r.Context(), orgID, target, by); err != nil {
		writeError(w, http.StatusInternalServerError, "grant admin: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "isAdmin": true})
}

// revokeAdmin removes the org-admin role from the user identified by the Zitadel
// id in the path. It refuses to remove the org's last admin (409), so an org is
// never left with nobody who can administer it.
func (h *Handler) revokeAdmin(w http.ResponseWriter, r *http.Request, zitadelID string) {
	if h.roster == nil {
		writeError(w, http.StatusServiceUnavailable, "admin-role management is not configured")
		return
	}
	orgID, ok := h.roster.CallerOrgID(r.Context())
	if !ok || orgID == "" {
		writeError(w, http.StatusBadRequest, "no org context")
		return
	}
	target, err := h.roster.GrownUserIDForZitadel(r.Context(), orgID, zitadelID)
	if err != nil || target == "" {
		writeError(w, http.StatusBadGateway, "resolve target user: "+errMsg(err))
		return
	}
	// Guard the last admin: count first and refuse if removing this user would
	// leave the org with zero admins. (If the target isn't currently an admin,
	// the revoke is a harmless no-op and the count is unaffected.)
	n, err := h.roster.CountAdmins(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "count admins: "+err.Error())
		return
	}
	if n <= 1 {
		// Only block when the target is actually that last admin.
		admins, aerr := h.roster.AdminZitadelIDs(r.Context(), orgID, []string{zitadelID})
		if aerr == nil && admins[zitadelID] {
			writeError(w, http.StatusConflict, "cannot remove the last admin of the org")
			return
		}
	}
	if err := h.roster.Revoke(r.Context(), orgID, target); err != nil {
		writeError(w, http.StatusInternalServerError, "revoke admin: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "isAdmin": false})
}

// errMsg renders err for an error response, tolerating a nil error.
func errMsg(err error) string {
	if err == nil {
		return "user not found"
	}
	return err.Error()
}

// ---- Upstream + response helpers -------------------------------------------

// upstream issues an authenticated request to the Zitadel API. A nil body sends
// no payload; a non-nil body is JSON-encoded.
func (h *Handler) upstream(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(buf)
	}
	req, err := http.NewRequestWithContext(ctx, method, h.zitadelURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+h.zitadelToken)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return h.client.Do(req)
}

// decodeBody reads a (small) JSON request body into v. An empty body is allowed
// and leaves v at its zero value.
func decodeBody(r *http.Request, v any) error {
	if r.Body == nil {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	return json.Unmarshal(data, v)
}

// writeJSON writes v as a JSON response with the given status.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes a JSON {error} body with the given status.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}

// relayError surfaces a non-2xx upstream response as a grown error, preserving
// the upstream status and including Zitadel's message when present.
func relayError(w http.ResponseWriter, resp *http.Response, op string) {
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	msg := op + " failed"
	var zitErr struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(data, &zitErr) == nil && zitErr.Message != "" {
		msg = op + ": " + zitErr.Message
	}
	writeError(w, resp.StatusCode, msg)
}

// orDash returns s, or "-" when s is blank. Zitadel requires non-empty
// given/family names on human creation; a dash is an unobtrusive placeholder the
// admin can edit later.
func orDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return s
}
