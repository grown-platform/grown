# Pdf Features

## Overview

Pdf (codebase: `pdf`) is a document signing platform providing cryptographic signatures with a full signing workflow, similar to DocuSign. Documents are signed with X.509 certificates and PAdES-compliant signatures that are verifiable in Adobe Reader/Acrobat. The product is rebranded as **Pdf** in the UI (sidebar logo, signing pages); the Go module, proto packages, Docker image, and environment-variable prefix (`PDF_*`) remain `pdf` for now — a full code rename is tracked as a separate effort.

---

## Implemented Features

### Infrastructure

| Feature                     | Status      | Details                                                                                                                        |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Nix development environment | ✅ Complete | `flake.nix` with Go, protoc, sqlc, Node.js, and dev tools                                                                      |
| Local dev orchestration     | ✅ Complete | `process-compose.yaml` with PostgreSQL, RustFS (S3), Zitadel, backend, frontend                                                |
| Database schema             | ✅ Complete | 9 migrations covering documents, signers, fields, signatures, audit, certs, superadmins, annotations                           |
| gRPC + REST API             | ✅ Complete | Proto definitions with gRPC-Gateway annotations; admin + annotation endpoints registered directly on root mux (no proto regen) |
| SQL queries                 | ✅ Complete | Type-safe queries via sqlc                                                                                                     |
| Forgejo CI build/push       | ✅ Complete | Nix container build pushed to internal Forgejo registry; Attic cache for build closure                                         |
| Flux image-automation       | ✅ Complete | image-reflector + ImageUpdateAutomation auto-bump dev tag from CI tags                                                         |

### Backend Services

| Feature                    | Status      | Details                                                                                                                |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Document CRUD              | ✅ Complete | Create, read, update, delete, list documents                                                                           |
| Document status management | ✅ Complete | Draft → Pending → In Progress → Completed/Declined/Voided                                                              |
| Signer management          | ✅ Complete | Add/remove signers with email, name, type, order                                                                       |
| Signature field management | ✅ Complete | Add/update/remove fields with normalized coordinates                                                                   |
| Field font size            | ✅ Complete | Configurable font size for text/date fields                                                                            |
| Guest signing session      | ✅ Complete | Token-based access for guest signers                                                                                   |
| View recording             | ✅ Complete | Track when signers view documents                                                                                      |
| Signature submission       | ✅ Complete | Submit filled field values with consent                                                                                |
| Decline signing            | ✅ Complete | Allow signers to decline with reason                                                                                   |
| Audit trail queries        | ✅ Complete | Query audit entries by document with IP/user-agent                                                                     |
| Email notifications        | ✅ Complete | Signing invitations, reminders, completion via Resend SMTP                                                             |
| PDF page count             | ✅ Complete | Auto-detect page count on first document access                                                                        |
| S3 presigned URLs          | ✅ Complete | Upload and download via RustFS/MinIO                                                                                   |
| Document re-upload         | ✅ Complete | `POST /api/documents/:id/replace-url` issues fresh presigned PUT for in-place edits                                    |
| Document annotations       | ✅ Complete | `documents.annotations` JSONB column; GET/PUT endpoints; loaded read-only on signing page so signers see author markup |
| ListDocuments scoping      | ✅ Complete | Non-admins see only `created_by = caller`; superadmins use `/api/admin/documents` for the full list                    |
| CreateDocument owner       | ✅ Complete | `created_by` set to caller's verified email instead of hardcoded `user_default`                                        |

### Authentication & Authorization

| Feature                      | Status      | Details                                                                                                                                                                                                                                                               |
| ---------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zitadel OIDC                 | ✅ Complete | Login, callback, logout, `/api/user/me`; cookie-based session                                                                                                                                                                                                         |
| OIDC state + nonce           | ✅ Complete | Per-login random state + nonce in short-lived HttpOnly cookie; validated in callback against ID-token nonce claim                                                                                                                                                     |
| OAuth logout URL match       | ✅ Complete | `post_logout_redirect_uri` URL-encoded via `url.Values` and normalized to trailing slash to match the OIDC client registration                                                                                                                                        |
| Proxy-auth middleware        | ✅ Complete | When `proxy_mode=true`, requires `X-Proxy-Auth` shared secret; strips inbound `X-User-*` / `X-SSL-Client-*` headers and re-reads only after secret verifies (`subtle.ConstantTimeCompare`)                                                                            |
| CSRF gate                    | ✅ Complete | State-changing `/api/*` requests require `Authorization` header OR `X-Requested-With: pdf-frontend`. Browsers can't set custom headers cross-origin without CORS preflight (which denies unknown origins). Frontend `apiClient` sets the header on every request. |
| Super_admin role (DB-backed) | ✅ Complete | `superadmins` table; bootstrap via `PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL` on first boot when table is empty; idempotent                                                                                                                                            |
| Admin API                    | ✅ Complete | `GET/POST/DELETE /api/admin/superadmins[/{email}]` for managing the superadmin list; `GET /api/admin/documents` returns metadata-only listing of every document. All gated by `RequireSuperadmin` middleware.                                                         |
| User identity in context     | ✅ Complete | `WithUserEmail` / `UserEmailFromContext` helpers; OIDC HTTPMiddleware parses claims and stashes verified email for downstream handlers                                                                                                                                |

### Cryptographic Signing

| Feature                         | Status      | Details                                                                                                                                                                                                                                             |
| ------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-signed CA                  | ✅ Complete | Auto-generated 4096-bit RSA CA (10-year validity)                                                                                                                                                                                                   |
| Signer certificates             | ✅ Complete | Per-signer 2048-bit RSA certs (1-year validity)                                                                                                                                                                                                     |
| PAdES PDF signatures            | ✅ Complete | Embedded PKCS#7 signatures via digitorus/pdfsign                                                                                                                                                                                                    |
| Private key encryption          | ✅ Complete | AES-256-GCM encryption with configurable KEK                                                                                                                                                                                                        |
| Signature database storage      | ✅ Complete | Full signature metadata in `signatures` table                                                                                                                                                                                                       |
| Certificate authority interface | ✅ Complete | Pluggable interface for future Let's Encrypt/DigiCert                                                                                                                                                                                               |
| RFC 3161 timestamps             | ✅ Complete | TSA integration via DigiCert (configurable URL)                                                                                                                                                                                                     |
| Signature viewing               | ✅ Complete | View certificate details in document detail page                                                                                                                                                                                                    |
| Signature verification API      | ✅ Complete | `GET /api/documents/:id/verify` — re-verifies chain against configured trust bundle, recomputes document hash, validates stored signature against recomputed hash                                                                                   |
| Browser-extension signing       | ✅ Complete | `CompleteSignature` actually verifies the signer's certificate chain, binds it to signer email (SAN or subject), and verifies the signature against the prepared hash. Trusted CA bundle configurable via `PDF_SIGNING_TRUSTED_CA_BUNDLE_PATH`. |

### Document Authoring & Editing

| Feature                  | Status      | Details                                                                                                                                                                                                                          |
| ------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload PDF               | ✅ Complete | Drag-drop or file picker on `/documents/new`                                                                                                                                                                                     |
| Create from scratch      | ✅ Complete | Mode toggle on `/documents/new` — generates a blank Letter-size PDF client-side via jsPDF with optional Title; body content authored via the in-place editor                                                                     |
| Edit step before signers | ✅ Complete | After creation the user picks **Edit** or **Continue to add signers**. `/documents/:id/edit` route renders the document with editing tools                                                                                       |
| Annotation overlay mode  | ✅ Complete | tibui PDFEditor with freehand, rectangle, circle, arrow, text, highlight, eraser, select. Annotations persisted to DB and rendered for signers                                                                                   |
| In-place text editing    | ✅ Complete | pdfjs extracts text items + positions; positioned contenteditable spans overlay each item. Save regenerates the PDF via pdf-lib (white-out original + redraw at same position) and re-uploads to S3                              |
| Text styling             | ✅ Complete | Bold (HelveticaBold), Italic (HelveticaOblique), Underline + Strikethrough (drawn rectangles, widths match rendered text). Combinable.                                                                                           |
| Font size                | ✅ Complete | Per-block font size input (4-144pt) in toolbar; updates the transform matrix and both visual + saved size                                                                                                                        |
| Add new text blocks      | ✅ Complete | "Add text" tool: click on PDF to drop a new editable block at that position                                                                                                                                                      |
| Delete with confirmation | ✅ Complete | Red trash button anchored next to focused text. `window.confirm` before deletion. Deleting an extracted text block ALSO covers the original PDF text with a white rectangle (so the underlying body content actually goes away). |
| Drag-to-move text blocks | ✅ Complete | Gray Move handle on the left of focused text; drag updates transform matrix; clamped to page bounds and margin guides                                                                                                            |
| Adjustable margin guides | ✅ Complete | Two semi-transparent blue vertical lines per page at 72pt default; draggable. Text blocks can't be moved outside them.                                                                                                           |
| Mode persistence         | ✅ Complete | Switching between Annotate / Edit text / Preview no longer loses edits (state lifted to parent component)                                                                                                                        |
| Auto-save on tab switch  | ✅ Complete | Leaving the text tab with dirty edits triggers an auto-save; document refetches with a fresh presigned URL so all tabs see the new PDF                                                                                           |
| Preview tab              | ✅ Complete | View-only render with current annotations overlaid — what signers will see. No toolbar.                                                                                                                                          |

### Frontend Pages

| Page                 | Status      | Details                                                                                                                    |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| Documents list       | ✅ Complete | DataTable with status badges, description, delete action. Non-admins see only their own docs.                              |
| To-sign list         | ✅ Complete | Documents pending current user's signature. Requires proxy_mode to provide caller email.                                   |
| Create document      | ✅ Complete | Upload OR Create-from-scratch toggle; name (required) + description + optional title                                       |
| Document detail      | ✅ Complete | Signed PDF preview, signers, digital signatures, audit timeline                                                            |
| Edit document        | ✅ Complete | `/documents/:id/edit` — three modes: Annotate, Edit text, Preview                                                          |
| Prepare document     | ✅ Complete | Add signers, place signature fields with drag-drop                                                                         |
| Guest signing        | ✅ Complete | View document, fill fields, progress tracking, consent modal. Signers see author's saved annotations as initial overlay.   |
| Signing complete     | ✅ Complete | Success/declined confirmation with download                                                                                |
| Profile page         | ✅ Complete | User info display                                                                                                          |
| Admin: All Documents | ✅ Complete | Superadmin-only. Lists every document in the system (metadata only, no PDF content). Per-row expand shows the audit trail. |

### Visual Signatures

| Feature           | Status      | Details                                                  |
| ----------------- | ----------- | -------------------------------------------------------- |
| Canvas drawing    | ✅ Complete | Draw signature with mouse/touch                          |
| Type signature    | ✅ Complete | Generate signature from typed name (Dancing Script font) |
| Initials capture  | ✅ Complete | Separate initials field type                             |
| Visual watermarks | ✅ Complete | PNG images embedded via pdfcpu                           |
| Text fields       | ✅ Complete | Date, text fields with configurable font size            |

### Download Options

| Feature               | Status      | Details                                 |
| --------------------- | ----------- | --------------------------------------- |
| Download signed PDF   | ✅ Complete | Cryptographically signed document       |
| Download original PDF | ✅ Complete | Unsigned original document              |
| Signed PDF preview    | ✅ Complete | Shows signed version in document detail |

### Branding & Layout

| Feature                    | Status      | Details                                                                                    |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pdf visible branding | ✅ Complete | Sidebar logo and signing-page heading render `PDF` (blue) + `Sign` (black/white-in-dark) |
| Auto-collapse sidebar      | ✅ Complete | On `/documents/<id>(/edit                                                                  | /prepare)` routes the desktop sidebar shrinks to a 16-wide icon strip; nav items become icon-only with tooltips. PDF editor area gains ~12rem horizontal room. |

### UI Components (via tibui)

| Component            | Usage                                                           |
| -------------------- | --------------------------------------------------------------- |
| PageLayout           | Main application shell with navigation                          |
| Button               | All actions and form submissions                                |
| Card                 | Content containers throughout                                   |
| Badge                | Status indicators (document, signer)                            |
| DataTable            | Documents list                                                  |
| TextField / TextArea | Form inputs                                                     |
| LoadingSpinner       | Loading states                                                  |
| CenterMessage        | Empty states and errors                                         |
| Timeline             | Audit trail display                                             |
| PDFEditor            | Document viewing, annotation overlay, signature field placement |

### Database Tables

| Table                  | Fields                                                                                                                                                                         | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `documents`            | id, org_id, name, status, storage_key, signed_storage_key, pages, signing_order, expires_at, **annotations JSONB**                                                             | Document metadata, state, and author annotations                    |
| `signers`              | id, doc_id, email, name, type, order, status, access_token, timestamps                                                                                                         | Who signs and their progress                                        |
| `signature_fields`     | id, doc_id, signer_id, type, page, x/y/width/height, font_size, value                                                                                                          | Where signatures go                                                 |
| `signatures`           | id, doc_id, signer_id, signature_data, algorithm, certificate_chain, hash, timestamp, **certificate_issuer, certificate_serial, certificate_valid_from, certificate_valid_to** | Cryptographic signatures + cert metadata for read-side verification |
| `audit_trail`          | id, doc_id, signer_id, action, details, ip, user_agent, geo                                                                                                                    | Complete activity log                                               |
| `signing_certificates` | id, org_id, user_id, type, status, cert_pem, private_key_encrypted, validity                                                                                                   | CA and signer certificates                                          |
| `superadmins`          | email (PK), granted_by, granted_at                                                                                                                                             | DB-backed super_admin role list                                     |

### API Endpoints

**Documents (Authenticated)**

```
POST   /api/documents                         Create document
GET    /api/documents                         List documents (filtered by caller email for non-admins)
GET    /api/documents/:id                     Get document with signers + signed URL
PATCH  /api/documents/:id                     Update document
DELETE /api/documents/:id                     Delete document
POST   /api/documents/:id/send                Send for signing
POST   /api/documents/:id/void                Void document
POST   /api/documents/:id/signers             Add signer
DELETE /api/documents/:id/signers/:sid        Remove signer
POST   /api/documents/:id/signers/:sid/resend Resend invitation
POST   /api/documents/:id/fields              Add signature field
PATCH  /api/documents/:id/fields/:fid         Update field position/size
DELETE /api/documents/:id/fields/:fid         Remove field
GET    /api/documents/:id/completed           Get signed document URL
GET    /api/documents/:id/signatures          Get cryptographic signature details
GET    /api/documents/:id/verify              Verify document signatures
GET    /api/documents/:id/audit               Get audit trail
GET    /api/documents/:id/annotations         Get author annotations
PUT    /api/documents/:id/annotations         Save annotations (5MB cap, JSON array)
POST   /api/documents/:id/replace-url         Issue fresh 15-min presigned PUT for in-place edit save
GET    /api/to-sign                           List documents to sign (requires proxy-asserted email)
```

**Guest Signing (Token-based)**

```
GET    /api/sign/:token                  Get signing session
GET    /api/sign/:token/annotations      Get author annotations (token-authenticated, read-only)
POST   /api/sign/:token/view             Record document view
POST   /api/sign/:token/submit           Submit signatures
POST   /api/sign/:token/decline          Decline to sign
```

**Admin (Super_admin only)**

```
GET    /api/admin/superadmins             List current superadmins
POST   /api/admin/superadmins/{email}     Grant superadmin to {email}
DELETE /api/admin/superadmins/{email}     Revoke superadmin from {email}
GET    /api/admin/documents               List all documents in the system (metadata only)
```

**Audit**

```
GET    /api/audit/document/:id           Get audit trail by document
```

---

## Configuration

### Environment Variables

```bash
# Server
PDF_SERVER_HTTP_ADDR=:8085
PDF_SERVER_GRPC_ADDR=:50053
PDF_SERVER_CORS_ORIGINS=http://localhost:5173
PDF_SERVER_FRONTEND_URL=http://localhost:5173

# Database
PDF_DATABASE_URL=postgres://pdf:pdf@localhost:5433/pdf

# Storage (S3-compatible)
PDF_STORAGE_ENDPOINT=http://localhost:9020
PDF_STORAGE_PUBLIC_ENDPOINT=https://storage-sign.example.com  # browser-facing
PDF_STORAGE_REGION=us-east-1
PDF_STORAGE_BUCKET=pdf-documents
PDF_STORAGE_ACCESS_KEY=pdf-access-key
PDF_STORAGE_SECRET_KEY=pdf-secret-key

# Auth (Zitadel)
PDF_AUTH_ISSUER_URL=https://sso.example.com
PDF_AUTH_CLIENT_ID=<from setup>
PDF_AUTH_CLIENT_SECRET=<from setup>
PDF_AUTH_REDIRECT_URL=https://sign.example.com/auth/callback
PDF_AUTH_COOKIE_DOMAIN=.example.com
PDF_AUTH_COOKIE_SECURE=true
PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL=admin@example.com  # bootstrapped on first boot when superadmins table is empty

# Email (Resend SMTP)
PDF_EMAIL_SMTP_HOST=smtp.resend.com
PDF_EMAIL_SMTP_PORT=587
PDF_EMAIL_SMTP_USER=resend
PDF_EMAIL_SMTP_PASSWORD=<api-key>
PDF_EMAIL_FROM_ADDRESS=noreply@yourdomain.com
PDF_EMAIL_FROM_NAME=Pdf

# Cryptographic Signing
PDF_CRYPTO_KEY_ENCRYPTION_KEY=<base64-32-bytes>             # For encrypting private keys
PDF_CRYPTO_TSA_URL=http://timestamp.digicert.com            # Optional RFC 3161 TSA
PDF_CRYPTO_ORGANIZATION_ID=default_org
PDF_SIGNING_TRUSTED_CA_BUNDLE_PATH=/etc/pdf/trusted-cas.pem  # Required when browser_extension_enabled=true
PDF_SIGNING_BROWSER_EXTENSION_ENABLED=false                 # Hardware-token signing via the extension
PDF_SIGNING_CAC_MTLS_ENABLED=false                          # CAC/PIV via mTLS redirect

# mTLS / Proxy auth
PDF_MTLS_PROXY_MODE=false                                   # Trust proxy-set identity headers when paired with shared secret
PDF_MTLS_PROXY_SHARED_SECRET=<32+ chars>                    # Required when proxy_mode=true
```

---

## Recent Security Posture

Patched in the 2026-05-26 security review and follow-ups:

- **IDOR / token leak** in `ListDocumentsToSign` — endpoint no longer trusts `req.Email`; reads from proxy-asserted identity.
- **OAuth login CSRF** — per-login random state + nonce in HttpOnly cookie; validated in callback (constant-time) and against ID-token nonce claim.
- **Spoofable mTLS proxy headers** — `ProxyAuthMiddleware` strips inbound identity headers and requires `X-Proxy-Auth` shared secret before repopulating from the proxy's view.
- **Signature verification bypass** — `CompleteSignature` and `VerifyDocument` now do real x509 chain validation, email binding, and signature math against the document hash. `sigValid := true` is gone.
- **S3 key path traversal** — `CreateDocument` no longer concatenates user-controlled `req.Filename` into the storage key; uses a fixed `original.pdf`.
- **OAuth logout URL match** — properly URL-encoded; trailing-slash normalized to match the OIDC client registration.
- **CSRF on cookie-auth endpoints** — defense-in-depth gate requiring `X-Requested-With` custom header (cross-origin pages can't set it without CORS preflight) OR `Authorization` header.

See `docs/superpowers/specs/2026-05-26-security-fixes-design.md` for the full design.

---

## Future Enhancements

### Authentication & Authorization

| Feature                              | Priority | Notes                                                                                                                          |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ~~Zitadel OIDC integration~~         | ✅ Done  | Login, callback, logout, /me                                                                                                   |
| ~~Super_admin role~~                 | ✅ Done  | DB-backed in this iteration; OpenFGA migration deferred                                                                        |
| OpenFGA authorization                | Medium   | Fine-grained per-document permissions. Spec preserved at `docs/superpowers/specs/2026-05-26-pdf-openfga-future-design.md`  |
| Multi-tenant org support             | Medium   | `org_id` is still hardcoded `org_default`; needs Zitadel claim wiring throughout handlers                                      |
| Owner-or-superadmin authz tightening | Medium   | `GET/PUT /api/documents/:id/annotations` and `/replace-url` currently accept any authenticated user; tighten once org_id lands |

### Cryptographic Signing

| Feature                           | Priority | Notes                                                                                                                             |
| --------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Let's Encrypt CA integration      | High     | Production certificate issuance                                                                                                   |
| DigiCert/GlobalSign CA            | Medium   | Enterprise CA options                                                                                                             |
| Certificate management UI         | Medium   | View/revoke certificates                                                                                                          |
| ~~Signature validation endpoint~~ | ✅ Done  | `GET /api/documents/:id/verify`                                                                                                   |
| Bake annotations into signed PDF  | Medium   | Server-side PDF flattening so annotations are part of the cryptographically signed bytes (currently they render client-side only) |
| Long-term validation (LTV)        | Low      | OCSP responses, CRL embedding                                                                                                     |

### Document Authoring

| Feature                      | Priority | Notes                                                                                                                                                                                       |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rich-text on body authoring  | Medium   | Bullet lists, indent/align, code/monospace, link annotations                                                                                                                                |
| Multi-line text-block reflow | Medium   | Width-aware wrap when replacement text is longer than the original run                                                                                                                      |
| True text removal            | Medium   | Current delete covers the original with a white rectangle; the original glyph bytes remain in the PDF stream (recoverable by inspection). True redaction would need content-stream surgery. |
| Image insertion in editor    | Low      | Drop images onto the page from the toolbar                                                                                                                                                  |
| Per-page margin overrides    | Low      | Currently a single global L/R margin for all pages                                                                                                                                          |

### Advanced Features

| Feature                        | Priority | Notes                                                                             |
| ------------------------------ | -------- | --------------------------------------------------------------------------------- |
| Document templates             | Medium   | Save and reuse document configurations                                            |
| Auto-retry email send          | Medium   | Recipient drop / SMTP transient errors should retry without operator intervention |
| Bulk send                      | Low      | Send same document to multiple recipient sets                                     |
| Sequential signing enforcement | Low      | Block out-of-order signing                                                        |
| In-person signing              | Low      | Signer signs on sender's device                                                   |
| API webhooks                   | Low      | Notify external systems of events                                                 |
| Audit certificate PDF          | Low      | Generate certificate of completion                                                |
| Signature size controls        | Low      | Adjust visual signature size (A/a buttons)                                        |

### Branding & Naming

| Feature                                | Priority | Notes                                                                                                                                                    |
| -------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full code rename (pdf → pdf) | Low      | Go module path, proto packages, Docker image name, `PDF_*` env vars, repo name. Large mechanical change; visible-UI branding already says Pdf. |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
│  - tibui component library (PDFEditor, DataTable, etc.)          │
│  - TanStack Query for data fetching                              │
│  - react-pdf for PDF viewing                                     │
│  - pdf-lib for in-place PDF edits (white-out + redraw)           │
│  - jsPDF for from-scratch PDF generation                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Go + gRPC-Gateway)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Documents  │  │   Signing   │  │    Audit    │              │
│  │   Handler   │  │   Handler   │  │   Handler   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│  ┌─────────────┐  ┌─────────────────┐  ┌──────────────────┐     │
│  │    Admin    │  │  Annotations    │  │ DocumentReplace  │     │
│  │   Handler   │  │    Handler      │  │     Handler      │     │
│  └─────────────┘  └─────────────────┘  └──────────────────┘     │
│         │                │                │                      │
│         ▼                ▼                ▼                      │
│  ┌─────────────────────────────────────────────────┐            │
│  │              Crypto Package                      │            │
│  │  - SelfSignedCA (CertificateAuthority interface)│            │
│  │  - PDFSigner (digitorus/pdfsign)                │            │
│  │  - Keystore (AES-256-GCM)                       │            │
│  └─────────────────────────────────────────────────┘            │
│  ┌─────────────────────────────────────────────────┐            │
│  │              Sig Package                         │            │
│  │  - VerifyClientSignature (chain + email + math) │            │
│  │  - LoadCAPool (trusted-CA bundle loader)        │            │
│  └─────────────────────────────────────────────────┘            │
│  ┌─────────────────────────────────────────────────┐            │
│  │           Middleware Chain                       │            │
│  │  ProxyAuth → mTLS → OIDC → CSRF → CORS → mux    │            │
│  └─────────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌──────────┐    ┌──────────┐    ┌──────────┐
       │PostgreSQL│    │  RustFS  │    │  Resend  │
       │ (sqlc)   │    │   (S3)   │    │  (SMTP)  │
       └──────────┘    └──────────┘    └──────────┘
```
