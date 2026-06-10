// Package prefs is the data-access + service layer for per-user preferences.
package prefs

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Defaults holds the sane fallback values returned when no row exists yet.
var Defaults = Preferences{
	Language:           "en",
	Density:            "comfortable",
	DefaultApp:         "dashboard",
	DateFormat:         "MMM D, YYYY",
	TimeFormat:         "12h",
	WeekStart:          "sunday",
	EmailNotifications: true,
	Extra:              "{}",
}

// Preferences is the in-memory representation of a grown.user_preferences row.
type Preferences struct {
	UserID             string
	OrgID              string
	Language           string
	Density            string
	DefaultApp         string
	DateFormat         string
	TimeFormat         string
	WeekStart          string
	EmailNotifications bool
	Extra              string
	UpdatedAt          time.Time
}

// UpdateFields carries the fields that may be changed via UpdatePreferences.
// Only the fields whose names appear in Mask are written; others are left alone.
type UpdateFields struct {
	Language           string
	Density            string
	DefaultApp         string
	DateFormat         string
	TimeFormat         string
	WeekStart          string
	EmailNotifications bool
	Extra              string
	// Mask lists the field names to apply.  Use []string{"*"} for all.
	Mask []string
}

// Repository reads and writes user preferences.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const columns = `user_id::text, org_id::text, language, density, default_app,
	date_format, time_format, week_start, email_notifications, extra::text, updated_at`

func scan(row pgx.Row) (Preferences, error) {
	var p Preferences
	err := row.Scan(
		&p.UserID, &p.OrgID, &p.Language, &p.Density, &p.DefaultApp,
		&p.DateFormat, &p.TimeFormat, &p.WeekStart, &p.EmailNotifications,
		&p.Extra, &p.UpdatedAt,
	)
	return p, err
}

// GetOrDefault returns the preferences for (orgID, userID).  When no row exists
// it returns Defaults with UserID/OrgID filled in (no DB write).
func (r *Repository) GetOrDefault(ctx context.Context, orgID, userID string) (Preferences, error) {
	q := `SELECT ` + columns + ` FROM grown.user_preferences WHERE user_id=$1`
	p, err := scan(r.pool.QueryRow(ctx, q, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		d := Defaults
		d.UserID = userID
		d.OrgID = orgID
		d.UpdatedAt = time.Now().UTC()
		return d, nil
	}
	if err != nil {
		return Preferences{}, err
	}
	return p, nil
}

// allFields is the canonical ordered list used by UpdatePreferences when the
// mask is "*" or absent.
var allFields = []string{
	"language", "density", "default_app", "date_format",
	"time_format", "week_start", "email_notifications", "extra",
}

func inMask(mask []string, name string) bool {
	if len(mask) == 0 || (len(mask) == 1 && mask[0] == "*") {
		return true
	}
	for _, m := range mask {
		if m == name {
			return true
		}
	}
	return false
}

// UpdatePreferences upserts preference fields for (orgID, userID).  Only
// fields listed in f.Mask are written; all others retain their current value.
func (r *Repository) UpdatePreferences(ctx context.Context, orgID, userID string, f UpdateFields) (Preferences, error) {
	// Start from the current (or default) values so partial updates work.
	cur, err := r.GetOrDefault(ctx, orgID, userID)
	if err != nil {
		return Preferences{}, err
	}

	mask := f.Mask
	if len(mask) == 0 {
		mask = []string{"*"}
	}

	if inMask(mask, "language") {
		cur.Language = f.Language
	}
	if inMask(mask, "density") {
		cur.Density = f.Density
	}
	if inMask(mask, "default_app") {
		cur.DefaultApp = f.DefaultApp
	}
	if inMask(mask, "date_format") {
		cur.DateFormat = f.DateFormat
	}
	if inMask(mask, "time_format") {
		cur.TimeFormat = f.TimeFormat
	}
	if inMask(mask, "week_start") {
		cur.WeekStart = f.WeekStart
	}
	if inMask(mask, "email_notifications") {
		cur.EmailNotifications = f.EmailNotifications
	}
	if inMask(mask, "extra") {
		if f.Extra == "" {
			f.Extra = "{}"
		}
		cur.Extra = f.Extra
	}

	q := `INSERT INTO grown.user_preferences
		(user_id, org_id, language, density, default_app,
		 date_format, time_format, week_start, email_notifications, extra, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
		ON CONFLICT (user_id) DO UPDATE SET
			org_id              = EXCLUDED.org_id,
			language            = EXCLUDED.language,
			density             = EXCLUDED.density,
			default_app         = EXCLUDED.default_app,
			date_format         = EXCLUDED.date_format,
			time_format         = EXCLUDED.time_format,
			week_start          = EXCLUDED.week_start,
			email_notifications = EXCLUDED.email_notifications,
			extra               = EXCLUDED.extra,
			updated_at          = now()
		RETURNING ` + columns

	p, err := scan(r.pool.QueryRow(ctx, q,
		userID, orgID,
		cur.Language, cur.Density, cur.DefaultApp,
		cur.DateFormat, cur.TimeFormat, cur.WeekStart,
		cur.EmailNotifications, cur.Extra,
	))
	if err != nil {
		return Preferences{}, err
	}
	return p, nil
}
