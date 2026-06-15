package podcasts

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"code.pick.haus/grown/grown/internal/auth"
)

// HTTP serves the podcasts JSON API: per-user subscriptions and the
// SSRF-guarded feed fetcher/parser.
type HTTP struct {
	repo *Repository
}

// NewHTTP constructs the podcasts HTTP handlers.
func NewHTTP(repo *Repository) *HTTP {
	return &HTTP{repo: repo}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// SubscriptionID extracts {id} from /api/v1/podcasts/subscriptions/{id}.
func SubscriptionID(path string) (string, bool) {
	const prefix = "/api/v1/podcasts/subscriptions/"
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	id := strings.Trim(strings.TrimPrefix(path, prefix), "/")
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// ListSubscriptionsHandler returns the caller's subscriptions.
// GET /api/v1/podcasts/subscriptions
func (h *HTTP) ListSubscriptionsHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, u, ok := authCtx(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		list, err := h.repo.ListSubscriptions(r.Context(), o, u)
		if err != nil {
			http.Error(w, "list subscriptions", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"subscriptions": list})
	})
}

// SubscribeHandler records a subscription (idempotent on user+feed_url).
// POST /api/v1/podcasts/subscriptions  body: {feed_url,title,author,artwork_url}
func (h *HTTP) SubscribeHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, u, ok := authCtx(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var body struct {
			FeedURL    string `json:"feed_url"`
			Title      string `json:"title"`
			Author     string `json:"author"`
			ArtworkURL string `json:"artwork_url"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		feed := strings.TrimSpace(body.FeedURL)
		if feed == "" {
			http.Error(w, "feed_url is required", http.StatusBadRequest)
			return
		}
		// Reuse the SSRF/scheme validation so a subscription can never store a
		// non-http(s) or obviously-internal URL we'd later fetch.
		if _, err := validateURL(feed); err != nil {
			http.Error(w, "feed_url is not an allowed http(s) url", http.StatusBadRequest)
			return
		}
		s, err := h.repo.Subscribe(r.Context(), o, u, SubscriptionFields{
			FeedURL:    feed,
			Title:      strings.TrimSpace(body.Title),
			Author:     strings.TrimSpace(body.Author),
			ArtworkURL: strings.TrimSpace(body.ArtworkURL),
		})
		if err != nil {
			http.Error(w, "subscribe", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"subscription": s})
	})
}

// UnsubscribeHandler removes a subscription by id.
// DELETE /api/v1/podcasts/subscriptions/{id}
func (h *HTTP) UnsubscribeHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, u, ok := authCtx(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, ok := SubscriptionID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		if err := h.repo.Unsubscribe(r.Context(), o, u, id); err != nil {
			if errors.Is(err, ErrNotFound) {
				http.Error(w, "subscription not found", http.StatusNotFound)
				return
			}
			http.Error(w, "unsubscribe", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// FeedHandler fetches + parses an RSS feed (SSRF-guarded) and returns the
// channel metadata + most-recent episodes.
// GET /api/v1/podcasts/feed?url=<feedUrl>
func (h *HTTP) FeedHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, _, ok := authCtx(r); !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		raw := strings.TrimSpace(r.URL.Query().Get("url"))
		if raw == "" {
			http.Error(w, "url query param is required", http.StatusBadRequest)
			return
		}
		feed, err := FetchFeed(r.Context(), raw)
		if err != nil {
			if errors.Is(err, ErrBlockedTarget) {
				http.Error(w, "feed url target is not allowed", http.StatusBadRequest)
				return
			}
			// Upstream/parse failures are the user's URL being bad, not our bug.
			http.Error(w, "could not fetch feed", http.StatusBadGateway)
			return
		}
		writeJSON(w, feed)
	})
}

// authCtx pulls org id + user id from the request context, returning ok=false
// if either is missing.
func authCtx(r *http.Request) (orgID, userID string, ok bool) {
	o, ook := auth.OrgFromContext(r.Context())
	u, uok := auth.UserFromContext(r.Context())
	if !ook || !uok {
		return "", "", false
	}
	return o.ID, u.ID, true
}
