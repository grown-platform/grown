// Package sharing is the data-access layer for per-object ACL grants
// (grown.object_grants). A grant gives one grown user a role on one object,
// identified by (object_type, object_id). Grants are the cross-org sharing
// primitive: they let a user who is not a member of the object's owning org
// open that single object at the granted role. See migration 0042 and
// docs/sharing-and-personal-orgs.md.
//
// This package depends only on pgx — it does NOT import internal/auth or the
// generated protos, so services can wire it directly without a dependency cycle.
package sharing

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Object type constants. Apps adopt their own string when they wire in sharing;
// Drive and Docs are the first two.
const (
	TypeDriveFile       = "drive_file"
	TypeDocsDoc         = "docs_document"
	TypeSheetsSheet     = "sheets_document"
	TypeSlidesDeck      = "slides_document"
	TypeKeepNote        = "keep_note"
	TypeWhiteboardBoard = "whiteboard"
)

// Roles, ordered weakest → strongest. RoleRank lets callers compare them.
const (
	RoleViewer    = "viewer"
	RoleCommenter = "commenter"
	RoleEditor    = "editor"
)

// ValidRole reports whether role is one of the three known roles.
func ValidRole(role string) bool {
	switch role {
	case RoleViewer, RoleCommenter, RoleEditor:
		return true
	}
	return false
}

// RoleRank maps a role to a comparable strength (higher = more access).
// Unknown roles rank -1.
func RoleRank(role string) int {
	switch role {
	case RoleViewer:
		return 1
	case RoleCommenter:
		return 2
	case RoleEditor:
		return 3
	}
	return -1
}

// CanWrite reports whether role permits editing (editor only).
func CanWrite(role string) bool { return role == RoleEditor }

// Grant mirrors a grown.object_grants row, enriched with the grantee's display
// name/email for listing (those come from grown.users).
type Grant struct {
	ObjectType    string
	ObjectID      string
	GranteeUserID string
	GranteeName   string
	GranteeEmail  string
	Role          string
	GrantedBy     string
}

// GrantEvent carries the details of a successful GrantAccess call. It is
// passed to OnGrant so external code (e.g. the notifications package) can
// react without creating a hard import dependency in this package.
type GrantEvent struct {
	ObjectType    string
	ObjectID      string
	GranteeUserID string
	Role          string
	GrantedBy     string // empty when anonymous
}

// Repository reads and writes object grants.
type Repository struct {
	pool    *pgxpool.Pool
	OnGrant func(ctx context.Context, e GrantEvent) // optional; called after a successful grant
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// GrantAccess grants granteeUserID the given role on (objectType, objectID).
// Re-granting updates the role and granted_by (idempotent upsert). grantedBy
// may be "" (stored NULL).
// After a successful upsert, OnGrant (if set) is called with the event details
// so external code (e.g. notifications) can react without a hard dependency.
func (r *Repository) GrantAccess(ctx context.Context, objectType, objectID, granteeUserID, role, grantedBy string) error {
	if !ValidRole(role) {
		return fmt.Errorf("sharing.GrantAccess: invalid role %q", role)
	}
	var by any
	if grantedBy != "" {
		by = grantedBy
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.object_grants (object_type, object_id, grantee_user_id, role, granted_by)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (object_type, object_id, grantee_user_id)
		 DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by`,
		objectType, objectID, granteeUserID, role, by,
	)
	if err != nil {
		return fmt.Errorf("sharing.GrantAccess: %w", err)
	}
	if r.OnGrant != nil {
		r.OnGrant(ctx, GrantEvent{
			ObjectType:    objectType,
			ObjectID:      objectID,
			GranteeUserID: granteeUserID,
			Role:          role,
			GrantedBy:     grantedBy,
		})
	}
	return nil
}

// RevokeAccess removes granteeUserID's grant on (objectType, objectID).
// Revoking a non-existent grant is a no-op (no error).
func (r *Repository) RevokeAccess(ctx context.Context, objectType, objectID, granteeUserID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM grown.object_grants
		 WHERE object_type = $1 AND object_id = $2 AND grantee_user_id = $3`,
		objectType, objectID, granteeUserID,
	)
	if err != nil {
		return fmt.Errorf("sharing.RevokeAccess: %w", err)
	}
	return nil
}

// ListGrantsForObject returns the grants on (objectType, objectID), each joined
// to the grantee's name/email, oldest grant first.
func (r *Repository) ListGrantsForObject(ctx context.Context, objectType, objectID string) ([]Grant, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT g.object_type, g.object_id::text, g.grantee_user_id::text,
		        COALESCE(u.display_name, ''), COALESCE(u.email, ''),
		        g.role, COALESCE(g.granted_by::text, '')
		 FROM grown.object_grants g
		 JOIN grown.users u ON u.id = g.grantee_user_id
		 WHERE g.object_type = $1 AND g.object_id = $2
		 ORDER BY g.created_at`,
		objectType, objectID,
	)
	if err != nil {
		return nil, fmt.Errorf("sharing.ListGrantsForObject: %w", err)
	}
	defer rows.Close()
	var out []Grant
	for rows.Next() {
		var g Grant
		if err := rows.Scan(&g.ObjectType, &g.ObjectID, &g.GranteeUserID,
			&g.GranteeName, &g.GranteeEmail, &g.Role, &g.GrantedBy); err != nil {
			return nil, fmt.Errorf("sharing.ListGrantsForObject scan: %w", err)
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// ListObjectIDsGrantedToUser returns the object ids of objectType granted to
// userID — backing each app's "Shared with me" view.
func (r *Repository) ListObjectIDsGrantedToUser(ctx context.Context, userID, objectType string) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT object_id::text FROM grown.object_grants
		 WHERE grantee_user_id = $1 AND object_type = $2`,
		userID, objectType,
	)
	if err != nil {
		return nil, fmt.Errorf("sharing.ListObjectIDsGrantedToUser: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("sharing.ListObjectIDsGrantedToUser scan: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// RoleFor returns the role userID holds on (objectType, objectID), or "" with
// ok=false when there is no grant. This is the security-critical lookup: the
// object-fetch path calls it to decide whether a non-org-member may read.
func (r *Repository) RoleFor(ctx context.Context, userID, objectType, objectID string) (string, bool, error) {
	if userID == "" || objectID == "" {
		return "", false, nil
	}
	var role string
	err := r.pool.QueryRow(ctx,
		`SELECT role FROM grown.object_grants
		 WHERE object_type = $1 AND object_id = $2 AND grantee_user_id = $3`,
		objectType, objectID, userID,
	).Scan(&role)
	if err != nil {
		if isNoRows(err) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("sharing.RoleFor: %w", err)
	}
	return role, true, nil
}
