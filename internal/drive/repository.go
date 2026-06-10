// Package drive provides file storage, sharing, and previews. The blob
// layer talks to a rustfs (S3-compatible) backend; the metadata layer is
// Postgres-backed.
package drive

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FolderMimeType is the special mime type stored on folder rows.
const FolderMimeType = "application/vnd.grown.folder"

// ErrNotFound is returned when no row matches.
var ErrNotFound = errors.New("file not found")

// File mirrors a grown.drive_files row.
type File struct {
	ID         string
	OrgID      string
	OwnerID    string
	ParentID   *string
	Name       string
	MimeType   string
	StorageKey *string
	SizeBytes  int64
	TrashedAt  *time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// Repository is the Postgres-backed metadata layer for Drive.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// CreateFolder inserts a new folder row. Empty parent = org root.
func (r *Repository) CreateFolder(ctx context.Context, orgID, ownerID, parent, name string) (File, error) {
	return r.insert(ctx, orgID, ownerID, parent, name, FolderMimeType, nil, 0)
}

// CreateFile inserts a new file row pointing at an existing blob.
func (r *Repository) CreateFile(ctx context.Context, orgID, ownerID, parent, name, mimeType, storageKey string, size int64) (File, error) {
	k := storageKey
	return r.insert(ctx, orgID, ownerID, parent, name, mimeType, &k, size)
}

func (r *Repository) insert(ctx context.Context, orgID, ownerID, parent, name, mime string, key *string, size int64) (File, error) {
	var parentArg interface{}
	if parent == "" {
		parentArg = nil
	} else {
		parentArg = parent
	}
	var f File
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.drive_files
		   (org_id, owner_id, parent_id, name, mime_type, storage_key, size_bytes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id::text, org_id::text, owner_id::text, parent_id::text, name, mime_type, storage_key, size_bytes, trashed_at, created_at, updated_at`,
		orgID, ownerID, parentArg, name, mime, key, size,
	).Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		return File{}, fmt.Errorf("drive.insert: %w", err)
	}
	return f, nil
}

// Get fetches one file (any state).
func (r *Repository) Get(ctx context.Context, orgID, id string) (File, error) {
	var f File
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, org_id::text, owner_id::text, parent_id::text, name, mime_type, storage_key, size_bytes, trashed_at, created_at, updated_at
		 FROM grown.drive_files
		 WHERE org_id = $1 AND id = $2`,
		orgID, id,
	).Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return File{}, ErrNotFound
	}
	if err != nil {
		return File{}, fmt.Errorf("drive.Get: %w", err)
	}
	return f, nil
}

// GetByID fetches one file by id WITHOUT an org filter. This is used only on the
// grant path, after the caller has independently verified an object_grant for
// the requesting user — callers MUST NOT expose it without that check, or it
// leaks cross-org files. Use Get (org-scoped) for the normal path.
func (r *Repository) GetByID(ctx context.Context, id string) (File, error) {
	var f File
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, org_id::text, owner_id::text, parent_id::text, name, mime_type, storage_key, size_bytes, trashed_at, created_at, updated_at
		 FROM grown.drive_files
		 WHERE id = $1`,
		id,
	).Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return File{}, ErrNotFound
	}
	if err != nil {
		return File{}, fmt.Errorf("drive.GetByID: %w", err)
	}
	return f, nil
}

// GetByIDs returns the non-trashed files whose ids are in the given set, across
// any org. Used to materialize a user's "Shared with me" list from the ids
// returned by the sharing repo. Order is unspecified; the service sorts.
func (r *Repository) GetByIDs(ctx context.Context, ids []string) ([]File, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, org_id::text, owner_id::text, parent_id::text, name, mime_type, storage_key, size_bytes, trashed_at, created_at, updated_at
		 FROM grown.drive_files
		 WHERE id = ANY($1) AND trashed_at IS NULL
		 ORDER BY updated_at DESC`,
		ids,
	)
	if err != nil {
		return nil, fmt.Errorf("drive.GetByIDs: %w", err)
	}
	defer rows.Close()
	var out []File
	for rows.Next() {
		var f File
		if err := rows.Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ListChildren returns rows under `parent` (empty = root). `pageToken` is the
// last-seen file ID for cursor pagination (V1: simple, not stable across
// concurrent inserts — acceptable for the dashboard).
func (r *Repository) ListChildren(ctx context.Context, orgID, parent string, includeTrashed bool, pageSize int, pageToken string) ([]File, string, error) {
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 100
	}
	var parentClause string
	var args []interface{}
	args = append(args, orgID)
	if parent == "" {
		parentClause = "parent_id IS NULL"
	} else {
		args = append(args, parent)
		parentClause = "parent_id = $2"
	}
	trashClause := "trashed_at IS NULL"
	if includeTrashed {
		trashClause = "TRUE"
	}
	tokenClause := ""
	if pageToken != "" {
		args = append(args, pageToken)
		tokenClause = fmt.Sprintf("AND id > $%d", len(args))
	}
	query := fmt.Sprintf(
		`SELECT id::text, org_id::text, owner_id::text, parent_id::text, name, mime_type, storage_key, size_bytes, trashed_at, created_at, updated_at
		 FROM grown.drive_files
		 WHERE org_id = $1 AND %s AND %s %s
		 ORDER BY id
		 LIMIT %d`,
		parentClause, trashClause, tokenClause, pageSize+1,
	)
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, "", fmt.Errorf("drive.ListChildren: %w", err)
	}
	defer rows.Close()

	out := make([]File, 0, pageSize)
	for rows.Next() {
		var f File
		if err := rows.Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, "", err
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	next := ""
	if len(out) > pageSize {
		next = out[pageSize-1].ID
		out = out[:pageSize]
	}
	return out, next, nil
}

// UpdateNameOrParent renames or moves a file. Pass empty strings / nil to leave fields alone.
func (r *Repository) UpdateNameOrParent(ctx context.Context, orgID, id string, name string, parent *string) (File, error) {
	setClauses := []string{"updated_at = now()"}
	args := []interface{}{orgID, id}
	if name != "" {
		args = append(args, name)
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", len(args)))
	}
	if parent != nil {
		if *parent == "" {
			setClauses = append(setClauses, "parent_id = NULL")
		} else {
			args = append(args, *parent)
			setClauses = append(setClauses, fmt.Sprintf("parent_id = $%d", len(args)))
		}
	}
	query := fmt.Sprintf(
		`UPDATE grown.drive_files SET %s
		 WHERE org_id = $1 AND id = $2
		 RETURNING id::text, org_id::text, owner_id::text, parent_id::text, name, mime_type, storage_key, size_bytes, trashed_at, created_at, updated_at`,
		strings.Join(setClauses, ", "),
	)
	var f File
	err := r.pool.QueryRow(ctx, query, args...).Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return File{}, ErrNotFound
	}
	if err != nil {
		return File{}, fmt.Errorf("drive.Update: %w", err)
	}
	return f, nil
}

// Trash sets trashed_at = now().
func (r *Repository) Trash(ctx context.Context, orgID, id string) error {
	res, err := r.pool.Exec(ctx,
		`UPDATE grown.drive_files SET trashed_at = now() WHERE org_id = $1 AND id = $2 AND trashed_at IS NULL`,
		orgID, id,
	)
	if err != nil {
		return fmt.Errorf("drive.Trash: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Restore clears trashed_at.
func (r *Repository) Restore(ctx context.Context, orgID, id string) error {
	res, err := r.pool.Exec(ctx,
		`UPDATE grown.drive_files SET trashed_at = NULL WHERE org_id = $1 AND id = $2 AND trashed_at IS NOT NULL`,
		orgID, id,
	)
	if err != nil {
		return fmt.Errorf("drive.Restore: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListTrash returns trashed files in the org, ordered by trashed_at DESC.
func (r *Repository) ListTrash(ctx context.Context, orgID string, pageSize int, pageToken string) ([]File, string, error) {
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 100
	}
	args := []interface{}{orgID}
	tokenClause := ""
	if pageToken != "" {
		args = append(args, pageToken)
		tokenClause = fmt.Sprintf("AND id > $%d", len(args))
	}
	query := fmt.Sprintf(
		`SELECT id::text, org_id::text, owner_id::text, parent_id::text, name, mime_type, storage_key, size_bytes, trashed_at, created_at, updated_at
		 FROM grown.drive_files
		 WHERE org_id = $1 AND trashed_at IS NOT NULL %s
		 ORDER BY trashed_at DESC, id
		 LIMIT %d`,
		tokenClause, pageSize+1,
	)
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, "", fmt.Errorf("drive.ListTrash: %w", err)
	}
	defer rows.Close()
	out := make([]File, 0, pageSize)
	for rows.Next() {
		var f File
		if err := rows.Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, "", err
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	next := ""
	if len(out) > pageSize {
		next = out[pageSize-1].ID
		out = out[:pageSize]
	}
	return out, next, nil
}

// ListRecent returns non-trashed files across all folders in the org, ordered
// by updated_at DESC (most recently modified first).
func (r *Repository) ListRecent(ctx context.Context, orgID string, pageSize int, pageToken string) ([]File, string, error) {
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 50
	}
	args := []interface{}{orgID}
	tokenClause := ""
	if pageToken != "" {
		// Cursor: "updatedAt_unix:id". Decode the token.
		args = append(args, pageToken)
		tokenClause = fmt.Sprintf("AND id > $%d", len(args))
	}
	query := fmt.Sprintf(
		`SELECT id::text, org_id::text, owner_id::text, parent_id::text, name, mime_type, storage_key, size_bytes, trashed_at, created_at, updated_at
		 FROM grown.drive_files
		 WHERE org_id = $1 AND trashed_at IS NULL %s
		 ORDER BY updated_at DESC, id
		 LIMIT %d`,
		tokenClause, pageSize+1,
	)
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, "", fmt.Errorf("drive.ListRecent: %w", err)
	}
	defer rows.Close()
	out := make([]File, 0, pageSize)
	for rows.Next() {
		var f File
		if err := rows.Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, "", err
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	next := ""
	if len(out) > pageSize {
		next = out[pageSize-1].ID
		out = out[:pageSize]
	}
	return out, next, nil
}

// StarFile inserts a star for (userID, fileID). Idempotent (does nothing if
// already starred).
func (r *Repository) StarFile(ctx context.Context, userID, fileID string) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.drive_stars (user_id, file_id)
		 VALUES ($1, $2)
		 ON CONFLICT DO NOTHING`,
		userID, fileID,
	)
	if err != nil {
		return fmt.Errorf("drive.StarFile: %w", err)
	}
	return nil
}

// UnstarFile removes the star for (userID, fileID). No-op if not starred.
func (r *Repository) UnstarFile(ctx context.Context, userID, fileID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM grown.drive_stars WHERE user_id = $1 AND file_id = $2`,
		userID, fileID,
	)
	if err != nil {
		return fmt.Errorf("drive.UnstarFile: %w", err)
	}
	return nil
}

// IsStarred reports whether userID has starred fileID.
func (r *Repository) IsStarred(ctx context.Context, userID, fileID string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.drive_stars WHERE user_id = $1 AND file_id = $2)`,
		userID, fileID,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("drive.IsStarred: %w", err)
	}
	return exists, nil
}

// ListStarred returns non-trashed files starred by the given user (within any
// org). Results are ordered by starred_at DESC.
func (r *Repository) ListStarred(ctx context.Context, userID string, pageSize int, pageToken string) ([]File, string, error) {
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 100
	}
	args := []interface{}{userID}
	tokenClause := ""
	if pageToken != "" {
		args = append(args, pageToken)
		tokenClause = fmt.Sprintf("AND f.id > $%d", len(args))
	}
	query := fmt.Sprintf(
		`SELECT f.id::text, f.org_id::text, f.owner_id::text, f.parent_id::text, f.name, f.mime_type, f.storage_key, f.size_bytes, f.trashed_at, f.created_at, f.updated_at
		 FROM grown.drive_stars s
		 JOIN grown.drive_files f ON f.id = s.file_id
		 WHERE s.user_id = $1 AND f.trashed_at IS NULL %s
		 ORDER BY s.starred_at DESC, f.id
		 LIMIT %d`,
		tokenClause, pageSize+1,
	)
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, "", fmt.Errorf("drive.ListStarred: %w", err)
	}
	defer rows.Close()
	out := make([]File, 0, pageSize)
	for rows.Next() {
		var f File
		if err := rows.Scan(&f.ID, &f.OrgID, &f.OwnerID, &f.ParentID, &f.Name, &f.MimeType, &f.StorageKey, &f.SizeBytes, &f.TrashedAt, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, "", err
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	next := ""
	if len(out) > pageSize {
		next = out[pageSize-1].ID
		out = out[:pageSize]
	}
	return out, next, nil
}

// StarredFileIDs returns the set of file IDs (among the provided ids) that the
// user has starred. Used to annotate file lists with the caller's star state.
func (r *Repository) StarredFileIDs(ctx context.Context, userID string, fileIDs []string) (map[string]bool, error) {
	if len(fileIDs) == 0 {
		return nil, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT file_id::text FROM grown.drive_stars WHERE user_id = $1 AND file_id = ANY($2)`,
		userID, fileIDs,
	)
	if err != nil {
		return nil, fmt.Errorf("drive.StarredFileIDs: %w", err)
	}
	defer rows.Close()
	out := make(map[string]bool)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// PurgeTrashedOlderThan hard-deletes all trashed files whose trashed_at is
// older than d (e.g. 30*24*time.Hour). It returns the storage keys of all
// deleted file rows so callers can remove the corresponding blobs. This method
// is safe to run as a background cron job.
func (r *Repository) PurgeTrashedOlderThan(ctx context.Context, d time.Duration) ([]string, error) {
	cutoff := time.Now().Add(-d)
	rows, err := r.pool.Query(ctx,
		`DELETE FROM grown.drive_files
		 WHERE trashed_at IS NOT NULL AND trashed_at < $1
		 RETURNING storage_key`,
		cutoff,
	)
	if err != nil {
		return nil, fmt.Errorf("drive.PurgeTrashedOlderThan: %w", err)
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var key *string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		if key != nil && *key != "" {
			keys = append(keys, *key)
		}
	}
	return keys, rows.Err()
}

// DeleteForever removes the row, returning the storage_key so the caller can
// also delete the blob. Returns empty string for folders.
func (r *Repository) DeleteForever(ctx context.Context, orgID, id string) (string, error) {
	var key *string
	err := r.pool.QueryRow(ctx,
		`DELETE FROM grown.drive_files WHERE org_id = $1 AND id = $2 RETURNING storage_key`,
		orgID, id,
	).Scan(&key)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("drive.DeleteForever: %w", err)
	}
	if key == nil {
		return "", nil
	}
	return *key, nil
}

// FileVersion mirrors a grown.drive_file_versions row.
type FileVersion struct {
	ID          string
	FileID      string
	OrgID       string
	BlobKey     string
	SizeBytes   int64
	ContentType string
	UploadedBy  string
	CreatedAt   time.Time
}

// CreateVersion inserts a version snapshot row for a file. Typically called
// just before overwriting the file's current blob.
func (r *Repository) CreateVersion(ctx context.Context, orgID, fileID, blobKey, contentType, uploadedBy string, size int64) (FileVersion, error) {
	var v FileVersion
	var uploadedByArg interface{}
	if uploadedBy != "" {
		uploadedByArg = uploadedBy
	}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.drive_file_versions
		   (file_id, org_id, blob_key, size_bytes, content_type, uploaded_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id::text, file_id::text, org_id::text, blob_key, size_bytes, content_type, uploaded_by::text, created_at`,
		fileID, orgID, blobKey, size, contentType, uploadedByArg,
	).Scan(&v.ID, &v.FileID, &v.OrgID, &v.BlobKey, &v.SizeBytes, &v.ContentType, &v.UploadedBy, &v.CreatedAt)
	if err != nil {
		return FileVersion{}, fmt.Errorf("drive.CreateVersion: %w", err)
	}
	return v, nil
}

// ListVersions returns all version rows for a file, most-recent first.
func (r *Repository) ListVersions(ctx context.Context, orgID, fileID string) ([]FileVersion, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, file_id::text, org_id::text, blob_key, size_bytes, content_type, uploaded_by::text, created_at
		 FROM grown.drive_file_versions
		 WHERE org_id = $1 AND file_id = $2
		 ORDER BY created_at DESC`,
		orgID, fileID,
	)
	if err != nil {
		return nil, fmt.Errorf("drive.ListVersions: %w", err)
	}
	defer rows.Close()
	var out []FileVersion
	for rows.Next() {
		var v FileVersion
		if err := rows.Scan(&v.ID, &v.FileID, &v.OrgID, &v.BlobKey, &v.SizeBytes, &v.ContentType, &v.UploadedBy, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// GetVersion fetches a single version row, scoped to the org.
func (r *Repository) GetVersion(ctx context.Context, orgID, versionID string) (FileVersion, error) {
	var v FileVersion
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, file_id::text, org_id::text, blob_key, size_bytes, content_type, uploaded_by::text, created_at
		 FROM grown.drive_file_versions
		 WHERE org_id = $1 AND id = $2`,
		orgID, versionID,
	).Scan(&v.ID, &v.FileID, &v.OrgID, &v.BlobKey, &v.SizeBytes, &v.ContentType, &v.UploadedBy, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return FileVersion{}, ErrNotFound
	}
	if err != nil {
		return FileVersion{}, fmt.Errorf("drive.GetVersion: %w", err)
	}
	return v, nil
}

// ReplaceBlob atomically updates storage_key + size_bytes + mime_type on the
// file row and returns the OLD storage_key (so the caller can snapshot it as a
// version or roll back). Returns ErrNotFound when the file is absent/trashed.
//
// Postgres UPDATE does not natively return the pre-update value, so we use a
// CTE that reads the old row first, then updates it.
func (r *Repository) ReplaceBlob(ctx context.Context, orgID, fileID, newKey, newMime string, newSize int64) (oldKey string, err error) {
	var key *string
	err = r.pool.QueryRow(ctx,
		`WITH old AS (
		   SELECT storage_key FROM grown.drive_files
		   WHERE org_id = $1 AND id = $2 AND trashed_at IS NULL
		 )
		 UPDATE grown.drive_files f
		 SET storage_key = $3, size_bytes = $4, mime_type = $5, updated_at = now()
		 FROM old
		 WHERE f.org_id = $1 AND f.id = $2
		 RETURNING old.storage_key`,
		orgID, fileID, newKey, newSize, newMime,
	).Scan(&key)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("drive.ReplaceBlob: %w", err)
	}
	if key == nil {
		return "", nil
	}
	return *key, nil
}
