#!/bin/bash
set -euo pipefail

# Pdf Native Signing Helper - Install Script

echo "Installing Pdf Native Signing Helper..."

# Build
echo "Building..."
go build -o pdf-signer .

# Install binary
echo "Installing binary to /usr/local/bin..."
sudo cp pdf-signer /usr/local/bin/
sudo chmod +x /usr/local/bin/pdf-signer

# Get extension ID from user (for Chrome/Edge)
echo ""
echo "What is your Chrome/Edge extension ID?"
echo "(Find it at chrome://extensions after loading the extension)"
read -p "Extension ID: " EXTENSION_ID

if [ -z "$EXTENSION_ID" ]; then
    echo "Error: Extension ID is required"
    exit 1
fi

# Create Chrome/Edge manifest
CHROME_MANIFEST=$(cat <<EOF
{
  "name": "dev.pick.pdf.signer",
  "description": "Pdf Native Signing Helper - signs document hashes using CAC/PIV smart cards via PKCS#11",
  "path": "/usr/local/bin/pdf-signer",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXTENSION_ID}/"
  ]
}
EOF
)

# Create Firefox manifest (uses allowed_extensions with extension ID)
FIREFOX_MANIFEST=$(cat <<EOF
{
  "name": "dev.pick.pdf.signer",
  "description": "Pdf Native Signing Helper - signs document hashes using CAC/PIV smart cards via PKCS#11",
  "path": "/usr/local/bin/pdf-signer",
  "type": "stdio",
  "allowed_extensions": [
    "pdf-signer@pick.haus"
  ]
}
EOF
)

# Install manifests for supported browsers
install_chrome_manifest() {
    local dir="$1"
    local name="$2"

    if [ -d "$(dirname "$dir")" ]; then
        mkdir -p "$dir"
        echo "$CHROME_MANIFEST" > "$dir/dev.pick.pdf.signer.json"
        echo "Installed manifest for $name"
    fi
}

install_firefox_manifest() {
    local dir="$1"

    if [ -d "$(dirname "$dir")" ]; then
        mkdir -p "$dir"
        echo "$FIREFOX_MANIFEST" > "$dir/dev.pick.pdf.signer.json"
        echo "Installed manifest for Firefox"
    fi
}

# Chrome
install_chrome_manifest "$HOME/.config/google-chrome/NativeMessagingHosts" "Chrome"

# Chromium
install_chrome_manifest "$HOME/.config/chromium/NativeMessagingHosts" "Chromium"

# Edge
install_chrome_manifest "$HOME/.config/microsoft-edge/NativeMessagingHosts" "Edge"

# Firefox (uses different allowed_extensions format)
install_firefox_manifest "$HOME/.mozilla/native-messaging-hosts"

echo ""
echo "Installation complete!"
echo ""
echo "Make sure you have a PKCS#11 library installed:"
echo "  YubiKey: apt install yubico-piv-tool"
echo "  CAC/PIV: apt install opensc"
echo ""
echo "If your PKCS#11 library is in a non-standard location, set:"
echo "  export PKCS11_MODULE_PATH=/path/to/your/pkcs11.so"
