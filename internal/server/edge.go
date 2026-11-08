package server

import (
	"bufio"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"code.pick.haus/grown/grown/internal/audit"
)

// edgeOptions configures the outermost HTTP middlewares (security headers and
// access logging). Zero value = headers on (no HSTS), access log on.
type edgeOptions struct {
	// HSTS adds Strict-Transport-Security. Only enable when the app is served
	// exclusively over HTTPS (it is tied to secure session cookies).
	HSTS bool
	// FrameOptions is the X-Frame-Options value; "" disables the header.
	FrameOptions string
	// AccessLog emits one structured log line per request.
	AccessLog bool
}

// edgeOptionsFromEnv reads GROWN_FRAME_OPTIONS (default SAMEORIGIN; "off"
// disables it, e.g. if another origin must embed grown in an iframe) and
// GROWN_ACCESS_LOG (default on; "off"/"false"/"0" disables).
func edgeOptionsFromEnv(hsts bool) edgeOptions {
	o := edgeOptions{HSTS: hsts, FrameOptions: "SAMEORIGIN", AccessLog: true}
	if v, ok := os.LookupEnv("GROWN_FRAME_OPTIONS"); ok {
		v = strings.TrimSpace(v)
		switch strings.ToLower(v) {
		case "", "off", "false", "0", "none":
			o.FrameOptions = ""
		default:
			o.FrameOptions = v
		}
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("GROWN_ACCESS_LOG"))) {
	case "off", "false", "0", "no":
		o.AccessLog = false
	}
	return o
}

// securityHeaders sets baseline response headers on every response. They are
// set BEFORE the inner handler runs, so a handler that needs something stricter
// or different (e.g. the sandboxed asset CSPs, or games' frame-ancestors) simply
// overwrites them with Header().Set.
func securityHeaders(next http.Handler, o edgeOptions) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		if o.FrameOptions != "" {
			h.Set("X-Frame-Options", o.FrameOptions)
		}
		if o.HSTS {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

// accessLog writes one slog line per request with the real client IP
// (CF-Connecting-IP behind the Cloudflare tunnel), country, method, path,
// status, bytes and latency. The query string is deliberately NOT logged: it
// carries signed stream URLs, OAuth codes and share passwords. Health checks
// are skipped to keep the log readable.
func accessLog(next http.Handler, o edgeOptions) http.Handler {
	if !o.AccessLog {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		lw := &logWriter{ResponseWriter: w}
		next.ServeHTTP(lw, r)
		status := lw.status
		if status == 0 {
			status = http.StatusOK
		}
		if lw.hijacked {
			status = http.StatusSwitchingProtocols
		}
		slog.Info("http",
			"method", r.Method,
			"host", r.Host,
			"path", r.URL.Path,
			"status", status,
			"bytes", lw.bytes,
			"dur_ms", time.Since(start).Milliseconds(),
			"ip", audit.ClientIP(r),
			"country", r.Header.Get("CF-IPCountry"),
			"ua", r.UserAgent(),
		)
	})
}

// logWriter records status/bytes while staying transparent to streaming
// (Flush), WebSocket upgrades (Hijack) and http.ResponseController (Unwrap).
type logWriter struct {
	http.ResponseWriter
	status   int
	bytes    int64
	hijacked bool
}

func (l *logWriter) WriteHeader(code int) {
	if l.status == 0 {
		l.status = code
	}
	l.ResponseWriter.WriteHeader(code)
}

func (l *logWriter) Write(b []byte) (int, error) {
	if l.status == 0 {
		l.status = http.StatusOK
	}
	n, err := l.ResponseWriter.Write(b)
	l.bytes += int64(n)
	return n, err
}

func (l *logWriter) Flush() {
	if f, ok := l.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (l *logWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := l.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("accesslog: underlying ResponseWriter does not support hijacking")
	}
	c, rw, err := hj.Hijack()
	if err == nil {
		l.hijacked = true
	}
	return c, rw, err
}

func (l *logWriter) Unwrap() http.ResponseWriter { return l.ResponseWriter }
