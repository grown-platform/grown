package audit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientIP(t *testing.T) {
	cases := []struct {
		name       string
		xff        string
		remoteAddr string
		want       string
	}{
		{"xff single", "203.0.113.7", "10.0.0.1:1234", "203.0.113.7"},
		{"xff multi takes first hop", "203.0.113.7, 70.41.3.18, 150.172.238.178", "10.0.0.1:1234", "203.0.113.7"},
		{"xff trims spaces", "  203.0.113.7  ", "10.0.0.1:1234", "203.0.113.7"},
		{"no xff strips port", "", "192.168.1.5:5678", "192.168.1.5"},
		{"no xff no port falls back to raw", "", "unparseable", "unparseable"},
		{"ipv6 remoteaddr", "", "[::1]:443", "::1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.RemoteAddr = c.remoteAddr
			if c.xff != "" {
				r.Header.Set("X-Forwarded-For", c.xff)
			}
			if got := clientIP(r); got != c.want {
				t.Errorf("clientIP() = %q, want %q", got, c.want)
			}
		})
	}
}

func TestResourceFromPath_Extra(t *testing.T) {
	// Complements TestResourceFromPath in interceptor_test.go with edge cases.
	cases := map[string]string{
		"/content":                     "", // no segment before /content
		"/a/b/c/content":               "c",
		"/api/v1/files/x-1/content///": "x-1", // trailing slashes trimmed
		"/api/v1/files":                "",
		"":                             "",
		"/content/extra":               "",
	}
	for in, want := range cases {
		if got := resourceFromPath(in); got != want {
			t.Errorf("resourceFromPath(%q) = %q, want %q", in, got, want)
		}
	}
}

// fakeFlusher lets us assert statusRecorder.Flush forwards to an underlying
// http.Flusher.
type fakeFlusher struct {
	http.ResponseWriter
	flushed bool
}

func (f *fakeFlusher) Flush() { f.flushed = true }

func TestStatusRecorder_WriteHeader(t *testing.T) {
	t.Run("captures first status only", func(t *testing.T) {
		rr := httptest.NewRecorder()
		sr := &statusRecorder{ResponseWriter: rr, status: http.StatusOK}
		sr.WriteHeader(http.StatusForbidden)
		sr.WriteHeader(http.StatusTeapot) // ignored
		if sr.status != http.StatusForbidden {
			t.Errorf("status = %d, want 403", sr.status)
		}
		if !sr.wrote {
			t.Error("wrote should be true")
		}
	})

	t.Run("Write without WriteHeader implies 200", func(t *testing.T) {
		rr := httptest.NewRecorder()
		sr := &statusRecorder{ResponseWriter: rr, status: 0}
		n, err := sr.Write([]byte("hi"))
		if err != nil || n != 2 {
			t.Fatalf("Write = (%d,%v)", n, err)
		}
		if sr.status != http.StatusOK {
			t.Errorf("status = %d, want 200", sr.status)
		}
		if rr.Body.String() != "hi" {
			t.Errorf("body = %q", rr.Body.String())
		}
	})

	t.Run("WriteHeader then Write keeps original status", func(t *testing.T) {
		rr := httptest.NewRecorder()
		sr := &statusRecorder{ResponseWriter: rr, status: http.StatusOK}
		sr.WriteHeader(http.StatusCreated)
		_, _ = sr.Write([]byte("x"))
		if sr.status != http.StatusCreated {
			t.Errorf("status = %d, want 201", sr.status)
		}
	})
}

func TestStatusRecorder_Flush(t *testing.T) {
	t.Run("forwards when underlying flushes", func(t *testing.T) {
		ff := &fakeFlusher{ResponseWriter: httptest.NewRecorder()}
		sr := &statusRecorder{ResponseWriter: ff}
		sr.Flush()
		if !ff.flushed {
			t.Error("Flush did not forward to underlying flusher")
		}
	})
	t.Run("no-op when underlying does not flush", func(t *testing.T) {
		// A bare writer without Flush must not panic.
		sr := &statusRecorder{ResponseWriter: nonFlusher{}}
		sr.Flush()
	})
}

type nonFlusher struct{}

func (nonFlusher) Header() http.Header         { return http.Header{} }
func (nonFlusher) Write(b []byte) (int, error) { return len(b), nil }
func (nonFlusher) WriteHeader(int)             {}

// TestRecorder_Log_NilShortCircuit verifies Log returns the handler unchanged
// when the recorder (or its repo) is nil, so wiring audit off is transparent.
func TestRecorder_Log_NilShortCircuit(t *testing.T) {
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})

	t.Run("nil recorder returns same handler", func(t *testing.T) {
		var nilRec *Recorder
		got := nilRec.Log("video", "create", inner)
		// Should be the exact same handler value.
		rr := httptest.NewRecorder()
		got.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/", nil))
		if !called || rr.Code != http.StatusNoContent {
			t.Errorf("inner handler not invoked transparently (called=%v code=%d)", called, rr.Code)
		}
	})

	t.Run("nil repo returns handler unchanged", func(t *testing.T) {
		rec := NewRecorder(nil, nil)
		got := rec.Log("video", "create", inner)
		rr := httptest.NewRecorder()
		got.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/", nil))
		if rr.Code != http.StatusNoContent {
			t.Errorf("code = %d", rr.Code)
		}
	})
}

// TestRecorder_Log_WrapsAndRecords exercises the wrapping path (repo present but
// nil pool, so Record's Insert is a no-op). It asserts the inner handler still
// runs and the response is passed through unchanged, across ok/error statuses.
// The status->ok/error mapping in Log is exercised but not directly observable
// (the insert is a no-op); we assert the response passthrough and that the
// recorder's resolver is consulted, proving Record ran.
func TestRecorder_Log_WrapsAndRecords(t *testing.T) {
	cases := []struct {
		name      string
		innerCode int
	}{
		{"2xx", http.StatusOK},
		{"3xx", http.StatusMovedPermanently},
		{"4xx", http.StatusForbidden},
		{"5xx", http.StatusInternalServerError},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ran := false
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				ran = true
				w.WriteHeader(c.innerCode)
				_, _ = w.Write([]byte("body"))
			})
			resolved := false
			rec := NewRecorder(NewRepository(nil), func(context.Context) (Actor, bool) {
				resolved = true
				return Actor{OrgID: "o", UserID: "u", Email: "e@x.com"}, true
			})
			wrapped := rec.Log("video", "download", inner)

			req := httptest.NewRequest(http.MethodGet, "/api/v1/videos/v1/content", nil)
			req.Header.Set("X-Forwarded-For", "1.2.3.4")
			rr := httptest.NewRecorder()
			wrapped.ServeHTTP(rr, req)

			if !ran {
				t.Error("inner handler did not run")
			}
			if rr.Code != c.innerCode {
				t.Errorf("status passthrough = %d, want %d", rr.Code, c.innerCode)
			}
			if rr.Body.String() != "body" {
				t.Errorf("body = %q, want %q", rr.Body.String(), "body")
			}
			if !resolved {
				t.Error("Record did not run (resolver never consulted)")
			}
		})
	}
}
