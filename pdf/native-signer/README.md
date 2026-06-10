# Pdf Native Signing Helper

Native messaging host for signing document hashes with CAC/PIV smart cards via PKCS#11.

## Overview

This is a small Go program that runs as a Chrome Native Messaging host. It receives JSON messages from the Pdf browser extension and performs cryptographic operations using smart cards (YubiKey PIV, DoD CAC, etc.) via PKCS#11.

## Building

```bash
go build -o pdf-signer .
```

## Installation

### 1. Build and Install Binary

```bash
# Build
go build -o pdf-signer .

# Install to standard location
sudo cp pdf-signer /usr/local/bin/
sudo chmod +x /usr/local/bin/pdf-signer
```

### 2. Install Native Messaging Manifest

The manifest tells Chrome where to find this program. Copy it to the appropriate location for your browser:

**Chrome (Linux):**

```bash
mkdir -p ~/.config/google-chrome/NativeMessagingHosts
cp ../extension/native-host/manifest.json \
   ~/.config/google-chrome/NativeMessagingHosts/dev.pick.pdf.signer.json
```

**Chromium (Linux):**

```bash
mkdir -p ~/.config/chromium/NativeMessagingHosts
cp ../extension/native-host/manifest.json \
   ~/.config/chromium/NativeMessagingHosts/dev.pick.pdf.signer.json
```

**Edge (Linux):**

```bash
mkdir -p ~/.config/microsoft-edge/NativeMessagingHosts
cp ../extension/native-host/manifest.json \
   ~/.config/microsoft-edge/NativeMessagingHosts/dev.pick.pdf.signer.json
```

**Firefox (Linux):**

```bash
mkdir -p ~/.mozilla/native-messaging-hosts
cp ../extension/native-host/manifest.json \
   ~/.mozilla/native-messaging-hosts/dev.pick.pdf.signer.json
```

### 3. Update Manifest

Update the manifest with the correct extension ID and binary path:

```bash
# Edit the manifest
vim ~/.config/google-chrome/NativeMessagingHosts/dev.pick.pdf.signer.json
```

Change:

- `"path"`: to the actual path of `pdf-signer`
- `"allowed_origins"`: to include your extension's ID (get from `chrome://extensions`)

Example:

```json
{
  "name": "dev.pick.pdf.signer",
  "description": "Pdf Native Signing Helper",
  "path": "/usr/local/bin/pdf-signer",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://abcdefghijklmnopqrstuvwxyz123456/"]
}
```

## PKCS#11 Configuration

The program looks for PKCS#11 modules in standard locations. You can override with:

```bash
export PKCS11_MODULE_PATH=/path/to/your/pkcs11.so
```

### YubiKey

```bash
# Install yubico-piv-tool
sudo apt install yubico-piv-tool

# PKCS#11 module path (Linux):
export PKCS11_MODULE_PATH=/usr/lib/x86_64-linux-gnu/libykcs11.so
```

### OpenSC (CAC/PIV)

```bash
# Install OpenSC
sudo apt install opensc

# PKCS#11 module path (Linux):
export PKCS11_MODULE_PATH=/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so
```

## Protocol

The helper uses Chrome Native Messaging protocol:

- 4-byte message length prefix (little-endian)
- JSON message body

### Actions

#### listCertificates

Request:

```json
{ "requestId": 1, "action": "listCertificates" }
```

Response:

```json
{
  "requestId": 1,
  "certificates": [
    {
      "id": "PIV Authentication:01",
      "subject": "CN=John Doe,O=Example",
      "issuer": "CN=Example CA",
      "email": "john@example.com",
      "notBefore": "2024-01-01T00:00:00Z",
      "notAfter": "2025-01-01T00:00:00Z",
      "keyType": "RSA"
    }
  ]
}
```

#### signHash

Request:

```json
{
  "requestId": 2,
  "action": "signHash",
  "certificateId": "PIV Authentication:01",
  "hash": "base64-encoded-hash",
  "hashAlgorithm": "SHA256",
  "pin": "123456"
}
```

Response:

```json
{
  "requestId": 2,
  "signature": "base64-encoded-signature"
}
```

#### getCertificate

Request:

```json
{
  "requestId": 3,
  "action": "getCertificate",
  "certificateId": "PIV Authentication:01"
}
```

Response:

```json
{
  "requestId": 3,
  "certificate": "base64-encoded-pem-certificate",
  "chain": ["base64-encoded-issuer-cert", "base64-encoded-root-cert"]
}
```

## Testing

Test the helper manually:

```bash
# Create test message (list certificates)
echo -n '{"requestId":1,"action":"listCertificates"}' > /tmp/msg.json

# Add length prefix and send to helper
python3 -c "
import struct, sys
msg = open('/tmp/msg.json', 'rb').read()
sys.stdout.buffer.write(struct.pack('<I', len(msg)) + msg)
" | ./pdf-signer
```

## Security Notes

1. **PIN Handling**: PINs are passed in request messages and should only be used once per session
2. **Private Keys**: Private key operations happen entirely on the smart card - keys never leave the hardware
3. **Access Control**: The `allowed_origins` in the manifest restricts which extensions can use this helper
