package wsorigin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func serve(opts *websocket.AcceptOptions) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, opts)
		if err != nil {
			return
		}
		_ = c.Close(websocket.StatusNormalClosure, "")
	}))
}

func dial(t *testing.T, srv *httptest.Server, origin string) (*http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h := http.Header{}
	if origin != "" {
		h.Set("Origin", origin)
	}
	c, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), &websocket.DialOptions{HTTPHeader: h})
	if err == nil {
		_ = c.CloseNow()
	}
	return resp, err
}

func TestAcceptOptionsRejectsCrossOrigin(t *testing.T) {
	srv := serve(&websocket.AcceptOptions{OriginPatterns: parse("")})
	defer srv.Close()
	host := strings.TrimPrefix(srv.URL, "http://")

	if _, err := dial(t, srv, ""); err != nil {
		t.Fatalf("no Origin (non-browser client) should be accepted: %v", err)
	}
	if _, err := dial(t, srv, "http://"+host); err != nil {
		t.Fatalf("same-host Origin should be accepted: %v", err)
	}
	resp, err := dial(t, srv, "https://evil.example")
	if err == nil {
		t.Fatal("cross-origin handshake was accepted")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin status = %v, want 403", resp)
	}
	if _, err := dial(t, srv, "https://sibling.pick.haus"); err == nil {
		t.Fatal("sibling-subdomain Origin was accepted")
	}
}

func TestAllowedOriginPatterns(t *testing.T) {
	srv := serve(&websocket.AcceptOptions{OriginPatterns: parse(" localhost:5173 , *.localtest.me ,")})
	defer srv.Close()
	for _, o := range []string{"http://localhost:5173", "http://app.localtest.me"} {
		if _, err := dial(t, srv, o); err != nil {
			t.Errorf("Origin %s should be allowed: %v", o, err)
		}
	}
	if _, err := dial(t, srv, "https://evil.example"); err == nil {
		t.Error("unlisted Origin was accepted")
	}
}

func TestAcceptOptionsReturnsCopy(t *testing.T) {
	a := AcceptOptions()
	a.OriginPatterns = append(a.OriginPatterns, "mutated")
	for _, p := range AcceptOptions().OriginPatterns {
		if p == "mutated" {
			t.Fatal("AcceptOptions shares its pattern slice between callers")
		}
	}
}
