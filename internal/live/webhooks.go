package live

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// Webhooks are the raw HTTP handlers MediaMTX calls server-to-server. They are
// NOT wrapped by grown's auth middleware (there is no grown session on these
// requests) — they must be mounted BEFORE the /api/ auth fallthrough in
// server.go, unwrapped. They depend only on the Repository, so this file is
// gen-free and builds independently of buf-generated code.
type Webhooks struct {
	repo *Repository
}

// NewWebhooks constructs the MediaMTX-facing handlers.
func NewWebhooks(repo *Repository) *Webhooks {
	return &Webhooks{repo: repo}
}

// authRequest is the JSON body MediaMTX POSTs to authHTTPAddress on every
// publish/read (and other actions). See MediaMTX authMethod: http.
//
// Fields we use: User/Password (credentials the client supplied), Action
// (publish|read|playback|api|metrics|pprof), Path (the MediaMTX path),
// Protocol, Query. The rest are accepted but ignored.
type authRequest struct {
	User     string `json:"user"`
	Password string `json:"password"`
	IP       string `json:"ip"`
	Action   string `json:"action"`
	Path     string `json:"path"`
	Protocol string `json:"protocol"`
	ID       string `json:"id"`
	Query    string `json:"query"`
}

// AuthHandler authorizes a MediaMTX publish/read.
//
//	POST /api/v1/live/auth
//
// Decision matrix:
//   - action=publish → the path must match a stream AND password (or, for some
//     clients, the query "?key=" / user) must equal that stream's stream_key →
//     200, else 401. This is the security boundary that stops a stranger from
//     hijacking a path: only someone holding the secret key can publish.
//   - action=read|playback → 200 if the stream is public. For org-visibility
//     streams we cannot see the grown session here (MediaMTX is the caller), so
//     we ALLOW read and rely on grown's reverse proxy to gate org access (the
//     /live-hls and /live-webrtc proxies sit behind grown's auth middleware, so
//     only signed-in org members reach MediaMTX at all). TRADEOFF: anyone who
//     can reach MediaMTX's HLS/WebRTC ports directly (bypassing grown's proxy)
//     could read an org stream. In this deployment MediaMTX is bound to
//     localhost and only grown proxies to it, so that path isn't exposed. To
//     harden later, switch the read branch to require a short-lived read token
//     minted by grown and passed in the query.
//   - any other/unknown action → default 200 for api/metrics/pprof is NOT
//     granted here; we default-deny unknown actions with 401.
func (h *Webhooks) AuthHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req authRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			// Malformed body: deny.
			http.Error(w, "bad request", http.StatusUnauthorized)
			return
		}
		path := strings.Trim(req.Path, "/")
		switch req.Action {
		case "publish":
			if path == "" {
				http.Error(w, "denied", http.StatusUnauthorized)
				return
			}
			s, err := h.repo.GetByPath(r.Context(), path)
			if err != nil {
				http.Error(w, "denied", http.StatusUnauthorized)
				return
			}
			if !keyMatches(req, s.StreamKey) {
				http.Error(w, "denied", http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusOK)
			return

		case "read", "playback":
			if path == "" {
				http.Error(w, "denied", http.StatusUnauthorized)
				return
			}
			s, err := h.repo.GetByPath(r.Context(), path)
			if err != nil {
				http.Error(w, "denied", http.StatusUnauthorized)
				return
			}
			// Public streams: always allowed. Org streams: allowed here, gated
			// at grown's proxy (see the doc comment above).
			_ = s
			w.WriteHeader(http.StatusOK)
			return

		default:
			// api / metrics / pprof / unknown: deny. grown never needs MediaMTX
			// to authorize these for end users.
			http.Error(w, "denied", http.StatusUnauthorized)
		}
	})
}

// keyMatches reports whether the supplied credentials carry the stream key.
// Streaming software differs in where it puts the key:
//   - OBS RTMP: as the stream-key path segment OR the "password" field;
//   - some clients: the "user" field, or a "?key=" / "?pass=" query param.
//
// We accept any of these so the UX is forgiving (the UI documents "password").
func keyMatches(req authRequest, key string) bool {
	if key == "" {
		return false
	}
	if req.Password == key || req.User == key {
		return true
	}
	// Query forms: key=, pass=, password=, token=.
	if q := req.Query; q != "" {
		for _, kv := range strings.Split(strings.TrimPrefix(q, "?"), "&") {
			eq := strings.IndexByte(kv, '=')
			if eq < 0 {
				continue
			}
			name, val := kv[:eq], kv[eq+1:]
			switch name {
			case "key", "pass", "password", "token":
				if val == key {
					return true
				}
			}
		}
	}
	return false
}

// streamID extracts the {id} from /api/v1/live/{id}/_ready or /_notready.
// Returns ("", false) when the path doesn't match.
func streamID(path, suffix string) (string, bool) {
	const prefix = "/api/v1/live/"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// ReadyPath / NotReadyPath are the suffixes MediaMTX runOnReady/runOnNotReady
// hooks curl. The stream id (== MediaMTX path) is the {id} segment.
const (
	ReadyPath    = "/_ready"
	NotReadyPath = "/_notready"
)

// ReadyHandler flips a stream live (status='live', started_at=now). MediaMTX's
// runOnReady fires this when a publisher starts. The id segment is the path.
//
//	POST /api/v1/live/{id}/_ready
func (h *Webhooks) ReadyHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := streamID(r.URL.Path, ReadyPath)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		h.setStatus(r.Context(), w, id, true)
	})
}

// NotReadyHandler flips a stream offline (status='offline', ended_at=now).
// MediaMTX's runOnNotReady fires this when the publisher stops.
//
//	POST /api/v1/live/{id}/_notready
func (h *Webhooks) NotReadyHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := streamID(r.URL.Path, NotReadyPath)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		h.setStatus(r.Context(), w, id, false)
	})
}

func (h *Webhooks) setStatus(ctx context.Context, w http.ResponseWriter, path string, isLive bool) {
	if _, err := h.repo.SetStatus(ctx, path, isLive); err != nil {
		// Unknown path: MediaMTX hooks are best-effort; 200 anyway so MediaMTX
		// doesn't treat the hook as failed and retry-storm. (We log nothing here
		// to stay dependency-light; the status simply stays as-is.)
		w.WriteHeader(http.StatusOK)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// Routes is a helper the server uses to dispatch the three webhook paths. It
// returns the matched handler and true, or (nil,false) when the request is not
// a live webhook. Mount this BEFORE grown's /api/ auth fallthrough, UNWRAPPED.
func (h *Webhooks) Routes(r *http.Request) (http.Handler, bool) {
	if r.Method != http.MethodPost {
		return nil, false
	}
	p := r.URL.Path
	if p == "/api/v1/live/auth" {
		return h.AuthHandler(), true
	}
	if _, ok := streamID(p, ReadyPath); ok {
		return h.ReadyHandler(), true
	}
	if _, ok := streamID(p, NotReadyPath); ok {
		return h.NotReadyHandler(), true
	}
	return nil, false
}
