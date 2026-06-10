// Package mail is the data-access + service layer for the mailbox app.
package mail

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no message matches the given id (within the mailbox).
var ErrNotFound = errors.New("message not found")

// Message is the in-memory representation of a grown.mail_messages row.
type Message struct {
	ID          string
	ThreadID    string
	OrgID       string
	OwnerID     string
	Folder      string
	FromAddr    string
	FromName    string
	ToAddrs     []string
	CcAddrs     []string
	Subject     string
	Body        string
	Snippet     string
	IsRead      bool
	Starred     bool
	Labels      []string
	Attachments []Attachment
	SentAt      time.Time
	// SnoozeUntil is non-nil when the message is snoozed until that time.
	SnoozeUntil *time.Time
}

// Thread is a conversation summary derived from its messages.
type Thread struct {
	ThreadID     string
	Latest       Message
	MessageCount int
	AnyUnread    bool
	Starred      bool
	Labels       []string
	Participants []string
}

// Attachment is the denormalized attachment view stored on a message.
type Attachment struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
}

// AttachmentMeta is the full attachment record (with blob key) for download.
type AttachmentMeta struct {
	Attachment
	OrgID   string
	OwnerID string
	BlobKey string
}

// Recipient is an org user resolved for internal delivery.
type Recipient struct {
	ID          string
	Email       string
	DisplayName string
}

// Repository reads and writes mail messages.
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

const columns = `id::text, thread_id::text, org_id::text, owner_id::text, folder, from_addr, from_name,
	to_addrs, cc_addrs, subject, body, snippet, is_read, starred, labels, attachments, sent_at, snooze_until`

func attachJSON(a []Attachment) []byte {
	if a == nil {
		a = []Attachment{}
	}
	b, _ := json.Marshal(a)
	return b
}

func scan(row pgx.Row) (Message, error) {
	var m Message
	var to, cc, labels, attachments []byte
	err := row.Scan(&m.ID, &m.ThreadID, &m.OrgID, &m.OwnerID, &m.Folder, &m.FromAddr, &m.FromName,
		&to, &cc, &m.Subject, &m.Body, &m.Snippet, &m.IsRead, &m.Starred, &labels, &attachments, &m.SentAt, &m.SnoozeUntil)
	if err != nil {
		return Message{}, err
	}
	_ = json.Unmarshal(to, &m.ToAddrs)
	_ = json.Unmarshal(cc, &m.CcAddrs)
	_ = json.Unmarshal(labels, &m.Labels)
	_ = json.Unmarshal(attachments, &m.Attachments)
	return m, nil
}

// Insert stores a message (used for Sent copies, delivered Inbox copies, drafts).
func (r *Repository) Insert(ctx context.Context, m Message) (Message, error) {
	q := `INSERT INTO grown.mail_messages
		(thread_id, org_id, owner_id, folder, from_addr, from_name, to_addrs, cc_addrs, subject, body, snippet, is_read, starred, labels, attachments, sent_at)
		VALUES (COALESCE(NULLIF($1,'')::uuid, gen_random_uuid()), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, COALESCE($16, now()))
		RETURNING ` + columns
	var sentAt interface{}
	if !m.SentAt.IsZero() {
		sentAt = m.SentAt
	}
	out, err := scan(r.pool.QueryRow(ctx, q, m.ThreadID, m.OrgID, m.OwnerID, m.Folder, m.FromAddr, m.FromName,
		jsonArr(m.ToAddrs), jsonArr(m.CcAddrs), m.Subject, m.Body, m.Snippet, m.IsRead, m.Starred, jsonArr(m.Labels), attachJSON(m.Attachments), sentAt))
	if err != nil {
		return Message{}, fmt.Errorf("mail.Insert: %w", err)
	}
	return out, nil
}

// List returns messages in a mailbox folder (newest first), with optional
// label/query/starred filters.
func (r *Repository) List(ctx context.Context, ownerID, folder, label, query string, starredOnly bool) ([]Message, error) {
	args := []interface{}{ownerID}
	where := []string{"owner_id = $1"}
	switch folder {
	case "snoozed":
		// Virtual folder: messages still snoozed (snooze_until in the future).
		where = append(where, "snooze_until IS NOT NULL AND snooze_until > now()")
	case "":
		where = append(where, "folder <> 'trash'")
		where = append(where, "(snooze_until IS NULL OR snooze_until <= now())")
	default:
		args = append(args, folder)
		where = append(where, fmt.Sprintf("folder = $%d", len(args)))
		// Hide still-snoozed messages from their underlying folder (e.g. inbox).
		where = append(where, "(snooze_until IS NULL OR snooze_until <= now())")
	}
	if starredOnly {
		where = append(where, "starred = true")
	}
	if label != "" {
		args = append(args, label)
		where = append(where, fmt.Sprintf("labels ? $%d", len(args)))
	}
	if q := strings.TrimSpace(query); q != "" {
		args = append(args, "%"+strings.ToLower(q)+"%")
		i := len(args)
		where = append(where, fmt.Sprintf("(lower(subject) LIKE $%d OR lower(from_name) LIKE $%d OR lower(from_addr) LIKE $%d OR lower(snippet) LIKE $%d)", i, i, i, i))
	}
	sql := `SELECT ` + columns + ` FROM grown.mail_messages WHERE ` + strings.Join(where, " AND ") + ` ORDER BY sent_at DESC LIMIT 500`
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("mail.List: %w", err)
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		m, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("mail.List scan: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// UnreadCounts returns unread message counts per folder for a mailbox.
func (r *Repository) UnreadCounts(ctx context.Context, ownerID string) (map[string]int32, error) {
	// Unread per folder, excluding still-snoozed messages from their underlying
	// folder (they're surfaced under the virtual "snoozed" folder instead).
	rows, err := r.pool.Query(ctx,
		`SELECT folder, count(*)::int FROM grown.mail_messages
		 WHERE owner_id=$1 AND is_read=false AND (snooze_until IS NULL OR snooze_until <= now())
		 GROUP BY folder`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("mail.UnreadCounts: %w", err)
	}
	defer rows.Close()
	out := map[string]int32{}
	for rows.Next() {
		var f string
		var n int32
		if err := rows.Scan(&f, &n); err != nil {
			return nil, err
		}
		out[f] = n
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Count currently-snoozed messages under the virtual "snoozed" folder.
	var snoozed int32
	if err := r.pool.QueryRow(ctx,
		`SELECT count(*)::int FROM grown.mail_messages
		 WHERE owner_id=$1 AND snooze_until IS NOT NULL AND snooze_until > now()`, ownerID).Scan(&snoozed); err != nil {
		return nil, fmt.Errorf("mail.UnreadCounts snoozed: %w", err)
	}
	if snoozed > 0 {
		out["snoozed"] = snoozed
	}
	return out, nil
}

// Get returns a message within a mailbox, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, ownerID, id string) (Message, error) {
	m, err := scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM grown.mail_messages WHERE id=$1 AND owner_id=$2`, id, ownerID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	if err != nil {
		return Message{}, fmt.Errorf("mail.Get: %w", err)
	}
	return m, nil
}

// ListThreads groups a folder's messages into conversations. It reuses List's
// visibility rules (snooze, folder, label, query, starred), then collapses by
// thread_id keeping the newest message as the representative. Threads are
// ordered by their newest message (newest first).
func (r *Repository) ListThreads(ctx context.Context, ownerID, folder, label, query string, starredOnly bool) ([]Thread, error) {
	msgs, err := r.List(ctx, ownerID, folder, label, query, starredOnly)
	if err != nil {
		return nil, err
	}
	// msgs is already newest-first; the first message seen per thread is newest.
	order := make([]string, 0, len(msgs))
	byThread := map[string]*Thread{}
	for _, m := range msgs {
		t, ok := byThread[m.ThreadID]
		if !ok {
			t = &Thread{ThreadID: m.ThreadID, Latest: m}
			byThread[m.ThreadID] = t
			order = append(order, m.ThreadID)
		}
		t.MessageCount++
		if !m.IsRead {
			t.AnyUnread = true
		}
		if m.Starred {
			t.Starred = true
		}
		for _, l := range m.Labels {
			if !contains(t.Labels, l) {
				t.Labels = append(t.Labels, l)
			}
		}
		p := m.FromName
		if p == "" {
			p = m.FromAddr
		}
		if p != "" && !contains(t.Participants, p) {
			t.Participants = append(t.Participants, p)
		}
	}
	out := make([]Thread, 0, len(order))
	for _, id := range order {
		out = append(out, *byThread[id])
	}
	return out, nil
}

// GetThread returns all messages in a thread for a mailbox (oldest first). When
// folder is non-empty the thread is scoped to that folder.
func (r *Repository) GetThread(ctx context.Context, ownerID, threadID, folder string) ([]Message, error) {
	args := []interface{}{ownerID, threadID}
	where := []string{"owner_id = $1", "thread_id = $2"}
	if folder != "" && folder != "snoozed" && folder != "starred" {
		args = append(args, folder)
		where = append(where, fmt.Sprintf("folder = $%d", len(args)))
	}
	sql := `SELECT ` + columns + ` FROM grown.mail_messages WHERE ` + strings.Join(where, " AND ") + ` ORDER BY sent_at ASC LIMIT 500`
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("mail.GetThread: %w", err)
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		m, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("mail.GetThread scan: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// MarkThreadRead marks every message in a thread (within a mailbox) as read.
func (r *Repository) MarkThreadRead(ctx context.Context, ownerID, threadID string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE grown.mail_messages SET is_read=true, updated_at=now()
		 WHERE owner_id=$1 AND thread_id=$2 AND is_read=false`, ownerID, threadID)
	if err != nil {
		return fmt.Errorf("mail.MarkThreadRead: %w", err)
	}
	return nil
}

// ListLabels returns the distinct labels in use across a mailbox, sorted.
func (r *Repository) ListLabels(ctx context.Context, ownerID string) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT DISTINCT jsonb_array_elements_text(labels) AS label
		 FROM grown.mail_messages WHERE owner_id=$1 ORDER BY label`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("mail.ListLabels: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var l string
		if err := rows.Scan(&l); err != nil {
			return nil, err
		}
		if l != "" {
			out = append(out, l)
		}
	}
	return out, rows.Err()
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// Modify updates flags / folder / labels of a message within a mailbox.
type Changes struct {
	IsRead    bool
	Starred   bool
	Folder    string
	Labels    []string
	SetLabels bool
	// Snooze state. When SetSnooze is true, SnoozeUntil replaces the snooze
	// timestamp (nil clears it / un-snoozes).
	SnoozeUntil *time.Time
	SetSnooze   bool
}

func (r *Repository) Modify(ctx context.Context, ownerID, id string, c Changes) (Message, error) {
	set := []string{"is_read=$3", "starred=$4", "updated_at=now()"}
	args := []interface{}{id, ownerID, c.IsRead, c.Starred}
	if c.Folder != "" {
		args = append(args, c.Folder)
		set = append(set, fmt.Sprintf("folder=$%d", len(args)))
	}
	if c.SetLabels {
		args = append(args, jsonArr(c.Labels))
		set = append(set, fmt.Sprintf("labels=$%d", len(args)))
	}
	if c.SetSnooze {
		args = append(args, c.SnoozeUntil) // nil clears the column
		set = append(set, fmt.Sprintf("snooze_until=$%d", len(args)))
	}
	sql := `UPDATE grown.mail_messages SET ` + strings.Join(set, ", ") + ` WHERE id=$1 AND owner_id=$2 RETURNING ` + columns
	m, err := scan(r.pool.QueryRow(ctx, sql, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	if err != nil {
		return Message{}, fmt.Errorf("mail.Modify: %w", err)
	}
	return m, nil
}

// Delete removes a message from a mailbox (hard delete; UI uses trash folder first).
func (r *Repository) Delete(ctx context.Context, ownerID, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM grown.mail_messages WHERE id=$1 AND owner_id=$2`, id, ownerID)
	if err != nil {
		return fmt.Errorf("mail.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateAttachment inserts attachment metadata (the blob is stored separately).
func (r *Repository) CreateAttachment(ctx context.Context, m AttachmentMeta) (AttachmentMeta, error) {
	q := `INSERT INTO grown.mail_attachments (org_id, owner_id, filename, content_type, size, blob_key)
	      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id::text`
	err := r.pool.QueryRow(ctx, q, m.OrgID, m.OwnerID, m.Filename, m.ContentType, m.Size, m.BlobKey).Scan(&m.ID)
	if err != nil {
		return AttachmentMeta{}, fmt.Errorf("mail.CreateAttachment: %w", err)
	}
	return m, nil
}

// GetAttachment returns attachment metadata within an org (for download).
func (r *Repository) GetAttachment(ctx context.Context, orgID, id string) (AttachmentMeta, error) {
	var m AttachmentMeta
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, org_id::text, owner_id::text, filename, content_type, size, blob_key
		 FROM grown.mail_attachments WHERE id=$1 AND org_id=$2`, id, orgID).
		Scan(&m.ID, &m.OrgID, &m.OwnerID, &m.Filename, &m.ContentType, &m.Size, &m.BlobKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return AttachmentMeta{}, ErrNotFound
	}
	if err != nil {
		return AttachmentMeta{}, fmt.Errorf("mail.GetAttachment: %w", err)
	}
	return m, nil
}

// Rule is a mail filter (criteria + actions) applied at delivery.
type Rule struct {
	ID           string
	Name         string
	MatchFrom    string
	MatchTo      string
	MatchSubject string
	ActLabel     string
	ActFolder    string
	ActForward   string
	ActMarkRead  bool
	ActStar      bool
}

const ruleColumns = `id::text, name, match_from, match_to, match_subject,
	act_label, act_folder, act_forward, act_mark_read, act_star`

func scanRule(row pgx.Row) (Rule, error) {
	var r Rule
	err := row.Scan(&r.ID, &r.Name, &r.MatchFrom, &r.MatchTo, &r.MatchSubject,
		&r.ActLabel, &r.ActFolder, &r.ActForward, &r.ActMarkRead, &r.ActStar)
	return r, err
}

// ListRules returns a user's rules (also used to apply them at delivery).
func (r *Repository) ListRules(ctx context.Context, ownerID string) ([]Rule, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+ruleColumns+` FROM grown.mail_rules WHERE owner_id=$1 ORDER BY created_at`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("mail.ListRules: %w", err)
	}
	defer rows.Close()
	var out []Rule
	for rows.Next() {
		rl, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rl)
	}
	return out, rows.Err()
}

// CreateRule inserts a rule for a user.
func (r *Repository) CreateRule(ctx context.Context, orgID, ownerID string, rl Rule) (Rule, error) {
	q := `INSERT INTO grown.mail_rules
		(org_id, owner_id, name, match_from, match_to, match_subject, act_label, act_folder, act_forward, act_mark_read, act_star)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ` + ruleColumns
	out, err := scanRule(r.pool.QueryRow(ctx, q, orgID, ownerID, rl.Name, rl.MatchFrom, rl.MatchTo, rl.MatchSubject,
		rl.ActLabel, rl.ActFolder, rl.ActForward, rl.ActMarkRead, rl.ActStar))
	if err != nil {
		return Rule{}, fmt.Errorf("mail.CreateRule: %w", err)
	}
	return out, nil
}

// DeleteRule removes a user's rule.
func (r *Repository) DeleteRule(ctx context.Context, ownerID, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM grown.mail_rules WHERE id=$1 AND owner_id=$2`, id, ownerID)
	if err != nil {
		return fmt.Errorf("mail.DeleteRule: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Label entity CRUD (mail_labels + mail_message_labels) ---

// LabelEntity is a named, colored label record (mail_labels table).
type LabelEntity struct {
	ID     string
	OrgID  string
	UserID string
	Name   string
	Color  string
}

const labelEntityColumns = `id::text, org_id::text, user_id::text, name, color`

func scanLabelEntity(row pgx.Row) (LabelEntity, error) {
	var l LabelEntity
	err := row.Scan(&l.ID, &l.OrgID, &l.UserID, &l.Name, &l.Color)
	return l, err
}

// ListLabelEntities returns all named labels for a user, sorted by name.
func (r *Repository) ListLabelEntities(ctx context.Context, userID string) ([]LabelEntity, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+labelEntityColumns+` FROM grown.mail_labels WHERE user_id=$1 ORDER BY name`, userID)
	if err != nil {
		return nil, fmt.Errorf("mail.ListLabelEntities: %w", err)
	}
	defer rows.Close()
	var out []LabelEntity
	for rows.Next() {
		l, err := scanLabelEntity(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// CreateLabelEntity inserts a new named label.
func (r *Repository) CreateLabelEntity(ctx context.Context, orgID, userID, name, color string) (LabelEntity, error) {
	if color == "" {
		color = "#3D5A80"
	}
	q := `INSERT INTO grown.mail_labels (org_id, user_id, name, color)
		  VALUES ($1,$2,$3,$4)
		  ON CONFLICT (user_id, name) DO UPDATE SET color = EXCLUDED.color
		  RETURNING ` + labelEntityColumns
	out, err := scanLabelEntity(r.pool.QueryRow(ctx, q, orgID, userID, name, color))
	if err != nil {
		return LabelEntity{}, fmt.Errorf("mail.CreateLabelEntity: %w", err)
	}
	return out, nil
}

// UpdateLabelEntity updates the name and/or color of a label.
func (r *Repository) UpdateLabelEntity(ctx context.Context, userID, id, name, color string) (LabelEntity, error) {
	q := `UPDATE grown.mail_labels SET name=$3, color=$4 WHERE id=$1 AND user_id=$2 RETURNING ` + labelEntityColumns
	out, err := scanLabelEntity(r.pool.QueryRow(ctx, q, id, userID, name, color))
	if errors.Is(err, pgx.ErrNoRows) {
		return LabelEntity{}, ErrNotFound
	}
	if err != nil {
		return LabelEntity{}, fmt.Errorf("mail.UpdateLabelEntity: %w", err)
	}
	return out, nil
}

// DeleteLabelEntity removes a label and its message associations.
func (r *Repository) DeleteLabelEntity(ctx context.Context, userID, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM grown.mail_labels WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return fmt.Errorf("mail.DeleteLabelEntity: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ApplyLabelToMessage inserts a mail_message_labels row (idempotent).
func (r *Repository) ApplyLabelToMessage(ctx context.Context, userID, messageID, labelID string) error {
	// Verify ownership of both the message and the label.
	var count int
	if err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM grown.mail_messages WHERE id=$1 AND owner_id=$2`, messageID, userID).Scan(&count); err != nil || count == 0 {
		return ErrNotFound
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.mail_message_labels (message_id, label_id) VALUES ($1::uuid,$2::uuid) ON CONFLICT DO NOTHING`,
		messageID, labelID)
	if err != nil {
		return fmt.Errorf("mail.ApplyLabelToMessage: %w", err)
	}
	return nil
}

// RemoveLabelFromMessage deletes a mail_message_labels row.
func (r *Repository) RemoveLabelFromMessage(ctx context.Context, userID, messageID, labelID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM grown.mail_message_labels
		 WHERE message_id = $1::uuid AND label_id = $2::uuid
		   AND message_id IN (SELECT id FROM grown.mail_messages WHERE owner_id=$3)`,
		messageID, labelID, userID)
	if err != nil {
		return fmt.Errorf("mail.RemoveLabelFromMessage: %w", err)
	}
	return nil
}

// LabelEntitiesForMessages returns label entities keyed by message_id for a set of message IDs.
func (r *Repository) LabelEntitiesForMessages(ctx context.Context, userID string, messageIDs []string) (map[string][]LabelEntity, error) {
	if len(messageIDs) == 0 {
		return map[string][]LabelEntity{}, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT ml.message_id::text, l.id::text, l.name, l.color
		 FROM grown.mail_message_labels ml
		 JOIN grown.mail_labels l ON l.id = ml.label_id
		 WHERE ml.message_id = ANY($1::uuid[]) AND l.user_id = $2`, messageIDs, userID)
	if err != nil {
		return nil, fmt.Errorf("mail.LabelEntitiesForMessages: %w", err)
	}
	defer rows.Close()
	out := map[string][]LabelEntity{}
	for rows.Next() {
		var msgID string
		var l LabelEntity
		if err := rows.Scan(&msgID, &l.ID, &l.Name, &l.Color); err != nil {
			return nil, err
		}
		out[msgID] = append(out[msgID], l)
	}
	return out, rows.Err()
}

// --- Filter CRUD (mail_filters table) ---

// Filter is a normalized filter rule (mail_filters table).
type Filter struct {
	ID          string
	OrgID       string
	UserID      string
	MatchField  string
	MatchOp     string
	MatchValue  string
	ActionType  string
	ActionValue string
}

const filterColumns = `id::text, org_id::text, user_id::text, match_field, match_op, match_value, action_type, action_value`

func scanFilter(row pgx.Row) (Filter, error) {
	var f Filter
	err := row.Scan(&f.ID, &f.OrgID, &f.UserID, &f.MatchField, &f.MatchOp, &f.MatchValue, &f.ActionType, &f.ActionValue)
	return f, err
}

// ListFilters returns a user's normalized filters.
func (r *Repository) ListFilters(ctx context.Context, userID string) ([]Filter, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+filterColumns+` FROM grown.mail_filters WHERE user_id=$1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("mail.ListFilters: %w", err)
	}
	defer rows.Close()
	var out []Filter
	for rows.Next() {
		f, err := scanFilter(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// CreateFilter inserts a normalized filter.
func (r *Repository) CreateFilter(ctx context.Context, orgID, userID string, f Filter) (Filter, error) {
	q := `INSERT INTO grown.mail_filters (org_id, user_id, match_field, match_op, match_value, action_type, action_value)
		  VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ` + filterColumns
	out, err := scanFilter(r.pool.QueryRow(ctx, q, orgID, userID, f.MatchField, f.MatchOp, f.MatchValue, f.ActionType, f.ActionValue))
	if err != nil {
		return Filter{}, fmt.Errorf("mail.CreateFilter: %w", err)
	}
	return out, nil
}

// DeleteFilter removes a filter by id+user.
func (r *Repository) DeleteFilter(ctx context.Context, userID, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM grown.mail_filters WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return fmt.Errorf("mail.DeleteFilter: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// RecipientsInOrg resolves which of the given email addresses belong to org users
// (case-insensitive), for internal delivery.
func (r *Repository) RecipientsInOrg(ctx context.Context, orgID string, emails []string) ([]Recipient, error) {
	if len(emails) == 0 {
		return nil, nil
	}
	lower := make([]string, 0, len(emails))
	for _, e := range emails {
		lower = append(lower, strings.ToLower(strings.TrimSpace(e)))
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, email, display_name FROM grown.users WHERE org_id=$1 AND lower(email) = ANY($2)`, orgID, lower)
	if err != nil {
		return nil, fmt.Errorf("mail.RecipientsInOrg: %w", err)
	}
	defer rows.Close()
	var out []Recipient
	for rows.Next() {
		var rc Recipient
		if err := rows.Scan(&rc.ID, &rc.Email, &rc.DisplayName); err != nil {
			return nil, err
		}
		out = append(out, rc)
	}
	return out, rows.Err()
}
