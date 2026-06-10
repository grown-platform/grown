package orgadminhttp

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// maxOrgNameLen bounds an org display name.
const maxOrgNameLen = 200

// renameOrgRequest is the PATCH /api/v1/admin/org body.
type renameOrgRequest struct {
	DisplayName string `json:"display_name"`
}

// renameOrg updates the caller's org display_name (slug stays stable). Admin-gated.
func (h *Handler) renameOrg(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	c, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}
	if h.orgs == nil {
		writeError(w, http.StatusServiceUnavailable, "org settings unavailable")
		return
	}
	var in renameOrgRequest
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	name := strings.TrimSpace(in.DisplayName)
	if name == "" {
		writeError(w, http.StatusBadRequest, "display_name is required")
		return
	}
	if len(name) > maxOrgNameLen {
		writeError(w, http.StatusBadRequest, "display_name is too long")
		return
	}
	org, err := h.orgs.UpdateDisplayName(r.Context(), c.orgID, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "rename org: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"org": map[string]any{
			"id":           org.ID,
			"slug":         org.Slug,
			"display_name": org.DisplayName,
		},
	})
}

// ---- Branding --------------------------------------------------------------

// brandingOut is the JSON branding shape. accent_color is "" when unset; has_logo
// tells the SPA whether to fetch /api/v1/org/branding/logo.
type brandingOut struct {
	AccentColor string `json:"accent_color"`
	HasLogo     bool   `json:"has_logo"`
	ProductName string `json:"product_name"`
}

// adminBranding serves GET (current branding for editing) and PATCH (set accent
// color). Admin-gated.
func (h *Handler) adminBranding(w http.ResponseWriter, r *http.Request) {
	c, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}
	if h.branding == nil {
		writeError(w, http.StatusServiceUnavailable, "branding unavailable")
		return
	}
	switch r.Method {
	case http.MethodGet:
		b, err := h.branding.Get(r.Context(), c.orgID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, brandingOut{AccentColor: b.AccentColor, HasLogo: b.LogoBlobKey != "", ProductName: b.ProductName})
	case http.MethodPatch:
		var in struct {
			AccentColor *string `json:"accent_color"`
			ProductName *string `json:"product_name"`
		}
		if err := decodeBody(r, &in); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if in.AccentColor != nil {
			accent := strings.TrimSpace(*in.AccentColor)
			if accent != "" && !isHexColor(accent) {
				writeError(w, http.StatusBadRequest, "accent_color must be a hex color like #3F704D")
				return
			}
			if err := h.branding.SetAccentColor(r.Context(), c.orgID, accent); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		if in.ProductName != nil {
			name := strings.TrimSpace(*in.ProductName)
			if len(name) > 40 {
				writeError(w, http.StatusBadRequest, "product_name too long (max 40)")
				return
			}
			if err := h.branding.SetProductName(r.Context(), c.orgID, name); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		b, _ := h.branding.Get(r.Context(), c.orgID)
		writeJSON(w, http.StatusOK, brandingOut{AccentColor: b.AccentColor, HasLogo: b.LogoBlobKey != "", ProductName: b.ProductName})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// adminBrandingLogo serves POST (multipart upload) and DELETE (clear). Admin-gated.
func (h *Handler) adminBrandingLogo(w http.ResponseWriter, r *http.Request) {
	c, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}
	if h.branding == nil || h.blobs == nil {
		writeError(w, http.StatusServiceUnavailable, "logo storage unavailable")
		return
	}
	switch r.Method {
	case http.MethodPost:
		h.uploadLogo(w, r, c.orgID)
	case http.MethodDelete:
		if err := h.branding.SetLogo(r.Context(), c.orgID, "", ""); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// uploadLogo reads a multipart "file" field, stores it in the blob store under a
// per-org key, and records the key+mime. Accepts common image types only.
func (h *Handler) uploadLogo(w http.ResponseWriter, r *http.Request, orgID string) {
	if err := r.ParseMultipartForm(maxLogoBytes); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form: "+err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()
	if header.Size > maxLogoBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "logo too large (max 2 MiB)")
		return
	}
	mime := header.Header.Get("Content-Type")
	if !isAllowedLogoMIME(mime) {
		writeError(w, http.StatusUnsupportedMediaType, "logo must be PNG, JPEG, WEBP or SVG")
		return
	}
	suffix, err := randomHex(8)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Per-org key with a random suffix so a re-upload busts any CDN/proxy cache.
	key := "branding/" + orgID + "/logo-" + suffix
	if err := h.blobs.Put(r.Context(), key, mime, header.Size, file); err != nil {
		writeError(w, http.StatusBadGateway, "store logo: "+err.Error())
		return
	}
	if err := h.branding.SetLogo(r.Context(), orgID, key, mime); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "has_logo": true})
}

// publicBranding serves the active branding to any authenticated member (the SPA
// loads it at session start). Falls back to an empty (default) branding.
func (h *Handler) publicBranding(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	c, ok := h.caller(w, r)
	if !ok {
		return
	}
	if h.branding == nil || c.orgID == "" {
		writeJSON(w, http.StatusOK, brandingOut{})
		return
	}
	b, err := h.branding.Get(r.Context(), c.orgID)
	if err != nil {
		// Branding is non-critical at load; degrade to defaults rather than 500.
		writeJSON(w, http.StatusOK, brandingOut{})
		return
	}
	writeJSON(w, http.StatusOK, brandingOut{AccentColor: b.AccentColor, HasLogo: b.LogoBlobKey != "", ProductName: b.ProductName})
}

// publicBrandingLogo streams the org's logo blob to any authenticated member.
func (h *Handler) publicBrandingLogo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	c, ok := h.caller(w, r)
	if !ok {
		return
	}
	if h.branding == nil || h.blobs == nil || c.orgID == "" {
		writeError(w, http.StatusNotFound, "no logo")
		return
	}
	b, err := h.branding.Get(r.Context(), c.orgID)
	if err != nil || b.LogoBlobKey == "" {
		writeError(w, http.StatusNotFound, "no logo")
		return
	}
	body, mime, size, err := h.blobs.Get(r.Context(), b.LogoBlobKey)
	if err != nil {
		writeError(w, http.StatusNotFound, "no logo")
		return
	}
	defer body.Close()
	if mime == "" {
		mime = b.LogoMIME
	}
	if mime != "" {
		w.Header().Set("Content-Type", mime)
	}
	if size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	// Logos are per-org and rarely change; allow short private caching.
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, body)
}

// ---- small helpers ---------------------------------------------------------

// isHexColor reports whether s is a #RGB or #RRGGBB hex color.
func isHexColor(s string) bool {
	if len(s) != 4 && len(s) != 7 {
		return false
	}
	if s[0] != '#' {
		return false
	}
	for _, ch := range s[1:] {
		isHex := (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
		if !isHex {
			return false
		}
	}
	return true
}

// isAllowedLogoMIME restricts uploads to safe image types. SVG is allowed but
// served with its own content-type (and from a same-origin authed route).
func isAllowedLogoMIME(mime string) bool {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml", "image/gif":
		return true
	}
	return false
}

func randomHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", errors.New("rand: " + err.Error())
	}
	return hex.EncodeToString(buf), nil
}
