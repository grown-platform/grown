// Package groups is the data-access + service layer for Groups (a Google
// Groups clone: per-org mailing lists / forums with topics and posts).
package groups

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no row matches the given id within the org.
var ErrNotFound = errors.New("not found")

// ── Domain types ─────────────────────────────────────────────────────────────

// Group is the in-memory representation of a grown.groups row, plus
// denormalized counts populated by List/Get.
type Group struct {
	ID          string
	OrgID       string
	OwnerID     string
	Name        string
	Email       string
	Description string
	MemberIDs   []string
	MemberCount int32
	TopicCount  int32
	PostCount   int32
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Topic is a conversation thread within a group.
type Topic struct {
	ID         string
	GroupID    string
	OrgID      string
	Subject    string
	AuthorID   string
	AuthorName string
	PostCount  int32
	LastPostAt *time.Time
	CreatedAt  time.Time
}

// Post is a single message within a topic.
type Post struct {
	ID         string
	TopicID    string
	GroupID    string
	OrgID      string
	AuthorID   string
	AuthorName string
	Body       string
	CreatedAt  time.Time
}

// Member is an org user that can be added to a group.
type Member struct {
	ID    string
	Name  string
	Email string
}

// GroupFields bundles the editable attributes of a group (Create/Update).
type GroupFields struct {
	Name        string
	Email       string
	Description string
	MemberIDs   []string
}

// Repository reads and writes groups, topics and posts.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func jsonArr(s []string) []byte {
	if s == nil {
		s = []string{}
	}
	b, _ := json.Marshal(s)
	return b
}

// ── Members ──────────────────────────────────────────────────────────────────

// ListMembers returns the org's users (for the group member picker).
func (r *Repository) ListMembers(ctx context.Context, orgID string) ([]Member, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, COALESCE(NULLIF(display_name,''), email, ''), COALESCE(email,'')
		 FROM grown.users WHERE org_id=$1 ORDER BY lower(COALESCE(NULLIF(display_name,''), email))`, orgID)
	if err != nil {
		return nil, fmt.Errorf("groups.ListMembers: %w", err)
	}
	defer rows.Close()
	var out []Member
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.ID, &m.Name, &m.Email); err != nil {
			return nil, fmt.Errorf("groups.ListMembers scan: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ── Groups ───────────────────────────────────────────────────────────────────

// groupColumns is the base column list shared by group reads. The aggregate
// counts are appended per-query (they reference the topics/posts tables).
const groupColumns = `g.id::text, g.org_id::text, g.owner_id::text, g.name, g.email,
	g.description, g.member_ids, g.created_at, g.updated_at`

// countExprs produces the denormalized counts for a group row.
const countExprs = `
	COALESCE(jsonb_array_length(g.member_ids), 0)::int AS member_count,
	(SELECT COUNT(*) FROM grown.group_topics t WHERE t.group_id = g.id)::int AS topic_count,
	(SELECT COUNT(*) FROM grown.group_posts  p WHERE p.group_id = g.id)::int AS post_count`

func scanGroup(row pgx.Row) (Group, error) {
	var g Group
	var memberJSON []byte
	err := row.Scan(&g.ID, &g.OrgID, &g.OwnerID, &g.Name, &g.Email, &g.Description,
		&memberJSON, &g.CreatedAt, &g.UpdatedAt, &g.MemberCount, &g.TopicCount, &g.PostCount)
	if err != nil {
		return Group{}, err
	}
	_ = json.Unmarshal(memberJSON, &g.MemberIDs)
	if g.MemberIDs == nil {
		g.MemberIDs = []string{}
	}
	return g, nil
}

// Create inserts a new group owned by ownerID.
func (r *Repository) Create(ctx context.Context, orgID, ownerID string, f GroupFields) (Group, error) {
	q := `WITH ins AS (
		    INSERT INTO grown.groups (org_id, owner_id, name, email, description, member_ids)
		    VALUES ($1,$2,$3,$4,$5,$6)
		    RETURNING *
		)
		SELECT ` + groupColumns + `, ` + countExprs + ` FROM ins g`
	g, err := scanGroup(r.pool.QueryRow(ctx, q, orgID, ownerID, f.Name, f.Email, f.Description, jsonArr(f.MemberIDs)))
	if err != nil {
		return Group{}, fmt.Errorf("groups.Create: %w", err)
	}
	return g, nil
}

// Get returns a group within orgID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Group, error) {
	q := `SELECT ` + groupColumns + `, ` + countExprs + `
		FROM grown.groups g WHERE g.id=$1 AND g.org_id=$2`
	g, err := scanGroup(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Group{}, ErrNotFound
	}
	if err != nil {
		return Group{}, fmt.Errorf("groups.Get: %w", err)
	}
	return g, nil
}

// List returns all groups in orgID, ordered by name.
func (r *Repository) List(ctx context.Context, orgID string) ([]Group, error) {
	q := `SELECT ` + groupColumns + `, ` + countExprs + `
		FROM grown.groups g WHERE g.org_id=$1
		ORDER BY lower(g.name), g.created_at`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("groups.List: %w", err)
	}
	defer rows.Close()
	var out []Group
	for rows.Next() {
		g, err := scanGroup(rows)
		if err != nil {
			return nil, fmt.Errorf("groups.List scan: %w", err)
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// Update replaces the editable fields of a group (including members) within orgID.
func (r *Repository) Update(ctx context.Context, orgID, id string, f GroupFields) (Group, error) {
	q := `WITH upd AS (
		    UPDATE grown.groups SET
		      name=$3, email=$4, description=$5, member_ids=$6, updated_at=now()
		    WHERE id=$1 AND org_id=$2
		    RETURNING *
		)
		SELECT ` + groupColumns + `, ` + countExprs + ` FROM upd g`
	g, err := scanGroup(r.pool.QueryRow(ctx, q, id, orgID, f.Name, f.Email, f.Description, jsonArr(f.MemberIDs)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Group{}, ErrNotFound
	}
	if err != nil {
		return Group{}, fmt.Errorf("groups.Update: %w", err)
	}
	return g, nil
}

// Delete removes a group within orgID (topics/posts cascade).
func (r *Repository) Delete(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM grown.groups WHERE id=$1 AND org_id=$2`, id, orgID)
	if err != nil {
		return fmt.Errorf("groups.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Topics ───────────────────────────────────────────────────────────────────

const topicColumns = `t.id::text, t.group_id::text, t.org_id::text, t.subject,
	t.author_id::text, t.author_name, t.last_post_at, t.created_at,
	(SELECT COUNT(*) FROM grown.group_posts p WHERE p.topic_id = t.id)::int AS post_count`

func scanTopic(row pgx.Row) (Topic, error) {
	var t Topic
	var lastAt *time.Time
	err := row.Scan(&t.ID, &t.GroupID, &t.OrgID, &t.Subject, &t.AuthorID, &t.AuthorName,
		&lastAt, &t.CreatedAt, &t.PostCount)
	if err != nil {
		return Topic{}, err
	}
	t.LastPostAt = lastAt
	return t, nil
}

// GroupExists reports whether a group with id exists within orgID.
func (r *Repository) GroupExists(ctx context.Context, orgID, groupID string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.groups WHERE id=$1 AND org_id=$2)`, groupID, orgID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("groups.GroupExists: %w", err)
	}
	return exists, nil
}

// ListTopics returns the topics in a group, newest activity first.
func (r *Repository) ListTopics(ctx context.Context, orgID, groupID string) ([]Topic, error) {
	q := `SELECT ` + topicColumns + ` FROM grown.group_topics t
		WHERE t.group_id=$1 AND t.org_id=$2
		ORDER BY t.last_post_at DESC NULLS LAST, t.created_at DESC`
	rows, err := r.pool.Query(ctx, q, groupID, orgID)
	if err != nil {
		return nil, fmt.Errorf("groups.ListTopics: %w", err)
	}
	defer rows.Close()
	var out []Topic
	for rows.Next() {
		t, err := scanTopic(rows)
		if err != nil {
			return nil, fmt.Errorf("groups.ListTopics scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// CreateTopic inserts a topic and, when body is non-empty, an initial post in
// the same transaction. last_post_at is set to the topic's creation time.
func (r *Repository) CreateTopic(ctx context.Context, orgID, groupID, authorID, authorName, subject, body string) (Topic, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Topic{}, fmt.Errorf("groups.CreateTopic begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	q := `WITH ins AS (
		    INSERT INTO grown.group_topics (group_id, org_id, subject, author_id, author_name, last_post_at)
		    VALUES ($1,$2,$3,$4,$5, now())
		    RETURNING *
		)
		SELECT ` + topicColumns + ` FROM ins t`
	t, err := scanTopic(tx.QueryRow(ctx, q, groupID, orgID, subject, authorID, authorName))
	if err != nil {
		return Topic{}, fmt.Errorf("groups.CreateTopic insert: %w", err)
	}

	if body != "" {
		if _, err := tx.Exec(ctx,
			`INSERT INTO grown.group_posts (topic_id, group_id, org_id, author_id, author_name, body)
			 VALUES ($1,$2,$3,$4,$5,$6)`,
			t.ID, groupID, orgID, authorID, authorName, body); err != nil {
			return Topic{}, fmt.Errorf("groups.CreateTopic first post: %w", err)
		}
		t.PostCount = 1
	}

	if err := tx.Commit(ctx); err != nil {
		return Topic{}, fmt.Errorf("groups.CreateTopic commit: %w", err)
	}
	return t, nil
}

// ── Posts ────────────────────────────────────────────────────────────────────

const postColumns = `id::text, topic_id::text, group_id::text, org_id::text,
	author_id::text, author_name, body, created_at`

func scanPost(row pgx.Row) (Post, error) {
	var p Post
	err := row.Scan(&p.ID, &p.TopicID, &p.GroupID, &p.OrgID, &p.AuthorID, &p.AuthorName, &p.Body, &p.CreatedAt)
	if err != nil {
		return Post{}, err
	}
	return p, nil
}

// TopicGroup returns the group id owning a topic within orgID, or ErrNotFound.
func (r *Repository) TopicGroup(ctx context.Context, orgID, topicID string) (string, error) {
	var groupID string
	err := r.pool.QueryRow(ctx,
		`SELECT group_id::text FROM grown.group_topics WHERE id=$1 AND org_id=$2`, topicID, orgID).Scan(&groupID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("groups.TopicGroup: %w", err)
	}
	return groupID, nil
}

// ListPosts returns the posts in a topic, oldest first.
func (r *Repository) ListPosts(ctx context.Context, orgID, topicID string) ([]Post, error) {
	q := `SELECT ` + postColumns + ` FROM grown.group_posts
		WHERE topic_id=$1 AND org_id=$2 ORDER BY created_at`
	rows, err := r.pool.Query(ctx, q, topicID, orgID)
	if err != nil {
		return nil, fmt.Errorf("groups.ListPosts: %w", err)
	}
	defer rows.Close()
	var out []Post
	for rows.Next() {
		p, err := scanPost(rows)
		if err != nil {
			return nil, fmt.Errorf("groups.ListPosts scan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreatePost inserts a post in topicID and bumps the topic's last_post_at. The
// owning group is looked up so the post denormalizes its group_id.
func (r *Repository) CreatePost(ctx context.Context, orgID, topicID, authorID, authorName, body string) (Post, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Post{}, fmt.Errorf("groups.CreatePost begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var groupID string
	err = tx.QueryRow(ctx,
		`SELECT group_id::text FROM grown.group_topics WHERE id=$1 AND org_id=$2`, topicID, orgID).Scan(&groupID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Post{}, ErrNotFound
	}
	if err != nil {
		return Post{}, fmt.Errorf("groups.CreatePost lookup: %w", err)
	}

	q := `INSERT INTO grown.group_posts (topic_id, group_id, org_id, author_id, author_name, body)
	      VALUES ($1,$2,$3,$4,$5,$6)
	      RETURNING ` + postColumns
	p, err := scanPost(tx.QueryRow(ctx, q, topicID, groupID, orgID, authorID, authorName, body))
	if err != nil {
		return Post{}, fmt.Errorf("groups.CreatePost insert: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE grown.group_topics SET last_post_at=now() WHERE id=$1`, topicID); err != nil {
		return Post{}, fmt.Errorf("groups.CreatePost bump topic: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Post{}, fmt.Errorf("groups.CreatePost commit: %w", err)
	}
	return p, nil
}
