package mail

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"code.pick.haus/grown/grown/internal/email"
)

// Caller is the authenticated identity a backend operates on behalf of. It
// decouples the storage backends from the auth package.
type Caller struct {
	UserID string
	OrgID  string
	Email  string
	Name   string
}

// Compose is the editable payload of an outgoing message / draft.
type Compose struct {
	To          []string
	Cc          []string
	Subject     string
	Body        string
	Draft       bool
	Attachments []Attachment
}

// Backend is the mailbox storage/transport the MailService talks to. Two
// implementations exist: LocalBackend (Postgres, internal delivery) and the
// IMAP/SMTP Bridge (mailcow). The proto surface + Service are backend-agnostic;
// swapping backends is a config flip (GROWN_MAIL_BACKEND).
type Backend interface {
	// List returns messages in a folder plus per-folder unread counts.
	List(ctx context.Context, c Caller, folder, label, query string, starred bool) ([]Message, map[string]int32, error)
	// ListThreads groups a folder's messages into conversations (one entry per
	// thread_id), plus per-folder unread counts.
	ListThreads(ctx context.Context, c Caller, folder, label, query string, starred bool) ([]Thread, map[string]int32, error)
	// GetThread returns every message in a thread (full bodies, oldest first) and
	// marks them read.
	GetThread(ctx context.Context, c Caller, threadID, folder string) ([]Message, error)
	// ListLabels returns the distinct labels in use across the mailbox.
	ListLabels(ctx context.Context, c Caller) ([]string, error)
	// Get returns one message (full body) and marks it read.
	Get(ctx context.Context, c Caller, id string) (Message, error)
	// Send sends (or saves as draft) a message and returns the stored copy.
	Send(ctx context.Context, c Caller, m Compose) (Message, error)
	// Modify updates flags / folder / labels.
	Modify(ctx context.Context, c Caller, id string, ch Changes) (Message, error)
	// Delete removes a message (hard delete; the UI trashes first).
	Delete(ctx context.Context, c Caller, id string) error
}

// LocalBackend implements Backend over the Postgres Repository with internal
// delivery between org users. This is the default backend.
//
// External delivery: recipients whose address is NOT on the workspace mail
// domain (the domain of the email Sender's From address, e.g. pick.haus) are
// also dispatched via the Resend HTTP API when an external sender is set, so a
// message composed in /mail actually leaves the building. Internal org users
// still get an in-app inbox copy as before.
type LocalBackend struct {
	repo *Repository
	ext  *email.Sender // optional; nil = internal-only delivery
}

// NewLocalBackend constructs the Postgres-backed mail backend.
func NewLocalBackend(repo *Repository) *LocalBackend { return &LocalBackend{repo: repo} }

// SetExternalSender wires the Resend sender used to deliver messages addressed
// to recipients outside the workspace mail domain.
func (b *LocalBackend) SetExternalSender(s *email.Sender) { b.ext = s }

// domainOf returns the lowercase domain of an RFC 5322 address ("Name <a@b>"
// or "a@b" → "b"), or "" if none.
func domainOf(addr string) string {
	a := addr
	if i := strings.LastIndex(a, "<"); i >= 0 {
		if j := strings.Index(a[i:], ">"); j >= 0 {
			a = a[i+1 : i+j]
		}
	}
	at := strings.LastIndex(a, "@")
	if at < 0 {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(a[at+1:]))
}

func (b *LocalBackend) List(ctx context.Context, c Caller, folder, label, query string, starred bool) ([]Message, map[string]int32, error) {
	msgs, err := b.repo.List(ctx, c.UserID, folder, label, query, starred)
	if err != nil {
		return nil, nil, err
	}
	counts, err := b.repo.UnreadCounts(ctx, c.UserID)
	if err != nil {
		return nil, nil, err
	}
	return msgs, counts, nil
}

func (b *LocalBackend) ListThreads(ctx context.Context, c Caller, folder, label, query string, starred bool) ([]Thread, map[string]int32, error) {
	threads, err := b.repo.ListThreads(ctx, c.UserID, folder, label, query, starred)
	if err != nil {
		return nil, nil, err
	}
	counts, err := b.repo.UnreadCounts(ctx, c.UserID)
	if err != nil {
		return nil, nil, err
	}
	return threads, counts, nil
}

func (b *LocalBackend) GetThread(ctx context.Context, c Caller, threadID, folder string) ([]Message, error) {
	msgs, err := b.repo.GetThread(ctx, c.UserID, threadID, folder)
	if err != nil {
		return nil, err
	}
	// Mark the whole thread read (best-effort) so unread counts settle.
	_ = b.repo.MarkThreadRead(ctx, c.UserID, threadID)
	for i := range msgs {
		msgs[i].IsRead = true
	}
	return msgs, nil
}

func (b *LocalBackend) ListLabels(ctx context.Context, c Caller) ([]string, error) {
	return b.repo.ListLabels(ctx, c.UserID)
}

func (b *LocalBackend) Get(ctx context.Context, c Caller, id string) (Message, error) {
	m, err := b.repo.Get(ctx, c.UserID, id)
	if err != nil {
		return Message{}, err
	}
	if !m.IsRead {
		if upd, e := b.repo.Modify(ctx, c.UserID, id, Changes{IsRead: true, Starred: m.Starred}); e == nil {
			upd.Body = m.Body
			m = upd
		}
	}
	return m, nil
}

func (b *LocalBackend) Send(ctx context.Context, c Caller, m Compose) (Message, error) {
	base := Message{
		OrgID: c.OrgID, FromAddr: c.Email, FromName: c.Name,
		ToAddrs: m.To, CcAddrs: m.Cc, Subject: m.Subject, Body: m.Body, Snippet: snippetOf(m.Body),
		Attachments: m.Attachments,
	}
	if m.Draft {
		base.OwnerID = c.UserID
		base.Folder = "drafts"
		base.IsRead = true
		return b.repo.Insert(ctx, base)
	}
	// Sender's Sent copy establishes the thread.
	sent := base
	sent.OwnerID = c.UserID
	sent.Folder = "sent"
	sent.IsRead = true
	sentMsg, err := b.repo.Insert(ctx, sent)
	if err != nil {
		return Message{}, err
	}
	// Deliver an Inbox copy to each recipient that is an org user (including the
	// sender if they addressed themselves — useful for local testing).
	emails := append(append([]string{}, m.To...), m.Cc...)
	if recips, e := b.repo.RecipientsInOrg(ctx, c.OrgID, emails); e == nil {
		for _, rc := range recips {
			inbox := base
			inbox.OwnerID = rc.ID
			inbox.Folder = "inbox"
			inbox.ThreadID = sentMsg.ThreadID
			// Apply the recipient's rules (label/move/mark/star/forward).
			if rules, re := b.repo.ListRules(ctx, rc.ID); re == nil && len(rules) > 0 {
				for _, fa := range applyRules(&inbox, rules) {
					b.deliverForward(ctx, c.OrgID, fa, base, sentMsg.ThreadID)
				}
			}
			_, _ = b.repo.Insert(ctx, inbox)
		}
	}
	// External delivery: send to any recipient not on the workspace mail domain
	// via Resend, so /mail messages actually reach outside addresses (gmail etc.).
	if err := b.sendExternal(ctx, c, m, emails); err != nil {
		// The Sent copy is already stored; surface the failure so the UI reports it.
		return sentMsg, err
	}
	return sentMsg, nil
}

// sendExternal dispatches the message to every recipient whose domain is not the
// workspace's own mail domain, via the Resend sender. No-op when no external
// sender is configured or there are no external recipients.
func (b *LocalBackend) sendExternal(ctx context.Context, c Caller, m Compose, recipients []string) error {
	if b.ext == nil || !b.ext.Configured() {
		return nil
	}
	localDomain := domainOf(b.ext.From()) // e.g. "pick.haus"
	var to, cc []string
	for _, a := range m.To {
		if d := domainOf(a); d != "" && d != localDomain {
			to = append(to, a)
		}
	}
	for _, a := range m.Cc {
		if d := domainOf(a); d != "" && d != localDomain {
			cc = append(cc, a)
		}
	}
	if len(to) == 0 && len(cc) == 0 {
		return nil
	}
	// From must use a Resend-verified domain. If the sender's own address is on
	// the local domain, send truly as them; otherwise send as the default From
	// (noreply@…) with their name, and set Reply-To so replies reach them.
	from := b.ext.From()
	replyTo := ""
	if strings.EqualFold(domainOf(c.Email), localDomain) {
		if c.Name != "" {
			from = fmt.Sprintf("%s <%s>", c.Name, c.Email)
		} else {
			from = c.Email
		}
	} else {
		if c.Name != "" {
			from = fmt.Sprintf("%s <%s>", c.Name, addrOf(b.ext.From()))
		}
		replyTo = c.Email
	}
	subject := m.Subject
	if strings.TrimSpace(subject) == "" {
		subject = "(no subject)"
	}
	text := m.Body
	if strings.TrimSpace(text) == "" {
		text = " "
	}
	msg := email.Message{
		To: to, Cc: cc, Subject: subject, Text: text,
		HTML: "<div style=\"white-space:pre-wrap\">" + htmlEscape(m.Body) + "</div>",
		From: from, ReplyTo: replyTo,
	}
	if err := b.ext.Send(ctx, msg); err != nil {
		slog.Error("mail: external send failed", "to", to, "err", err)
		return fmt.Errorf("mail: external delivery failed: %w", err)
	}
	slog.Info("mail: external send ok", "to", to, "cc", cc, "from", from)
	return nil
}

// addrOf returns the bare address part of an RFC 5322 "Name <addr>" or "addr".
func addrOf(s string) string {
	if i := strings.LastIndex(s, "<"); i >= 0 {
		if j := strings.Index(s[i:], ">"); j >= 0 {
			return s[i+1 : i+j]
		}
	}
	return s
}

// htmlEscape escapes the minimal set of characters for embedding plain text in
// an HTML body.
func htmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	return r.Replace(s)
}

// deliverForward delivers a redirected copy to an org user (one hop; rules are
// not re-applied to avoid loops).
func (b *LocalBackend) deliverForward(ctx context.Context, orgID, addr string, base Message, threadID string) {
	recips, err := b.repo.RecipientsInOrg(ctx, orgID, []string{addr})
	if err != nil {
		return
	}
	for _, fr := range recips {
		fwd := base
		fwd.OwnerID = fr.ID
		fwd.Folder = "inbox"
		fwd.ThreadID = threadID
		fwd.Subject = "Fwd: " + base.Subject
		_, _ = b.repo.Insert(ctx, fwd)
	}
}

// ruleMatches reports whether a message matches a rule's (ANDed, non-empty)
// criteria. A rule with no criteria never matches (avoids catch-all).
func ruleMatches(m *Message, r Rule) bool {
	ci := func(hay, needle string) bool { return strings.Contains(strings.ToLower(hay), strings.ToLower(needle)) }
	any := false
	if r.MatchFrom != "" {
		any = true
		if !ci(m.FromAddr+" "+m.FromName, r.MatchFrom) {
			return false
		}
	}
	if r.MatchSubject != "" {
		any = true
		if !ci(m.Subject, r.MatchSubject) {
			return false
		}
	}
	if r.MatchTo != "" {
		any = true
		if !ci(strings.Join(m.ToAddrs, " ")+" "+strings.Join(m.CcAddrs, " "), r.MatchTo) {
			return false
		}
	}
	return any
}

// applyRules mutates the message per matching rules and returns forward addresses.
func applyRules(m *Message, rules []Rule) []string {
	var forwards []string
	for _, r := range rules {
		if !ruleMatches(m, r) {
			continue
		}
		if r.ActFolder != "" {
			m.Folder = r.ActFolder
		}
		if r.ActLabel != "" {
			has := false
			for _, l := range m.Labels {
				if l == r.ActLabel {
					has = true
				}
			}
			if !has {
				m.Labels = append(m.Labels, r.ActLabel)
			}
		}
		if r.ActMarkRead {
			m.IsRead = true
		}
		if r.ActStar {
			m.Starred = true
		}
		if r.ActForward != "" {
			forwards = append(forwards, r.ActForward)
		}
	}
	return forwards
}

func (b *LocalBackend) Modify(ctx context.Context, c Caller, id string, ch Changes) (Message, error) {
	return b.repo.Modify(ctx, c.UserID, id, ch)
}

func (b *LocalBackend) Delete(ctx context.Context, c Caller, id string) error {
	return b.repo.Delete(ctx, c.UserID, id)
}

// filterMatches reports whether a message matches a normalized Filter.
// match_op: "contains" (case-insensitive substring) or "equals" (case-insensitive exact).
// match_field: "from", "to", "subject", "body".
func filterMatches(m *Message, f Filter) bool {
	if f.MatchValue == "" {
		return false
	}
	val := strings.ToLower(f.MatchValue)
	var hay string
	switch f.MatchField {
	case "from":
		hay = strings.ToLower(m.FromAddr + " " + m.FromName)
	case "to":
		hay = strings.ToLower(strings.Join(m.ToAddrs, " ") + " " + strings.Join(m.CcAddrs, " "))
	case "subject":
		hay = strings.ToLower(m.Subject)
	case "body":
		hay = strings.ToLower(m.Body + " " + m.Snippet)
	default:
		hay = strings.ToLower(m.Subject)
	}
	switch f.MatchOp {
	case "equals":
		return hay == val
	default: // "contains"
		return strings.Contains(hay, val)
	}
}

// applyFilter mutates the message per a matching Filter (label, mark_read, archive, star).
func applyFilter(m *Message, f Filter) {
	switch f.ActionType {
	case "label":
		if f.ActionValue != "" && !contains(m.Labels, f.ActionValue) {
			m.Labels = append(m.Labels, f.ActionValue)
		}
	case "mark_read":
		m.IsRead = true
	case "archive":
		if m.Folder == "inbox" {
			m.Folder = "archive"
		}
	case "star":
		m.Starred = true
	}
}

// ApplyFiltersNow applies all user filters to existing inbox messages and
// returns the count of messages modified.
func (b *LocalBackend) ApplyFiltersNow(ctx context.Context, c Caller) (int32, error) {
	filters, err := b.repo.ListFilters(ctx, c.UserID)
	if err != nil {
		return 0, err
	}
	if len(filters) == 0 {
		return 0, nil
	}
	msgs, err := b.repo.List(ctx, c.UserID, "inbox", "", "", false)
	if err != nil {
		return 0, err
	}
	var modified int32
	for _, msg := range msgs {
		orig := msg
		for _, f := range filters {
			if filterMatches(&msg, f) {
				applyFilter(&msg, f)
			}
		}
		// Only update if something changed.
		if msg.IsRead != orig.IsRead || msg.Starred != orig.Starred ||
			msg.Folder != orig.Folder || !stringSliceEq(msg.Labels, orig.Labels) {
			ch := Changes{
				IsRead:    msg.IsRead,
				Starred:   msg.Starred,
				SetLabels: true,
				Labels:    msg.Labels,
			}
			if msg.Folder != orig.Folder {
				ch.Folder = msg.Folder
			}
			if _, err := b.repo.Modify(ctx, c.UserID, orig.ID, ch); err == nil {
				modified++
			}
		}
	}
	return modified, nil
}

func stringSliceEq(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
