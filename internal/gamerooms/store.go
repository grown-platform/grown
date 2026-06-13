package gamerooms

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Store persists the relay's global enable/disable flag and an audit trail of
// room/peer lifecycle + admin actions (grown.gamerooms_settings and
// grown.gamerooms_audit, added in migration 0084). It is account-agnostic — the
// relay has no org/user context — so this is a standalone side-table store,
// separate from grown's org-scoped internal/audit.
//
// A nil Store (no DB configured) is valid: the hub then treats multiplayer as
// always-enabled and silently drops audit events.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store over the given pool. Passing a nil pool returns a
// nil *Store, which every method tolerates.
func NewStore(pool *pgxpool.Pool) *Store {
	if pool == nil {
		return nil
	}
	return &Store{pool: pool}
}

// Settings is the relay's global configuration.
type Settings struct {
	Enabled   bool      `json:"enabled"`
	UpdatedAt time.Time `json:"updated_at"`
	UpdatedBy string    `json:"updated_by"`
}

// LoadSettings reads the single settings row. A nil store (or any error) yields
// the default (enabled) — the relay fails open so a DB hiccup never silently
// takes multiplayer offline.
func (s *Store) LoadSettings(ctx context.Context) Settings {
	def := Settings{Enabled: true}
	if s == nil {
		return def
	}
	var out Settings
	err := s.pool.QueryRow(ctx,
		`SELECT enabled, updated_at, updated_by FROM grown.gamerooms_settings WHERE id = TRUE`).
		Scan(&out.Enabled, &out.UpdatedAt, &out.UpdatedBy)
	if err != nil {
		return def
	}
	return out
}

// SetEnabled upserts the global enabled flag, recording the acting admin.
func (s *Store) SetEnabled(ctx context.Context, enabled bool, actorEmail string) error {
	if s == nil {
		return nil
	}
	_, err := s.pool.Exec(ctx,
		`INSERT INTO grown.gamerooms_settings (id, enabled, updated_at, updated_by)
		 VALUES (TRUE, $1, now(), $2)
		 ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled,
		     updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
		enabled, actorEmail)
	return err
}

// AuditEvent is one row of grown.gamerooms_audit.
type AuditEvent struct {
	ID         string         `json:"id"`
	Event      string         `json:"event"`
	Room       string         `json:"room"`
	Game       string         `json:"game"`
	PeerID     string         `json:"peer_id"`
	PeerName   string         `json:"peer_name"`
	ActorEmail string         `json:"actor_email"`
	Detail     map[string]any `json:"detail,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
}

// LogEvent appends an audit row. Best-effort: a nil store or DB error is
// swallowed so audit never blocks the relay path. The write runs on a detached
// short-timeout context so a slow DB can't stall a WS connect/disconnect.
func (s *Store) LogEvent(e AuditEvent) {
	if s == nil {
		return
	}
	detail := e.Detail
	if detail == nil {
		detail = map[string]any{}
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		raw = []byte("{}")
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = s.pool.Exec(ctx,
			`INSERT INTO grown.gamerooms_audit
			   (event, room, game, peer_id, peer_name, actor_email, detail)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			e.Event, e.Room, e.Game, e.PeerID, e.PeerName, e.ActorEmail, raw)
	}()
}

// AuditFilter narrows ListAudit. Zero-value fields are ignored.
type AuditFilter struct {
	Event  string    // exact event type
	Room   string    // exact room code
	Limit  int       // clamped to [1,500], default 100
	Before time.Time // keyset: only rows strictly older than this
}

// ListAudit returns audit rows newest-first, filtered and keyset-paginated.
func (s *Store) ListAudit(ctx context.Context, f AuditFilter) ([]AuditEvent, error) {
	if s == nil {
		return []AuditEvent{}, nil
	}
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		if limit > 500 {
			limit = 500
		} else {
			limit = 100
		}
	}
	// Build a small dynamic WHERE — all params are placeholders (no injection).
	conds := []string{"TRUE"}
	args := []any{}
	add := func(cond string, val any) {
		args = append(args, val)
		conds = append(conds, strings.Replace(cond, "?", "$"+itoa(len(args)), 1))
	}
	if f.Event != "" {
		add("event = ?", f.Event)
	}
	if f.Room != "" {
		add("room = ?", f.Room)
	}
	if !f.Before.IsZero() {
		add("created_at < ?", f.Before)
	}
	args = append(args, limit)
	q := `SELECT id, event, room, game, peer_id, peer_name, actor_email, detail, created_at
	      FROM grown.gamerooms_audit
	      WHERE ` + strings.Join(conds, " AND ") +
		` ORDER BY created_at DESC LIMIT $` + itoa(len(args))

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AuditEvent, 0, limit)
	for rows.Next() {
		var e AuditEvent
		var raw []byte
		if err := rows.Scan(&e.ID, &e.Event, &e.Room, &e.Game, &e.PeerID,
			&e.PeerName, &e.ActorEmail, &raw, &e.CreatedAt); err != nil {
			return nil, err
		}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &e.Detail)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// itoa is a tiny strconv.Itoa avoiding an import just for placeholder numbers.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
