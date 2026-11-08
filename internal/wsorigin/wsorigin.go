// Package wsorigin is the single Origin policy for grown's browser-facing
// WebSocket endpoints (docs/sheets/slides/whiteboards/chat/projects/meet/
// telephony collab and signaling hubs).
//
// These sockets authenticate with the session cookie, so accepting any Origin
// (websocket.AcceptOptions.InsecureSkipVerify) lets a page on another origin
// open an authenticated socket in the victim's browser (cross-site WebSocket
// hijacking). The session cookie is SameSite=Lax with Domain=<apex>, so every
// sibling subdomain counts as "same-site" and would still carry it.
//
// AcceptOptions keeps coder/websocket's default check: the Origin header's host
// must equal the request Host (the browser-visible host; the edge preserves
// it). Requests without an Origin header (non-browser clients) are allowed,
// as before. Extra trusted origins can be listed, comma-separated, in
// GROWN_WS_ALLOWED_ORIGINS as host patterns (path.Match syntax, e.g.
// "localhost:5173" or "*.localtest.me").
package wsorigin

import (
	"os"
	"strings"
	"sync"

	"github.com/coder/websocket"
)

// EnvAllowedOrigins names the env var with extra allowed Origin host patterns.
const EnvAllowedOrigins = "GROWN_WS_ALLOWED_ORIGINS"

var (
	once     sync.Once
	patterns []string
)

// AcceptOptions returns the options every grown WebSocket Accept should use.
// A fresh struct is returned so callers may set other fields.
func AcceptOptions() *websocket.AcceptOptions {
	once.Do(func() { patterns = parse(os.Getenv(EnvAllowedOrigins)) })
	return &websocket.AcceptOptions{OriginPatterns: append([]string(nil), patterns...)}
}

func parse(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
