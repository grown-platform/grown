# Pdf

Pdf is a document signing platform - a DocuSign replacement with cryptographic signatures.

## Architecture

- **Backend**: Go + gRPC + gRPC-Gateway (REST API)
- **Frontend**: React 19 + TypeScript + Vite + Tailwind + tibui components
- **Database**: PostgreSQL with sqlc for type-safe queries
- **Storage**: S3-compatible (MinIO/RustFS for local dev)
- **Auth**: Zitadel OIDC (to be integrated)

## Development

Enter the Nix development shell:

```bash
nix develop
```

Available commands:

- `pc` - Start all services with process-compose (PostgreSQL, MinIO, backend, frontend)
- `generate` - Generate all code (proto + sqlc)
- `proto-gen` - Generate protobuf code
- `sqlc-gen` - Generate sqlc code
- `backend-run` - Run backend server
- `backend-dev` - Run backend with hot reload
- `migrate up` - Run database migrations
- `frontend-dev` - Start frontend dev server
- `frontend-install` - Install npm dependencies

## Project Structure

```
pdf/
├── backend/
│   ├── api/proto/          # gRPC service definitions
│   ├── cmd/server/         # Main entry point
│   ├── internal/
│   │   ├── config/         # Configuration loading
│   │   ├── database/       # Database connection + migrations
│   │   ├── handler/        # gRPC handlers
│   │   └── sqlc/           # Generated SQL code
│   └── sql/queries/        # SQL queries for sqlc
├── frontend/
│   └── src/
│       ├── features/       # Feature modules (documents, signing)
│       └── utils/          # Utilities (apiClient)
├── flake.nix               # Nix development environment
└── process-compose.yaml    # Local dev orchestration
```

## Key Flows

### Document Preparation (Authenticated)

1. Upload PDF → Create document → S3 storage
2. Add signers (email, name)
3. Place signature fields using PDFEditor
4. Send for signing → Generate access tokens → Send emails

### Guest Signing

1. Receive email with link containing access token
2. View document (token validated, view recorded)
3. Fill signature fields
4. Consent modal → Submit
5. Cryptographic signature created → PDF signed

## Database Schema

- `documents` - PDF documents with status tracking
- `signers` - Who needs to sign, with guest access tokens
- `signature_fields` - Where signatures go (normalized 0-1 coordinates)
- `signatures` - Cryptographic signature data
- `audit_trail` - Complete audit log
- `signing_certificates` - CA-issued certificates

## API Endpoints

### Authenticated (Documents)

- `POST /api/documents` - Create document
- `GET /api/documents` - List documents
- `GET /api/documents/:id` - Get document
- `POST /api/documents/:id/send` - Send for signing
- `POST /api/documents/:id/signers` - Add signer
- `POST /api/documents/:id/fields` - Add signature field

### Guest Signing (Token-based)

- `GET /api/sign/:token` - Get signing session
- `POST /api/sign/:token/view` - Record view
- `POST /api/sign/:token/submit` - Submit signatures
- `POST /api/sign/:token/decline` - Decline to sign

## Dependencies

Uses tibui component library from `../../tibui`:

- Button, Card, Badge, TextField, TextArea
- DataTable, Timeline, CenterMessage, LoadingSpinner
- PageLayout, PDFEditor

## TODO

- [ ] Integrate Zitadel authentication
- [ ] S3 presigned URL generation
- [ ] Email notification system
- [ ] Signature capture canvas
- [ ] Cryptographic PDF signing (CA integration)
- [ ] Certificate management
