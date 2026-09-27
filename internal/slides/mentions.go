package slides

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"code.pick.haus/grown/grown/internal/auth"
)

// @mentions in slide comments (M10). Comment threads live in the deck JSON
// (see web/app/src/pages/slides/comments.ts); when a comment @-mentions
// people, the editor posts their ids here and each one who can open the deck
// gets an in-app notification linking to the thread.
//
//	POST /api/v1/slides/d/{id}/mentions  {"user_ids":[…],"comment_id":"…","text":"…"}

// MaxMentions caps the users notified by one comment.
const MaxMentions = 20

// Notification is what the Mentions handler asks the notifier to create.
type Notification struct {
	OrgID, UserID, ActorUserID, Title, Body, TargetURL string
}

// Mentions serves the mention endpoint.
type Mentions struct {
	access DeckAccess
	// target reports whether userID may open deckID and the org to notify
	// them in.
	target func(ctx context.Context, deckID, userID string) (orgID string, ok bool)
	title  func(ctx context.Context, deckID string) string
	notify func(ctx context.Context, n Notification) error
}

// NewMentions builds the handler.
func NewMentions(
	access DeckAccess,
	target func(ctx context.Context, deckID, userID string) (string, bool),
	title func(ctx context.Context, deckID string) string,
	notify func(ctx context.Context, n Notification) error,
) *Mentions {
	return &Mentions{access: access, target: target, title: title, notify: notify}
}

// MentionPath returns the deck id of /api/v1/slides/d/{id}/mentions.
func MentionPath(path string) (string, bool) {
	const prefix, suffix = "/api/v1/slides/d/", "/mentions"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

type mentionReq struct {
	UserIDs   []string `json:"user_ids"`
	CommentID string   `json:"comment_id"`
	Text      string   `json:"text"`
}

func snippet(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n-1]) + "…"
}

func (m *Mentions) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	deckID, ok := MentionPath(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	read, write := m.access(r, deckID)
	if !read {
		http.Error(w, "deck not found", http.StatusNotFound)
		return
	}
	if !write {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	var req mentionReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	actor := u.DisplayName
	if actor == "" {
		actor = u.Email
	}
	deckTitle := m.title(r.Context(), deckID)
	if deckTitle == "" {
		deckTitle = "a presentation"
	}
	url := "/slides/d/" + deckID
	if req.CommentID != "" && !strings.ContainsAny(req.CommentID, "/?&#") {
		url += "?comment=" + req.CommentID
	}
	seen := map[string]bool{u.ID: true}
	notified := 0
	for _, uid := range req.UserIDs {
		if seen[uid] || uid == "" {
			continue
		}
		seen[uid] = true
		if len(seen) > MaxMentions+1 {
			break
		}
		org, ok := m.target(r.Context(), deckID, uid)
		if !ok {
			continue
		}
		if err := m.notify(r.Context(), Notification{
			OrgID:       org,
			UserID:      uid,
			ActorUserID: u.ID,
			Title:       actor + " mentioned you in “" + deckTitle + "”",
			Body:        snippet(req.Text, 200),
			TargetURL:   url,
		}); err == nil {
			notified++
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]int{"notified": notified})
}
