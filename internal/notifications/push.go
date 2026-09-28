package notifications

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"code.pick.haus/grown/grown/internal/auth"
)

// PushPath is the self-notification endpoint used by integrations (the Home
// Assistant `grown` notify entity) to drop a notification into the caller's
// own feed. It is a plain HTTP handler matched before the grpc-gateway.
//
// Token scope gating happens in auth.HTTPMiddleware: a POST under
// /api/v1/notifications/ needs `notifications:write` (or `notifications`/`*`).
const PushPath = "/api/v1/notifications/push"

// TypeHomeAssistant is the notifications.type recorded for pushed rows. Today
// the only pusher is the Home Assistant integration, so pushes are labelled
// with it (the bell shows them like any other notification).
const TypeHomeAssistant = "homeassistant"

// Push limits (the public contract the HA integration codes against).
const (
	MaxPushTitle   = 200
	MaxPushMessage = 2000
	MaxPushLink    = 2048
	PushPerMinute  = 60
)

// PushHandler serves POST /api/v1/notifications/push.
type PushHandler struct {
	repo    *Repository
	limiter *rateLimiter
}

// NewPushHandler constructs the handler with the default 60/min/user limit.
func NewPushHandler(repo *Repository) *PushHandler {
	return &PushHandler{repo: repo, limiter: newRateLimiter(PushPerMinute, time.Minute, time.Now)}
}

type pushRequest struct {
	Title   string `json:"title"`
	Message string `json:"message"`
	Link    string `json:"link"`
}

// ValidatePush checks a push body against the contract and returns a
// human-readable reason when invalid ("" when valid). Title is trimmed.
func ValidatePush(title, message, link string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return "title is required"
	}
	if utf8.RuneCountInString(title) > MaxPushTitle {
		return "title must be at most 200 characters"
	}
	if utf8.RuneCountInString(message) > MaxPushMessage {
		return "message must be at most 2000 characters"
	}
	if link != "" && !validLink(link) {
		return "link must be a relative path starting with / or an http(s) URL"
	}
	return ""
}

// validLink accepts an in-app path ("/calendar", not the protocol-relative
// "//host") or an absolute http(s) URL with a host.
func validLink(link string) bool {
	if len(link) > MaxPushLink || strings.ContainsAny(link, "\r\n\t\\") {
		return false
	}
	if strings.HasPrefix(link, "/") {
		return !strings.HasPrefix(link, "//")
	}
	u, err := url.Parse(link)
	if err != nil {
		return false
	}
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func (h *PushHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	o, ok := auth.OrgFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusInternalServerError, "missing org context")
		return
	}
	// Defence in depth: the middleware already enforces token scopes, but make
	// the contract explicit here too.
	if auth.IsTokenAuth(r.Context()) {
		scopes, _ := auth.ScopesFromContext(r.Context())
		if !hasWrite(scopes) {
			writeErr(w, http.StatusForbidden, "api token needs the notifications:write scope")
			return
		}
	}
	var body pushRequest
	dec := json.NewDecoder(io.LimitReader(r.Body, 64<<10))
	if err := dec.Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if msg := ValidatePush(body.Title, body.Message, body.Link); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	if !h.limiter.allow(u.ID) {
		w.Header().Set("Retry-After", "60")
		writeErr(w, http.StatusTooManyRequests, "rate limit: at most 60 notifications per minute")
		return
	}
	n, err := h.repo.Create(r.Context(), CreateParams{
		OrgID:     o.ID,
		UserID:    u.ID,
		Type:      TypeHomeAssistant,
		Title:     strings.TrimSpace(body.Title),
		Body:      body.Message,
		TargetURL: body.Link,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create notification")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{"id": n.ID})
}

func hasWrite(scopes []string) bool {
	for _, s := range scopes {
		if s == "*" || s == "notifications" || s == "notifications:write" {
			return true
		}
	}
	return false
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// rateLimiter is a per-key sliding-window limiter (in-memory, per replica).
type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	now    func() time.Time
	hits   map[string][]time.Time
}

func newRateLimiter(limit int, window time.Duration, now func() time.Time) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, now: now, hits: map[string][]time.Time{}}
}

func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	cutoff := now.Add(-l.window)
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.limit {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	// Opportunistic cleanup so idle users don't accumulate.
	if len(l.hits) > 1024 {
		for k, ts := range l.hits {
			if len(ts) == 0 || !ts[len(ts)-1].After(cutoff) {
				delete(l.hits, k)
			}
		}
	}
	return true
}
