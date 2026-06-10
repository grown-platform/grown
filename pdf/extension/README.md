# Pdf Signing Agent Browser Extension

Browser extension that enables signing documents with CAC/PIV smart cards directly in the browser.

## Browser Support

- **Chrome** - Full support (MV3)
- **Edge** - Full support (Chromium-based, MV3)
- **Firefox** - Full support (MV3, requires v109+)
- **Chromium** - Full support (MV3)

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   Web Page      │────▶│ Content Script   │────▶│ Background Worker   │
│   (Pdf)     │◀────│                  │◀────│                     │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
                                                          │
                                                          │ Native Messaging
                                                          ▼
                                                ┌─────────────────────┐
                                                │ pdf-signer      │
                                                │ (PKCS#11 helper)    │
                                                └─────────────────────┘
                                                          │
                                                          │ PKCS#11
                                                          ▼
                                                ┌─────────────────────┐
                                                │ YubiKey/CAC Card    │
                                                └─────────────────────┘
```

## Components

1. **Content Script** (`content.js`): Bridges communication between web page and extension
2. **Injected Script** (`injected.js`): Provides `window.PdfSigner` API to web pages
3. **Background Worker** (`background.js`): Handles native messaging with signing helper
4. **Native Host** (`pdf-signer`): Go binary that interfaces with smart cards via PKCS#11

## Web Page API

The extension exposes `window.PdfSigner` to web pages:

```javascript
// Check if extension is available
const status = await window.PdfSigner.isAvailable();
// { available: true, nativeHostConnected: true }

// List certificates
const { certificates } = await window.PdfSigner.listCertificates();
// [{ id: "...", subject: "CN=John Doe", email: "john@example.com", ... }]

// Sign a hash
const { signature } = await window.PdfSigner.signHash(
  certificateId,
  base64Hash,
  "SHA256",
);

// Get certificate chain
const { certificate, chain } =
  await window.PdfSigner.getCertificate(certificateId);
```

## Installation

### 1. Install the Browser Extension

**Development Mode:**

1. Open Chrome/Edge and go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this `extension` directory
4. Note the extension ID that's assigned

**Production:**

- Extension will be published to Chrome Web Store

### 2. Install the Native Signing Helper

```bash
# Build the helper
cd ../native-signer
go build -o pdf-signer .

# Install binary
sudo cp pdf-signer /usr/local/bin/

# Install native messaging manifest
mkdir -p ~/.config/google-chrome/NativeMessagingHosts
cp native-host/manifest.json ~/.config/google-chrome/NativeMessagingHosts/dev.pick.pdf.signer.json

# Update manifest with your extension ID
sed -i 's/EXTENSION_ID_HERE/your-actual-extension-id/' \
  ~/.config/google-chrome/NativeMessagingHosts/dev.pick.pdf.signer.json
```

### 3. Install PKCS#11 Library

For YubiKey:

```bash
# Ubuntu/Debian
sudo apt install yubico-piv-tool opensc

# The PKCS#11 library is at:
# /usr/lib/x86_64-linux-gnu/libykcs11.so
```

For DoD CAC:

```bash
# Install OpenSC
sudo apt install opensc

# The PKCS#11 library is at:
# /usr/lib/x86_64-linux-gnu/opensc-pkcs11.so
```

## Icon Generation

The icons need to be generated from `icons/icon.svg`:

```bash
# Using ImageMagick
convert -background none icons/icon.svg -resize 16x16 icons/icon16.png
convert -background none icons/icon.svg -resize 48x48 icons/icon48.png
convert -background none icons/icon.svg -resize 128x128 icons/icon128.png
```

## Security Considerations

1. **PIN Entry**: The native helper prompts for PIN through the PKCS#11 library (system dialog)
2. **Key Never Leaves Card**: Private key operations happen on the smart card
3. **Origin Restrictions**: Extension only responds to trusted Pdf domains
4. **Certificate Validation**: Server validates certificate against trusted CAs
