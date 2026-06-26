package honeypot

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"
)

// clientIP extracts a best-effort client IP, preferring the edge-set headers
// (the site sits behind a Cloudflare tunnel) over the raw socket:
//
//  1. CF-Connecting-IP  — Cloudflare's authoritative client IP.
//  2. X-Forwarded-First — a single pre-extracted first hop, if a proxy set it.
//  3. X-Forwarded-For   — first (left-most) entry of the comma list.
//  4. r.RemoteAddr      — the socket peer (host part only).
//
// Returns "" when nothing usable is present; the caller still records the alert.
func clientIP(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); v != "" {
		return v
	}
	if v := strings.TrimSpace(r.Header.Get("X-Forwarded-First")); v != "" {
		return v
	}
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		if first := strings.TrimSpace(strings.Split(v, ",")[0]); first != "" {
			return first
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

// alertFromRequest builds an Alert from the request's edge metadata.
func alertFromRequest(r *http.Request, kind, detail string) Alert {
	return Alert{
		Kind:      kind,
		Path:      r.URL.Path,
		Method:    r.Method,
		IP:        clientIP(r),
		Country:   strings.TrimSpace(r.Header.Get("CF-IPCountry")),
		UserAgent: r.Header.Get("User-Agent"),
		Detail:    detail,
	}
}

// notFoundHTML is the body returned for a tripped decoy path. It is a plain,
// generic 404 — deliberately indistinguishable from any other missing path so a
// prober gets no signal that they hit a trap.
const notFoundHTML = "404 page not found\n"

// scanStatusWriter wraps http.ResponseWriter to capture the response status so
// the middleware can feed 404s to the per-IP burst tracker. It forwards Flush so
// streaming/range responses keep working through the outermost wrapper.
type scanStatusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (s *scanStatusWriter) WriteHeader(code int) {
	if !s.wrote {
		s.status = code
		s.wrote = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *scanStatusWriter) Write(b []byte) (int, error) {
	if !s.wrote {
		s.status = http.StatusOK
		s.wrote = true
	}
	return s.ResponseWriter.Write(b)
}

func (s *scanStatusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack forwards connection takeover to the underlying ResponseWriter so
// WebSocket upgrades keep working through this outermost wrapper. Embedding the
// http.ResponseWriter INTERFACE hides the concrete writer's Hijacker, so without
// this method coder/websocket (and any hijacking handler) sees a non-Hijacker
// and fails the upgrade with 501 Not Implemented — which silently broke the
// game-room relay and collab WebSockets.
func (s *scanStatusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := s.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, errors.New("honeypot: underlying ResponseWriter does not support hijacking")
}

// Middleware mounts the intrusion tripwire at the OUTERMOST layer:
//
//  1. EXACT decoy paths (IsDecoyPath) are short-circuited with a canned 404 and
//     a decoy_path alert — these paths no real route serves.
//  2. SCAN signals (probe paths, scanner UAs, traversal/null-byte) are recorded
//     (api_scan / bad_ua / path_traversal) but ALWAYS fall through to next, so a
//     real route is never shadowed and a false positive can't break a request.
//  3. A per-IP 404-burst tracker watches the downstream response status and
//     records ONE scan_burst alert per window when an IP exceeds the threshold.
//
// All recording is best-effort + async (Store.Record); a nil Store no-ops the
// alerts but the pass-through behavior is unchanged.
func (s *Store) Middleware(next http.Handler) http.Handler {
	tracker := newBurstTracker()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 1. Exact decoy paths: canned 404, never reaches real routing.
		if IsDecoyPath(r.URL.Path) {
			s.Record(alertFromRequest(r, KindDecoyPath, ""))
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(notFoundHTML))
			return
		}

		// 2. Scan signals: record but PASS THROUGH (do not shadow real routes).
		if kind, detail := classifyScan(r); kind != "" {
			s.Record(alertFromRequest(r, kind, detail))
		}

		// 3. Run the real handler, observing its status for the 404-burst tracker.
		sw := &scanStatusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		if sw.status == http.StatusNotFound {
			if tracker.record404(clientIP(r), time.Now()) {
				s.Record(alertFromRequest(r, KindScanBurst, "exceeded 404 burst threshold"))
			}
		}
	})
}

// hiddenFormFields are the trap field names. A real (human-driven) client never
// fills these in — they are rendered invisible — so any non-empty value marks a
// bot. company_website is the classic honeypot name; hp_token is an alternate.
var hiddenFormFields = []string{"company_website", "hp_token"}

// FormHandler serves the public POST /api/v1/honeypot trap. It accepts either a
// JSON body or a form-encoded body; if any hidden field is non-empty it records
// a kind="form_bot" alert. It ALWAYS returns 204 (even on a clean submission or
// a parse error) so a bot gets no signal. Best-effort throughout.
func (s *Store) FormHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if tripped, field := s.checkHiddenFields(r); tripped {
			s.Record(alertFromRequest(r, KindFormBot, "hidden field: "+field))
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// checkHiddenFields reports whether any hidden honeypot field on the request is
// non-empty, returning the first tripped field name. It tolerates JSON and
// form-encoded bodies and never errors out (a malformed body simply does not
// trip).
func (s *Store) checkHiddenFields(r *http.Request) (bool, string) {
	ct := r.Header.Get("Content-Type")
	if strings.Contains(ct, "application/json") {
		var body map[string]any
		if json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20)).Decode(&body) == nil {
			for _, f := range hiddenFormFields {
				if v, ok := body[f]; ok {
					if str, ok := v.(string); ok && strings.TrimSpace(str) != "" {
						return true, f
					}
				}
			}
		}
		return false, ""
	}
	// Form-encoded (or anything ParseForm understands).
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<20)
	if err := r.ParseForm(); err == nil {
		for _, f := range hiddenFormFields {
			if strings.TrimSpace(r.Form.Get(f)) != "" {
				return true, f
			}
		}
	}
	return false, ""
}

// TripHiddenFields lets other handlers (e.g. the in-app login) reuse the same
// hidden-field trap: pass the candidate field values and, if any is non-empty,
// it records a form_bot alert against the request. Returns true when tripped.
// Best-effort; safe to ignore the result.
func (s *Store) TripHiddenFields(r *http.Request, fields map[string]string) bool {
	for _, f := range hiddenFormFields {
		if strings.TrimSpace(fields[f]) != "" {
			s.Record(alertFromRequest(r, KindFormBot, "hidden field: "+f))
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Admin surface — listing + counts + clear, admin-gated. Mirrors the
// Identity/IsAdmin gate used by adminanalytics and gamerooms.
// ---------------------------------------------------------------------------

// Identity resolves the calling admin off the request context. server.go injects
// a closure backed by auth.UserFromContext + the org_admins/allowlist check,
// keeping this package free of internal/auth's gen/ dependency (same pattern as
// adminanalytics and gamerooms).
type Identity struct {
	// Caller returns the caller's grown email and whether a session is present.
	Caller func(ctx context.Context) (email string, ok bool)
	// IsAdmin reports whether the caller is a grown admin (allowlist or org_admins).
	IsAdmin func(ctx context.Context) bool
}

// AdminHandler is the admin-gated control surface at /api/v1/admin/honeypot:
//
//	GET    /api/v1/admin/honeypot          – recent alerts + counts
//	DELETE /api/v1/admin/honeypot          – clear/acknowledge all alerts
//
// Mounted INSIDE grown's auth middleware in server.go, so the caller's session
// is resolvable from the request context.
type AdminHandler struct {
	store    *Store
	identity Identity
}

// NewAdminHandler constructs the admin handler over a store.
func NewAdminHandler(store *Store, id Identity) *AdminHandler {
	return &AdminHandler{store: store, identity: id}
}

func (h *AdminHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Authorize: a present session whose caller IsAdmin. No open fallback.
	ok := false
	if h.identity.Caller != nil {
		_, ok = h.identity.Caller(r.Context())
	}
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "no session"})
		return
	}
	if h.identity.IsAdmin == nil || !h.identity.IsAdmin(r.Context()) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "admin privileges required"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		alerts, err := h.store.ListRecent(r.Context(), 200)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"alerts": alerts,
			"counts": h.store.CountSummary(r.Context()),
		})
	case http.MethodDelete:
		n, err := h.store.Clear(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"cleared": n})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
