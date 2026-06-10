package mail

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	netmail "net/mail"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"code.pick.haus/grown/grown/internal/email"
	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	_ "github.com/emersion/go-message/charset" // register non-UTF-8 charset decoders
)

// ErrNotImplemented is retained for paths still unsupported by the bridge
// (currently only saving drafts, which needs IMAP APPEND).
var ErrNotImplemented = errors.New("mail: not implemented by the IMAP bridge yet")

// BridgeConfig configures the IMAP bridge to a Mailu instance.
//
// Auth strategy: mailbox IMAP auth is password-based. To act on behalf of a
// grown (Zitadel-authenticated) user without their password, use a Dovecot
// **master user** — login as "<mailbox>*<masteruser>" with the master password.
// Set MasterUser/MasterPass for that.
//
// Sending no longer uses SMTP (Mailu's front rejects the master user on SMTP
// submission). SMTPAddr/SMTPUser/SMTPPass are retained as inert legacy fields
// and are no longer required.
type BridgeConfig struct {
	IMAPAddr   string // host:port (993 implicit TLS, or 143 STARTTLS)
	SMTPAddr   string // deprecated: unused; sending is via IMAP APPEND + email.Sender
	MasterUser string // Dovecot master user (preferred; used for IMAP)
	MasterPass string
	SMTPUser   string // deprecated: unused
	SMTPPass   string // deprecated: unused
	TLS        bool   // implicit TLS for IMAP (993); false = STARTTLS (143)
	// TLSInsecure skips TLS cert verification (IMAP). Needed for the self-signed
	// cert that mailu presents in-cluster. The host name from the dial address is
	// still used as ServerName.
	TLSInsecure bool
	// MailDomain is the Mailu mail domain. When set, grown logins (often an
	// external address like gmail) are mapped onto a mailbox on this domain via
	// mailboxAddr. Empty = use the caller's email verbatim (back-compat).
	MailDomain string
	// Plaintext dials IMAP without TLS at all (no implicit TLS, no STARTTLS).
	// Mailu's internal dovecot listener (mailu-dovecot:143) is a trusted plaintext
	// IMAP endpoint inside the cluster; STARTTLS there is unreliable. Set
	// GROWN_MAIL_IMAP_PLAINTEXT=true for that. Takes precedence over TLS.
	Plaintext bool
}

// BridgeConfigFromEnv reads GROWN_MAIL_* env vars.
func BridgeConfigFromEnv() BridgeConfig {
	return BridgeConfig{
		IMAPAddr:    os.Getenv("GROWN_MAIL_IMAP_ADDR"),
		SMTPAddr:    os.Getenv("GROWN_MAIL_SMTP_ADDR"),
		MasterUser:  os.Getenv("GROWN_MAIL_MASTER_USER"),
		MasterPass:  os.Getenv("GROWN_MAIL_MASTER_PASS"),
		SMTPUser:    os.Getenv("GROWN_MAIL_SMTP_USER"),
		SMTPPass:    os.Getenv("GROWN_MAIL_SMTP_PASS"),
		TLS:         os.Getenv("GROWN_MAIL_IMAP_TLS") != "false",
		TLSInsecure: os.Getenv("GROWN_MAIL_TLS_INSECURE") == "true",
		MailDomain:  os.Getenv("GROWN_MAIL_DOMAIN"),
		Plaintext:   os.Getenv("GROWN_MAIL_IMAP_PLAINTEXT") == "true",
	}
}

// folderToIMAP maps our folder names to IMAP mailbox names (mailcow/Dovecot
// defaults). "starred" is a \Flagged search in INBOX; "snoozed" has no native
// IMAP equivalent.
var folderToIMAP = map[string]string{
	"inbox":  "INBOX",
	"sent":   "Sent",
	"drafts": "Drafts",
	"spam":   "Junk",
	"trash":  "Trash",
}

func mailboxFor(folder string) string {
	if m, ok := folderToIMAP[folder]; ok {
		return m
	}
	return "INBOX"
}

// Bridge implements Backend against a Mailu instance over IMAP. Reads use the
// Dovecot master user; sending stores a Sent copy and delivers internally via
// IMAP APPEND, and reaches external recipients via the Resend email.Sender.
// Message ids are "<folder>:<uid>" so Get/Modify/Delete can re-select.
//
// Why no SMTP: Mailu's front (nginx) authenticates SMTP submission against its
// admin API, which does not recognise the Dovecot master user. The master user
// works for IMAP directly against dovecot:143, so sending is done entirely over
// IMAP (APPEND for storage + internal delivery) plus the external sender.
type Bridge struct {
	cfg BridgeConfig
	ext *email.Sender // optional; nil = no external (off-domain) delivery
}

// NewBridge constructs the IMAP bridge.
func NewBridge(cfg BridgeConfig) *Bridge { return &Bridge{cfg: cfg} }

// SetExternalSender wires the email.Sender used to deliver messages addressed to
// recipients outside the Mailu mail domain (mirrors LocalBackend).
func (b *Bridge) SetExternalSender(s *email.Sender) { b.ext = s }

func host(addr string) string {
	h, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return h
}

// mailboxAddr maps a grown caller's login identity onto the Mailu mailbox
// address. With no MailDomain configured it returns the caller's email verbatim
// (back-compat). With a MailDomain set, an address already on that domain is
// passed through, otherwise the local part of the caller's email is taken and
// re-homed onto the mail domain (lowercased). Examples (MailDomain=mail.x):
//
//	alice@gmail.com   -> alice@mail.x
//	bob@mail.x        -> bob@mail.x
//	carol             -> carol@mail.x
func mailboxAddr(cfg BridgeConfig, c Caller) string {
	if cfg.MailDomain == "" {
		return c.Email
	}
	suffix := "@" + cfg.MailDomain
	if strings.HasSuffix(strings.ToLower(c.Email), strings.ToLower(suffix)) {
		return c.Email
	}
	local := c.Email
	if i := strings.Index(local, "@"); i >= 0 {
		local = local[:i]
	}
	return strings.ToLower(local) + suffix
}

// tlsConfigFor builds the TLS config used for IMAP dials. When TLSInsecure is
// set, cert verification is skipped (for the self-signed mailu cert) while still
// pinning the ServerName to the dial host.
func (b *Bridge) tlsConfigFor(addr string) *tls.Config {
	if !b.cfg.TLSInsecure {
		return nil
	}
	return &tls.Config{InsecureSkipVerify: true, ServerName: host(addr)}
}

func msgID(folder string, uid imap.UID) string {
	return folder + ":" + strconv.FormatUint(uint64(uid), 10)
}
func parseMsgID(id string) (string, imap.UID, bool) {
	i := strings.LastIndex(id, ":")
	if i < 0 {
		return "", 0, false
	}
	n, err := strconv.ParseUint(id[i+1:], 10, 32)
	if err != nil {
		return "", 0, false
	}
	return id[:i], imap.UID(n), true
}

// ---- Send (IMAP APPEND + external sender) ----

// buildRFC822 renders the outgoing message. fromAddr is the mailbox-mapped
// envelope/header address; the caller's display name is preserved.
func buildRFC822(fromAddr string, c Caller, m Compose) []byte {
	var sb strings.Builder
	from := fromAddr
	if c.Name != "" {
		from = fmt.Sprintf("%s <%s>", c.Name, fromAddr)
	}
	fmt.Fprintf(&sb, "From: %s\r\n", from)
	fmt.Fprintf(&sb, "To: %s\r\n", strings.Join(m.To, ", "))
	if len(m.Cc) > 0 {
		fmt.Fprintf(&sb, "Cc: %s\r\n", strings.Join(m.Cc, ", "))
	}
	fmt.Fprintf(&sb, "Subject: %s\r\n", m.Subject)
	fmt.Fprintf(&sb, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	sb.WriteString("MIME-Version: 1.0\r\n")
	sb.WriteString("Content-Type: text/plain; charset=utf-8\r\n\r\n")
	sb.WriteString(strings.ReplaceAll(m.Body, "\n", "\r\n"))
	return []byte(sb.String())
}

// splitRecipients partitions To+Cc into those on the Mailu mail domain (delivered
// internally via IMAP APPEND) and those off it (delivered via the external
// sender). With no MailDomain configured every recipient is treated as external
// (back-compat: there is no local domain to deliver into). Returns dedup'd
// lowercased internal addresses and the original To/Cc external slices.
func splitRecipients(mailDomain string, to, cc []string) (internal []string, extTo, extCc []string) {
	dom := strings.ToLower(strings.TrimSpace(mailDomain))
	seen := map[string]bool{}
	classify := func(addrs []string, ext *[]string) {
		for _, a := range addrs {
			d := domainOf(a)
			if dom != "" && d == dom {
				bare := strings.ToLower(addrOf(a))
				if !seen[bare] {
					seen[bare] = true
					internal = append(internal, bare)
				}
				continue
			}
			*ext = append(*ext, a)
		}
	}
	classify(to, &extTo)
	classify(cc, &extCc)
	return internal, extTo, extCc
}

// append1 opens a master IMAP session for the given caller and APPENDs raw to
// the named mailbox with the given flags.
func (b *Bridge) append1(c Caller, mailbox string, flags []imap.Flag, raw []byte) error {
	cl, err := b.connect(c)
	if err != nil {
		return err
	}
	defer func() { cl.Logout().Wait() }()
	return appendTo(cl, mailbox, flags, raw)
}

// appendTo APPENDs raw to mailbox on an already-connected client. go-imap v2
// (beta.8) Append signature: Append(mailbox string, size int64, *AppendOptions)
// returns *AppendCommand; the caller Writes the literal, Closes, then Waits.
func appendTo(cl *imapclient.Client, mailbox string, flags []imap.Flag, raw []byte) error {
	opts := &imap.AppendOptions{Flags: flags, Time: time.Now()}
	cmd := cl.Append(mailbox, int64(len(raw)), opts)
	if _, err := cmd.Write(raw); err != nil {
		_ = cmd.Close()
		return fmt.Errorf("append write %s: %w", mailbox, err)
	}
	if err := cmd.Close(); err != nil {
		return fmt.Errorf("append close %s: %w", mailbox, err)
	}
	if _, err := cmd.Wait(); err != nil {
		return fmt.Errorf("append %s: %w", mailbox, err)
	}
	return nil
}

// Send delivers an outgoing message without using SMTP (see Bridge doc):
//
//   - Drafts APPEND to the sender's Drafts (unseen) and return.
//   - Otherwise the message is APPENDed to the sender's Sent (\Seen).
//   - Recipients on the Mailu MailDomain are delivered by APPENDing to each
//     recipient's INBOX (unseen) via that recipient's master session.
//   - Recipients off the MailDomain are sent via the external email.Sender.
func (b *Bridge) Send(ctx context.Context, c Caller, m Compose) (Message, error) {
	fromAddr := mailboxAddr(b.cfg, c)
	raw := buildRFC822(fromAddr, c, m)
	now := time.Now()

	if m.Draft {
		if err := b.append1(c, mailboxFor("drafts"), nil, raw); err != nil {
			return Message{}, fmt.Errorf("mail bridge save draft: %w", err)
		}
		return Message{
			Folder: "drafts", FromAddr: fromAddr, FromName: c.Name, ToAddrs: m.To, CcAddrs: m.Cc,
			Subject: m.Subject, Body: m.Body, Snippet: snippetOf(m.Body), IsRead: true, SentAt: now,
		}, nil
	}

	if len(m.To)+len(m.Cc) == 0 {
		return Message{}, errors.New("mail bridge: no recipients")
	}

	// 1. Store the Sent copy in the sender's mailbox (marked read).
	if err := b.append1(c, mailboxFor("sent"), []imap.Flag{imap.FlagSeen}, raw); err != nil {
		return Message{}, fmt.Errorf("mail bridge sent copy: %w", err)
	}

	internal, extTo, extCc := splitRecipients(b.cfg.MailDomain, m.To, m.Cc)

	// 2. Internal delivery: APPEND to each on-domain recipient's INBOX (unseen).
	for _, rcpt := range internal {
		if err := b.append1(Caller{Email: rcpt}, mailboxFor("inbox"), nil, raw); err != nil {
			// Best-effort: log and continue so one bad mailbox doesn't fail the send.
			slog.Error("mail bridge: internal delivery failed", "to", rcpt, "err", err)
		}
	}

	// 3. External delivery via the Resend sender.
	if len(extTo)+len(extCc) > 0 {
		if b.ext == nil || !b.ext.Configured() {
			slog.Warn("mail bridge: external recipients but no external sender configured", "to", extTo, "cc", extCc)
		} else {
			from := fromAddr
			if c.Name != "" {
				from = fmt.Sprintf("%s <%s>", c.Name, fromAddr)
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
				To: extTo, Cc: extCc, Subject: subject, Text: text,
				HTML:    "<div style=\"white-space:pre-wrap\">" + htmlEscape(m.Body) + "</div>",
				From:    from,
				ReplyTo: fromAddr,
			}
			if err := b.ext.Send(ctx, msg); err != nil {
				// The Sent copy is already stored; surface the failure.
				slog.Error("mail bridge: external send failed", "to", extTo, "err", err)
				return Message{}, fmt.Errorf("mail bridge external delivery: %w", err)
			}
		}
	}

	return Message{
		Folder: "sent", FromAddr: fromAddr, FromName: c.Name, ToAddrs: m.To, CcAddrs: m.Cc,
		Subject: m.Subject, Body: m.Body, Snippet: snippetOf(m.Body), IsRead: true, SentAt: now,
	}, nil
}

// ---- IMAP connection ----

func (b *Bridge) imapLogin(c Caller) (user, pass string) {
	mbox := mailboxAddr(b.cfg, c)
	if b.cfg.MasterUser != "" {
		return mbox + "*" + b.cfg.MasterUser, b.cfg.MasterPass
	}
	return mbox, b.cfg.MasterPass
}

func (b *Bridge) connect(c Caller) (*imapclient.Client, error) {
	if b.cfg.IMAPAddr == "" {
		return nil, errors.New("mail bridge: GROWN_MAIL_IMAP_ADDR not set")
	}
	var opts *imapclient.Options
	if tc := b.tlsConfigFor(b.cfg.IMAPAddr); tc != nil {
		opts = &imapclient.Options{TLSConfig: tc}
	}
	var cl *imapclient.Client
	var err error
	switch {
	case b.cfg.Plaintext:
		cl, err = imapclient.DialInsecure(b.cfg.IMAPAddr, opts)
	case b.cfg.TLS:
		cl, err = imapclient.DialTLS(b.cfg.IMAPAddr, opts)
	default:
		cl, err = imapclient.DialStartTLS(b.cfg.IMAPAddr, opts)
	}
	if err != nil {
		return nil, fmt.Errorf("mail bridge dial: %w", err)
	}
	user, pass := b.imapLogin(c)
	if err := cl.Login(user, pass).Wait(); err != nil {
		_ = cl.Close()
		return nil, fmt.Errorf("mail bridge login: %w", err)
	}
	return cl, nil
}

func toMessage(folder string, buf *imapclient.FetchMessageBuffer) Message {
	m := Message{ID: msgID(folder, buf.UID), Folder: folder}
	if e := buf.Envelope; e != nil {
		m.Subject = e.Subject
		m.SentAt = e.Date
		if len(e.From) > 0 {
			m.FromAddr = e.From[0].Addr()
			m.FromName = e.From[0].Name
		}
		for _, a := range e.To {
			m.ToAddrs = append(m.ToAddrs, a.Addr())
		}
		for _, a := range e.Cc {
			m.CcAddrs = append(m.CcAddrs, a.Addr())
		}
	}
	for _, f := range buf.Flags {
		switch f {
		case imap.FlagSeen:
			m.IsRead = true
		case imap.FlagFlagged:
			m.Starred = true
		}
	}
	return m
}

// extractText pulls a human-readable body out of a raw RFC822 message. It
// walks the MIME tree, prefers text/plain, falls back to stripped text/html,
// and decodes quoted-printable / base64 transfer encodings.
func extractText(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	msg, err := netmail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		// Couldn't parse headers — return everything after the header break.
		if i := bytes.Index(raw, []byte("\r\n\r\n")); i >= 0 {
			return strings.TrimSpace(string(raw[i+4:]))
		}
		return string(raw)
	}
	plain, html := walkMIME(
		msg.Header.Get("Content-Type"),
		msg.Header.Get("Content-Transfer-Encoding"),
		msg.Body,
	)
	if s := strings.TrimSpace(plain); s != "" {
		return s
	}
	if html != "" {
		return htmlToText(html)
	}
	return ""
}

// walkMIME recursively descends a MIME part, returning the first text/plain and
// text/html leaf bodies it finds (transfer-decoded). Go's mime/multipart does
// not decode Content-Transfer-Encoding, so we do it per-leaf.
func walkMIME(contentType, encoding string, body io.Reader) (plain, html string) {
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType == "" {
		mediaType = "text/plain"
	}
	if strings.HasPrefix(mediaType, "multipart/") && params["boundary"] != "" {
		mr := multipart.NewReader(body, params["boundary"])
		for {
			p, err := mr.NextPart()
			if err != nil {
				break
			}
			cp, ch := walkMIME(
				p.Header.Get("Content-Type"),
				p.Header.Get("Content-Transfer-Encoding"),
				p,
			)
			if plain == "" {
				plain = cp
			}
			if html == "" {
				html = ch
			}
			_ = p.Close()
			if plain != "" && html != "" {
				break
			}
		}
		return plain, html
	}
	decoded := decodeTransfer(encoding, body)
	switch {
	case strings.HasPrefix(mediaType, "text/plain"):
		return string(decoded), ""
	case strings.HasPrefix(mediaType, "text/html"):
		return "", string(decoded)
	}
	return "", ""
}

func decodeTransfer(encoding string, r io.Reader) []byte {
	switch strings.ToLower(strings.TrimSpace(encoding)) {
	case "quoted-printable":
		b, _ := io.ReadAll(quotedprintable.NewReader(r))
		return b
	case "base64":
		b, _ := io.ReadAll(base64.NewDecoder(base64.StdEncoding, newlineStripper{r}))
		return b
	default:
		b, _ := io.ReadAll(r)
		return b
	}
}

// newlineStripper drops CR/LF so base64 wrapped across lines decodes cleanly.
type newlineStripper struct{ r io.Reader }

func (n newlineStripper) Read(p []byte) (int, error) {
	buf := make([]byte, len(p))
	m, err := n.r.Read(buf)
	j := 0
	for i := 0; i < m; i++ {
		if buf[i] != '\r' && buf[i] != '\n' {
			p[j] = buf[i]
			j++
		}
	}
	return j, err
}

var htmlTagRe = regexp.MustCompile(`(?s)<[^>]*>`)

// htmlToText crudely renders an HTML body as plain text: strip tags, convert
// <br>/</p> to newlines, and decode the common entities.
func htmlToText(h string) string {
	h = regexp.MustCompile(`(?is)<(br|/p|/div|/tr)[^>]*>`).ReplaceAllString(h, "\n")
	h = regexp.MustCompile(`(?is)<(style|script)[^>]*>.*?</(style|script)>`).ReplaceAllString(h, "")
	h = htmlTagRe.ReplaceAllString(h, "")
	h = strings.NewReplacer(
		"&nbsp;", " ", "&amp;", "&", "&lt;", "<", "&gt;", ">",
		"&quot;", "\"", "&#39;", "'", "&apos;", "'",
	).Replace(h)
	// collapse 3+ blank lines
	h = regexp.MustCompile(`\n{3,}`).ReplaceAllString(h, "\n\n")
	return strings.TrimSpace(h)
}

func (b *Bridge) unreadCounts(cl *imapclient.Client) map[string]int32 {
	out := map[string]int32{}
	for folder, mbox := range folderToIMAP {
		sd, err := cl.Status(mbox, &imap.StatusOptions{NumUnseen: true}).Wait()
		if err != nil || sd == nil || sd.NumUnseen == nil {
			continue
		}
		out[folder] = int32(*sd.NumUnseen)
	}
	return out
}

func (b *Bridge) List(ctx context.Context, c Caller, folder, label, query string, starred bool) ([]Message, map[string]int32, error) {
	if folder == "" {
		folder = "inbox"
	}
	if folder == "snoozed" {
		return nil, nil, nil // no IMAP equivalent
	}
	searchFlagged := starred || folder == "starred"
	mbox := "INBOX"
	if folder != "starred" {
		mbox = mailboxFor(folder)
	}
	cl, err := b.connect(c)
	if err != nil {
		return nil, nil, err
	}
	defer func() { cl.Logout().Wait() }()
	if _, err := cl.Select(mbox, nil).Wait(); err != nil {
		return nil, nil, fmt.Errorf("select %s: %w", mbox, err)
	}
	crit := &imap.SearchCriteria{}
	if searchFlagged {
		crit.Flag = append(crit.Flag, imap.FlagFlagged)
	}
	if q := strings.TrimSpace(query); q != "" {
		crit.Text = []string{q}
	}
	sd, err := cl.UIDSearch(crit, nil).Wait()
	if err != nil {
		return nil, nil, fmt.Errorf("search: %w", err)
	}
	uids := sd.AllUIDs()
	if len(uids) > 100 {
		uids = uids[len(uids)-100:] // most recent 100
	}
	var msgs []Message
	if len(uids) > 0 {
		fo := &imap.FetchOptions{
			Envelope: true, Flags: true, UID: true,
			// Fetch the whole message (incl. headers) with Peek so the snippet
			// can be MIME-decoded; PartSpecifierText omits the Content-Type
			// header needed to parse multipart boundaries.
			BodySection: []*imap.FetchItemBodySection{{
				Specifier: imap.PartSpecifierNone, Peek: true,
			}},
		}
		bufs, err := cl.Fetch(imap.UIDSetNum(uids...), fo).Collect()
		if err != nil {
			return nil, nil, fmt.Errorf("fetch: %w", err)
		}
		for _, buf := range bufs {
			m := toMessage(folder, buf)
			for _, bs := range buf.BodySection {
				m.Snippet = snippetOf(extractText(bs.Bytes))
				break
			}
			msgs = append(msgs, m)
		}
		sort.Slice(msgs, func(i, j int) bool { return msgs[i].SentAt.After(msgs[j].SentAt) })
	}
	return msgs, b.unreadCounts(cl), nil
}

// ListThreads collapses the bridge's flat IMAP listing by thread_id. IMAP has no
// native thread id, so each message is its own single-message thread here.
func (b *Bridge) ListThreads(ctx context.Context, c Caller, folder, label, query string, starred bool) ([]Thread, map[string]int32, error) {
	msgs, counts, err := b.List(ctx, c, folder, label, query, starred)
	if err != nil {
		return nil, nil, err
	}
	threads := make([]Thread, 0, len(msgs))
	for _, m := range msgs {
		tid := m.ThreadID
		if tid == "" {
			tid = m.ID
		}
		p := m.FromName
		if p == "" {
			p = m.FromAddr
		}
		var parts []string
		if p != "" {
			parts = []string{p}
		}
		threads = append(threads, Thread{
			ThreadID: tid, Latest: m, MessageCount: 1,
			AnyUnread: !m.IsRead, Starred: m.Starred, Labels: m.Labels, Participants: parts,
		})
	}
	return threads, counts, nil
}

// GetThread is not supported by the IMAP bridge (no server-side threading); the
// UI falls back to opening individual messages.
func (b *Bridge) GetThread(ctx context.Context, c Caller, threadID, folder string) ([]Message, error) {
	return nil, ErrNotImplemented
}

// ListLabels is not supported by the IMAP bridge (labels are IMAP keywords, not
// enumerated here yet).
func (b *Bridge) ListLabels(ctx context.Context, c Caller) ([]string, error) {
	return nil, nil
}

func (b *Bridge) Get(ctx context.Context, c Caller, id string) (Message, error) {
	folder, uid, ok := parseMsgID(id)
	if !ok {
		return Message{}, ErrNotFound
	}
	cl, err := b.connect(c)
	if err != nil {
		return Message{}, err
	}
	defer func() { cl.Logout().Wait() }()
	if _, err := cl.Select(mailboxFor(folder), nil).Wait(); err != nil {
		return Message{}, fmt.Errorf("select: %w", err)
	}
	// Fetching the full message without Peek marks it \Seen.
	fo := &imap.FetchOptions{
		Envelope: true, Flags: true, UID: true,
		BodySection: []*imap.FetchItemBodySection{{Specifier: imap.PartSpecifierNone}},
	}
	bufs, err := cl.Fetch(imap.UIDSetNum(uid), fo).Collect()
	if err != nil || len(bufs) == 0 {
		return Message{}, ErrNotFound
	}
	m := toMessage(folder, bufs[0])
	for _, bs := range bufs[0].BodySection {
		m.Body = extractText(bs.Bytes)
		break
	}
	m.Snippet = snippetOf(m.Body)
	m.IsRead = true
	return m, nil
}

// Raw returns the full RFC822 source of a message (headers + body) for
// "Show original" inspection. Peek avoids changing the \Seen flag.
func (b *Bridge) Raw(ctx context.Context, c Caller, id string) ([]byte, error) {
	folder, uid, ok := parseMsgID(id)
	if !ok {
		return nil, ErrNotFound
	}
	cl, err := b.connect(c)
	if err != nil {
		return nil, err
	}
	defer func() { cl.Logout().Wait() }()
	if _, err := cl.Select(mailboxFor(folder), nil).Wait(); err != nil {
		return nil, fmt.Errorf("select: %w", err)
	}
	fo := &imap.FetchOptions{
		BodySection: []*imap.FetchItemBodySection{{Specifier: imap.PartSpecifierNone, Peek: true}},
	}
	bufs, err := cl.Fetch(imap.UIDSetNum(uid), fo).Collect()
	if err != nil || len(bufs) == 0 {
		return nil, ErrNotFound
	}
	for _, bs := range bufs[0].BodySection {
		return bs.Bytes, nil
	}
	return nil, ErrNotFound
}

func (b *Bridge) store(cl *imapclient.Client, set imap.UIDSet, op imap.StoreFlagsOp, flag imap.Flag) {
	if cmd := cl.Store(set, &imap.StoreFlags{Op: op, Silent: true, Flags: []imap.Flag{flag}}, nil); cmd != nil {
		_, _ = cmd.Collect()
	}
}

func (b *Bridge) Modify(ctx context.Context, c Caller, id string, ch Changes) (Message, error) {
	folder, uid, ok := parseMsgID(id)
	if !ok {
		return Message{}, ErrNotFound
	}
	cl, err := b.connect(c)
	if err != nil {
		return Message{}, err
	}
	defer func() { cl.Logout().Wait() }()
	if _, err := cl.Select(mailboxFor(folder), nil).Wait(); err != nil {
		return Message{}, fmt.Errorf("select: %w", err)
	}
	set := imap.UIDSetNum(uid)
	seenOp := imap.StoreFlagsDel
	if ch.IsRead {
		seenOp = imap.StoreFlagsAdd
	}
	b.store(cl, set, seenOp, imap.FlagSeen)
	flagOp := imap.StoreFlagsDel
	if ch.Starred {
		flagOp = imap.StoreFlagsAdd
	}
	b.store(cl, set, flagOp, imap.FlagFlagged)

	newFolder := folder
	if ch.Folder != "" && ch.Folder != folder {
		if _, err := cl.Move(set, mailboxFor(ch.Folder)).Wait(); err != nil {
			return Message{}, fmt.Errorf("move: %w", err)
		}
		newFolder = ch.Folder // NB: the UID changes in the destination; the UI reloads after modify.
	}
	return Message{ID: msgID(newFolder, uid), Folder: newFolder, IsRead: ch.IsRead, Starred: ch.Starred, Labels: ch.Labels, SentAt: time.Now()}, nil
}

func (b *Bridge) Delete(ctx context.Context, c Caller, id string) error {
	folder, uid, ok := parseMsgID(id)
	if !ok {
		return ErrNotFound
	}
	cl, err := b.connect(c)
	if err != nil {
		return err
	}
	defer func() { cl.Logout().Wait() }()
	if _, err := cl.Select(mailboxFor(folder), nil).Wait(); err != nil {
		return fmt.Errorf("select: %w", err)
	}
	set := imap.UIDSetNum(uid)
	if folder == "trash" {
		// Permanent delete: mark \Deleted then expunge just this uid.
		b.store(cl, set, imap.StoreFlagsAdd, imap.FlagDeleted)
		if cmd := cl.UIDExpunge(set); cmd != nil {
			_, _ = cmd.Collect()
		}
		return nil
	}
	if _, err := cl.Move(set, mailboxFor("trash")).Wait(); err != nil {
		return fmt.Errorf("move to trash: %w", err)
	}
	return nil
}
