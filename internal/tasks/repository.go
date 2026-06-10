// Package tasks is the data-access + service layer for task lists and tasks
// (a Google Tasks clone).
package tasks

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no record matches the given id (within the org).
var ErrNotFound = errors.New("not found")

// List is the in-memory representation of a grown.task_lists row.
type List struct {
	ID          string
	OrgID       string
	OwnerUserID string
	Name        string
	Position    int32
	CreatedAt   time.Time
}

// TaskItem is the in-memory representation of a grown.tasks row.
type TaskItem struct {
	ID           string
	OrgID        string
	ListID       string
	OwnerUserID  string
	Title        string
	Notes        string
	DueAt        *time.Time
	Completed    bool
	CompletedAt  *time.Time
	ParentTaskID string
	Position     int32
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// ListFields bundles editable attributes for a task list.
type ListFields struct {
	Name string
}

// TaskFields bundles editable attributes for a task.
type TaskFields struct {
	Title        string
	Notes        string
	DueAt        *time.Time
	ParentTaskID string
}

// Repository reads and writes task lists and tasks.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// ----- Task lists -----

const listColumns = `id::text, org_id::text, owner_user_id::text, name, position, created_at`

func scanList(row pgx.Row) (List, error) {
	var l List
	err := row.Scan(&l.ID, &l.OrgID, &l.OwnerUserID, &l.Name, &l.Position, &l.CreatedAt)
	if err != nil {
		return List{}, err
	}
	return l, nil
}

// CreateList inserts a new task list.
func (r *Repository) CreateList(ctx context.Context, orgID, ownerUserID string, f ListFields) (List, error) {
	q := `INSERT INTO grown.task_lists (org_id, owner_user_id, name, position)
		VALUES ($1, $2, $3,
			COALESCE((SELECT MAX(position)+1 FROM grown.task_lists WHERE org_id=$1 AND owner_user_id=$2), 0))
		RETURNING ` + listColumns
	l, err := scanList(r.pool.QueryRow(ctx, q, orgID, ownerUserID, f.Name))
	if err != nil {
		return List{}, fmt.Errorf("tasks.CreateList: %w", err)
	}
	return l, nil
}

// ListLists returns all task lists for the owner in orgID, ordered by position.
func (r *Repository) ListLists(ctx context.Context, orgID, ownerUserID string) ([]List, error) {
	q := `SELECT ` + listColumns + ` FROM grown.task_lists
		WHERE org_id=$1 AND owner_user_id=$2
		ORDER BY position, created_at`
	rows, err := r.pool.Query(ctx, q, orgID, ownerUserID)
	if err != nil {
		return nil, fmt.Errorf("tasks.ListLists: %w", err)
	}
	defer rows.Close()
	var out []List
	for rows.Next() {
		l, err := scanList(rows)
		if err != nil {
			return nil, fmt.Errorf("tasks.ListLists scan: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// UpdateList renames a task list within orgID.
func (r *Repository) UpdateList(ctx context.Context, orgID, id string, f ListFields) (List, error) {
	q := `UPDATE grown.task_lists SET name=$3
		WHERE id=$1 AND org_id=$2
		RETURNING ` + listColumns
	l, err := scanList(r.pool.QueryRow(ctx, q, id, orgID, f.Name))
	if errors.Is(err, pgx.ErrNoRows) {
		return List{}, ErrNotFound
	}
	if err != nil {
		return List{}, fmt.Errorf("tasks.UpdateList: %w", err)
	}
	return l, nil
}

// DeleteList hard-deletes a task list (tasks cascade).
func (r *Repository) DeleteList(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.task_lists WHERE id=$1 AND org_id=$2`, id, orgID)
	if err != nil {
		return fmt.Errorf("tasks.DeleteList: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ----- Tasks -----

const taskColumns = `id::text, org_id::text, list_id::text, owner_user_id::text,
	title, notes, due_at, completed, completed_at,
	COALESCE(parent_task_id::text, ''), position, created_at, updated_at`

func scanTask(row pgx.Row) (TaskItem, error) {
	var t TaskItem
	err := row.Scan(&t.ID, &t.OrgID, &t.ListID, &t.OwnerUserID,
		&t.Title, &t.Notes, &t.DueAt, &t.Completed, &t.CompletedAt,
		&t.ParentTaskID, &t.Position, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return TaskItem{}, err
	}
	return t, nil
}

// CreateTask inserts a new task.
func (r *Repository) CreateTask(ctx context.Context, orgID, listID, ownerUserID string, f TaskFields) (TaskItem, error) {
	var parentID *string
	if f.ParentTaskID != "" {
		parentID = &f.ParentTaskID
	}
	q := `INSERT INTO grown.tasks
		(org_id, list_id, owner_user_id, title, notes, due_at, parent_task_id, position)
		VALUES ($1, $2, $3, $4, $5, $6, $7,
			COALESCE((SELECT MAX(position)+1 FROM grown.tasks WHERE list_id=$2), 0))
		RETURNING ` + taskColumns
	t, err := scanTask(r.pool.QueryRow(ctx, q, orgID, listID, ownerUserID,
		f.Title, f.Notes, f.DueAt, parentID))
	if err != nil {
		return TaskItem{}, fmt.Errorf("tasks.CreateTask: %w", err)
	}
	return t, nil
}

// ListTasks returns all tasks in listID within orgID, ordered by position.
func (r *Repository) ListTasks(ctx context.Context, orgID, listID string) ([]TaskItem, error) {
	q := `SELECT ` + taskColumns + ` FROM grown.tasks
		WHERE org_id=$1 AND list_id=$2
		ORDER BY position, created_at`
	rows, err := r.pool.Query(ctx, q, orgID, listID)
	if err != nil {
		return nil, fmt.Errorf("tasks.ListTasks: %w", err)
	}
	defer rows.Close()
	var out []TaskItem
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, fmt.Errorf("tasks.ListTasks scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetTask returns a task by id within orgID.
func (r *Repository) GetTask(ctx context.Context, orgID, id string) (TaskItem, error) {
	q := `SELECT ` + taskColumns + ` FROM grown.tasks WHERE id=$1 AND org_id=$2`
	t, err := scanTask(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return TaskItem{}, ErrNotFound
	}
	if err != nil {
		return TaskItem{}, fmt.Errorf("tasks.GetTask: %w", err)
	}
	return t, nil
}

// UpdateTask replaces editable fields of a task.
func (r *Repository) UpdateTask(ctx context.Context, orgID, id string, f TaskFields) (TaskItem, error) {
	var parentID *string
	if f.ParentTaskID != "" {
		parentID = &f.ParentTaskID
	}
	q := `UPDATE grown.tasks SET
		title=$3, notes=$4, due_at=$5, parent_task_id=$6, updated_at=now()
		WHERE id=$1 AND org_id=$2
		RETURNING ` + taskColumns
	t, err := scanTask(r.pool.QueryRow(ctx, q, id, orgID,
		f.Title, f.Notes, f.DueAt, parentID))
	if errors.Is(err, pgx.ErrNoRows) {
		return TaskItem{}, ErrNotFound
	}
	if err != nil {
		return TaskItem{}, fmt.Errorf("tasks.UpdateTask: %w", err)
	}
	return t, nil
}

// DeleteTask hard-deletes a task (subtasks cascade).
func (r *Repository) DeleteTask(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.tasks WHERE id=$1 AND org_id=$2`, id, orgID)
	if err != nil {
		return fmt.Errorf("tasks.DeleteTask: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ToggleTask flips the completed flag.
func (r *Repository) ToggleTask(ctx context.Context, orgID, id string) (TaskItem, error) {
	q := `UPDATE grown.tasks SET
		completed = NOT completed,
		completed_at = CASE WHEN NOT completed THEN now() ELSE NULL END,
		updated_at = now()
		WHERE id=$1 AND org_id=$2
		RETURNING ` + taskColumns
	t, err := scanTask(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return TaskItem{}, ErrNotFound
	}
	if err != nil {
		return TaskItem{}, fmt.Errorf("tasks.ToggleTask: %w", err)
	}
	return t, nil
}

// ReorderTask moves a task to the given position by shifting siblings.
func (r *Repository) ReorderTask(ctx context.Context, orgID, id string, newPos int32) (TaskItem, error) {
	// Read current task to get listID and current position.
	cur, err := r.GetTask(ctx, orgID, id)
	if err != nil {
		return TaskItem{}, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return TaskItem{}, fmt.Errorf("tasks.ReorderTask begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Shift sibling positions to open space at newPos.
	if newPos > cur.Position {
		_, err = tx.Exec(ctx,
			`UPDATE grown.tasks SET position = position - 1
			 WHERE list_id = $1 AND position > $2 AND position <= $3 AND id != $4`,
			cur.ListID, cur.Position, newPos, id)
	} else {
		_, err = tx.Exec(ctx,
			`UPDATE grown.tasks SET position = position + 1
			 WHERE list_id = $1 AND position >= $2 AND position < $3 AND id != $4`,
			cur.ListID, newPos, cur.Position, id)
	}
	if err != nil {
		return TaskItem{}, fmt.Errorf("tasks.ReorderTask shift: %w", err)
	}

	q := `UPDATE grown.tasks SET position=$3, updated_at=now()
		WHERE id=$1 AND org_id=$2
		RETURNING ` + taskColumns
	t, err := scanTask(tx.QueryRow(ctx, q, id, orgID, newPos))
	if err != nil {
		return TaskItem{}, fmt.Errorf("tasks.ReorderTask update: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return TaskItem{}, fmt.Errorf("tasks.ReorderTask commit: %w", err)
	}
	return t, nil
}
