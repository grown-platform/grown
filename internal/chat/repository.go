// Package chat is the data-access + service layer for chat channels and messages.
package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a channel or message is not found.
var ErrNotFound = errors.New("not found")

// ErrForbidden is returned when a user is not a member of a channel.
var ErrForbidden = errors.New("forbidden")

// Channel is the in-memory representation of a grown.chat_channels row.
type Channel struct {
	ID            string
	OrgID         string
	Kind          string
	Name          string
	MemberIDs     []string
	LastMessageAt *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
	// Populated by ListForUser, not a DB column.
	UnreadCount int32
}

// Message is the in-memory representation of a grown.chat_messages row.
type Message struct {
	ID         string
	ChannelID  string
	OrgID      string
	SenderID   string
	SenderName string
	Body       string
	Reactions  string // JSON object (legacy)
	SentAt     time.Time
	// ParentID is set for thread replies; empty for top-level messages.
	ParentID string
	// ReplyCount is the number of thread replies (populated for top-level msgs).
	ReplyCount int32
}

// Reaction is the aggregate reaction for a single emoji on a message.
type Reaction struct {
	Emoji string
	Count int32
	// Me is true when the requesting user has reacted with this emoji.
	Me bool
}

// Repository reads and writes chat channels and messages.
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

const channelColumns = `id::text, org_id::text, kind, name, member_ids, last_message_at, created_at, updated_at`

func scanChannel(row pgx.Row) (Channel, error) {
	var ch Channel
	var memberJSON []byte
	var lastAt *time.Time
	err := row.Scan(&ch.ID, &ch.OrgID, &ch.Kind, &ch.Name, &memberJSON, &lastAt, &ch.CreatedAt, &ch.UpdatedAt)
	if err != nil {
		return Channel{}, err
	}
	_ = json.Unmarshal(memberJSON, &ch.MemberIDs)
	if ch.MemberIDs == nil {
		ch.MemberIDs = []string{}
	}
	ch.LastMessageAt = lastAt
	return ch, nil
}

// CreateChannel inserts a new channel. memberIDs should include all participants
// (the creator is typically included by the caller).
func (r *Repository) CreateChannel(ctx context.Context, orgID, kind, name string, memberIDs []string) (Channel, error) {
	q := `INSERT INTO grown.chat_channels (org_id, kind, name, member_ids)
	      VALUES ($1, $2, $3, $4)
	      RETURNING ` + channelColumns
	ch, err := scanChannel(r.pool.QueryRow(ctx, q, orgID, kind, name, jsonArr(memberIDs)))
	if err != nil {
		return Channel{}, fmt.Errorf("chat.CreateChannel: %w", err)
	}
	return ch, nil
}

// GetChannel returns a channel within orgID, or ErrNotFound.
func (r *Repository) GetChannel(ctx context.Context, orgID, id string) (Channel, error) {
	q := `SELECT ` + channelColumns + ` FROM grown.chat_channels WHERE id=$1 AND org_id=$2`
	ch, err := scanChannel(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Channel{}, ErrNotFound
	}
	if err != nil {
		return Channel{}, fmt.Errorf("chat.GetChannel: %w", err)
	}
	return ch, nil
}

// ListChannelsForUser returns all channels in orgID where userID is a member,
// ordered by last_message_at DESC. It also computes unread counts.
func (r *Repository) ListChannelsForUser(ctx context.Context, orgID, userID string) ([]Channel, error) {
	q := `SELECT ` + channelColumns + `, COALESCE(
	        (SELECT COUNT(*) FROM grown.chat_messages m
	         WHERE m.channel_id = c.id
	           AND m.sent_at > COALESCE(
	               (SELECT rc.last_read_at FROM grown.chat_read_cursors rc
	                WHERE rc.channel_id = c.id AND rc.user_id = $2::uuid),
	               '-infinity'::timestamptz)
	        ), 0)::int AS unread_count
	      FROM grown.chat_channels c
	      WHERE c.org_id = $1
	        -- $2 is also cast ::uuid in the unread subquery above, which makes
	        -- Postgres type the whole param uuid; cast back to text here so the
	        -- jsonb existence operator resolves to "jsonb ? text", not "? uuid".
	        AND c.member_ids ? ($2::text)
	      ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`
	rows, err := r.pool.Query(ctx, q, orgID, userID)
	if err != nil {
		return nil, fmt.Errorf("chat.ListChannelsForUser: %w", err)
	}
	defer rows.Close()
	var out []Channel
	for rows.Next() {
		var ch Channel
		var memberJSON []byte
		var lastAt *time.Time
		var unread int32
		if err := rows.Scan(&ch.ID, &ch.OrgID, &ch.Kind, &ch.Name, &memberJSON, &lastAt, &ch.CreatedAt, &ch.UpdatedAt, &unread); err != nil {
			return nil, fmt.Errorf("chat.ListChannelsForUser scan: %w", err)
		}
		_ = json.Unmarshal(memberJSON, &ch.MemberIDs)
		if ch.MemberIDs == nil {
			ch.MemberIDs = []string{}
		}
		ch.LastMessageAt = lastAt
		ch.UnreadCount = unread
		out = append(out, ch)
	}
	return out, rows.Err()
}

// FindDMChannel finds an existing DM channel between exactly two users in orgID.
func (r *Repository) FindDMChannel(ctx context.Context, orgID, userA, userB string) (Channel, error) {
	// A self-DM ("Notes to self") is the single-member DM; a regular DM has both.
	// Cast the operands to text so the jsonb existence operator resolves to
	// "jsonb ? text" (not "? uuid").
	if userA == userB {
		q := `SELECT ` + channelColumns + ` FROM grown.chat_channels
		      WHERE org_id=$1 AND kind='dm'
		        AND member_ids ? ($2::text)
		        AND jsonb_array_length(member_ids) = 1
		      LIMIT 1`
		ch, err := scanChannel(r.pool.QueryRow(ctx, q, orgID, userA))
		if errors.Is(err, pgx.ErrNoRows) {
			return Channel{}, ErrNotFound
		}
		if err != nil {
			return Channel{}, fmt.Errorf("chat.FindDMChannel: %w", err)
		}
		return ch, nil
	}
	q := `SELECT ` + channelColumns + ` FROM grown.chat_channels
	      WHERE org_id=$1 AND kind='dm'
	        AND member_ids ? ($2::text)
	        AND member_ids ? ($3::text)
	        AND jsonb_array_length(member_ids) = 2
	      LIMIT 1`
	ch, err := scanChannel(r.pool.QueryRow(ctx, q, orgID, userA, userB))
	if errors.Is(err, pgx.ErrNoRows) {
		return Channel{}, ErrNotFound
	}
	if err != nil {
		return Channel{}, fmt.Errorf("chat.FindDMChannel: %w", err)
	}
	return ch, nil
}

const msgColumns = `id::text, channel_id::text, org_id::text, sender_id::text, sender_name, body, reactions::text, sent_at, COALESCE(parent_id::text, '')`

func scanMessage(row pgx.Row) (Message, error) {
	var m Message
	err := row.Scan(&m.ID, &m.ChannelID, &m.OrgID, &m.SenderID, &m.SenderName, &m.Body, &m.Reactions, &m.SentAt, &m.ParentID)
	if err != nil {
		return Message{}, err
	}
	if m.Reactions == "" {
		m.Reactions = "{}"
	}
	return m, nil
}

// PostMessage inserts a message and updates last_message_at on the channel.
// If parentID is non-empty the message is a thread reply.
func (r *Repository) PostMessage(ctx context.Context, channelID, orgID, senderID, senderName, body, parentID string) (Message, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Message{}, fmt.Errorf("chat.PostMessage begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var q string
	var m Message
	if parentID != "" {
		q = `INSERT INTO grown.chat_messages (channel_id, org_id, sender_id, sender_name, body, parent_id)
		     VALUES ($1, $2, $3, $4, $5, $6::uuid)
		     RETURNING ` + msgColumns
		m, err = scanMessage(tx.QueryRow(ctx, q, channelID, orgID, senderID, senderName, body, parentID))
	} else {
		q = `INSERT INTO grown.chat_messages (channel_id, org_id, sender_id, sender_name, body)
		     VALUES ($1, $2, $3, $4, $5)
		     RETURNING ` + msgColumns
		m, err = scanMessage(tx.QueryRow(ctx, q, channelID, orgID, senderID, senderName, body))
	}
	if err != nil {
		return Message{}, fmt.Errorf("chat.PostMessage insert: %w", err)
	}

	// Only update channel's last_message_at for top-level messages.
	if parentID == "" {
		if _, err := tx.Exec(ctx,
			`UPDATE grown.chat_channels SET last_message_at=now(), updated_at=now() WHERE id=$1`, channelID); err != nil {
			return Message{}, fmt.Errorf("chat.PostMessage update channel: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Message{}, fmt.Errorf("chat.PostMessage commit: %w", err)
	}
	return m, nil
}

// msgColumnsWithReplies is like msgColumns but adds a reply_count subquery.
// Used when listing top-level messages in a channel.
const msgColumnsWithReplies = `m.id::text, m.channel_id::text, m.org_id::text, m.sender_id::text, m.sender_name, m.body, m.reactions::text, m.sent_at, COALESCE(m.parent_id::text, ''),
    (SELECT COUNT(*)::int FROM grown.chat_messages r WHERE r.parent_id = m.id)`

// ListMessages returns up to limit top-level messages (parent_id IS NULL) in
// channelID, newest first. If beforeID is set, only messages older than that
// message are returned. Each message includes its reply_count.
func (r *Repository) ListMessages(ctx context.Context, orgID, channelID, beforeID string, limit int32) ([]Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var rows pgx.Rows
	var err error
	if beforeID != "" {
		rows, err = r.pool.Query(ctx,
			`SELECT `+msgColumnsWithReplies+`
			 FROM grown.chat_messages m
			 WHERE m.channel_id=$1 AND m.org_id=$2 AND m.parent_id IS NULL
			   AND m.sent_at < (SELECT sent_at FROM grown.chat_messages WHERE id=$3 AND org_id=$2)
			 ORDER BY m.sent_at DESC LIMIT $4`,
			channelID, orgID, beforeID, limit)
	} else {
		rows, err = r.pool.Query(ctx,
			`SELECT `+msgColumnsWithReplies+`
			 FROM grown.chat_messages m
			 WHERE m.channel_id=$1 AND m.org_id=$2 AND m.parent_id IS NULL
			 ORDER BY m.sent_at DESC LIMIT $3`,
			channelID, orgID, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("chat.ListMessages: %w", err)
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.ChannelID, &m.OrgID, &m.SenderID, &m.SenderName, &m.Body, &m.Reactions, &m.SentAt, &m.ParentID, &m.ReplyCount); err != nil {
			return nil, fmt.Errorf("chat.ListMessages scan: %w", err)
		}
		if m.Reactions == "" {
			m.Reactions = "{}"
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListThreadReplies returns replies to parentID in chronological order.
func (r *Repository) ListThreadReplies(ctx context.Context, orgID, channelID, parentID string, limit int32) ([]Message, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := r.pool.Query(ctx,
		`SELECT `+msgColumns+`
		 FROM grown.chat_messages
		 WHERE channel_id=$1 AND org_id=$2 AND parent_id=$3::uuid
		 ORDER BY sent_at ASC LIMIT $4`,
		channelID, orgID, parentID, limit)
	if err != nil {
		return nil, fmt.Errorf("chat.ListThreadReplies: %w", err)
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, fmt.Errorf("chat.ListThreadReplies scan: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// DeleteMessage soft-deletes by removing the body (marks as deleted).
func (r *Repository) DeleteMessage(ctx context.Context, orgID, channelID, id, callerID string) error {
	// Only sender or org-level admin can delete; for now only sender check.
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.chat_messages
		 WHERE id=$1 AND channel_id=$2 AND org_id=$3 AND sender_id=$4`,
		id, channelID, orgID, callerID)
	if err != nil {
		return fmt.Errorf("chat.DeleteMessage: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ToggleReaction adds the reaction if the user hasn't reacted with that emoji
// yet, or removes it if they have. Returns the updated aggregate reactions for
// the message.
func (r *Repository) ToggleReaction(ctx context.Context, orgID, messageID, userID, emoji string) ([]Reaction, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("chat.ToggleReaction begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Check whether the row already exists.
	var exists bool
	err = tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.chat_message_reactions
		  WHERE message_id=$1::uuid AND user_id=$2::uuid AND emoji=$3)`,
		messageID, userID, emoji).Scan(&exists)
	if err != nil {
		return nil, fmt.Errorf("chat.ToggleReaction check: %w", err)
	}

	if exists {
		if _, err := tx.Exec(ctx,
			`DELETE FROM grown.chat_message_reactions
			 WHERE message_id=$1::uuid AND user_id=$2::uuid AND emoji=$3`,
			messageID, userID, emoji); err != nil {
			return nil, fmt.Errorf("chat.ToggleReaction delete: %w", err)
		}
	} else {
		if _, err := tx.Exec(ctx,
			`INSERT INTO grown.chat_message_reactions (message_id, org_id, user_id, emoji)
			 VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
			 ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
			messageID, orgID, userID, emoji); err != nil {
			return nil, fmt.Errorf("chat.ToggleReaction insert: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("chat.ToggleReaction commit: %w", err)
	}

	return r.GetReactions(ctx, messageID, userID)
}

// GetReactions returns the aggregate reactions for a message, with the me flag
// set when userID has reacted with that emoji.
func (r *Repository) GetReactions(ctx context.Context, messageID, userID string) ([]Reaction, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT emoji,
		        COUNT(*)::int AS count,
		        BOOL_OR(user_id = $2::uuid) AS me
		 FROM grown.chat_message_reactions
		 WHERE message_id = $1::uuid
		 GROUP BY emoji
		 ORDER BY MIN(created_at)`,
		messageID, userID)
	if err != nil {
		return nil, fmt.Errorf("chat.GetReactions: %w", err)
	}
	defer rows.Close()
	var out []Reaction
	for rows.Next() {
		var rx Reaction
		if err := rows.Scan(&rx.Emoji, &rx.Count, &rx.Me); err != nil {
			return nil, fmt.Errorf("chat.GetReactions scan: %w", err)
		}
		out = append(out, rx)
	}
	return out, rows.Err()
}

// GetReactionsForMessages returns a map[messageID][]Reaction for a batch of
// message IDs, with the me flag relative to userID.
func (r *Repository) GetReactionsForMessages(ctx context.Context, messageIDs []string, userID string) (map[string][]Reaction, error) {
	if len(messageIDs) == 0 {
		return map[string][]Reaction{}, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT message_id::text, emoji, COUNT(*)::int, BOOL_OR(user_id = $2::uuid)
		 FROM grown.chat_message_reactions
		 WHERE message_id = ANY($1::uuid[])
		 GROUP BY message_id, emoji
		 ORDER BY message_id, MIN(created_at)`,
		messageIDs, userID)
	if err != nil {
		return nil, fmt.Errorf("chat.GetReactionsForMessages: %w", err)
	}
	defer rows.Close()
	out := make(map[string][]Reaction)
	for rows.Next() {
		var msgID string
		var rx Reaction
		if err := rows.Scan(&msgID, &rx.Emoji, &rx.Count, &rx.Me); err != nil {
			return nil, fmt.Errorf("chat.GetReactionsForMessages scan: %w", err)
		}
		out[msgID] = append(out[msgID], rx)
	}
	return out, rows.Err()
}

// UpdateReadCursor upserts the read cursor for a user in a channel.
func (r *Repository) UpdateReadCursor(ctx context.Context, channelID, userID string) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.chat_read_cursors (channel_id, user_id, last_read_at)
		 VALUES ($1, $2, now())
		 ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read_at = now()`,
		channelID, userID)
	return err
}

// ---- Attachments ------------------------------------------------------------

// CreateAttachment inserts chat attachment metadata (the blob is stored separately).
func (r *Repository) CreateAttachment(ctx context.Context, m AttachmentMeta) (AttachmentMeta, error) {
	q := `INSERT INTO grown.chat_attachments (org_id, name, mime_type, size_bytes, blob_key)
	      VALUES ($1,$2,$3,$4,$5) RETURNING id::text`
	err := r.pool.QueryRow(ctx, q, m.OrgID, m.Name, m.MimeType, m.Size, m.BlobKey).Scan(&m.ID)
	if err != nil {
		return AttachmentMeta{}, fmt.Errorf("chat.CreateAttachment: %w", err)
	}
	return m, nil
}

// GetAttachment returns chat attachment metadata within an org (for download).
func (r *Repository) GetAttachment(ctx context.Context, orgID, id string) (AttachmentMeta, error) {
	var m AttachmentMeta
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, org_id::text, COALESCE(message_id::text,''), name, mime_type, size_bytes, blob_key
		 FROM grown.chat_attachments WHERE id=$1 AND org_id=$2`, id, orgID).
		Scan(&m.ID, &m.OrgID, &m.MessageID, &m.Name, &m.MimeType, &m.Size, &m.BlobKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return AttachmentMeta{}, ErrNotFound
	}
	if err != nil {
		return AttachmentMeta{}, fmt.Errorf("chat.GetAttachment: %w", err)
	}
	return m, nil
}

// LinkAttachmentsToMessage sets the message_id FK on a batch of attachment ids.
// Silently skips ids that don't belong to orgID.
func (r *Repository) LinkAttachmentsToMessage(ctx context.Context, orgID, messageID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := r.pool.Exec(ctx,
		`UPDATE grown.chat_attachments
		 SET message_id = $1::uuid
		 WHERE org_id = $2::uuid AND id = ANY($3::uuid[]) AND message_id IS NULL`,
		messageID, orgID, ids)
	return err
}

// GetAttachmentsForMessage returns all attachments linked to a message.
func (r *Repository) GetAttachmentsForMessage(ctx context.Context, orgID, messageID string) ([]AttachmentMeta, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, org_id::text, COALESCE(message_id::text,''), name, mime_type, size_bytes, blob_key
		 FROM grown.chat_attachments
		 WHERE message_id = $1::uuid AND org_id = $2::uuid
		 ORDER BY created_at`,
		messageID, orgID)
	if err != nil {
		return nil, fmt.Errorf("chat.GetAttachmentsForMessage: %w", err)
	}
	defer rows.Close()
	var out []AttachmentMeta
	for rows.Next() {
		var m AttachmentMeta
		if err := rows.Scan(&m.ID, &m.OrgID, &m.MessageID, &m.Name, &m.MimeType, &m.Size, &m.BlobKey); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
