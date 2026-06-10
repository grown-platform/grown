# X.509 Hardware Token Signing

This document describes two approaches for signing PDF documents with hardware tokens (DoD CAC, YubiKey PIV, smart cards) in Pdf.

## Overview

Hardware tokens like CAC cards and YubiKeys store private keys in tamper-resistant hardware. The private key **never leaves the device** - this is a core security feature. To use these keys for PDF signing, we need a mechanism to perform the cryptographic operation where the hardware is located.

## Comparison Summary

| Feature                     | Browser Extension        | mTLS + Server Signing     |
| --------------------------- | ------------------------ | ------------------------- |
| **Private key location**    | User's CAC/YubiKey       | Server's CA               |
| **Local software required** | Yes (extension + helper) | No                        |
| **True hardware signing**   | Yes                      | No (identity only)        |
| **Non-repudiation**         | Strong                   | Moderate                  |
| **Deployment complexity**   | Higher                   | Lower                     |
| **User experience**         | PIN prompt in browser    | Certificate prompt at TLS |
| **Offline signing**         | Possible                 | No                        |
| **Compliance (DoD, NIST)**  | Full                     | Partial                   |

---

## Option 1: Browser Extension + Native Helper

**True hardware signing where the CAC/YubiKey private key signs the document.**

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser Extension Flow                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────┐                      ┌───────────────────┐  │
│  │ Pdf Web UI │ ◄─── Content ───►    │ Browser Extension │  │
│  │ (pdf.dev)  │      Script          │ (Pdf Signer)  │  │
│  └────────────────┘                      └───────────────────┘  │
│          │                                        │              │
│          │ REST API                    Native Messaging          │
│          ▼                                        ▼              │
│  ┌────────────────┐                      ┌───────────────────┐  │
│  │ Pdf Server │                      │   Native Helper   │  │
│  │                │                      │ (signinghelper)   │  │
│  └────────────────┘                      └───────────────────┘  │
│                                                   │              │
│                                               PKCS#11            │
│                                                   ▼              │
│                                          ┌───────────────────┐  │
│                                          │   CAC / YubiKey   │  │
│                                          │   (Hardware Key)  │  │
│                                          └───────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Signing Flow

1. **User initiates signing** in Pdf web UI
2. **Frontend detects extension** via content script messaging
3. **Backend prepares signature**:
   ```
   POST /api/documents/{id}/prepare-signature
   Response: {
     "hash": "base64-encoded-sha256-hash",
     "algorithm": "SHA256",
     "signatureId": "sig_xxx"
   }
   ```
4. **Extension requests signing** from native helper:
   ```json
   {
     "action": "sign",
     "hash": "base64-encoded-hash",
     "algorithm": "SHA256",
     "certId": "slot-9c"
   }
   ```
5. **Native helper prompts for PIN** (if not cached)
6. **CAC/YubiKey signs the hash** via PKCS#11
7. **Extension returns signature** to frontend:
   ```json
   {
     "signature": "base64-pkcs7-signature",
     "certificate": "base64-x509-cert",
     "chain": ["base64-intermediate-cert"]
   }
   ```
8. **Frontend sends to backend**:
   ```
   POST /api/documents/{id}/complete-signature
   Body: { "signatureId": "sig_xxx", "signature": "...", "certificate": "..." }
   ```
9. **Backend embeds signature** in PDF (PAdES format)

### Components

#### Browser Extension (`signing-extension/`)

```
signing-extension/
├── manifest.json          # WebExtension manifest (v3)
├── background.js          # Service worker, native messaging
├── content.js             # Content script for page communication
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic (cert selection, status)
└── icons/                 # Extension icons
```

**manifest.json (Chrome MV3):**

```json
{
  "manifest_version": 3,
  "name": "Pdf Signing Agent",
  "version": "1.0.0",
  "description": "Sign documents with CAC/YubiKey",
  "permissions": ["nativeMessaging"],
  "host_permissions": ["https://*.pick.haus/*"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://*.pick.haus/*"],
      "js": ["content.js"]
    }
  ]
}
```

#### Native Helper (`cmd/signinghelper/`)

A Go binary that:

- Communicates via stdin/stdout (Native Messaging protocol)
- Accesses CAC/YubiKey via PKCS#11 (libykcs11, opensc-pkcs11)
- Lists available certificates
- Signs hashes with user's private key
- Caches PIN for session (optional)

**Native messaging host manifest (`com.grown.pdf.json`):**

```json
{
  "name": "com.grown.pdf",
  "description": "Pdf Signing Helper",
  "path": "/usr/local/bin/pdf-helper",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://EXTENSION_ID/"]
}
```

### Installation

**End Users:**

1. Install extension from Chrome Web Store / Firefox Add-ons
2. Extension prompts to download native helper (one-time)
3. Run installer for native helper

**Enterprise (GPO/MDM):**

1. Push extension via Chrome Enterprise Policy
2. Deploy native helper via software distribution (SCCM, Intune)
3. Deploy native messaging host manifest

### Pros

- **True non-repudiation**: The user's actual private key signs the document
- **Strong compliance**: Meets DoD PKI, NIST 800-63, eIDAS requirements
- **Key never leaves hardware**: Maximum security
- **Works offline**: Can sign documents without server (future feature)
- **Audit trail**: Can verify signature was made by specific hardware token

### Cons

- **Requires installation**: Users must install extension + native helper
- **Browser compatibility**: Need to maintain Chrome, Firefox, Edge versions
- **Platform support**: Native helper needs builds for Windows, Mac, Linux
- **Store approval**: Extensions must be approved by browser stores
- **Update management**: Two components to keep updated

---

## Option 2: mTLS + Server-Side Signing

**Server signs on behalf of user after verifying their CAC via mTLS.**

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    mTLS Server Signing Flow                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────┐      TLS + Client Cert     ┌─────────────┐  │
│  │    Browser     │ ◄─────────────────────────► │   nginx     │  │
│  │                │                             │  (mTLS)     │  │
│  └────────────────┘                             └─────────────┘  │
│          │                                            │          │
│          │ Certificate from CAC            X-SSL-Client-* hdrs   │
│          ▼                                            ▼          │
│  ┌────────────────┐                         ┌─────────────────┐  │
│  │  CAC/YubiKey   │                         │ Pdf Server  │  │
│  │  (TLS auth)    │                         │                 │  │
│  └────────────────┘                         └─────────────────┘  │
│                                                      │           │
│                                              Server CA signs     │
│                                                      ▼           │
│                                             ┌─────────────────┐  │
│                                             │   Signed PDF    │  │
│                                             │ (Server CA key) │  │
│                                             └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Signing Flow

1. **User accesses Pdf** via mTLS endpoint (https://pdf.pick.haus:8443)
2. **Browser prompts for CAC** certificate selection
3. **User enters CAC PIN** - TLS handshake completes
4. **nginx extracts certificate info** and passes to backend:
   ```
   X-SSL-Client-Verify: SUCCESS
   X-SSL-Client-DN: CN=Lucas Pick,O=Grown
   X-SSL-Client-Cert: (URL-encoded PEM certificate)
   ```
5. **User clicks "Sign"** in the UI
6. **Backend creates signature**:
   - Uses server's CA private key to sign the PDF
   - Includes user's certificate info in signature metadata
   - Records that signature was authenticated via mTLS
7. **PDF signature shows**: "Lucas Pick" (from CAC certificate)
8. **Audit trail records**: mTLS authentication with certificate serial number

### nginx Configuration

```nginx
server {
    listen 8443 ssl;

    # Server certificate
    ssl_certificate /etc/nginx/certs/server.pem;
    ssl_certificate_key /etc/nginx/certs/server-key.pem;

    # Client CA (DoD Root CA bundle for CAC support)
    ssl_client_certificate /etc/nginx/certs/dod-root-ca-bundle.pem;
    ssl_verify_client optional;  # or "require" for mandatory CAC
    ssl_verify_depth 5;

    location / {
        proxy_pass http://backend:8085;

        # Pass client certificate info to backend
        proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
        proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
        proxy_set_header X-SSL-Client-Cert $ssl_client_escaped_cert;
        proxy_set_header X-SSL-Client-Serial $ssl_client_serial;
    }
}
```

### Server-Side Signature Content

The PDF signature created by the server includes:

```
Signer: Lucas Pick
Organization: Grown
Certificate Serial: 200ad531b7b4d470ae8d56852fe184bc6a04de62
Authentication: mTLS with CAC certificate
Signed By: Pdf Server CA
Timestamp: 2024-02-03T12:00:00Z (RFC 3161)
```

### Pros

- **No installation required**: Works with any browser that supports client certificates
- **Simple deployment**: Just configure nginx + DoD CA bundle
- **Familiar UX**: Users already know the CAC PIN prompt from other DoD sites
- **Lower maintenance**: No extension or native helper to maintain
- **Works on any device**: Including mobile (with CAC reader)

### Cons

- **Server holds signing key**: Not the user's CAC private key
- **Weaker non-repudiation**: Server could theoretically forge signatures
- **Compliance questions**: May not meet strict requirements for user-held keys
- **Trust model**: Users must trust the server's CA
- **Online only**: Requires connection to server

---

## Compliance Considerations

### DoD PKI Requirements

| Requirement                 | Browser Extension | mTLS + Server     |
| --------------------------- | ----------------- | ----------------- |
| User-controlled private key | ✅ Yes            | ❌ No             |
| Hardware token signing      | ✅ Yes            | ❌ No (auth only) |
| Non-repudiation             | ✅ Strong         | ⚠️ Moderate       |
| Audit trail                 | ✅ Full           | ✅ Full           |
| Certificate validation      | ✅ Yes            | ✅ Yes            |

### Recommendations by Use Case

**High-Security / DoD Contracts:**

- Use **Browser Extension** approach
- Required for true non-repudiation
- Meets NIST 800-63 AAL3

**Internal Business Documents:**

- **mTLS + Server Signing** is sufficient
- Faster deployment, lower friction
- Acceptable for most business use cases

**Hybrid Approach:**

- Offer both options
- Default to mTLS for convenience
- Browser extension for high-security documents

---

## Implementation Status

| Component                        | Status      | Notes                                             |
| -------------------------------- | ----------- | ------------------------------------------------- |
| mTLS nginx proxy                 | ✅ Complete | Port 8443, `ssl_verify_client optional_no_ca`     |
| Backend mTLS header parsing      | ✅ Complete | `internal/mtls/identity.go`                       |
| Server-side CA signing           | ✅ Complete | Self-signed CA in `internal/crypto/`              |
| CAC identity capture             | ✅ Complete | Captured from mTLS headers, stored with signature |
| Feature flags                    | ✅ Complete | `SigningConfig` in `internal/config/config.go`    |
| GetSigningOptions API            | ✅ Complete | Returns available signing methods                 |
| PrepareSignature API             | ✅ Complete | Returns hash for browser extension signing        |
| CompleteSignature API            | ✅ Complete | Accepts client-signed signature                   |
| Frontend signing method selector | ✅ Complete | Shows CAC options when enabled                    |
| Browser extension                | ✅ Complete | `extension/` - MV3 format                         |
| Native signing helper            | ✅ Complete | `native-signer/` - Go + PKCS#11                   |
| DoD CA bundle                    | 📋 Planned  | Need to obtain/configure for production           |

---

## Configuration

### Environment Variables / Config

```yaml
# config.yaml
signing:
  # Enable mTLS-based CAC signing (redirect to mTLS endpoint)
  cac_mtls_enabled: true
  cac_mtls_endpoint: "https://pdf.pick.haus:8443"

  # Enable browser extension signing (true hardware signing)
  browser_extension_enabled: true

  # Default signing method: typed, drawn, cac_mtls, cac_extension
  default_method: typed

mtls:
  # Proxy mode: read client cert from X-SSL-Client-* headers
  proxy_mode: true
```

### File Locations

```
pdf/
├── backend/
│   ├── internal/
│   │   ├── config/config.go       # SigningConfig struct
│   │   ├── handler/signing.go     # GetSigningOptions, PrepareSignature, CompleteSignature
│   │   └── mtls/identity.go       # Client identity extraction
│   └── api/proto/signing.proto    # SigningMethod, PrepareSignature messages
├── frontend/
│   ├── src/
│   │   ├── features/signing/pages/SigningPage.tsx  # CAC UI integration
│   │   └── hooks/usePdfSigner.ts               # Extension API hook
├── extension/                      # Browser extension
│   ├── manifest.json              # MV3 manifest
│   ├── background.js              # Native messaging
│   ├── content.js                 # Page bridge
│   ├── injected.js               # window.PdfSigner API
│   ├── popup.html/js             # Extension popup
│   └── native-host/manifest.json # Native messaging host
├── native-signer/                 # Native signing helper
│   ├── main.go                   # PKCS#11 signing
│   ├── go.mod
│   ├── install.sh               # Installation script
│   └── README.md
└── nginx/
    └── nginx.conf                # mTLS proxy config
```

---

## API Endpoints

### GetSigningOptions

Returns available signing methods based on configuration and client context.

```
GET /api/sign/{token}/options

Response:
{
  "methods": [
    {
      "id": "typed",
      "name": "Typed Signature",
      "description": "Type your name to sign",
      "enabled": true,
      "requiresRedirect": false
    },
    {
      "id": "cac_mtls",
      "name": "CAC/PIV (mTLS)",
      "description": "Sign using your smart card via secure redirect",
      "enabled": true,
      "requiresRedirect": true,
      "redirectUrl": "https://pdf.pick.haus:8443"
    },
    {
      "id": "cac_extension",
      "name": "CAC/PIV (Browser Extension)",
      "description": "Sign using your smart card with the Pdf extension",
      "enabled": true,
      "requiresRedirect": false
    }
  ],
  "defaultMethod": "typed",
  "cacDetected": true,
  "cacSubject": "CN=Lucas Pick,O=Grown"
}
```

### PrepareSignature (Browser Extension Flow)

Prepares a document for client-side signing.

```
POST /api/sign/{token}/prepare
Body: { "fieldValues": [...] }

Response:
{
  "signatureId": "sig_abc123",
  "hash": "base64-encoded-sha256-hash",
  "hashAlgorithm": "SHA256",
  "expiresAt": 1706961234
}
```

### CompleteSignature (Browser Extension Flow)

Completes signing with client-provided signature.

```
POST /api/sign/{token}/complete
Body: {
  "signatureId": "sig_abc123",
  "signature": "base64-pkcs7-signature",
  "certificate": "base64-pem-certificate",
  "certificateChain": ["base64-intermediate-cert"],
  "consentGiven": true,
  "consentText": "I agree..."
}

Response:
{ "success": true, "message": "Document signed successfully" }
```

---

## Browser Extension API

The extension exposes `window.PdfSigner` to web pages:

```typescript
// Check if extension is available
const status = await window.PdfSigner.isAvailable();
// { available: true, nativeHostConnected: true }

// List certificates from smart card
const { certificates } = await window.PdfSigner.listCertificates();
// [{ id: "PIV:01", subject: "CN=John Doe", email: "john@example.com", ... }]

// Sign a hash
const { signature } = await window.PdfSigner.signHash(
  certId,
  base64Hash,
  "SHA256",
);

// Get certificate chain
const { certificate, chain } =
  await window.PdfSigner.getCertificate(certId);
```

---

## Installation

### Browser Extension

1. Load unpacked extension from `extension/` directory in Chrome
2. Note the extension ID
3. Update `extension/native-host/manifest.json` with the extension ID

### Native Signing Helper

```bash
cd native-signer
./install.sh
# Follow prompts to enter extension ID
```

### PKCS#11 Library

```bash
# YubiKey
sudo apt install yubico-piv-tool
export PKCS11_MODULE_PATH=/usr/lib/x86_64-linux-gnu/libykcs11.so

# OpenSC (CAC/PIV)
sudo apt install opensc
export PKCS11_MODULE_PATH=/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so
```

---

## Next Steps

1. **For production deployment:**
   - Obtain DoD Root CA bundle
   - Configure production certificates
   - Submit extension to Chrome Web Store
   - Create MSI/PKG installers for native helper

2. **Testing:**
   - Test with DoD CAC cards (need access)
   - Test cross-browser (Firefox, Edge)
   - Performance testing with large documents

---

## References

- [WebExtensions Native Messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)
- [PKCS#11 Specification](https://docs.oasis-open.org/pkcs11/pkcs11-base/v2.40/pkcs11-base-v2.40.html)
- [PAdES (PDF Advanced Electronic Signatures)](https://www.etsi.org/deliver/etsi_en/319100_319199/31914201/01.01.01_60/en_31914201v010101p.pdf)
- [DoD PKI](https://public.cyber.mil/pki-pke/)
- [NIST SP 800-63B](https://pages.nist.gov/800-63-3/sp800-63b.html)
