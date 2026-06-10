// Package docs is the data-access and collaboration layer for Docs documents.
package docs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no document matches the given id (within the org).
var ErrNotFound = errors.New("document not found")

// Doc is the in-memory representation of a grown.docs_documents row.
type Doc struct {
	ID          string
	OrgID       string
	OwnerID     string
	Title       string
	DriveKey    string
	DriveFileID string
	SnapshotSeq int64
	PreviewHTML string
	IsTemplate  bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Repository reads and writes documents and their Yjs update log.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const docColumns = `id::text, org_id::text, owner_id::text, title,
	COALESCE(drive_key, ''), COALESCE(drive_file_id::text, ''),
	snapshot_seq, COALESCE(preview_html, ''), is_template, created_at, updated_at`

func scanDoc(row pgx.Row) (Doc, error) {
	var d Doc
	err := row.Scan(&d.ID, &d.OrgID, &d.OwnerID, &d.Title,
		&d.DriveKey, &d.DriveFileID, &d.SnapshotSeq, &d.PreviewHTML, &d.IsTemplate, &d.CreatedAt, &d.UpdatedAt)
	return d, err
}

// SetTemplate flags or unflags a document as a gallery template.
func (r *Repository) SetTemplate(ctx context.Context, orgID, id string, isTemplate bool) (Doc, error) {
	q := `UPDATE grown.docs_documents SET is_template = $3, updated_at = now()
	      WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL
	      RETURNING ` + docColumns
	d, err := scanDoc(r.pool.QueryRow(ctx, q, id, orgID, isTemplate))
	if errors.Is(err, pgx.ErrNoRows) {
		return Doc{}, ErrNotFound
	}
	if err != nil {
		return Doc{}, fmt.Errorf("docs.SetTemplate: %w", err)
	}
	return d, nil
}

// SetPreview stores a rendered HTML preview for thumbnails. Returns ErrNotFound
// if no live document matched.
func (r *Repository) SetPreview(ctx context.Context, orgID, id, html string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.docs_documents SET preview_html = $3
		 WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL`, id, orgID, html)
	if err != nil {
		return fmt.Errorf("docs.SetPreview: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Create inserts a new document owned by ownerID in orgID. An empty title
// becomes "Untitled document" (the column default).
func (r *Repository) Create(ctx context.Context, orgID, ownerID, title string) (Doc, error) {
	q := `INSERT INTO grown.docs_documents (org_id, owner_id, title)
	      VALUES ($1, $2, COALESCE(NULLIF($3, ''), 'Untitled document'))
	      RETURNING ` + docColumns
	d, err := scanDoc(r.pool.QueryRow(ctx, q, orgID, ownerID, title))
	if err != nil {
		return Doc{}, fmt.Errorf("docs.Create: %w", err)
	}
	return d, nil
}

// Get returns the document with id within orgID, or ErrNotFound. Trashed
// documents are not returned.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Doc, error) {
	q := `SELECT ` + docColumns + ` FROM grown.docs_documents
	      WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL`
	d, err := scanDoc(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Doc{}, ErrNotFound
	}
	if err != nil {
		return Doc{}, fmt.Errorf("docs.Get: %w", err)
	}
	return d, nil
}

// GetByID returns the non-trashed document with id WITHOUT an org filter. Used
// only on the grant path, after the caller has independently verified an
// object_grant for the requesting user. Callers MUST NOT expose it without that
// check, or it leaks cross-org documents. Use Get (org-scoped) for the normal path.
func (r *Repository) GetByID(ctx context.Context, id string) (Doc, error) {
	q := `SELECT ` + docColumns + ` FROM grown.docs_documents
	      WHERE id = $1 AND trashed_at IS NULL`
	d, err := scanDoc(r.pool.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Doc{}, ErrNotFound
	}
	if err != nil {
		return Doc{}, fmt.Errorf("docs.GetByID: %w", err)
	}
	return d, nil
}

// GetByIDs returns the non-trashed documents whose ids are in the set, across
// any org, newest first. Backs the Docs "Shared with me" view.
func (r *Repository) GetByIDs(ctx context.Context, ids []string) ([]Doc, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	q := `SELECT ` + docColumns + ` FROM grown.docs_documents
	      WHERE id = ANY($1) AND trashed_at IS NULL
	      ORDER BY updated_at DESC`
	rows, err := r.pool.Query(ctx, q, ids)
	if err != nil {
		return nil, fmt.Errorf("docs.GetByIDs: %w", err)
	}
	defer rows.Close()
	var out []Doc
	for rows.Next() {
		d, err := scanDoc(rows)
		if err != nil {
			return nil, fmt.Errorf("docs.GetByIDs scan: %w", err)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// List returns all non-trashed documents in orgID, newest first.
func (r *Repository) List(ctx context.Context, orgID string) ([]Doc, error) {
	q := `SELECT ` + docColumns + ` FROM grown.docs_documents
	      WHERE org_id = $1 AND trashed_at IS NULL
	      ORDER BY updated_at DESC`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("docs.List: %w", err)
	}
	defer rows.Close()
	var out []Doc
	for rows.Next() {
		d, err := scanDoc(rows)
		if err != nil {
			return nil, fmt.Errorf("docs.List scan: %w", err)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Rename updates the title of a document in orgID, returning the updated row or
// ErrNotFound.
func (r *Repository) Rename(ctx context.Context, orgID, id, title string) (Doc, error) {
	q := `UPDATE grown.docs_documents
	      SET title = $3, updated_at = now()
	      WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL
	      RETURNING ` + docColumns
	d, err := scanDoc(r.pool.QueryRow(ctx, q, id, orgID, title))
	if errors.Is(err, pgx.ErrNoRows) {
		return Doc{}, ErrNotFound
	}
	if err != nil {
		return Doc{}, fmt.Errorf("docs.Rename: %w", err)
	}
	return d, nil
}

// Trash soft-deletes a document in orgID. Returns ErrNotFound if no live row matched.
func (r *Repository) Trash(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.docs_documents SET trashed_at = now(), updated_at = now()
		 WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL`, id, orgID)
	if err != nil {
		return fmt.Errorf("docs.Trash: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Share is a grown.docs_shares row.
type Share struct {
	Token     string
	DocID     string
	Role      string
	Audience  string // invitee email; empty = anyone-with-the-link
	CreatedAt time.Time
}

// ShareGrant is a resolved share token plus the document's current title.
type ShareGrant struct {
	Share
	DocTitle string
}

func newShareToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// CreateShare issues a new share token for docID at role ("viewer"|"editor"),
// created by userID. audience is an optional invitee email (empty = anyone with
// the link). The caller must already have verified docID is accessible.
func (r *Repository) CreateShare(ctx context.Context, docID, userID, role, audience string) (Share, error) {
	token, err := newShareToken()
	if err != nil {
		return Share{}, fmt.Errorf("docs.CreateShare token: %w", err)
	}
	var s Share
	err = r.pool.QueryRow(ctx,
		`INSERT INTO grown.docs_shares (token, doc_id, role, created_by, audience)
		 VALUES ($1, $2, $3, $4, NULLIF($5, ''))
		 RETURNING token, doc_id::text, role, COALESCE(audience, ''), created_at`,
		token, docID, role, userID, audience).Scan(&s.Token, &s.DocID, &s.Role, &s.Audience, &s.CreatedAt)
	if err != nil {
		return Share{}, fmt.Errorf("docs.CreateShare: %w", err)
	}
	return s, nil
}

// ListShares returns the active (non-revoked) shares for a document.
func (r *Repository) ListShares(ctx context.Context, docID string) ([]Share, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT token, doc_id::text, role, COALESCE(audience, ''), created_at FROM grown.docs_shares
		 WHERE doc_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`, docID)
	if err != nil {
		return nil, fmt.Errorf("docs.ListShares: %w", err)
	}
	defer rows.Close()
	var out []Share
	for rows.Next() {
		var s Share
		if err := rows.Scan(&s.Token, &s.DocID, &s.Role, &s.Audience, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("docs.ListShares scan: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// RevokeShare marks a share token revoked. Returns ErrNotFound if no live share matched.
func (r *Repository) RevokeShare(ctx context.Context, token string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.docs_shares SET revoked_at = now()
		 WHERE token = $1 AND revoked_at IS NULL`, token)
	if err != nil {
		return fmt.Errorf("docs.RevokeShare: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetShareByToken resolves a live token to its share + the (non-trashed) doc's
// title. Returns ErrNotFound if the token is unknown, revoked, or the doc is gone.
func (r *Repository) GetShareByToken(ctx context.Context, token string) (ShareGrant, error) {
	var g ShareGrant
	err := r.pool.QueryRow(ctx,
		`SELECT s.token, s.doc_id::text, s.role, s.created_at, d.title
		 FROM grown.docs_shares s
		 JOIN grown.docs_documents d ON d.id = s.doc_id AND d.trashed_at IS NULL
		 WHERE s.token = $1 AND s.revoked_at IS NULL`, token).
		Scan(&g.Token, &g.DocID, &g.Role, &g.CreatedAt, &g.DocTitle)
	if errors.Is(err, pgx.ErrNoRows) {
		return ShareGrant{}, ErrNotFound
	}
	if err != nil {
		return ShareGrant{}, fmt.Errorf("docs.GetShareByToken: %w", err)
	}
	return g, nil
}

// Version is a grown.docs_versions row. ContentHTML is only populated by
// GetVersion; list queries leave it empty to keep the payload small.
type Version struct {
	ID          string
	DocID       string
	AuthorID    string
	AuthorName  string
	Label       string
	ContentHTML string
	IsAuto      bool
	CreatedAt   time.Time
}

// maxVersionBytes caps stored version HTML (a few hundred KB of rendered doc).
const maxVersionBytes = 4 << 20

// CreateVersion inserts a new snapshot of docID's rendered content.
func (r *Repository) CreateVersion(ctx context.Context, docID, authorID, label, html string, isAuto bool) (Version, error) {
	if len(html) > maxVersionBytes {
		html = html[:maxVersionBytes]
	}
	var v Version
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.docs_versions (doc_id, author_id, label, content_html, is_auto)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id::text, doc_id::text, author_id::text, label, is_auto, created_at`,
		docID, authorID, label, html, isAuto).
		Scan(&v.ID, &v.DocID, &v.AuthorID, &v.Label, &v.IsAuto, &v.CreatedAt)
	if err != nil {
		return Version{}, fmt.Errorf("docs.CreateVersion: %w", err)
	}
	return v, nil
}

// ListVersions returns docID's versions newest first, without content_html.
func (r *Repository) ListVersions(ctx context.Context, docID string) ([]Version, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT v.id::text, v.doc_id::text, v.author_id::text,
		        COALESCE(u.display_name, u.email, ''), v.label, v.is_auto, v.created_at
		 FROM grown.docs_versions v
		 LEFT JOIN grown.users u ON u.id = v.author_id
		 WHERE v.doc_id = $1 ORDER BY v.created_at DESC`, docID)
	if err != nil {
		return nil, fmt.Errorf("docs.ListVersions: %w", err)
	}
	defer rows.Close()
	var out []Version
	for rows.Next() {
		var v Version
		if err := rows.Scan(&v.ID, &v.DocID, &v.AuthorID, &v.AuthorName, &v.Label, &v.IsAuto, &v.CreatedAt); err != nil {
			return nil, fmt.Errorf("docs.ListVersions scan: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// GetVersion returns one version including content_html, scoped to docID.
func (r *Repository) GetVersion(ctx context.Context, docID, versionID string) (Version, error) {
	var v Version
	err := r.pool.QueryRow(ctx,
		`SELECT v.id::text, v.doc_id::text, v.author_id::text,
		        COALESCE(u.display_name, u.email, ''), v.label, v.content_html, v.is_auto, v.created_at
		 FROM grown.docs_versions v
		 LEFT JOIN grown.users u ON u.id = v.author_id
		 WHERE v.id = $1 AND v.doc_id = $2`, versionID, docID).
		Scan(&v.ID, &v.DocID, &v.AuthorID, &v.AuthorName, &v.Label, &v.ContentHTML, &v.IsAuto, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Version{}, ErrNotFound
	}
	if err != nil {
		return Version{}, fmt.Errorf("docs.GetVersion: %w", err)
	}
	return v, nil
}

// Comment is a grown.docs_comments row.
type Comment struct {
	ID              string
	DocID           string
	AuthorID        string
	AuthorName      string
	Body            string
	Quote           string
	AnchorFrom      int32
	AnchorTo        int32
	Resolved        bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
	ResolvedAt      *time.Time
	ParentCommentID string    // empty for top-level comments
	Replies         []Comment // populated by ListComments for top-level comments
}

// CreateComment anchors a new comment to a selection range within docID.
func (r *Repository) CreateComment(ctx context.Context, docID, authorID, body, quote string, from, to int32) (Comment, error) {
	var c Comment
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.docs_comments (doc_id, author_id, body, quote, anchor_from, anchor_to)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id::text, doc_id::text, author_id::text, body, quote, anchor_from, anchor_to,
		           COALESCE(parent_comment_id::text, ''), resolved_at, created_at,
		           COALESCE(updated_at, created_at)`,
		docID, authorID, body, quote, from, to).
		Scan(&c.ID, &c.DocID, &c.AuthorID, &c.Body, &c.Quote, &c.AnchorFrom, &c.AnchorTo,
			&c.ParentCommentID, &c.ResolvedAt, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return Comment{}, fmt.Errorf("docs.CreateComment: %w", err)
	}
	c.Resolved = c.ResolvedAt != nil
	return c, nil
}

// ReplyToComment adds a reply under parentCommentID, scoped to docID.
// The parent must be a top-level comment in the same document.
func (r *Repository) ReplyToComment(ctx context.Context, docID, parentCommentID, authorID, body string) (Comment, error) {
	// Verify parent exists and belongs to docID.
	var parentDocID string
	err := r.pool.QueryRow(ctx,
		`SELECT doc_id::text FROM grown.docs_comments WHERE id = $1 AND doc_id = $2 AND parent_comment_id IS NULL`,
		parentCommentID, docID).Scan(&parentDocID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Comment{}, ErrNotFound
	}
	if err != nil {
		return Comment{}, fmt.Errorf("docs.ReplyToComment parent lookup: %w", err)
	}

	var c Comment
	err = r.pool.QueryRow(ctx,
		`INSERT INTO grown.docs_comments (doc_id, author_id, body, parent_comment_id)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id::text, doc_id::text, author_id::text, body, '',
		           0, 0, COALESCE(parent_comment_id::text, ''), resolved_at, created_at,
		           COALESCE(updated_at, created_at)`,
		docID, authorID, body, parentCommentID).
		Scan(&c.ID, &c.DocID, &c.AuthorID, &c.Body, &c.Quote, &c.AnchorFrom, &c.AnchorTo,
			&c.ParentCommentID, &c.ResolvedAt, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return Comment{}, fmt.Errorf("docs.ReplyToComment: %w", err)
	}
	c.Resolved = c.ResolvedAt != nil
	return c, nil
}

// scanCommentRow scans a single comment row (without Replies).
func scanCommentRow(row pgx.Row) (Comment, error) {
	var c Comment
	err := row.Scan(&c.ID, &c.DocID, &c.AuthorID, &c.AuthorName, &c.Body, &c.Quote,
		&c.AnchorFrom, &c.AnchorTo, &c.ParentCommentID, &c.ResolvedAt, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return Comment{}, err
	}
	c.Resolved = c.ResolvedAt != nil
	return c, nil
}

const commentSelectCols = `c.id::text, c.doc_id::text, c.author_id::text,
	COALESCE(u.display_name, u.email, ''), c.body, COALESCE(c.quote, ''),
	c.anchor_from, c.anchor_to, COALESCE(c.parent_comment_id::text, ''),
	c.resolved_at, c.created_at, COALESCE(c.updated_at, c.created_at)`

// ListComments returns docID's comments oldest first, with author names and
// replies nested under their parent threads.
func (r *Repository) ListComments(ctx context.Context, docID string) ([]Comment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+commentSelectCols+`
		 FROM grown.docs_comments c
		 LEFT JOIN grown.users u ON u.id = c.author_id
		 WHERE c.doc_id = $1 ORDER BY c.created_at`, docID)
	if err != nil {
		return nil, fmt.Errorf("docs.ListComments: %w", err)
	}
	defer rows.Close()
	var allComments []Comment
	for rows.Next() {
		c, err := scanCommentRow(rows)
		if err != nil {
			return nil, fmt.Errorf("docs.ListComments scan: %w", err)
		}
		allComments = append(allComments, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Build index of comment id → position in allComments.
	index := make(map[string]int, len(allComments))
	for i, c := range allComments {
		index[c.ID] = i
	}

	// Two-pass: collect top-level comments, then attach replies.
	var roots []Comment
	for _, c := range allComments {
		if c.ParentCommentID == "" {
			c.Replies = nil // initialise empty slice
			roots = append(roots, c)
		}
	}
	// Build root index.
	rootIdx := make(map[string]int, len(roots))
	for i, c := range roots {
		rootIdx[c.ID] = i
	}
	for _, c := range allComments {
		if c.ParentCommentID != "" {
			if i, ok := rootIdx[c.ParentCommentID]; ok {
				roots[i].Replies = append(roots[i].Replies, c)
			}
		}
	}
	return roots, nil
}

const commentScanCols = `id::text, doc_id::text, author_id::text, '', body,
	COALESCE(quote, ''), anchor_from, anchor_to,
	COALESCE(parent_comment_id::text, ''), resolved_at, created_at,
	COALESCE(updated_at, created_at)`

// ResolveComment sets resolved_at on a comment, scoped to docID.
func (r *Repository) ResolveComment(ctx context.Context, docID, commentID string, resolved bool) (Comment, error) {
	var resolvedAt any
	if resolved {
		resolvedAt = time.Now()
	}
	var c Comment
	err := r.pool.QueryRow(ctx,
		`UPDATE grown.docs_comments SET resolved_at = $3, updated_at = now()
		 WHERE id = $1 AND doc_id = $2
		 RETURNING `+commentScanCols,
		commentID, docID, resolvedAt).
		Scan(&c.ID, &c.DocID, &c.AuthorID, &c.AuthorName, &c.Body, &c.Quote,
			&c.AnchorFrom, &c.AnchorTo, &c.ParentCommentID, &c.ResolvedAt, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Comment{}, ErrNotFound
	}
	if err != nil {
		return Comment{}, fmt.Errorf("docs.ResolveComment: %w", err)
	}
	c.Resolved = c.ResolvedAt != nil
	return c, nil
}

// DeleteComment removes a comment (and all cascaded replies) scoped to docID.
// ErrNotFound if none matched.
func (r *Repository) DeleteComment(ctx context.Context, docID, commentID string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.docs_comments WHERE id = $1 AND doc_id = $2`, commentID, docID)
	if err != nil {
		return fmt.Errorf("docs.DeleteComment: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AppendUpdate appends one binary Yjs update to a document's update log.
func (r *Repository) AppendUpdate(ctx context.Context, docID string, update []byte) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.docs_updates (doc_id, update_blob) VALUES ($1, $2)`,
		docID, update)
	if err != nil {
		return fmt.Errorf("docs.AppendUpdate: %w", err)
	}
	return nil
}

// Updates returns all stored updates for a document in insertion order. These
// are replayed to a joining client so it converges to current state.
func (r *Repository) Updates(ctx context.Context, docID string) ([][]byte, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT update_blob FROM grown.docs_updates WHERE doc_id = $1 ORDER BY id`, docID)
	if err != nil {
		return nil, fmt.Errorf("docs.Updates: %w", err)
	}
	defer rows.Close()
	var out [][]byte
	for rows.Next() {
		var b []byte
		if err := rows.Scan(&b); err != nil {
			return nil, fmt.Errorf("docs.Updates scan: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
