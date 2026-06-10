// Package photos is the data-access + service layer for the photo library.
package photos

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no photo/album matches the given id (within the org).
var ErrNotFound = errors.New("not found")

// Photo is the in-memory representation of a grown.photos row.
type Photo struct {
	ID          string
	OrgID       string
	OwnerID     string
	Filename    string
	ContentType string
	Size        int64
	Width       int32
	Height      int32
	Description string
	Favorite    bool
	BlobKey     string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Album is the in-memory representation of a grown.photo_albums row, plus a
// derived photo count and (optionally) its photos.
type Album struct {
	ID           string
	OrgID        string
	OwnerID      string
	Title        string
	CoverPhotoID string
	PhotoCount   int32
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Photos       []Photo
}

// NewPhoto bundles the fields needed to insert a photo (after the blob is stored).
type NewPhoto struct {
	Filename    string
	ContentType string
	Size        int64
	Width       int32
	Height      int32
	BlobKey     string
}

// Repository reads and writes photos and albums.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const photoColumns = `id::text, org_id::text, owner_id::text, filename, content_type, size,
	width, height, description, favorite, blob_key, created_at, updated_at`

func scanPhoto(row pgx.Row) (Photo, error) {
	var p Photo
	err := row.Scan(&p.ID, &p.OrgID, &p.OwnerID, &p.Filename, &p.ContentType, &p.Size,
		&p.Width, &p.Height, &p.Description, &p.Favorite, &p.BlobKey, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return Photo{}, err
	}
	return p, nil
}

// CreatePhoto inserts a new photo's metadata.
func (r *Repository) CreatePhoto(ctx context.Context, orgID, ownerID string, np NewPhoto) (Photo, error) {
	q := `INSERT INTO grown.photos
		(org_id, owner_id, filename, content_type, size, width, height, blob_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING ` + photoColumns
	p, err := scanPhoto(r.pool.QueryRow(ctx, q, orgID, ownerID, np.Filename, np.ContentType,
		np.Size, np.Width, np.Height, np.BlobKey))
	if err != nil {
		return Photo{}, fmt.Errorf("photos.CreatePhoto: %w", err)
	}
	return p, nil
}

// GetPhoto returns a photo within orgID, or ErrNotFound.
func (r *Repository) GetPhoto(ctx context.Context, orgID, id string) (Photo, error) {
	q := `SELECT ` + photoColumns + ` FROM grown.photos WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`
	p, err := scanPhoto(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Photo{}, ErrNotFound
	}
	if err != nil {
		return Photo{}, fmt.Errorf("photos.GetPhoto: %w", err)
	}
	return p, nil
}

// ListPhotos returns non-trashed photos in orgID (newest first). When albumID is
// set, only photos in that album (ordered by when they were added, newest first).
// When favoritesOnly is set, only favorites.
func (r *Repository) ListPhotos(ctx context.Context, orgID, albumID string, favoritesOnly bool) ([]Photo, error) {
	var q string
	args := []interface{}{orgID}
	if albumID != "" {
		args = append(args, albumID)
		q = `SELECT ` + prefixedPhotoColumns("p") + `
			FROM grown.photos p
			JOIN grown.album_photos ap ON ap.photo_id = p.id
			WHERE p.org_id=$1 AND ap.album_id=$2 AND p.trashed_at IS NULL`
		if favoritesOnly {
			q += ` AND p.favorite = true`
		}
		q += ` ORDER BY ap.added_at DESC, p.created_at DESC`
	} else {
		q = `SELECT ` + photoColumns + ` FROM grown.photos WHERE org_id=$1 AND trashed_at IS NULL`
		if favoritesOnly {
			q += ` AND favorite = true`
		}
		q += ` ORDER BY created_at DESC`
	}
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("photos.ListPhotos: %w", err)
	}
	defer rows.Close()
	var out []Photo
	for rows.Next() {
		p, err := scanPhoto(rows)
		if err != nil {
			return nil, fmt.Errorf("photos.ListPhotos scan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// prefixedPhotoColumns returns photoColumns with a table alias prefix.
func prefixedPhotoColumns(alias string) string {
	return alias + `.id::text, ` + alias + `.org_id::text, ` + alias + `.owner_id::text, ` +
		alias + `.filename, ` + alias + `.content_type, ` + alias + `.size, ` +
		alias + `.width, ` + alias + `.height, ` + alias + `.description, ` +
		alias + `.favorite, ` + alias + `.blob_key, ` + alias + `.created_at, ` + alias + `.updated_at`
}

// PhotoFields are the editable metadata of a photo.
type PhotoFields struct {
	Description string
	Favorite    bool
}

// UpdatePhoto edits a photo's metadata within orgID.
func (r *Repository) UpdatePhoto(ctx context.Context, orgID, id string, f PhotoFields) (Photo, error) {
	q := `UPDATE grown.photos SET description=$3, favorite=$4, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + photoColumns
	p, err := scanPhoto(r.pool.QueryRow(ctx, q, id, orgID, f.Description, f.Favorite))
	if errors.Is(err, pgx.ErrNoRows) {
		return Photo{}, ErrNotFound
	}
	if err != nil {
		return Photo{}, fmt.Errorf("photos.UpdatePhoto: %w", err)
	}
	return p, nil
}

// DeletePhoto soft-deletes a photo within orgID and returns its blob key so the
// caller can remove the underlying object. Also unlinks it from any albums.
func (r *Repository) DeletePhoto(ctx context.Context, orgID, id string) (string, error) {
	var blobKey string
	err := r.pool.QueryRow(ctx,
		`UPDATE grown.photos SET trashed_at=now(), updated_at=now()
		 WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		 RETURNING blob_key`, id, orgID).Scan(&blobKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("photos.DeletePhoto: %w", err)
	}
	if _, err := r.pool.Exec(ctx, `DELETE FROM grown.album_photos WHERE photo_id=$1`, id); err != nil {
		return "", fmt.Errorf("photos.DeletePhoto unlink: %w", err)
	}
	return blobKey, nil
}

// --- Albums ---

const albumColumns = `a.id::text, a.org_id::text, a.owner_id::text, a.title,
	COALESCE(a.cover_photo_id::text, ''), a.created_at, a.updated_at,
	(SELECT count(*) FROM grown.album_photos ap
	 JOIN grown.photos p ON p.id = ap.photo_id
	 WHERE ap.album_id = a.id AND p.trashed_at IS NULL)::int`

func scanAlbum(row pgx.Row) (Album, error) {
	var a Album
	err := row.Scan(&a.ID, &a.OrgID, &a.OwnerID, &a.Title, &a.CoverPhotoID,
		&a.CreatedAt, &a.UpdatedAt, &a.PhotoCount)
	if err != nil {
		return Album{}, err
	}
	return a, nil
}

// CreateAlbum inserts a new album and optionally adds initial photos.
func (r *Repository) CreateAlbum(ctx context.Context, orgID, ownerID, title string, photoIDs []string) (Album, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.photo_albums (org_id, owner_id, title) VALUES ($1,$2,$3) RETURNING id::text`,
		orgID, ownerID, title).Scan(&id)
	if err != nil {
		return Album{}, fmt.Errorf("photos.CreateAlbum: %w", err)
	}
	if len(photoIDs) > 0 {
		if err := r.addToAlbum(ctx, orgID, id, photoIDs); err != nil {
			return Album{}, err
		}
	}
	return r.GetAlbum(ctx, orgID, id)
}

// GetAlbum returns an album within orgID (without its photos). Use ListPhotos
// with the album id to fetch its photos.
func (r *Repository) GetAlbum(ctx context.Context, orgID, id string) (Album, error) {
	q := `SELECT ` + albumColumns + ` FROM grown.photo_albums a WHERE a.id=$1 AND a.org_id=$2`
	a, err := scanAlbum(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Album{}, ErrNotFound
	}
	if err != nil {
		return Album{}, fmt.Errorf("photos.GetAlbum: %w", err)
	}
	return a, nil
}

// ListAlbums returns all albums in orgID (newest first).
func (r *Repository) ListAlbums(ctx context.Context, orgID string) ([]Album, error) {
	q := `SELECT ` + albumColumns + ` FROM grown.photo_albums a WHERE a.org_id=$1 ORDER BY a.created_at DESC`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("photos.ListAlbums: %w", err)
	}
	defer rows.Close()
	var out []Album
	for rows.Next() {
		a, err := scanAlbum(rows)
		if err != nil {
			return nil, fmt.Errorf("photos.ListAlbums scan: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// AlbumFields are the editable attributes of an album.
type AlbumFields struct {
	Title        string
	CoverPhotoID string // empty leaves the cover unchanged is NOT assumed; see UpdateAlbum
}

// UpdateAlbum sets an album's title and cover photo. A blank cover_photo_id
// clears the cover.
func (r *Repository) UpdateAlbum(ctx context.Context, orgID, id, title, coverPhotoID string) (Album, error) {
	var cover interface{}
	if coverPhotoID != "" {
		cover = coverPhotoID
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.photo_albums SET title=$3, cover_photo_id=$4, updated_at=now()
		 WHERE id=$1 AND org_id=$2`, id, orgID, title, cover)
	if err != nil {
		return Album{}, fmt.Errorf("photos.UpdateAlbum: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Album{}, ErrNotFound
	}
	return r.GetAlbum(ctx, orgID, id)
}

// DeleteAlbum removes an album (the album_photos rows cascade; photos remain).
func (r *Repository) DeleteAlbum(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM grown.photo_albums WHERE id=$1 AND org_id=$2`, id, orgID)
	if err != nil {
		return fmt.Errorf("photos.DeleteAlbum: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AddToAlbum adds photos to an album (idempotent per photo). Validates the album
// belongs to orgID first.
func (r *Repository) AddToAlbum(ctx context.Context, orgID, albumID string, photoIDs []string) (Album, error) {
	if _, err := r.GetAlbum(ctx, orgID, albumID); err != nil {
		return Album{}, err
	}
	if err := r.addToAlbum(ctx, orgID, albumID, photoIDs); err != nil {
		return Album{}, err
	}
	return r.GetAlbum(ctx, orgID, albumID)
}

// addToAlbum inserts album_photos rows for photos that belong to orgID, skipping
// duplicates. It also sets the album cover to the last added photo when the
// album has no cover yet.
func (r *Repository) addToAlbum(ctx context.Context, orgID, albumID string, photoIDs []string) error {
	for _, pid := range photoIDs {
		// Only link photos that actually belong to this org and aren't trashed.
		tag, err := r.pool.Exec(ctx,
			`INSERT INTO grown.album_photos (album_id, photo_id)
			 SELECT $1, $2 WHERE EXISTS (
			   SELECT 1 FROM grown.photos WHERE id=$2 AND org_id=$3 AND trashed_at IS NULL)
			 ON CONFLICT (album_id, photo_id) DO NOTHING`, albumID, pid, orgID)
		if err != nil {
			return fmt.Errorf("photos.addToAlbum: %w", err)
		}
		if tag.RowsAffected() > 0 {
			// Set as cover if the album has none.
			if _, err := r.pool.Exec(ctx,
				`UPDATE grown.photo_albums SET cover_photo_id=$2, updated_at=now()
				 WHERE id=$1 AND cover_photo_id IS NULL`, albumID, pid); err != nil {
				return fmt.Errorf("photos.addToAlbum cover: %w", err)
			}
		}
	}
	return nil
}

// RemoveFromAlbum removes a photo from an album. If the photo was the cover, the
// cover falls back to the most recently added remaining photo.
func (r *Repository) RemoveFromAlbum(ctx context.Context, orgID, albumID, photoID string) (Album, error) {
	if _, err := r.GetAlbum(ctx, orgID, albumID); err != nil {
		return Album{}, err
	}
	if _, err := r.pool.Exec(ctx,
		`DELETE FROM grown.album_photos WHERE album_id=$1 AND photo_id=$2`, albumID, photoID); err != nil {
		return Album{}, fmt.Errorf("photos.RemoveFromAlbum: %w", err)
	}
	// If we removed the cover, pick a new one (newest remaining), else clear.
	if _, err := r.pool.Exec(ctx,
		`UPDATE grown.photo_albums a SET cover_photo_id = (
			SELECT ap.photo_id FROM grown.album_photos ap
			JOIN grown.photos p ON p.id = ap.photo_id
			WHERE ap.album_id = a.id AND p.trashed_at IS NULL
			ORDER BY ap.added_at DESC LIMIT 1
		 ), updated_at=now()
		 WHERE a.id=$1 AND a.cover_photo_id=$2`, albumID, photoID); err != nil {
		return Album{}, fmt.Errorf("photos.RemoveFromAlbum cover: %w", err)
	}
	return r.GetAlbum(ctx, orgID, albumID)
}
