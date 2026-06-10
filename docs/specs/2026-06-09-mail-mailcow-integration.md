# Mail — mailcow integration

**Status:** Gmail-style UI + local mail service landed; mailcow bridge is the next phase.
**Decision:** Backend = **mailcow (dockerized)** — fully GPLv3 OSS (Postfix, Dovecot, Rspamd,
ClamAV, SOGo, MariaDB), no proprietary feature tier. UI mirrors Gmail (docs/google-reference/gmail.md).

## What shipped now (local backend)

- `MailService` (proto + gateway) + migration `0016_mail_messages` + `internal/mail`.
- Folders inbox/starred/snoozed/sent/drafts/spam/trash; flags read/starred; labels; search.
- SendMessage: stores a Sent copy + delivers an Inbox copy to org users matched by email
  (internal delivery). External addresses are stored in Sent only (no real SMTP yet).
- Gmail UI: left nav, message list, reading pane, compose (To/Cc/Bcc, ⋮ more-options, discard,
  save draft), bulk-select toolbar (read/unread/star/label/delete), quick-settings gear, search.

## mailcow bridge (next phase)

mailcow has **no per-user mail REST/JMAP API** — read over **IMAP**, send over **SMTP**.
So replace the local store's data source with an IMAP/SMTP bridge in `internal/mail`:

1. **Run mailcow** as its own docker-compose stack (it owns ports 25/465/587/993/143 + 443/8080).
   For local dev, internal delivery works without public DNS; real internet mail needs a public
   IP, PTR/reverse DNS, and MX/SPF/DKIM/DMARC records.
2. **Bridge** (Go) — ✅ IMPLEMENTED in `internal/mail/bridge.go` (`go-imap/v2` reads +
   `net/smtp` send). List (UID SEARCH + envelope/flags/snippet FETCH with PEEK), Get (full
   FETCH → text/plain via `go-message`, marks \Seen), Modify (STORE \Seen/\Flagged + MOVE),
   Delete (MOVE to Trash, or \Deleted+UID EXPUNGE in Trash), unread counts via STATUS.
   Message ids are `<folder>:<uid>`; folders↔INBOX/Sent/Drafts/Junk/Trash, flags↔\Seen/\Flagged.
   **Remaining:** draft save (IMAP APPEND), Sent-copy APPEND after SMTP send, and running it
   against a live mailcow (set `GROWN_MAIL_BACKEND=imap` + `GROWN_MAIL_*`).
3. **Auth / SSO** (the hard part): IMAP auth is password-based. Authenticate the user via grown's
   Zitadel session, then access their mailbox via a **Dovecot master user** (proxy auth) or a
   per-user app password issued at provisioning. Provision mailboxes via mailcow's **admin API**
   when a grown user first opens Mail (domain + mailbox create).
4. **Provisioning**: a mailcow domain per org; one mailbox per user (address = grown email).
   Store the mailbox credential (or rely on master-user auth) keyed to the user id.
5. **Spam/labels**: Rspamd handles spam → Junk folder. Gmail-style labels map to IMAP keywords
   or per-message folders.

## Notes / risks

- Heavy footprint (~20 containers) vs grown's nix/process-compose stack — runs as a sibling stack.
- Push notifications: the client bell + service worker already exist; a backend push sender
  (VAPID + new-mail trigger from the IMAP IDLE loop) would light up real new-mail notifications.
- Threading: current model groups by thread_id; IMAP threading uses References/In-Reply-To —
  the bridge should set thread_id from those headers.
