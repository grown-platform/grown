package versions

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGStore is the Postgres Store over grown.object_versions.
type PGStore struct {
	pool *pgxpool.Pool
}

// NewPGStore constructs a PGStore.
func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

const metaCols = `v.id::text, v.object_type, v.object_id::text, COALESCE(v.author_id::text, ''),
	COALESCE(NULLIF(u.display_name, ''), u.email, ''), v.label, v.data_hash, v.size_bytes,
	v.is_auto, COALESCE(v.restored_from::text, ''), v.created_at`

const fromJoin = ` FROM grown.object_versions v LEFT JOIN grown.users u ON u.id = v.author_id `

func scanMeta(row pgx.Row, extra ...any) (Version, error) {
	var v Version
	dest := []any{&v.ID, &v.ObjectType, &v.ObjectID, &v.AuthorID, &v.AuthorName, &v.Label,
		&v.DataHash, &v.SizeBytes, &v.IsAuto, &v.RestoredFrom, &v.CreatedAt}
	if len(extra) > 0 {
		dest = append(dest, &v.Data)
	}
	err := row.Scan(dest...)
	return v, err
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Insert stores v and returns it with id, author name and created_at filled.
func (s *PGStore) Insert(ctx context.Context, v Version) (Version, error) {
	q := `WITH ins AS (
	        INSERT INTO grown.object_versions
	          (object_type, object_id, author_id, label, data, data_hash, size_bytes, is_auto, restored_from)
	        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	        RETURNING *)
	      SELECT ` + metaCols + ` FROM ins v LEFT JOIN grown.users u ON u.id = v.author_id`
	out, err := scanMeta(s.pool.QueryRow(ctx, q, v.ObjectType, v.ObjectID, nullable(v.AuthorID),
		v.Label, v.Data, v.DataHash, v.SizeBytes, v.IsAuto, nullable(v.RestoredFrom)))
	if err != nil {
		return Version{}, fmt.Errorf("versions.Insert: %w", err)
	}
	return out, nil
}

// Latest returns the newest version's metadata.
func (s *PGStore) Latest(ctx context.Context, objectType, objectID string) (Version, bool, error) {
	v, err := scanMeta(s.pool.QueryRow(ctx, `SELECT `+metaCols+fromJoin+`
	    WHERE v.object_type = $1 AND v.object_id = $2
	    ORDER BY v.created_at DESC, v.id DESC LIMIT 1`, objectType, objectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Version{}, false, nil
	}
	if err != nil {
		return Version{}, false, fmt.Errorf("versions.Latest: %w", err)
	}
	return v, true, nil
}

// List returns the object's versions newest first, without data.
func (s *PGStore) List(ctx context.Context, objectType, objectID string) ([]Version, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+metaCols+fromJoin+`
	    WHERE v.object_type = $1 AND v.object_id = $2
	    ORDER BY v.created_at DESC, v.id DESC`, objectType, objectID)
	if err != nil {
		return nil, fmt.Errorf("versions.List: %w", err)
	}
	defer rows.Close()
	out := []Version{}
	for rows.Next() {
		v, err := scanMeta(rows)
		if err != nil {
			return nil, fmt.Errorf("versions.List scan: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// Get returns one version including data, scoped to the object.
func (s *PGStore) Get(ctx context.Context, objectType, objectID, versionID string) (Version, error) {
	v, err := scanMeta(s.pool.QueryRow(ctx, `SELECT `+metaCols+`, v.data`+fromJoin+`
	    WHERE v.object_type = $1 AND v.object_id = $2 AND v.id::text = $3`,
		objectType, objectID, versionID), true)
	if errors.Is(err, pgx.ErrNoRows) {
		return Version{}, ErrNotFound
	}
	if err != nil {
		return Version{}, fmt.Errorf("versions.Get: %w", err)
	}
	return v, nil
}

// SetLabel updates a version's label and auto flag.
func (s *PGStore) SetLabel(ctx context.Context, objectType, objectID, versionID, label string, isAuto bool) (Version, error) {
	q := `WITH upd AS (
	        UPDATE grown.object_versions SET label = $4, is_auto = $5
	        WHERE object_type = $1 AND object_id = $2 AND id::text = $3
	        RETURNING *)
	      SELECT ` + metaCols + ` FROM upd v LEFT JOIN grown.users u ON u.id = v.author_id`
	v, err := scanMeta(s.pool.QueryRow(ctx, q, objectType, objectID, versionID, label, isAuto))
	if errors.Is(err, pgx.ErrNoRows) {
		return Version{}, ErrNotFound
	}
	if err != nil {
		return Version{}, fmt.Errorf("versions.SetLabel: %w", err)
	}
	return v, nil
}

// CountNamed counts the object's labelled versions.
func (s *PGStore) CountNamed(ctx context.Context, objectType, objectID string) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM grown.object_versions
	    WHERE object_type = $1 AND object_id = $2 AND label <> ''`, objectType, objectID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("versions.CountNamed: %w", err)
	}
	return n, nil
}

// PruneAuto deletes auto snapshots beyond the newest keep.
func (s *PGStore) PruneAuto(ctx context.Context, objectType, objectID string, keep int) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM grown.object_versions WHERE id IN (
	    SELECT id FROM grown.object_versions
	    WHERE object_type = $1 AND object_id = $2 AND is_auto
	    ORDER BY created_at DESC, id DESC OFFSET $3)`, objectType, objectID, keep)
	if err != nil {
		return fmt.Errorf("versions.PruneAuto: %w", err)
	}
	return nil
}
