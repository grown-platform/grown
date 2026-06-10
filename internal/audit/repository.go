// Package audit is the cross-cutting activity trail for grown-workspace. It
// records mutating actions across every built-in service — gRPC RPCs (via a
// unary interceptor) and raw upload/download/stream HTTP routes (via a handler
// middleware) — into grown.audit_events, and exposes an admin-gated viewer.
//
// The package is intentionally dependency-light: pure database/SQL (pgx) +
// net/http + the auth context helpers. It does NOT import the generated protos
// (gen/), so it builds standalone, exactly like internal/adminusers.
package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Event is one row of grown.audit_events. Fields left zero are stored as their
// SQL defaults (empty string / '{}' / NULL actor).
type Event struct {
	ID           string         // set by the DB; populated on read
	OrgID        string         // required: events with an empty org are dropped
	ActorID      string         // grown user id; "" → NULL (unauthenticated)
	ActorEmail   string         // denormalized caller email
	Service      string         // derived slug, e.g. "video"
	Action       string         // derived verb, e.g. "create"
	ResourceType string         // e.g. "video", "file"
	ResourceID   string         // affected resource id, when known
	Method       string         // full gRPC method or "HTTPVERB path"
	Status       string         // "ok" | "error"
	Detail       map[string]any // free-form context (gRPC code, http status…)
	IP           string         // client IP (X-Forwarded-For / RemoteAddr)
	UserAgent    string         // client user agent
	CreatedAt    time.Time      // set by the DB; populated on read
}

// Filter narrows a List query. Zero-value fields are ignored.
type Filter struct {
	Service    string    // exact service slug
	ActorEmail string    // exact actor email (case-sensitive match on stored value)
	Action     string    // exact action verb
	Limit      int       // max rows (clamped to [1,500], default 100)
	Before     time.Time // keyset: only events strictly older than this
}

// Repository reads and writes audit events.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// Insert appends one audit event. An empty OrgID is rejected (audit rows are
// org-scoped). An empty ActorID is stored as NULL.
func (r *Repository) Insert(ctx context.Context, e Event) error {
	if r == nil || r.pool == nil {
		return nil
	}
	if e.OrgID == "" {
		return fmt.Errorf("audit.Insert: empty org id")
	}
	detail := e.Detail
	if detail == nil {
		detail = map[string]any{}
	}
	b, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("audit.Insert marshal detail: %w", err)
	}
	var actor *string
	if e.ActorID != "" {
		actor = &e.ActorID
	}
	const q = `INSERT INTO grown.audit_events
		(org_id, actor_id, actor_email, service, action, resource_type,
		 resource_id, method, status, detail, ip, user_agent)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`
	_, err = r.pool.Exec(ctx, q,
		e.OrgID, actor, e.ActorEmail, e.Service, e.Action, e.ResourceType,
		e.ResourceID, e.Method, e.Status, b, e.IP, e.UserAgent)
	if err != nil {
		return fmt.Errorf("audit.Insert: %w", err)
	}
	return nil
}

// List returns an org's events newest-first, applying the filter. Limit is
// clamped to [1,500] (default 100). The Before field drives keyset pagination.
func (r *Repository) List(ctx context.Context, orgID string, f Filter) ([]Event, error) {
	if r == nil || r.pool == nil {
		return nil, nil
	}
	if orgID == "" {
		return nil, fmt.Errorf("audit.List: empty org id")
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	// Build a parameterized WHERE incrementally so optional filters don't bloat
	// the plan and so we stay injection-safe.
	args := []any{orgID}
	where := "org_id = $1"
	add := func(cond string, val any) {
		args = append(args, val)
		where += fmt.Sprintf(" AND %s $%d", cond, len(args))
	}
	if f.Service != "" {
		add("service =", f.Service)
	}
	if f.ActorEmail != "" {
		add("actor_email =", f.ActorEmail)
	}
	if f.Action != "" {
		add("action =", f.Action)
	}
	if !f.Before.IsZero() {
		add("created_at <", f.Before)
	}
	args = append(args, limit)

	q := fmt.Sprintf(`SELECT id, org_id, actor_id, actor_email, service, action,
			resource_type, resource_id, method, status, detail, ip, user_agent, created_at
		FROM grown.audit_events
		WHERE %s
		ORDER BY created_at DESC
		LIMIT $%d`, where, len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("audit.List: %w", err)
	}
	defer rows.Close()

	out := make([]Event, 0, limit)
	for rows.Next() {
		var (
			e       Event
			actor   *string
			detailB []byte
		)
		if err := rows.Scan(&e.ID, &e.OrgID, &actor, &e.ActorEmail, &e.Service,
			&e.Action, &e.ResourceType, &e.ResourceID, &e.Method, &e.Status,
			&detailB, &e.IP, &e.UserAgent, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("audit.List scan: %w", err)
		}
		if actor != nil {
			e.ActorID = *actor
		}
		if len(detailB) > 0 {
			_ = json.Unmarshal(detailB, &e.Detail)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
