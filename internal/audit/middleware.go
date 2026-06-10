package audit

import (
	"net"
	"net/http"
	"strings"
)

// statusRecorder wraps http.ResponseWriter to capture the status code written by
// the wrapped handler, so the audit row can record ok/error. It forwards
// Flush/Hijack-free; the raw routes we wrap (uploads/downloads/streams) use
// plain Write + WriteHeader, and streaming handlers call Write which implies a
// 200 unless WriteHeader was called first.
type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.wrote {
		s.status = code
		s.wrote = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.wrote {
		s.status = http.StatusOK
		s.wrote = true
	}
	return s.ResponseWriter.Write(b)
}

// Flush implements http.Flusher when the underlying writer does, so range/stream
// responses (video/music) keep working through the wrapper.
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Log wraps an http.Handler so that, AFTER it serves, an audit event for the
// given service/action is recorded (best-effort). It captures the client IP
// (X-Forwarded-For first hop, else RemoteAddr), the user agent, and a resource
// id sniffed from the path when present (e.g. the {id} in
// /api/v1/videos/{id}/content). Records via the Recorder closed over by the
// caller — pass the same recorder used by the gRPC interceptor.
//
// A nil recorder yields the handler unchanged.
func (rec *Recorder) Log(service, action string, h http.Handler) http.Handler {
	if rec == nil || rec.repo == nil {
		return h
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sr := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		h.ServeHTTP(sr, r)

		st := "ok"
		if sr.status >= 400 {
			st = "error"
		}
		rec.Record(r.Context(), Event{
			Service:      service,
			Action:       action,
			ResourceType: service,
			ResourceID:   resourceFromPath(r.URL.Path),
			Method:       r.Method + " " + r.URL.Path,
			Status:       st,
			Detail:       map[string]any{"http_status": sr.status},
			IP:           clientIP(r),
			UserAgent:    r.UserAgent(),
		})
	})
}

// clientIP returns the best-guess client IP: the first hop of X-Forwarded-For
// when present (the original client behind grown's tunnel/proxy), else the
// connection's RemoteAddr with the port stripped.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// resourceFromPath pulls a resource id out of the raw-route paths we wrap. These
// follow two shapes:
//
//	/api/v1/{collection}/{id}/content   → returns {id}   (downloads/streams)
//	/api/v1/{collection}/upload         → returns ""     (uploads: id not yet known)
//
// Anything else returns "" (best-effort; the row is still recorded).
func resourceFromPath(path string) string {
	path = strings.TrimRight(path, "/")
	// /content suffix: the id is the segment before it.
	if strings.HasSuffix(path, "/content") {
		trimmed := strings.TrimSuffix(path, "/content")
		if i := strings.LastIndex(trimmed, "/"); i >= 0 {
			return trimmed[i+1:]
		}
	}
	return ""
}
