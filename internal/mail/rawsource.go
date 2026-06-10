package mail

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"code.pick.haus/grown/grown/internal/auth"
)

// RawSourcer is an optional Backend capability: returning the full RFC822
// source of a message (headers + body) for "Show original" header inspection.
// The IMAP bridge implements this with the true on-wire bytes; backends that
// don't retain the original (e.g. the Postgres LocalBackend) fall back to a
// synthesized header block built from stored fields.
type RawSourcer interface {
	Raw(ctx context.Context, c Caller, id string) ([]byte, error)
}

// RawHandler serves GET /api/v1/mail/messages/{id}/raw as text/plain — the raw
// message source for header inspection. Auth/org are taken from the request
// context (populated by the auth wrapper).
func RawHandler(backend Backend) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := auth.UserFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "no org context", http.StatusInternalServerError)
			return
		}
		// /api/v1/mail/messages/{id}/raw
		seg := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/v1/mail/messages/"), "/raw")
		id, err := url.PathUnescape(seg)
		if err != nil || id == "" {
			http.Error(w, "bad message id", http.StatusBadRequest)
			return
		}
		name := u.DisplayName
		if name == "" {
			name = u.Email
		}
		c := Caller{UserID: u.ID, OrgID: o.ID, Email: u.Email, Name: name}

		var raw []byte
		if rs, ok := backend.(RawSourcer); ok {
			raw, err = rs.Raw(r.Context(), c, id)
		} else {
			var m Message
			if m, err = backend.Get(r.Context(), c, id); err == nil {
				raw = []byte(synthSource(m))
			}
		}
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(raw)
	})
}

// synthSource builds an RFC822-ish source from stored message fields for
// backends that don't keep the original bytes.
func synthSource(m Message) string {
	var b strings.Builder
	from := m.FromAddr
	if m.FromName != "" {
		from = fmt.Sprintf("%s <%s>", m.FromName, m.FromAddr)
	}
	fmt.Fprintf(&b, "From: %s\r\n", from)
	if len(m.ToAddrs) > 0 {
		fmt.Fprintf(&b, "To: %s\r\n", strings.Join(m.ToAddrs, ", "))
	}
	if len(m.CcAddrs) > 0 {
		fmt.Fprintf(&b, "Cc: %s\r\n", strings.Join(m.CcAddrs, ", "))
	}
	fmt.Fprintf(&b, "Subject: %s\r\n", m.Subject)
	if !m.SentAt.IsZero() {
		fmt.Fprintf(&b, "Date: %s\r\n", m.SentAt.Format(time.RFC1123Z))
	}
	b.WriteString("\r\n")
	b.WriteString(m.Body)
	return b.String()
}
