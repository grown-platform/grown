# Pdf

A document signing platform with cryptographic signatures, similar to DocuSign. Documents are signed with X.509 certificates and PAdES-compliant signatures that are verifiable in Adobe Reader/Acrobat.

## Features

- **Document Management** - Upload, organize, and track documents through the signing lifecycle
- **Cryptographic Signatures** - PAdES-compliant PDF signatures with X.509 certificates
- **Visual Signatures** - Draw or type signatures with customizable placement
- **Multi-signer Support** - Sequential or parallel signing workflows
- **Guest Signing** - Token-based access for external signers (no account required)
- **Audit Trail** - Complete activity log with IP addresses and timestamps
- **Email Notifications** - Automatic signing invitations and completion notices

## Quick Start

### Prerequisites

- [Nix](https://nixos.org/download.html) with flakes enabled
- Docker (for PostgreSQL and RustFS)

### Development Setup

```bash
# Enter the Nix development shell
nix develop

# Start all services (PostgreSQL, RustFS, Zitadel, backend, frontend)
process-compose up

# Or start services individually
process-compose up postgres rustfs backend frontend
```

The application will be available at:

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8085
- **Zitadel (Auth)**: http://localhost:8094

### Environment Configuration

Create a `.env` file in the project root for sensitive configuration:

```bash
# Email (Resend API key for sending invitations)
PDF_EMAIL_SMTP_PASSWORD=re_xxxxxxxxxxxx

# Cryptographic signing (generate with: openssl rand -base64 32)
PDF_CRYPTO_KEY_ENCRYPTION_KEY=<base64-encoded-32-byte-key>

# Optional: RFC 3161 Timestamp Authority
PDF_CRYPTO_TSA_URL=http://timestamp.digicert.com
```

> The legacy `PDF_*` prefix is still read as a fallback during the
> rename grace window; deprecation warnings are logged at startup.

## Project Structure

```
pdf/
├── backend/                 # Go backend
│   ├── api/proto/          # gRPC/REST API definitions
│   ├── cmd/server/         # Main application entry point
│   ├── internal/
│   │   ├── config/         # Configuration loading
│   │   ├── crypto/         # Cryptographic signing (CA, certificates, PDF signing)
│   │   ├── database/       # Database connection and migrations
│   │   ├── email/          # Email sending via SMTP
│   │   ├── handler/        # gRPC service implementations
│   │   ├── pdf/            # PDF manipulation (watermarks, page counting)
│   │   ├── sqlc/           # Generated SQL queries
│   │   └── storage/        # S3-compatible storage client
│   ├── pkg/proto/          # Generated protobuf code
│   └── sql/
│       ├── migrations/     # Database schema migrations
│       └── queries/        # SQL queries for sqlc
├── frontend/               # React frontend
│   └── src/
│       ├── components/     # Reusable UI components
│       ├── features/       # Feature-specific pages and logic
│       └── utils/          # API client and utilities
├── process-compose.yaml    # Local development orchestration
└── flake.nix              # Nix development environment
```

## Tech Stack

### Backend

- **Go** - Primary language
- **gRPC + gRPC-Gateway** - API layer (REST + gRPC)
- **sqlc** - Type-safe SQL queries
- **digitorus/pdfsign** - PAdES PDF signing
- **pdfcpu** - PDF manipulation (watermarks)

### Frontend

- **React** - UI framework
- **TypeScript** - Type safety
- **TanStack Query** - Data fetching
- **react-pdf** - PDF viewing
- **tibui** - Internal component library

### Infrastructure

- **PostgreSQL** - Primary database
- **RustFS/MinIO** - S3-compatible object storage
- **Zitadel** - Identity provider (OIDC)
- **Resend** - Email delivery

## Cryptographic Signing

Pdf implements PAdES-B (PDF Advanced Electronic Signatures - Baseline) compliant signatures:

1. **Self-Signed CA** (Development) - Auto-generated on first startup
   - 4096-bit RSA CA certificate (10-year validity)
   - Stored encrypted in database

2. **Signer Certificates** - Issued per-signer on demand
   - 2048-bit RSA certificates (1-year validity)
   - Includes signer email and name

3. **PDF Signing Flow**:
   - Visual watermarks applied first (pdfcpu)
   - Cryptographic signature applied last (pdfsign)
   - PKCS#7/CMS signature embedded in PDF
   - Optional RFC 3161 timestamp

4. **Verification** - Open signed PDFs in Adobe Reader to see:
   - "Signed by [Name]" in signature panel
   - Certificate details and validity
   - Document integrity status

### Production CA Integration

The `CertificateAuthority` interface supports pluggable implementations:

```go
type CertificateAuthority interface {
    GetOrCreateSignerCertificate(ctx context.Context, orgID, email, name string) (*x509.Certificate, crypto.PrivateKey, error)
    GetCACertificate() *x509.Certificate
}
```

Future integrations planned:

- Let's Encrypt (ACME)
- DigiCert
- GlobalSign

## API Documentation

See [FEATURES.md](./FEATURES.md) for complete API endpoint documentation.

### Quick Examples

**Create a document:**

```bash
curl -X POST http://localhost:8085/api/documents \
  -H "Content-Type: application/json" \
  -d '{"name": "Contract", "filename": "contract.pdf"}'
```

**Get signing session (guest):**

```bash
curl http://localhost:8085/api/sign/{token}
```

## Development

### Regenerate Protobuf

```bash
cd backend
# Run from nix shell which has protoc in PATH
protoc --proto_path=api/proto --proto_path=/path/to/includes \
  --go_out=pkg/proto --go_opt=paths=source_relative \
  --go-grpc_out=pkg/proto --go-grpc_opt=paths=source_relative \
  --grpc-gateway_out=pkg/proto --grpc-gateway_opt=paths=source_relative \
  api/proto/*.proto
```

### Regenerate SQL

```bash
cd backend
sqlc generate
```

### Run Tests

```bash
cd backend && go test ./...
cd frontend && npm test
```

## License

Proprietary - Grown
