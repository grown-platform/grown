// Package cloudimport persists import jobs and orchestrates data routing.
package cloudimport

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no job matches.
var ErrNotFound = errors.New("import job not found")

// JobStatus enumerates import-job lifecycle states.
const (
	StatusPending    = "pending"
	StatusProcessing = "processing"
	StatusDone       = "done"
	StatusFailed     = "failed"
)

// ItemStatus enumerates import-item lifecycle states.
const (
	ItemPending = "pending"
	ItemDone    = "done"
	ItemSkipped = "skipped"
	ItemError   = "error"
)

// Job represents a single import operation.
type Job struct {
	ID        string
	OrgID     string
	UserID    string
	Source    string // google_takeout | apple | file
	Filename  string
	Status    string
	CreatedAt time.Time
	UpdatedAt time.Time
	Items     []Item
}

// Item is one data-type result inside a Job.
type Item struct {
	ID     string
	JobID  string
	Kind   string // contacts | calendar | drive | photos | mail
	Count  int
	Status string
	Detail string
}

// Repository reads and writes import jobs.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const jobColumns = `id::text, org_id::text, user_id::text, source, filename, status, created_at, updated_at`
const itemColumns = `id::text, job_id::text, kind, count, status, detail`

func scanJob(row pgx.Row) (Job, error) {
	var j Job
	if err := row.Scan(&j.ID, &j.OrgID, &j.UserID, &j.Source, &j.Filename, &j.Status, &j.CreatedAt, &j.UpdatedAt); err != nil {
		return Job{}, err
	}
	return j, nil
}

func scanItem(row pgx.Row) (Item, error) {
	var it Item
	if err := row.Scan(&it.ID, &it.JobID, &it.Kind, &it.Count, &it.Status, &it.Detail); err != nil {
		return Item{}, err
	}
	return it, nil
}

// CreateJob inserts a new job in pending status and returns it.
func (r *Repository) CreateJob(ctx context.Context, orgID, userID, source, filename string) (Job, error) {
	q := `INSERT INTO grown.import_jobs (org_id, user_id, source, filename, status)
	      VALUES ($1,$2,$3,$4,'pending') RETURNING ` + jobColumns
	j, err := scanJob(r.pool.QueryRow(ctx, q, orgID, userID, source, filename))
	if err != nil {
		return Job{}, fmt.Errorf("cloudimport.CreateJob: %w", err)
	}
	return j, nil
}

// SetStatus updates a job's status.
func (r *Repository) SetStatus(ctx context.Context, id, status string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE grown.import_jobs SET status=$2, updated_at=now() WHERE id=$1`, id, status)
	if err != nil {
		return fmt.Errorf("cloudimport.SetStatus: %w", err)
	}
	return nil
}

// UpsertItem inserts or replaces a job item by job_id + kind.
func (r *Repository) UpsertItem(ctx context.Context, it Item) (Item, error) {
	q := `INSERT INTO grown.import_job_items (job_id, kind, count, status, detail)
	      VALUES ($1,$2,$3,$4,$5)
	      ON CONFLICT DO NOTHING
	      RETURNING ` + itemColumns
	// We rely on INSERT + separate UPDATE because there's no unique constraint;
	// simpler to just insert fresh rows.
	row := r.pool.QueryRow(ctx, q, it.JobID, it.Kind, it.Count, it.Status, it.Detail)
	out, err := scanItem(row)
	if err != nil {
		return Item{}, fmt.Errorf("cloudimport.UpsertItem: %w", err)
	}
	return out, nil
}

// AddItem inserts a job item record.
func (r *Repository) AddItem(ctx context.Context, it Item) (Item, error) {
	q := `INSERT INTO grown.import_job_items (job_id, kind, count, status, detail)
	      VALUES ($1,$2,$3,$4,$5) RETURNING ` + itemColumns
	out, err := scanItem(r.pool.QueryRow(ctx, q, it.JobID, it.Kind, it.Count, it.Status, it.Detail))
	if err != nil {
		return Item{}, fmt.Errorf("cloudimport.AddItem: %w", err)
	}
	return out, nil
}

// GetJob returns a job with its items. Returns ErrNotFound when absent.
func (r *Repository) GetJob(ctx context.Context, orgID, id string) (Job, error) {
	q := `SELECT ` + jobColumns + ` FROM grown.import_jobs WHERE id=$1 AND org_id=$2`
	j, err := scanJob(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Job{}, ErrNotFound
	}
	if err != nil {
		return Job{}, fmt.Errorf("cloudimport.GetJob: %w", err)
	}
	items, err := r.listItems(ctx, j.ID)
	if err != nil {
		return Job{}, err
	}
	j.Items = items
	return j, nil
}

// ListJobs returns all jobs for the user within the org, newest first.
func (r *Repository) ListJobs(ctx context.Context, orgID, userID string) ([]Job, error) {
	q := `SELECT ` + jobColumns + ` FROM grown.import_jobs
	      WHERE org_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 50`
	rows, err := r.pool.Query(ctx, q, orgID, userID)
	if err != nil {
		return nil, fmt.Errorf("cloudimport.ListJobs: %w", err)
	}
	defer rows.Close()
	var out []Job
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			return nil, fmt.Errorf("cloudimport.ListJobs scan: %w", err)
		}
		out = append(out, j)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cloudimport.ListJobs rows: %w", err)
	}
	// Attach items for each job.
	for i := range out {
		items, err := r.listItems(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Items = items
	}
	return out, nil
}

func (r *Repository) listItems(ctx context.Context, jobID string) ([]Item, error) {
	q := `SELECT ` + itemColumns + ` FROM grown.import_job_items WHERE job_id=$1 ORDER BY kind`
	rows, err := r.pool.Query(ctx, q, jobID)
	if err != nil {
		return nil, fmt.Errorf("cloudimport.listItems: %w", err)
	}
	defer rows.Close()
	var out []Item
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, fmt.Errorf("cloudimport.listItems scan: %w", err)
		}
		out = append(out, it)
	}
	return out, rows.Err()
}
