package convert

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"code.pick.haus/grown/grown/internal/auth"
)

// Routes served by Handler.
const (
	CapabilitiesPath = "/api/v1/convert/capabilities"
	OfficePath       = "/api/v1/convert/office"
)

// Handler serves the two converter endpoints. It must sit behind the auth
// middleware; it also refuses callers without a user in context.
//
//	GET  /api/v1/convert/capabilities       → Capabilities JSON (always 200)
//	POST /api/v1/convert/office?from=doc    → body: file bytes; 200 with the
//	     docx/xlsx/pptx package, 404 when disabled, 400/413/415/422/503/504 on errors
func Handler(c *Converter) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := auth.UserFromContext(r.Context()); !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case r.URL.Path == CapabilitiesPath && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "private, max-age=300")
			_ = json.NewEncoder(w).Encode(c.Capabilities())
		case r.URL.Path == OfficePath && r.Method == http.MethodPost:
			serveOffice(w, r, c)
		default:
			http.NotFound(w, r)
		}
	})
}

func serveOffice(w http.ResponseWriter, r *http.Request, c *Converter) {
	if !c.Enabled() {
		http.Error(w, "libreoffice conversion is not enabled", http.StatusNotFound)
		return
	}
	from := strings.ToLower(r.URL.Query().Get("from"))
	to, ok := TargetFor(from)
	if !ok {
		http.Error(w, "unsupported format", http.StatusUnsupportedMediaType)
		return
	}
	if want := r.URL.Query().Get("to"); want != "" && want != string(to) {
		http.Error(w, fmt.Sprintf(".%s converts to %s, not %s", from, to, want), http.StatusBadRequest)
		return
	}
	// Read one byte past the cap so an oversize upload is a 413, not a
	// silently truncated (and then corrupt) file.
	data, err := io.ReadAll(io.LimitReader(r.Body, c.MaxInput()+1))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	if int64(len(data)) > c.MaxInput() {
		http.Error(w, fmt.Sprintf("file too large (max %d bytes)", c.MaxInput()), http.StatusRequestEntityTooLarge)
		return
	}
	out, target, err := c.Convert(r.Context(), data, from)
	if err != nil {
		http.Error(w, err.Error(), statusFor(err))
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		name = "converted"
	}
	w.Header().Set("Content-Type", target.MIME())
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name+"."+string(target)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

func statusFor(err error) int {
	switch {
	case errors.Is(err, ErrDisabled):
		return http.StatusNotFound
	case errors.Is(err, ErrUnsupported):
		return http.StatusUnsupportedMediaType
	case errors.Is(err, ErrTooLarge):
		return http.StatusRequestEntityTooLarge
	case errors.Is(err, ErrBadInput):
		return http.StatusUnprocessableEntity
	case errors.Is(err, ErrBusy):
		return http.StatusServiceUnavailable
	case errors.Is(err, ErrTimeout):
		return http.StatusGatewayTimeout
	}
	return http.StatusInternalServerError
}
