package server

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestSecurityHeadersDefaults(t *testing.T) {
	h := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), edgeOptions{HSTS: true, FrameOptions: "SAMEORIGIN"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	want := map[string]string{
		"X-Content-Type-Options":    "nosniff",
		"Referrer-Policy":           "strict-origin-when-cross-origin",
		"X-Frame-Options":           "SAMEORIGIN",
		"Strict-Transport-Security": "max-age=31536000",
	}
	for k, v := range want {
		if got := rec.Header().Get(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
}

func TestSecurityHeadersHandlerOverridesAndOptOut(t *testing.T) {
	h := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
	}), edgeOptions{})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if got := rec.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Errorf("handler override lost: %q", got)
	}
	if rec.Header().Get("X-Frame-Options") != "" || rec.Header().Get("Strict-Transport-Security") != "" {
		t.Errorf("disabled headers were set: %v", rec.Header())
	}
}

func TestEdgeOptionsFromEnv(t *testing.T) {
	t.Setenv("GROWN_FRAME_OPTIONS", "off")
	t.Setenv("GROWN_ACCESS_LOG", "false")
	o := edgeOptionsFromEnv(true)
	if o.FrameOptions != "" || o.AccessLog || !o.HSTS {
		t.Fatalf("unexpected options %+v", o)
	}
	t.Setenv("GROWN_FRAME_OPTIONS", "DENY")
	t.Setenv("GROWN_ACCESS_LOG", "")
	o = edgeOptionsFromEnv(false)
	if o.FrameOptions != "DENY" || !o.AccessLog || o.HSTS {
		t.Fatalf("unexpected options %+v", o)
	}
}

// syncBuf is a goroutine-safe log sink (hijacked handlers log after the
// client side has already returned).
type syncBuf struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncBuf) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

func (s *syncBuf) Len() int { return len(s.String()) }

func captureLog(t *testing.T) *syncBuf {
	t.Helper()
	buf := &syncBuf{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return buf
}

func TestAccessLogRecordsRequestWithoutQuery(t *testing.T) {
	buf := captureLog(t)
	h := accessLog(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("hi"))
	}), edgeOptions{AccessLog: true})
	r := httptest.NewRequest("GET", "/api/v1/x?token=SECRET", nil)
	r.Header.Set("CF-Connecting-IP", "198.51.100.7")
	r.Header.Set("X-Forwarded-For", "6.6.6.6")
	r.Header.Set("CF-IPCountry", "NL")
	h.ServeHTTP(httptest.NewRecorder(), r)
	out := buf.String()
	for _, want := range []string{"path=/api/v1/x", "status=418", "bytes=2", "ip=198.51.100.7", "country=NL"} {
		if !strings.Contains(out, want) {
			t.Errorf("log %q missing %q", out, want)
		}
	}
	if strings.Contains(out, "SECRET") {
		t.Errorf("query string leaked into access log: %q", out)
	}
}

func TestAccessLogSkipsHealthz(t *testing.T) {
	buf := captureLog(t)
	h := accessLog(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), edgeOptions{AccessLog: true})
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/healthz", nil))
	if buf.Len() != 0 {
		t.Errorf("healthz was logged: %q", buf.String())
	}
}

// TestAccessLogKeepsWebSocketsWorking: the outermost wrapper must forward
// Hijack, or every WebSocket upgrade fails with 501.
func TestAccessLogKeepsWebSocketsWorking(t *testing.T) {
	buf := captureLog(t)
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		_ = c.Write(r.Context(), websocket.MessageText, []byte("ok"))
		_ = c.Close(websocket.StatusNormalClosure, "")
	})
	srv := httptest.NewServer(accessLog(securityHeaders(inner, edgeOptions{FrameOptions: "SAMEORIGIN"}), edgeOptions{AccessLog: true}))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial through edge middleware: %v", err)
	}
	_, msg, err := c.Read(ctx)
	if err != nil || string(msg) != "ok" {
		t.Fatalf("read = %q, %v", msg, err)
	}
	_ = c.CloseNow()
	// The hijacked handler logs once it returns, asynchronously to the client.
	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(buf.String(), "status=101") {
		if time.Now().After(deadline) {
			t.Fatalf("upgrade not logged as 101: %q", buf.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
}
