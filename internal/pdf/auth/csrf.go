package auth

import (
	"net/http"
	"strings"
)

// CSRFRequiredHeader is the value the frontend must send on state-changing
// /api/* requests when authenticating via cookie. Browsers can't set custom
// headers cross-origin without a CORS preflight, which the server denies
// for unknown origins — making this a lightweight CSRF gate.
const CSRFRequiredHeader = "pdf-frontend"

// CSRFMiddleware blocks state-changing /api/* requests that arrive without
// either:
//   - an Authorization header (proves the caller is not relying on browser
//     cookies; service-to-service flows pass through), or
//   - an X-Requested-With header matching CSRFRequiredHeader (proves the
//     caller is the same-origin frontend, since cross-origin pages can't
//     set custom headers without preflight, which CORS denies).
//
// GET/HEAD/OPTIONS pass through unchanged — they must remain idempotent
// per REST conventions.
func CSRFMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}

		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}

		if r.Header.Get("Authorization") != "" {
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("X-Requested-With") == CSRFRequiredHeader {
			next.ServeHTTP(w, r)
			return
		}

		http.Error(w, "CSRF protection: missing X-Requested-With header", http.StatusForbidden)
	})
}
