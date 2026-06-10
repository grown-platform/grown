// Package profile exposes a self-service HTTP surface for the authenticated
// user to read and update their own identity in Zitadel (the source of truth).
//
// Trust model: the handler is mounted INSIDE grown's auth middleware
// (auth.HTTPMiddleware), so the caller's grown user is already resolved on the
// request context. Identity is surfaced via an injected Caller closure (the
// same pattern used by internal/adminusers and internal/orgadminhttp), which
// keeps this package free of internal/auth's generated-proto dependency and
// lets it build and test standalone.
//
// Routes (mounted under /api/v1/me/profile):
//
//	GET  /api/v1/me/profile   → {given_name, family_name, username, phone,
//	                              email, email_verified, phone_verified}
//	PATCH /api/v1/me/profile  → partial update; only changed fields are sent
//	                             to Zitadel. Email changes trigger a Zitadel
//	                             verification email (isEmailVerified:false).
//
// Zitadel management v1 endpoints used:
//
//	GET  /v2/users/{subject}              → read current state + resourceOwner
//	PUT  /management/v1/users/{id}/profile → update firstName/lastName/displayName
//	PUT  /management/v1/users/{id}/username → update username
//	PUT  /management/v1/users/{id}/phone    → update phone
//	PUT  /management/v1/users/{id}/email    → change email (isEmailVerified:false
//	                                           triggers Zitadel to send a
//	                                           verification link via SMTP)
package profile

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"code.pick.haus/grown/grown/internal/users"
)

// mountPrefix is the public path under which the handler is mounted.
const mountPrefix = "/api/v1/me/profile"

// requestTimeout bounds each upstream Zitadel call.
const requestTimeout = 15 * time.Second

// Caller returns the authenticated user's grown user record from the request
// context. Returns (zero, false) when no authenticated user is present.
// server.go supplies a closure backed by auth.UserFromContext, keeping this
// package decoupled from internal/auth (and its gen/ dependency).
type Caller func(ctx context.Context) (users.User, bool)

// Handler implements GET + PATCH /api/v1/me/profile. It reads/writes the
// caller's Zitadel profile via the management v1 API using a service PAT, and
// keeps grown.users.display_name in sync after a successful profile update.
type Handler struct {
	zitadelURL   string // Zitadel API base (no trailing slash)
	zitadelToken string // service-account PAT (empty ⇒ 503)
	callerOf     Caller
	usersRepo    *users.Repository
	client       *http.Client
}

// NewHandler constructs the profile handler.
//
//   - zitadelURL is the Zitadel API base, e.g. "https://auth.pick.haus".
//   - zitadelToken is the service-account PAT from GROWN_ZITADEL_SERVICE_TOKEN.
//     When empty, every route returns 503.
//   - usersRepo is used to update grown.users.display_name after a save.
func NewHandler(zitadelURL, zitadelToken string, usersRepo *users.Repository) *Handler {
	return &Handler{
		zitadelURL:   strings.TrimRight(zitadelURL, "/"),
		zitadelToken: zitadelToken,
		usersRepo:    usersRepo,
		client:       &http.Client{Timeout: requestTimeout},
	}
}

// WithCaller injects the identity resolver and returns the handler for
// chaining. server.go calls this with a closure backed by auth.UserFromContext.
// When no resolver is set every request is treated as unauthenticated (401).
func (h *Handler) WithCaller(c Caller) *Handler {
	h.callerOf = c
	return h
}

// ServeHTTP routes GET and PATCH to their respective handlers.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.callerOf == nil {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	u, ok := h.callerOf(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	if h.zitadelToken == "" {
		writeError(w, http.StatusServiceUnavailable,
			"profile management requires GROWN_ZITADEL_SERVICE_TOKEN")
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.get(w, r, u)
	case http.MethodPatch:
		h.patch(w, r, u)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// ---- GET --------------------------------------------------------------------

// ProfileOut is the JSON shape returned to the frontend.
type ProfileOut struct {
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Username      string `json:"username"`
	Phone         string `json:"phone"`
	PhoneVerified bool   `json:"phone_verified"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
}

// get reads the caller's current profile from Zitadel v2 users endpoint.
func (h *Handler) get(w http.ResponseWriter, r *http.Request, u users.User) {
	if u.OIDCSubject == "" {
		writeError(w, http.StatusBadRequest, "user has no Zitadel subject")
		return
	}
	zUser, err := h.fetchZitadelUser(r.Context(), u.OIDCSubject)
	if err != nil {
		writeError(w, http.StatusBadGateway, "fetch Zitadel profile: "+err.Error())
		return
	}

	out := ProfileOut{
		GivenName:     zUser.Human.Profile.GivenName,
		FamilyName:    zUser.Human.Profile.FamilyName,
		Username:      zUser.Username,
		Phone:         zUser.Human.Phone.Phone,
		PhoneVerified: zUser.Human.Phone.IsVerified,
		Email:         zUser.Human.Email.Email,
		EmailVerified: zUser.Human.Email.IsVerified,
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- PATCH ------------------------------------------------------------------

// PatchRequest is the partial update payload from the frontend.
type PatchRequest struct {
	GivenName  *string `json:"given_name,omitempty"`
	FamilyName *string `json:"family_name,omitempty"`
	Username   *string `json:"username,omitempty"`
	Phone      *string `json:"phone,omitempty"`
	Email      *string `json:"email,omitempty"`
}

// PatchResponse is returned after a successful PATCH.
type PatchResponse struct {
	OK                    bool   `json:"ok"`
	EmailVerificationSent bool   `json:"email_verification_sent,omitempty"`
	Email                 string `json:"email,omitempty"`
}

// patch applies the partial update to Zitadel and synchronises grown.users.
func (h *Handler) patch(w http.ResponseWriter, r *http.Request, u users.User) {
	var in PatchRequest
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if in.GivenName == nil && in.FamilyName == nil && in.Username == nil &&
		in.Phone == nil && in.Email == nil {
		writeError(w, http.StatusBadRequest, "no fields to update")
		return
	}
	if u.OIDCSubject == "" {
		writeError(w, http.StatusBadRequest, "user has no Zitadel subject")
		return
	}

	// Fetch current state so we can skip truly-unchanged fields (e.g. avoid
	// sending a re-verification email for an email that hasn't changed).
	zUser, err := h.fetchZitadelUser(r.Context(), u.OIDCSubject)
	if err != nil {
		writeError(w, http.StatusBadGateway, "fetch current profile: "+err.Error())
		return
	}
	resourceOwner := zUser.Details.ResourceOwner
	subject := u.OIDCSubject

	// ---- profile (firstName + lastName + displayName) -----------------------
	if in.GivenName != nil || in.FamilyName != nil {
		given := deref(in.GivenName, zUser.Human.Profile.GivenName)
		family := deref(in.FamilyName, zUser.Human.Profile.FamilyName)
		displayName := strings.TrimSpace(given + " " + family)
		if displayName == "" {
			displayName = given
		}
		if displayName == "" {
			displayName = family
		}
		body := map[string]any{
			"firstName":         given,
			"lastName":          family,
			"displayName":       displayName,
			"nickName":          "",
			"preferredLanguage": "en",
		}
		if err := h.mgmtPUT(r.Context(), subject, resourceOwner, "profile", body); err != nil {
			writeError(w, http.StatusBadGateway, "update profile: "+err.Error())
			return
		}
	}

	// ---- username -----------------------------------------------------------
	if in.Username != nil && *in.Username != zUser.Username {
		body := map[string]any{"userName": *in.Username}
		if err := h.mgmtPUT(r.Context(), subject, resourceOwner, "username", body); err != nil {
			// Map a 409 from Zitadel ("username already in use") to a 409 we send
			// back so the frontend can surface "That username is taken."
			if strings.Contains(err.Error(), "already") || strings.Contains(err.Error(), "taken") ||
				strings.Contains(err.Error(), "CONFLICT") || strings.Contains(err.Error(), "409") {
				writeError(w, http.StatusConflict, "That username is taken.")
				return
			}
			writeError(w, http.StatusBadGateway, "update username: "+err.Error())
			return
		}
	}

	// ---- phone --------------------------------------------------------------
	if in.Phone != nil {
		phone := normalizePhone(*in.Phone)
		body := map[string]any{"phone": phone, "isPhoneVerified": false}
		if err := h.mgmtPUT(r.Context(), subject, resourceOwner, "phone", body); err != nil {
			writeError(w, http.StatusBadGateway, "update phone: "+err.Error())
			return
		}
	}

	// ---- email --------------------------------------------------------------
	emailVerificationSent := false
	newEmail := ""
	if in.Email != nil {
		trimmed := strings.TrimSpace(*in.Email)
		if !strings.EqualFold(trimmed, zUser.Human.Email.Email) {
			// isEmailVerified:false → Zitadel sends a verification email (SMTP
			// must be configured). Do NOT set isEmailVerified:true.
			body := map[string]any{"email": trimmed, "isEmailVerified": false}
			if err := h.mgmtPUT(r.Context(), subject, resourceOwner, "email", body); err != nil {
				writeError(w, http.StatusBadGateway, "update email: "+err.Error())
				return
			}
			emailVerificationSent = true
			newEmail = trimmed
		}
	}

	// ---- sync grown.users.display_name --------------------------------------
	// Update only when a name field actually changed.
	if (in.GivenName != nil || in.FamilyName != nil) && h.usersRepo != nil {
		given := deref(in.GivenName, zUser.Human.Profile.GivenName)
		family := deref(in.FamilyName, zUser.Human.Profile.FamilyName)
		displayName := strings.TrimSpace(given + " " + family)
		if displayName == "" {
			displayName = given
		}
		if displayName == "" {
			displayName = family
		}
		// Best-effort — a sync failure does not abort the response.
		if displayName != "" {
			_, _ = h.usersRepo.UpsertByOIDC(r.Context(), users.UpsertInput{
				OrgID:       u.OrgID,
				OIDCIssuer:  u.OIDCIssuer,
				OIDCSubject: u.OIDCSubject,
				Email:       u.Email,
				DisplayName: displayName,
			})
		}
	}

	resp := PatchResponse{
		OK:                    true,
		EmailVerificationSent: emailVerificationSent,
		Email:                 newEmail,
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---- Zitadel helpers --------------------------------------------------------

// zitadelUser is the JSON shape of GET /v2/users/{subject}.
type zitadelUser struct {
	Username string `json:"username"`
	Details  struct {
		ResourceOwner string `json:"resourceOwner"`
	} `json:"details"`
	Human struct {
		Profile struct {
			GivenName   string `json:"givenName"`
			FamilyName  string `json:"familyName"`
			DisplayName string `json:"displayName"`
		} `json:"profile"`
		Email struct {
			Email      string `json:"email"`
			IsVerified bool   `json:"isVerified"`
		} `json:"email"`
		Phone struct {
			Phone      string `json:"phone"`
			IsVerified bool   `json:"isVerified"`
		} `json:"phone"`
	} `json:"human"`
}

// fetchZitadelUser reads the user record from GET /v2/users/{subject}.
func (h *Handler) fetchZitadelUser(ctx context.Context, subject string) (zitadelUser, error) {
	resp, err := h.upstream(ctx, http.MethodGet, "/v2/users/"+subject, nil, "")
	if err != nil {
		return zitadelUser{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		return zitadelUser{}, fmt.Errorf("Zitadel GET /v2/users/%s: %d %s", subject, resp.StatusCode, body)
	}
	var wrapper struct {
		User zitadelUser `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&wrapper); err != nil {
		return zitadelUser{}, err
	}
	return wrapper.User, nil
}

// mgmtPUT issues PUT /management/v1/users/{id}/{field} with the org-id header.
// It returns a non-nil error for non-2xx responses (message includes the HTTP
// status and Zitadel's own message so the caller can inspect it).
func (h *Handler) mgmtPUT(ctx context.Context, subject, resourceOwner, field string, body any) error {
	path := fmt.Sprintf("/management/v1/users/%s/%s", subject, field)
	resp, err := h.upstream(ctx, http.MethodPut, path, body, resourceOwner)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		// Preserve the HTTP status code in the message so callers can detect 409.
		msg := fmt.Sprintf("%d", resp.StatusCode)
		var zErr struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(data, &zErr) == nil && zErr.Message != "" {
			msg = msg + " " + zErr.Message
		} else if len(data) > 0 {
			msg = msg + " " + string(data)
		}
		return fmt.Errorf("%s", msg)
	}
	return nil
}

// upstream issues an authenticated request to the Zitadel API.
//   - orgID is written as the x-zitadel-orgid header (management v1 requires it);
//     pass "" to omit it (v2 endpoints do not need it).
func (h *Handler) upstream(ctx context.Context, method, path string, body any, orgID string) (*http.Response, error) {
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

// ---- helpers ----------------------------------------------------------------

// normalizePhone does a best-effort normalization: strips whitespace and common
// punctuation, ensures a leading "+" for international numbers. We do NOT fail
// on format errors — Zitadel will reject truly invalid numbers with its own
// error, which is surfaced as a 502.
func normalizePhone(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return s
	}
	// Strip common separators but keep the leading +.
	clean := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "", ".", "").Replace(s)
	if clean != "" && clean[0] != '+' {
		// If the number starts with a digit, assume it needs a + prefix to be
		// E.164; leave it for Zitadel to validate rather than guessing the country.
		// Numbers that already start with 00 (international prefix) are kept as-is.
	}
	return clean
}

// deref returns *s if s is non-nil, otherwise fallback.
func deref(s *string, fallback string) string {
	if s != nil {
		return *s
	}
	return fallback
}

// decodeBody reads a JSON request body into v. An empty body is allowed.
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
