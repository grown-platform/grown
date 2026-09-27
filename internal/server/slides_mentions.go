package server

import (
	"context"
	"net/http"

	"code.pick.haus/grown/grown/internal/notifications"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/slides"
	"code.pick.haus/grown/grown/internal/users"
)

// newSlidesMentions wires the Slides comment @mention endpoint (M10): the
// caller needs write access to the deck; a mentioned user is notified only if
// they can open it (a member of the deck's org, or a per-user grantee).
func newSlidesMentions(repo *slides.Repository, grants *sharing.Repository, usersRepo *users.Repository, notif *notifications.Repository) *slides.Mentions {
	return slides.NewMentions(
		func(r *http.Request, id string) (bool, bool) { return slidesDeckAccess(r, id, repo, grants) },
		func(ctx context.Context, deckID, userID string) (string, bool) {
			return slidesMentionTarget(ctx, deckID, userID, repo, grants, usersRepo)
		},
		func(ctx context.Context, deckID string) string {
			if d, err := repo.GetByID(ctx, deckID); err == nil {
				return d.Title
			}
			return ""
		},
		func(ctx context.Context, n slides.Notification) error {
			_, err := notif.Create(ctx, notifications.CreateParams{
				OrgID:       n.OrgID,
				UserID:      n.UserID,
				Type:        "slides_mention",
				ActorUserID: n.ActorUserID,
				Title:       n.Title,
				Body:        n.Body,
				TargetURL:   n.TargetURL,
			})
			return err
		},
	)
}

func slidesMentionTarget(ctx context.Context, deckID, userID string, repo *slides.Repository, grants *sharing.Repository, usersRepo *users.Repository) (string, bool) {
	u, err := usersRepo.GetByID(ctx, userID)
	if err != nil {
		return "", false
	}
	d, err := repo.GetByID(ctx, deckID)
	if err != nil {
		return "", false
	}
	if u.OrgID == d.OrgID {
		return u.OrgID, true
	}
	if grants != nil {
		if _, ok, err := grants.RoleFor(ctx, userID, sharing.TypeSlidesDeck, deckID); err == nil && ok {
			return u.OrgID, true
		}
	}
	return "", false
}
