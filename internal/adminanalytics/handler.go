// Package adminanalytics exposes an admin-gated HTTP surface at
// GET /api/v1/admin/analytics that returns org-wide usage statistics in a
// single JSON response.
//
// Trust model mirrors internal/adminusers and internal/audit: the handler runs
// INSIDE grown's auth middleware, so the caller's user + org are on the request
// context via injected closures (Identity) — no import of internal/auth or gen/.
// Every call is gated on ADMIN privileges (GROWN_ADMIN_EMAILS allowlist OR an
// org_admins grant) via the same AdminChecker pattern.
//
// Org-scoping: every query is parameterised on the caller's org id, resolved off
// the auth context via Identity. A caller cannot access another org's data.
//
// Resilience: each per-table query runs independently; a missing table or column
// (e.g. optional features not deployed) records a 0 value rather than failing
// the whole response. Query errors are silently swallowed and the metric is
// omitted from the "errors" field (surfaced only in server logs if desired).
//
// Route:
//
//	GET /api/v1/admin/analytics
package adminanalytics

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Identity resolves the caller off the request context. server.go supplies
// closures backed by auth.UserFromContext / auth.OrgFromContext, keeping this
// package free of internal/auth (and its gen/ dependency).
type Identity struct {
	// Caller returns userID, email, orgID and whether a caller is present.
	Caller func(ctx context.Context) (userID, email, orgID string, ok bool)
	// IsAdmin reports whether the caller is an admin (allowlist OR org_admins).
	IsAdmin func(ctx context.Context) bool
}

// Handler serves GET /api/v1/admin/analytics. It is dependency-light: only
// net/http, encoding/json, and a *pgxpool.Pool (injected via WithPool).
type Handler struct {
	id Identity
	// demoUsername is the configured demo login name (GROWN_DEMO_USERNAME), used
	// to count unique login IPs for the public demo user. Empty when no demo is
	// configured, in which case the metric is reported as 0.
	demoUsername string
	pool         *pgxpool.Pool
}

// NewHandler constructs the analytics handler.
func NewHandler(id Identity) *Handler {
	return &Handler{id: id}
}

// WithPool injects the database pool and returns the handler for chaining.
// When no pool is set every request returns 503.
func (h *Handler) WithPool(pool *pgxpool.Pool) *Handler {
	h.pool = pool
	return h
}

// WithDemoUsername sets the demo login name so the analytics response can
// include a unique-IP count for the public demo user. Returns h for chaining.
func (h *Handler) WithDemoUsername(name string) *Handler {
	h.demoUsername = name
	return h
}

// ServeHTTP authorizes the caller then collects and returns analytics.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// --- authorization ---
	if h.id.Caller == nil {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	_, _, orgID, ok := h.id.Caller(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	if h.id.IsAdmin == nil || !h.id.IsAdmin(r.Context()) {
		writeError(w, http.StatusForbidden, "admin privileges required")
		return
	}
	if orgID == "" {
		writeError(w, http.StatusBadRequest, "no org context")
		return
	}

	// --- pool check ---
	if h.pool == nil {
		writeError(w, http.StatusServiceUnavailable, "analytics requires a database connection")
		return
	}

	data := h.collect(r.Context(), orgID)
	writeJSON(w, http.StatusOK, data)
}

// AnalyticsResponse is the full response payload.
type AnalyticsResponse struct {
	// OrgID is echoed so clients can assert they got the right org.
	OrgID string `json:"org_id"`
	// CollectedAt is the UTC timestamp of the query run.
	CollectedAt string `json:"collected_at"`
	// Users contains member / admin / activity stats.
	Users UserStats `json:"users"`
	// Storage contains aggregate blob storage usage.
	Storage StorageStats `json:"storage"`
	// Apps contains per-app object counts.
	Apps AppStats `json:"apps"`
}

// UserStats captures membership and activity metrics.
type UserStats struct {
	// TotalMembers is COUNT of rows in grown.users for this org.
	TotalMembers int64 `json:"total_members"`
	// TotalAdmins is COUNT of rows in grown.org_admins for this org.
	TotalAdmins int64 `json:"total_admins"`
	// ActiveLast7Days counts distinct users with a non-revoked session whose
	// last_seen_at > now()-7d.
	ActiveLast7Days int64 `json:"active_last_7_days"`
	// ActiveLast30Days counts distinct users active in the last 30 days.
	ActiveLast30Days int64 `json:"active_last_30_days"`
	// DemoConfigured reports whether a public demo user is configured for this
	// instance (GROWN_DEMO_USERNAME set). When false the dashboard hides the
	// demo metric entirely.
	DemoConfigured bool `json:"demo_configured"`
	// DemoUniqueIPs is the number of distinct IP addresses that have logged in
	// as the demo user (distinct non-empty sessions.ip for the demo user). 0
	// when no demo user is configured.
	DemoUniqueIPs int64 `json:"demo_unique_ips"`
}

// StorageStats captures blob storage usage.
type StorageStats struct {
	// DriveBytes is the sum of size_bytes in grown.drive_files (non-trashed).
	DriveBytes int64 `json:"drive_bytes"`
	// PhotoBytes is the sum of size in grown.photos (non-trashed).
	PhotoBytes int64 `json:"photo_bytes"`
	// VideoBytes is the sum of size in grown.videos (non-trashed).
	VideoBytes int64 `json:"video_bytes"`
	// MusicBytes is the sum of size in grown.music_tracks (non-trashed).
	MusicBytes int64 `json:"music_bytes"`
	// MailAttachmentBytes is the sum of size in grown.mail_attachments.
	MailAttachmentBytes int64 `json:"mail_attachment_bytes"`
	// TotalBytes is the sum of all the above.
	TotalBytes int64 `json:"total_bytes"`
}

// AppStats contains per-app total and recent-7-day object counts.
type AppStats struct {
	DriveFiles       int64 `json:"drive_files"`
	DriveFilesNew7d  int64 `json:"drive_files_new_7d"`
	Docs             int64 `json:"docs"`
	DocsNew7d        int64 `json:"docs_new_7d"`
	Sheets           int64 `json:"sheets"`
	SheetsNew7d      int64 `json:"sheets_new_7d"`
	Slides           int64 `json:"slides"`
	SlidesNew7d      int64 `json:"slides_new_7d"`
	Whiteboards      int64 `json:"whiteboards"`
	WhiteboardsNew7d int64 `json:"whiteboards_new_7d"`
	KeepNotes        int64 `json:"keep_notes"`
	KeepNotesNew7d   int64 `json:"keep_notes_new_7d"`
	CalendarEvents   int64 `json:"calendar_events"`
	CalendarNew7d    int64 `json:"calendar_events_new_7d"`
	Contacts         int64 `json:"contacts"`
	ContactsNew7d    int64 `json:"contacts_new_7d"`
	MailMessages     int64 `json:"mail_messages"`
	MailNew7d        int64 `json:"mail_messages_new_7d"`
	Photos           int64 `json:"photos"`
	PhotosNew7d      int64 `json:"photos_new_7d"`
	Videos           int64 `json:"videos"`
	VideosNew7d      int64 `json:"videos_new_7d"`
	MusicTracks      int64 `json:"music_tracks"`
	MusicNew7d       int64 `json:"music_tracks_new_7d"`
	Books            int64 `json:"books"`
	BooksNew7d       int64 `json:"books_new_7d"`
	Sites            int64 `json:"sites"`
	SitesNew7d       int64 `json:"sites_new_7d"`
	Groups           int64 `json:"groups"`
	GroupsNew7d      int64 `json:"groups_new_7d"`
	ProjectIssues    int64 `json:"project_issues"`
	ProjectNew7d     int64 `json:"project_issues_new_7d"`
	Forms            int64 `json:"forms"`
	FormsNew7d       int64 `json:"forms_new_7d"`
	MeetRooms        int64 `json:"meet_rooms"`
	LiveStreams      int64 `json:"live_streams"`
	ChatChannels     int64 `json:"chat_channels"`
	ChatMessages     int64 `json:"chat_messages"`
}

// countOne executes a SELECT COUNT(*) … query and returns the result. On any
// error it returns 0, tolerating missing tables / columns gracefully.
func countOne(ctx context.Context, pool *pgxpool.Pool, q string, args ...any) int64 {
	var n int64
	_ = pool.QueryRow(ctx, q, args...).Scan(&n)
	return n
}

// sumOne executes a SELECT COALESCE(SUM(col),0) … query. On any error returns 0.
func sumOne(ctx context.Context, pool *pgxpool.Pool, q string, args ...any) int64 {
	var n int64
	_ = pool.QueryRow(ctx, q, args...).Scan(&n)
	return n
}

// collect runs all analytics queries against the given org and returns the
// response. Queries are independent so one failure does not abort the others.
func (h *Handler) collect(ctx context.Context, orgID string) AnalyticsResponse {
	pool := h.pool
	ago7 := time.Now().UTC().Add(-7 * 24 * time.Hour)
	ago30 := time.Now().UTC().Add(-30 * 24 * time.Hour)

	// --- user stats ---
	totalMembers := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.users WHERE org_id = $1`, orgID)
	totalAdmins := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.org_admins WHERE org_id = $1`, orgID)
	active7 := countOne(ctx, pool,
		`SELECT COUNT(DISTINCT s.user_id)
		   FROM grown.sessions s
		   JOIN grown.users u ON u.id = s.user_id
		  WHERE u.org_id = $1
		    AND s.revoked_at IS NULL
		    AND s.last_seen_at > $2`, orgID, ago7)
	active30 := countOne(ctx, pool,
		`SELECT COUNT(DISTINCT s.user_id)
		   FROM grown.sessions s
		   JOIN grown.users u ON u.id = s.user_id
		  WHERE u.org_id = $1
		    AND s.revoked_at IS NULL
		    AND s.last_seen_at > $2`, orgID, ago30)

	// Unique IPs that have logged in as the public demo user. The demo user is
	// matched by login name/email (case-insensitive) within this org; we count
	// distinct non-empty session IPs. Only meaningful when a demo is configured.
	var demoUniqueIPs int64
	demoConfigured := h.demoUsername != ""
	if demoConfigured {
		demoUniqueIPs = countOne(ctx, pool,
			`SELECT COUNT(DISTINCT s.ip)
			   FROM grown.sessions s
			   JOIN grown.users u ON u.id = s.user_id
			  WHERE u.org_id = $1
			    AND lower(u.email) = lower($2)
			    AND s.ip IS NOT NULL
			    AND s.ip <> ''`, orgID, h.demoUsername)
	}

	// --- storage ---
	driveBytes := sumOne(ctx, pool,
		`SELECT COALESCE(SUM(size_bytes),0) FROM grown.drive_files
		  WHERE org_id = $1 AND trashed_at IS NULL`, orgID)
	photoBytes := sumOne(ctx, pool,
		`SELECT COALESCE(SUM(size),0) FROM grown.photos
		  WHERE org_id = $1 AND trashed_at IS NULL`, orgID)
	videoBytes := sumOne(ctx, pool,
		`SELECT COALESCE(SUM(size),0) FROM grown.videos
		  WHERE org_id = $1 AND trashed_at IS NULL`, orgID)
	musicBytes := sumOne(ctx, pool,
		`SELECT COALESCE(SUM(size),0) FROM grown.music_tracks
		  WHERE org_id = $1 AND trashed_at IS NULL`, orgID)
	mailAttBytes := sumOne(ctx, pool,
		`SELECT COALESCE(SUM(size),0) FROM grown.mail_attachments
		  WHERE org_id = $1`, orgID)

	// --- app object counts ---
	driveFiles := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.drive_files WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	driveFiles7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.drive_files WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	docs := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.docs_documents WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	docs7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.docs_documents WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	sheets := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.sheets_documents WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	sheets7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.sheets_documents WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	slides := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.slides_documents WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	slides7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.slides_documents WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	whiteboards := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.whiteboards WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	whiteboards7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.whiteboards WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	keepNotes := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.keep_notes WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	keepNotes7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.keep_notes WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	calEvents := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.calendar_events WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	calEvents7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.calendar_events WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	contacts := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.contacts WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	contacts7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.contacts WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	// mail_messages uses owner_id scoping (one row per mailbox owner, not one per
	// org), so we join to grown.users to org-scope correctly.
	mailMsgs := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.mail_messages m
		   JOIN grown.users u ON u.id = m.owner_id
		  WHERE u.org_id = $1`, orgID)
	mailMsgs7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.mail_messages m
		   JOIN grown.users u ON u.id = m.owner_id
		  WHERE u.org_id = $1 AND m.sent_at > $2`, orgID, ago7)

	photos := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.photos WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	photos7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.photos WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	videos := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.videos WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	videos7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.videos WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	musicTracks := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.music_tracks WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	musicTracks7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.music_tracks WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	books := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.books WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	books7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.books WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	sites := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.sites WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	sites7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.sites WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	groups := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.groups WHERE org_id=$1`, orgID)
	groups7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.groups WHERE org_id=$1 AND created_at > $2`, orgID, ago7)

	projIssues := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.project_issues WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	projIssues7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.project_issues WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	forms := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.forms WHERE org_id=$1 AND trashed_at IS NULL`, orgID)
	forms7d := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.forms WHERE org_id=$1 AND trashed_at IS NULL AND created_at > $2`, orgID, ago7)

	meetRooms := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.meet_rooms WHERE org_id=$1`, orgID)

	liveStreams := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.live_streams WHERE org_id=$1`, orgID)

	chatChannels := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.chat_channels WHERE org_id=$1`, orgID)
	chatMessages := countOne(ctx, pool,
		`SELECT COUNT(*) FROM grown.chat_messages WHERE org_id=$1`, orgID)

	totalBytes := driveBytes + photoBytes + videoBytes + musicBytes + mailAttBytes

	return AnalyticsResponse{
		OrgID:       orgID,
		CollectedAt: time.Now().UTC().Format(time.RFC3339),
		Users: UserStats{
			TotalMembers:     totalMembers,
			TotalAdmins:      totalAdmins,
			ActiveLast7Days:  active7,
			ActiveLast30Days: active30,
			DemoConfigured:   demoConfigured,
			DemoUniqueIPs:    demoUniqueIPs,
		},
		Storage: StorageStats{
			DriveBytes:          driveBytes,
			PhotoBytes:          photoBytes,
			VideoBytes:          videoBytes,
			MusicBytes:          musicBytes,
			MailAttachmentBytes: mailAttBytes,
			TotalBytes:          totalBytes,
		},
		Apps: AppStats{
			DriveFiles:       driveFiles,
			DriveFilesNew7d:  driveFiles7d,
			Docs:             docs,
			DocsNew7d:        docs7d,
			Sheets:           sheets,
			SheetsNew7d:      sheets7d,
			Slides:           slides,
			SlidesNew7d:      slides7d,
			Whiteboards:      whiteboards,
			WhiteboardsNew7d: whiteboards7d,
			KeepNotes:        keepNotes,
			KeepNotesNew7d:   keepNotes7d,
			CalendarEvents:   calEvents,
			CalendarNew7d:    calEvents7d,
			Contacts:         contacts,
			ContactsNew7d:    contacts7d,
			MailMessages:     mailMsgs,
			MailNew7d:        mailMsgs7d,
			Photos:           photos,
			PhotosNew7d:      photos7d,
			Videos:           videos,
			VideosNew7d:      videos7d,
			MusicTracks:      musicTracks,
			MusicNew7d:       musicTracks7d,
			Books:            books,
			BooksNew7d:       books7d,
			Sites:            sites,
			SitesNew7d:       sites7d,
			Groups:           groups,
			GroupsNew7d:      groups7d,
			ProjectIssues:    projIssues,
			ProjectNew7d:     projIssues7d,
			Forms:            forms,
			FormsNew7d:       forms7d,
			MeetRooms:        meetRooms,
			LiveStreams:      liveStreams,
			ChatChannels:     chatChannels,
			ChatMessages:     chatMessages,
		},
	}
}

// writeJSON writes v as a JSON response with the given status.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes a JSON {error} body with the given status.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}
