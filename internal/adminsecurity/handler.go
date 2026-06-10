// Package adminsecurity exposes an admin-gated HTTP surface that reads and
// writes the caller-org's Zitadel security policies (password complexity, login
// / MFA / passwordless, and lockout). It powers the Admin → Security console.
//
// Trust model (mirrors internal/adminanalytics and internal/adminusers): the
// handler is mounted INSIDE grown's auth middleware, so the caller's grown user
// and org are already resolved on the request context. Identity is supplied via
// an injected Identity struct of closures, keeping this package free of
// internal/auth (and its gen/ dependency). Every route is gated on ADMIN
// privileges (GROWN_ADMIN_EMAILS allowlist OR an org_admins grant); a non-admin
// gets 403.
//
// Org-scoping: Zitadel's management v1 policy endpoints are org-scoped via the
// x-zitadel-orgid header. We resolve the caller's Zitadel org (resourceOwner)
// the same way internal/profile does: GET /v2/users/{oidcSubject} →
// details.resourceOwner. EVERY upstream call carries that header, so a caller
// can only ever read or mutate their OWN org's policies — never another org's.
//
// Default-vs-org policy: a fresh org inherits the Zitadel INSTANCE default
// policy (the GET returns isDefault:true). The management v1 update endpoints
// (PUT) only succeed once an ORG-level policy row exists; on an org still using
// the default they return 404/NotFound. We handle this transparently: on a PUT
// that 404s we POST to create the org-level policy (seeding it from the values
// being written), then retry the PUT. See updatePolicy / putOrCreate below.
//
// All upstream calls are hand-rolled net/http + encoding/json — no Zitadel SDK
// and NO dependency on the generated protos (gen/), so this package builds and
// tests standalone.
//
// Routes (mounted under /api/v1/admin/security):
//
//	GET   /api/v1/admin/security/policies        → current org policies (read)
//	PUT   /api/v1/admin/security/password        → password complexity (write)
//	PUT   /api/v1/admin/security/mfa             → 2-step / MFA (login policy, write)
//	PUT   /api/v1/admin/security/lockout         → login challenges (lockout, write)
//	PUT   /api/v1/admin/security/passwordless    → passwordless (login policy, write)
//	GET   /api/v1/admin/security/idps            → org's IdPs + SAML apps (read-only)
package adminsecurity

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// mountPrefix is the public path under which this handler is mounted.
const mountPrefix = "/api/v1/admin/security"

// requestTimeout bounds each upstream Zitadel call.
const requestTimeout = 15 * time.Second

// Identity resolves the caller off the request context. server.go supplies
// closures backed by auth.UserFromContext / auth.OrgFromContext, keeping this
// package free of internal/auth (and its gen/ dependency).
type Identity struct {
	// Caller returns the caller's Zitadel user id (oidc_subject), email, grown
	// org id, and whether a caller is present. The Zitadel subject is used to
	// resolve the caller's resourceOwner (Zitadel org) for policy scoping.
	Caller func(ctx context.Context) (zitadelSubject, email, grownOrgID string, ok bool)
	// IsAdmin reports whether the caller is an admin (allowlist OR org_admins).
	IsAdmin func(ctx context.Context) bool
}

// Handler implements the admin-security policy routes. Dependency-light by
// design: net/http + encoding/json, with identity supplied via Identity.
type Handler struct {
	id           Identity
	zitadelURL   string // Zitadel API base (no trailing slash)
	zitadelToken string // service-account PAT (empty ⇒ 503)
	client       *http.Client
}

// NewHandler constructs the admin-security handler.
//
//   - id supplies the caller resolver + admin predicate.
//   - zitadelURL is the Zitadel API base, e.g. "https://auth.pick.haus".
//   - zitadelToken is the service-account PAT from GROWN_ZITADEL_SERVICE_TOKEN.
//     When empty, every route returns 503.
func NewHandler(id Identity, zitadelURL, zitadelToken string) *Handler {
	return &Handler{
		id:           id,
		zitadelURL:   strings.TrimRight(zitadelURL, "/"),
		zitadelToken: zitadelToken,
		client:       &http.Client{Timeout: requestTimeout},
	}
}

// ServeHTTP authorizes the caller, resolves their Zitadel org, then routes.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// --- authorization (identical gate to adminanalytics) ---
	if h.id.Caller == nil {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	subject, _, _, ok := h.id.Caller(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	if h.id.IsAdmin == nil || !h.id.IsAdmin(r.Context()) {
		writeError(w, http.StatusForbidden, "admin privileges required")
		return
	}
	if h.zitadelToken == "" {
		writeError(w, http.StatusServiceUnavailable,
			"security policies require GROWN_ZITADEL_SERVICE_TOKEN")
		return
	}
	if subject == "" {
		writeError(w, http.StatusBadRequest, "caller has no Zitadel subject")
		return
	}

	// Resolve the caller's Zitadel org (resourceOwner). Every downstream policy
	// call is scoped to this org via x-zitadel-orgid — a caller can never reach
	// another org's policies.
	orgID, err := h.resolveResourceOwner(r.Context(), subject)
	if err != nil {
		writeError(w, http.StatusBadGateway, "resolve org: "+err.Error())
		return
	}
	if orgID == "" {
		writeError(w, http.StatusBadRequest, "no Zitadel org for caller")
		return
	}

	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, mountPrefix), "/")
	switch rest {
	case "policies":
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		h.getPolicies(w, r, orgID)
	case "idps":
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		h.getIDPs(w, r, orgID)
	case "password":
		if r.Method != http.MethodPut {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		h.putPassword(w, r, orgID)
	case "mfa":
		if r.Method != http.MethodPut {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		h.putLoginPolicy(w, r, orgID, loginFieldsMFA)
	case "lockout":
		if r.Method != http.MethodPut {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		h.putLockout(w, r, orgID)
	case "passwordless":
		if r.Method != http.MethodPut {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		h.putLoginPolicy(w, r, orgID, loginFieldsPasswordless)
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

// ---- response payloads ------------------------------------------------------

// PoliciesResponse is the aggregate read of the org's security posture. Each
// sub-policy carries an IsDefault flag (true when the org still inherits the
// Zitadel instance default rather than an org-level override).
type PoliciesResponse struct {
	OrgID       string         `json:"org_id"`
	CollectedAt string         `json:"collected_at"`
	Password    PasswordPolicy `json:"password"`
	Login       LoginPolicy    `json:"login"`
	Lockout     LockoutPolicy  `json:"lockout"`
	// Errors holds best-effort fetch failures keyed by policy name; the rest of
	// the response is still returned so a single failing policy doesn't blank
	// the whole console.
	Errors map[string]string `json:"errors,omitempty"`
}

// PasswordPolicy mirrors the writable fields of the Zitadel password complexity
// policy.
type PasswordPolicy struct {
	MinLength    int64 `json:"min_length"`
	HasUppercase bool  `json:"has_uppercase"`
	HasLowercase bool  `json:"has_lowercase"`
	HasNumber    bool  `json:"has_number"`
	HasSymbol    bool  `json:"has_symbol"`
	IsDefault    bool  `json:"is_default"`
}

// LoginPolicy mirrors the MFA + passwordless fields of the Zitadel login policy
// that the console exposes.
type LoginPolicy struct {
	ForceMFA              bool     `json:"force_mfa"`
	ForceMFALocalOnly     bool     `json:"force_mfa_local_only"`
	AllowUsernamePassword bool     `json:"allow_username_password"`
	PasswordlessType      string   `json:"passwordless_type"`
	AllowDomainDiscovery  bool     `json:"allow_domain_discovery"`
	SecondFactors         []string `json:"second_factors"`
	MultiFactors          []string `json:"multi_factors"`
	IsDefault             bool     `json:"is_default"`
}

// LockoutPolicy mirrors the Zitadel lockout policy thresholds.
type LockoutPolicy struct {
	MaxPasswordAttempts int64 `json:"max_password_attempts"`
	MaxOTPAttempts      int64 `json:"max_otp_attempts"`
	IsDefault           bool  `json:"is_default"`
}

// IDPsResponse is the read-only list of the org's identity providers, used by
// the SSO cards. SAML apps live on individual projects in Zitadel and are not
// enumerable org-wide via a single management call, so the console links out
// for SAML configuration rather than faking a list.
type IDPsResponse struct {
	OrgID string    `json:"org_id"`
	IDPs  []IDPInfo `json:"idps"`
}

// IDPInfo is a flattened view of a Zitadel org IdP.
type IDPInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Type  string `json:"type"`
	State string `json:"state"`
	Owner string `json:"owner"`
}

// ---- GET handlers -----------------------------------------------------------

// getPolicies fetches the three org policies in parallel-ish (sequential, but
// each tolerant of failure) and returns the aggregate. A per-policy fetch error
// is recorded in Errors rather than failing the whole response.
func (h *Handler) getPolicies(w http.ResponseWriter, r *http.Request, orgID string) {
	ctx := r.Context()
	resp := PoliciesResponse{
		OrgID:       orgID,
		CollectedAt: time.Now().UTC().Format(time.RFC3339),
		Errors:      map[string]string{},
	}

	if pw, err := h.fetchPassword(ctx, orgID); err != nil {
		resp.Errors["password"] = err.Error()
	} else {
		resp.Password = pw
	}
	if lg, err := h.fetchLogin(ctx, orgID); err != nil {
		resp.Errors["login"] = err.Error()
	} else {
		resp.Login = lg
	}
	if lk, err := h.fetchLockout(ctx, orgID); err != nil {
		resp.Errors["lockout"] = err.Error()
	} else {
		resp.Lockout = lk
	}
	if len(resp.Errors) == 0 {
		resp.Errors = nil
	}
	writeJSON(w, http.StatusOK, resp)
}

// fetchPassword reads GET /management/v1/policies/password/complexity.
func (h *Handler) fetchPassword(ctx context.Context, orgID string) (PasswordPolicy, error) {
	var parsed struct {
		Policy struct {
			MinLength    json.Number `json:"minLength"`
			HasUppercase bool        `json:"hasUppercase"`
			HasLowercase bool        `json:"hasLowercase"`
			HasNumber    bool        `json:"hasNumber"`
			HasSymbol    bool        `json:"hasSymbol"`
			IsDefault    bool        `json:"isDefault"`
		} `json:"policy"`
	}
	if err := h.getJSON(ctx, "/management/v1/policies/password/complexity", orgID, &parsed); err != nil {
		return PasswordPolicy{}, err
	}
	return PasswordPolicy{
		MinLength:    asInt(parsed.Policy.MinLength),
		HasUppercase: parsed.Policy.HasUppercase,
		HasLowercase: parsed.Policy.HasLowercase,
		HasNumber:    parsed.Policy.HasNumber,
		HasSymbol:    parsed.Policy.HasSymbol,
		IsDefault:    parsed.Policy.IsDefault,
	}, nil
}

// fetchLogin reads GET /management/v1/policies/login.
func (h *Handler) fetchLogin(ctx context.Context, orgID string) (LoginPolicy, error) {
	var parsed struct {
		Policy struct {
			AllowUsernamePassword bool     `json:"allowUsernamePassword"`
			ForceMFA              bool     `json:"forceMfa"`
			ForceMFALocalOnly     bool     `json:"forceMfaLocalOnly"`
			PasswordlessType      string   `json:"passwordlessType"`
			AllowDomainDiscovery  bool     `json:"allowDomainDiscovery"`
			SecondFactors         []string `json:"secondFactors"`
			MultiFactors          []string `json:"multiFactors"`
			IsDefault             bool     `json:"isDefault"`
		} `json:"policy"`
	}
	if err := h.getJSON(ctx, "/management/v1/policies/login", orgID, &parsed); err != nil {
		return LoginPolicy{}, err
	}
	return LoginPolicy{
		ForceMFA:              parsed.Policy.ForceMFA,
		ForceMFALocalOnly:     parsed.Policy.ForceMFALocalOnly,
		AllowUsernamePassword: parsed.Policy.AllowUsernamePassword,
		PasswordlessType:      parsed.Policy.PasswordlessType,
		AllowDomainDiscovery:  parsed.Policy.AllowDomainDiscovery,
		SecondFactors:         parsed.Policy.SecondFactors,
		MultiFactors:          parsed.Policy.MultiFactors,
		IsDefault:             parsed.Policy.IsDefault,
	}, nil
}

// fetchLockout reads GET /management/v1/policies/lockout.
func (h *Handler) fetchLockout(ctx context.Context, orgID string) (LockoutPolicy, error) {
	var parsed struct {
		Policy struct {
			MaxPasswordAttempts json.Number `json:"maxPasswordAttempts"`
			MaxOTPAttempts      json.Number `json:"maxOtpAttempts"`
			IsDefault           bool        `json:"isDefault"`
		} `json:"policy"`
	}
	if err := h.getJSON(ctx, "/management/v1/policies/lockout", orgID, &parsed); err != nil {
		return LockoutPolicy{}, err
	}
	return LockoutPolicy{
		MaxPasswordAttempts: asInt(parsed.Policy.MaxPasswordAttempts),
		MaxOTPAttempts:      asInt(parsed.Policy.MaxOTPAttempts),
		IsDefault:           parsed.Policy.IsDefault,
	}, nil
}

// getIDPs lists the org's identity providers (read-only) for the SSO cards.
func (h *Handler) getIDPs(w http.ResponseWriter, r *http.Request, orgID string) {
	// POST /management/v1/idps/_search returns the org's configured IdPs.
	var parsed struct {
		Result []struct {
			ID     string `json:"id"`
			State  string `json:"state"`
			Name   string `json:"name"`
			Owner  string `json:"owner"`
			Type   string `json:"type"`
			Config struct {
				Name string `json:"name"`
			} `json:"config"`
		} `json:"result"`
	}
	resp, err := h.upstream(r.Context(), http.MethodPost, "/management/v1/idps/_search", orgID, map[string]any{})
	if err != nil {
		writeError(w, http.StatusBadGateway, "list idps: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		// IdP listing is a nicety; surface an empty list rather than failing the
		// whole SSO card if the endpoint shape differs on this Zitadel version.
		writeJSON(w, http.StatusOK, IDPsResponse{OrgID: orgID, IDPs: []IDPInfo{}})
		return
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		writeJSON(w, http.StatusOK, IDPsResponse{OrgID: orgID, IDPs: []IDPInfo{}})
		return
	}
	out := make([]IDPInfo, 0, len(parsed.Result))
	for _, idp := range parsed.Result {
		name := idp.Name
		if name == "" {
			name = idp.Config.Name
		}
		out = append(out, IDPInfo{
			ID:    idp.ID,
			Name:  name,
			Type:  idp.Type,
			State: idp.State,
			Owner: idp.Owner,
		})
	}
	writeJSON(w, http.StatusOK, IDPsResponse{OrgID: orgID, IDPs: out})
}

// ---- PUT handlers -----------------------------------------------------------

// putPassword updates the password complexity policy. On an org still using the
// instance default the PUT 404s; we then POST to create the org policy and retry.
func (h *Handler) putPassword(w http.ResponseWriter, r *http.Request, orgID string) {
	var in PasswordPolicy
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if in.MinLength <= 0 {
		in.MinLength = 8
	}
	body := map[string]any{
		"minLength":    in.MinLength,
		"hasUppercase": in.HasUppercase,
		"hasLowercase": in.HasLowercase,
		"hasNumber":    in.HasNumber,
		"hasSymbol":    in.HasSymbol,
	}
	if err := h.putOrCreate(r.Context(), orgID, "/management/v1/policies/password/complexity", body); err != nil {
		writeError(w, http.StatusBadGateway, "update password policy: "+err.Error())
		return
	}
	// Echo the freshly-read policy so the UI reflects what Zitadel stored.
	pw, _ := h.fetchPassword(r.Context(), orgID)
	writeJSON(w, http.StatusOK, pw)
}

// putLockout updates the lockout policy thresholds (Login challenges card).
func (h *Handler) putLockout(w http.ResponseWriter, r *http.Request, orgID string) {
	var in LockoutPolicy
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	body := map[string]any{
		"maxPasswordAttempts": in.MaxPasswordAttempts,
		"maxOtpAttempts":      in.MaxOTPAttempts,
	}
	if err := h.putOrCreate(r.Context(), orgID, "/management/v1/policies/lockout", body); err != nil {
		writeError(w, http.StatusBadGateway, "update lockout policy: "+err.Error())
		return
	}
	lk, _ := h.fetchLockout(r.Context(), orgID)
	writeJSON(w, http.StatusOK, lk)
}

// loginFieldSet selects which subset of the login policy a PUT writes. The
// Zitadel login-policy update endpoint requires the FULL policy body, so we
// always merge the requested changes onto the current policy before sending.
type loginFieldSet int

const (
	loginFieldsMFA loginFieldSet = iota
	loginFieldsPasswordless
)

// putLoginPolicy updates the login policy. Because Zitadel's
// PUT /management/v1/policies/login replaces the whole policy, we read the
// current policy first, overlay only the fields owned by this route (MFA vs
// passwordless), then write the merged body — creating the org policy first if
// the org still uses the instance default.
func (h *Handler) putLoginPolicy(w http.ResponseWriter, r *http.Request, orgID string, set loginFieldSet) {
	var in LoginPolicy
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	cur, err := h.fetchLogin(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusBadGateway, "read login policy: "+err.Error())
		return
	}
	// Start from the current values; overlay only the route-owned fields.
	merged := cur
	switch set {
	case loginFieldsMFA:
		merged.ForceMFA = in.ForceMFA
		merged.ForceMFALocalOnly = in.ForceMFALocalOnly
		if in.SecondFactors != nil {
			merged.SecondFactors = in.SecondFactors
		}
		if in.MultiFactors != nil {
			merged.MultiFactors = in.MultiFactors
		}
	case loginFieldsPasswordless:
		merged.PasswordlessType = in.PasswordlessType
		merged.AllowDomainDiscovery = in.AllowDomainDiscovery
	}

	body := loginPolicyBody(merged)
	if err := h.putOrCreate(r.Context(), orgID, "/management/v1/policies/login", body); err != nil {
		writeError(w, http.StatusBadGateway, "update login policy: "+err.Error())
		return
	}
	lg, _ := h.fetchLogin(r.Context(), orgID)
	writeJSON(w, http.StatusOK, lg)
}

// loginPolicyBody renders a LoginPolicy into the Zitadel management v1 request
// body. Zitadel requires the complete set of boolean knobs on the login policy
// update; we pass through what we read plus our overlaid fields, defaulting the
// fields the console doesn't expose to sensible passwords-on values.
func loginPolicyBody(p LoginPolicy) map[string]any {
	pwl := p.PasswordlessType
	if pwl == "" {
		pwl = "PASSWORDLESS_TYPE_NOT_ALLOWED"
	}
	body := map[string]any{
		"allowUsernamePassword":  true,
		"allowRegister":          false,
		"allowExternalIdp":       true,
		"forceMfa":               p.ForceMFA,
		"forceMfaLocalOnly":      p.ForceMFALocalOnly,
		"passwordlessType":       pwl,
		"hidePasswordReset":      false,
		"allowDomainDiscovery":   p.AllowDomainDiscovery,
		"ignoreUnknownUsernames": false,
		"disableLoginWithEmail":  false,
		"disableLoginWithPhone":  false,
	}
	if len(p.SecondFactors) > 0 {
		body["secondFactors"] = p.SecondFactors
	}
	if len(p.MultiFactors) > 0 {
		body["multiFactors"] = p.MultiFactors
	}
	return body
}

// ---- Zitadel helpers --------------------------------------------------------

// resolveResourceOwner reads GET /v2/users/{subject} and returns
// details.resourceOwner — the caller's Zitadel org id, used as x-zitadel-orgid
// on every policy call. This is the same resolution internal/profile uses.
func (h *Handler) resolveResourceOwner(ctx context.Context, subject string) (string, error) {
	resp, err := h.upstream(ctx, http.MethodGet, "/v2/users/"+subject, "", nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		return "", &upstreamError{status: resp.StatusCode, msg: string(body)}
	}
	var parsed struct {
		User struct {
			Details struct {
				ResourceOwner string `json:"resourceOwner"`
			} `json:"details"`
		} `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", err
	}
	return parsed.User.Details.ResourceOwner, nil
}

// getJSON issues a GET to a management v1 policy endpoint (org-scoped) and
// decodes the body into v.
func (h *Handler) getJSON(ctx context.Context, path, orgID string, v any) error {
	resp, err := h.upstream(ctx, http.MethodGet, path, orgID, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		return &upstreamError{status: resp.StatusCode, msg: string(body)}
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

// putOrCreate performs the default-vs-org policy dance: it PUTs the policy body;
// if Zitadel reports the org has no org-level policy yet (404 NotFound — it is
// using the instance default), it POSTs to the same path to CREATE the org
// policy with these values, then retries the PUT. Returns nil on success.
func (h *Handler) putOrCreate(ctx context.Context, orgID, path string, body map[string]any) error {
	// First attempt: PUT (the common case once an org policy exists).
	if err := h.mutate(ctx, http.MethodPut, path, orgID, body); err != nil {
		ue, ok := err.(*upstreamError)
		if !ok || ue.status != http.StatusNotFound {
			return err
		}
		// Org still on the instance default → create the org-level policy, then
		// PUT again (POST seeds it; the PUT makes the values authoritative and is
		// idempotent).
		if cerr := h.mutate(ctx, http.MethodPost, path, orgID, body); cerr != nil {
			// If creation itself reports the policy already exists, fall through to
			// the retry PUT below rather than failing.
			if cue, cok := cerr.(*upstreamError); !cok || cue.status != http.StatusConflict {
				return cerr
			}
		}
		return h.mutate(ctx, http.MethodPut, path, orgID, body)
	}
	return nil
}

// mutate issues a write (PUT/POST) to a management v1 endpoint scoped to orgID
// and returns an *upstreamError for any non-2xx response so callers can inspect
// the status (notably 404 to drive the create-before-update path).
func (h *Handler) mutate(ctx context.Context, method, path, orgID string, body any) error {
	resp, err := h.upstream(ctx, method, path, orgID, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		return &upstreamError{status: resp.StatusCode, msg: string(data)}
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	return nil
}

// upstream issues an authenticated request to the Zitadel API.
//   - orgID, when non-empty, is sent as x-zitadel-orgid (management v1 scoping).
//   - body, when non-nil, is JSON-encoded.
func (h *Handler) upstream(ctx context.Context, method, path, orgID string, body any) (*http.Response, error) {
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
	if orgID != "" {
		req.Header.Set("x-zitadel-orgid", orgID)
	}
	return h.client.Do(req)
}

// upstreamError carries an upstream HTTP status + body so callers can branch on
// the status (e.g. 404 → create-before-update).
type upstreamError struct {
	status int
	msg    string
}

func (e *upstreamError) Error() string {
	msg := e.msg
	// Try to surface Zitadel's structured {message} if present.
	var z struct {
		Message string `json:"message"`
	}
	if json.Unmarshal([]byte(e.msg), &z) == nil && z.Message != "" {
		msg = z.Message
	}
	return strings.TrimSpace(http.StatusText(e.status) + ": " + truncate(msg, 200))
}

// asInt converts a json.Number (Zitadel returns numeric policy fields as strings
// in some versions) to int64, tolerating empties.
func asInt(n json.Number) int64 {
	if n == "" {
		return 0
	}
	i, err := n.Int64()
	if err != nil {
		return 0
	}
	return i
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// decodeBody reads a (small) JSON request body into v. An empty body is allowed.
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
