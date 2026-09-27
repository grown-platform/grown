package server

import (
	"context"
	"net/http"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/docs"
	"code.pick.haus/grown/grown/internal/sharing"
)

// docsDocLookup is the slice of *docs.Repository the access check needs.
type docsDocLookup interface {
	Get(ctx context.Context, orgID, id string) (docs.Doc, error)
	GetByID(ctx context.Context, id string) (docs.Doc, error)
	GetShareByToken(ctx context.Context, token string) (docs.ShareGrant, error)
}

// docsRoleLookup is the slice of *sharing.Repository the access check needs.
type docsRoleLookup interface {
	RoleFor(ctx context.Context, userID, objectType, objectID string) (string, bool, error)
}

// docsGrantLookup adapts an optional grant repository; a nil repository
// disables the per-user grant path (and avoids a typed-nil interface).
func docsGrantLookup(grants *sharing.Repository) docsRoleLookup {
	if grants == nil {
		return nil
	}
	return grants
}

// docsAccess is what a caller may do with one document.
type docsAccess struct {
	Read, Write, Owner bool
}

// docsAccessFor decides a request's access to document id, for every raw HTTP
// document route (the collab WebSocket, protection). Three paths grant access:
// (1) an authenticated member of the org that owns the document (full edit,
// as the DocsService GetDoc access check), (2) an authenticated per-user
// grantee (object_grants), whose role decides read/write (cross-org), or
// (3) a valid share-link token for this document (?token=). Anything else,
// including lookup errors, grants nothing.
func docsAccessFor(r *http.Request, id string, repo docsDocLookup, grants docsRoleLookup) docsAccess {
	ctx := r.Context()
	var acc docsAccess
	if u, hasUser := auth.UserFromContext(ctx); hasUser {
		if org, ok := auth.OrgFromContext(ctx); ok {
			if d, err := repo.Get(ctx, org.ID, id); err == nil {
				acc = docsAccess{Read: true, Write: true, Owner: d.OwnerID == u.ID}
			}
		}
		// Per-user grant path: a non-org-member with a grant; only an editor
		// grant writes.
		if !acc.Read && grants != nil {
			if role, ok, err := grants.RoleFor(ctx, u.ID, sharing.TypeDocsDoc, id); err == nil && ok {
				// The document must still exist (not trashed).
				if _, derr := repo.GetByID(ctx, id); derr == nil {
					acc = docsAccess{Read: true, Write: sharing.CanWrite(role)}
				}
			}
		}
	}
	if !acc.Read {
		if token := r.URL.Query().Get("token"); token != "" {
			if grant, err := repo.GetShareByToken(ctx, token); err == nil && grant.DocID == id {
				acc = docsAccess{Read: true, Write: grant.Role == "editor"}
			}
		}
	}
	return acc
}
