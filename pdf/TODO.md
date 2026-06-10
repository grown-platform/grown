# Pdf TODO

## High Priority

### Cryptographic Signing - Production

- [ ] Implement `LetsEncryptCA` for production certificate issuance
  - Use ACME protocol
  - Implement `CertificateAuthority` interface
  - Handle certificate renewal
- [x] Add signature validation API endpoint (`GET /api/documents/:id/verify`)
- [x] Enable RFC 3161 timestamps (configured via `PDF_CRYPTO_TSA_URL`)

### Authentication

- [ ] Full Zitadel OIDC integration (currently using dev defaults)
- [ ] Extract org_id/user_id from auth context in handlers
- [ ] Multi-tenant organization support with X-Org-Id header
- [x] mTLS client certificate authentication (CAC/YubiKey/PIV support)

## Medium Priority

### UI Enhancements

- [ ] Signature size adjustment controls (A/a buttons in field toolbar)
- [ ] Certificate management UI (view/revoke certificates)
- [ ] Document templates feature
- [ ] Bulk send functionality

### Backend

- [ ] OpenFGA authorization for fine-grained permissions
- [ ] Webhook notifications for external integrations
- [ ] Sequential signing order enforcement
- [ ] DigiCert/GlobalSign CA integration options
- [x] Test X.509 signing with YubiKey (PIV/PKCS#11 integration)

## Low Priority

### Features

- [ ] In-person signing mode
- [ ] Audit certificate PDF generation
- [ ] Long-term validation (LTV) - OCSP responses, CRL embedding
- [ ] Signature image upload option
- [ ] Signature reuse (save and reuse previous signatures)

### Technical Debt

- [ ] Fix TypeScript build warnings in DocumentsPage.tsx
- [ ] Add comprehensive test coverage
- [ ] API rate limiting
- [ ] Request validation middleware

## Completed

- [x] Cryptographic PDF signing (PAdES-B compliant)
- [x] Self-signed CA for development
- [x] Private key encryption (AES-256-GCM)
- [x] Signature database storage
- [x] Digital signatures view in document detail
- [x] Download signed vs original PDF
- [x] Signed PDF preview
- [x] Document page count auto-detection
- [x] Document description in list view
- [x] Typed signature dynamic sizing
- [x] Visual signatures and watermarks
- [x] Email notifications (Resend SMTP)
- [x] Audit trail with IP/user-agent
- [x] Guest signing workflow
- [x] PKCS#11 YubiKey signing support
- [x] mTLS client certificate authentication (CAC/YubiKey/PIV)
- [x] Signature validation API endpoint (`GET /api/documents/:id/verify`)
- [x] RFC 3161 timestamps (DigiCert TSA configured for dev/prod)
