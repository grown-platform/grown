# Telephony feature map (3CX-style PBX → grown)

A factual reference, in our own words, of the feature areas a 3CX-style IP-PBX
provides, mapped to (a) the admin console section we've scaffolded in
`web/app/src/pages/telephony/AdminArea.tsx` and (b) how we'd implement it on a
self-hosted **Asterisk (PJSIP)** backend in Phase 2. This drives the telephony
roadmap; it is not a copy of any vendor documentation.

Sources consulted for the factual feature taxonomy: 3CX manual index and
feature pages (IVR/Digital Receptionist, SIP Trunks, Office Hours, Extensions,
Queues).

## Call handling

| Feature | What it does | Our section | Asterisk implementation |
|---|---|---|---|
| Extensions | Per-user SIP accounts; register softphone/desk phones; voicemail box, caller-ID, presence | Extensions | PJSIP endpoints/aauths/aors (realtime in DB); WebRTC (WSS+DTLS-SRTP) for the browser client |
| Ring groups | Ring a set of extensions together or in sequence | Ring Groups | Dialplan `Dial()` across members; strategies = ringall / hunt / round-robin |
| Call queues | Hold callers, distribute to agents with a strategy + SLA, music on hold | Call Queues | `app_queue` (queues.conf / realtime); agents, strategy, timeout, announcements |
| Auto-attendant / IVR | Play a greeting, route by DTMF digit to extension/queue/VM/hangup; nested menus | Auto-Attendant | `Background()`+`WaitExten()` or `confbridge`/IVR in dialplan; one context per menu |
| Office hours / holidays | Route differently by time of day / holiday | Settings → business hours | `GotoIfTime()` in dialplan; holiday tables |

## Routing & trunks

| Feature | What it does | Our section | Asterisk implementation |
|---|---|---|---|
| SIP trunks | Connect to a VoIP/PSTN provider for external calls | SIP Trunks | PJSIP trunk endpoint + registration/auth; per-trunk channel limits |
| Inbound routes (DID) | Map an inbound number (DID) to a destination (IVR/ext/queue) | Inbound Routes | DID → context match in dialplan; `from-trunk` context |
| Outbound routes | Match dialed patterns to a trunk, with priority/failover | Outbound Routes | dialplan pattern matches (`_1NXXNXXXXXX`) → `Dial(PJSIP/...@trunk)` |

## Messaging & media

| Feature | What it does | Our section | Asterisk implementation |
|---|---|---|---|
| Voicemail | Per-extension mailboxes, greetings, PIN, email delivery | Voicemail | `app_voicemail`; voicemail-to-email via SMTP |
| Music on hold | Audio sources played on hold/queue | Music on Hold | `musiconhold.conf` classes; per-queue assignment |
| Fax | Inbound fax-to-email; sent/received log | FAX | `res_fax` / `SpanDSP`; T.38 over the trunk |
| Contacts / phonebook | Company directory; powers caller-ID name lookup | Contacts | DB table; `CALLERID(name)` lookup in dialplan |
| SMS / texting | Send/receive texts (Google-Voice-style) | (Messages view, not admin) | Via the trunk provider's messaging API or an SMS gateway |

## Reporting & recording

| Feature | What it does | Our section | Asterisk implementation |
|---|---|---|---|
| Call reports (CDR) | Searchable call-detail records (time, parties, duration, status) | Call Reports | CDR backend (`cdr_adaptive_odbc` → Postgres) |
| Recordings | Record calls; store/retain/play/download | Recordings | `MixMonitor()`; store in S3 (reuse grown-s3); retention policy |
| Activity log | System/audit events in the admin console | Activity Log | App-level audit log (see the workspace audit-log work) |

## System

| Feature | What it does | Our section | Asterisk implementation |
|---|---|---|---|
| Phone provisioning | Auto-provision desk phones (MAC → config/firmware) | Phones | Provisioning HTTP endpoint serving per-MAC configs |
| Security / anti-fraud | Block IPs/numbers, failed-auth lockout, allowed countries, SIP IDS | Security | `fail2ban` + PJSIP ACLs; outbound dial-pattern allowlists |
| Backup & restore | Scheduled config/data backups | Backup & Restore | pg_dump of the telephony DB + config; to grown-s3 |
| Email (SMTP) | Outbound mail for voicemail/fax/reports | Email/SMTP | Reuse grown's Resend/SMTP config |
| Settings | Codecs, recording toggle, NAT/STUN, RTP range | Settings | PJSIP transport/codec config; external IP + STUN; RTP port range |
| Dashboard | At-a-glance status (extensions, active calls, trunks, VMs) | Dashboard | Asterisk ARI / AMI for live stats |

## Deployment model (Phase 2)

- **Optional, on by default.** Asterisk runs as its own deployment in the
  homelab via a gitops kustomize component that can be included or excluded;
  grown gates the telephony PBX behind a feature flag (e.g.
  `GROWN_TELEPHONY_PBX`) that defaults **on**. With it off, the Telephony app
  falls back to the existing peer-to-peer WebRTC internal calling only.
- **Browser client:** SIP.js (or jsSIP) over SIP-WSS to Asterisk's WebRTC
  transport; DTLS-SRTP media. The admin console drives PJSIP realtime config
  via a small grown control API (ARI/AMI or DB writes).
- **Phasing:** (1) app shell — done; (2) Asterisk + trunk + control API;
  (3) wire registration, calls, presence, then SMS/voicemail/recording.
