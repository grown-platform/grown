#!/bin/bash
# Setup mTLS certificates for testing
# This creates server certificates and configures trust for YubiKey/CAC client certs

set -e

CERT_DIR="${CERT_DIR:-./certs}"
mkdir -p "$CERT_DIR"

echo "=== Setting up mTLS certificates ==="
echo "Certificate directory: $CERT_DIR"

# Generate server CA (for signing server cert)
if [ ! -f "$CERT_DIR/server-ca.pem" ]; then
    echo "Generating server CA..."
    openssl genrsa -out "$CERT_DIR/server-ca-key.pem" 4096
    openssl req -new -x509 -days 3650 -key "$CERT_DIR/server-ca-key.pem" \
        -out "$CERT_DIR/server-ca.pem" \
        -subj "/CN=Pdf Server CA/O=Grown"
fi

# Generate server certificate
if [ ! -f "$CERT_DIR/server.pem" ]; then
    echo "Generating server certificate..."
    openssl genrsa -out "$CERT_DIR/server-key.pem" 2048

    # Create server cert with SAN
    cat > "$CERT_DIR/server.cnf" << EOF
[req]
distinguished_name = req_dn
req_extensions = v3_req
prompt = no

[req_dn]
CN = localhost
O = Grown

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = pdf.local
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

    openssl req -new -key "$CERT_DIR/server-key.pem" \
        -out "$CERT_DIR/server.csr" \
        -config "$CERT_DIR/server.cnf"

    openssl x509 -req -days 365 \
        -in "$CERT_DIR/server.csr" \
        -CA "$CERT_DIR/server-ca.pem" \
        -CAkey "$CERT_DIR/server-ca-key.pem" \
        -CAcreateserial \
        -out "$CERT_DIR/server.pem" \
        -extensions v3_req \
        -extfile "$CERT_DIR/server.cnf"

    rm "$CERT_DIR/server.csr" "$CERT_DIR/server.cnf"
fi

# Export YubiKey certificate for client CA trust (if YubiKey is connected)
if command -v ykman &> /dev/null; then
    echo "Exporting YubiKey certificate..."
    ykman piv certificates export 9c "$CERT_DIR/yubikey-client.pem" 2>/dev/null || true

    if [ -f "$CERT_DIR/yubikey-client.pem" ]; then
        echo "YubiKey certificate exported"
        # Create a combined client CA file
        cat "$CERT_DIR/yubikey-client.pem" > "$CERT_DIR/client-ca.pem"
    fi
else
    echo "ykman not found, skipping YubiKey certificate export"
fi

# Create empty client CA if not exists (for self-signed client certs)
if [ ! -f "$CERT_DIR/client-ca.pem" ]; then
    echo "Creating empty client CA bundle..."
    touch "$CERT_DIR/client-ca.pem"
fi

echo ""
echo "=== mTLS Setup Complete ==="
echo ""
echo "Server certificates:"
echo "  Server cert: $CERT_DIR/server.pem"
echo "  Server key:  $CERT_DIR/server-key.pem"
echo "  Server CA:   $CERT_DIR/server-ca.pem"
echo ""
echo "Client CA bundle: $CERT_DIR/client-ca.pem"
echo ""
echo "To enable mTLS, add to your .env or config.yaml:"
echo ""
echo "  PDF_MTLS_ENABLED=true"
echo "  PDF_MTLS_CERT_FILE=$CERT_DIR/server.pem"
echo "  PDF_MTLS_KEY_FILE=$CERT_DIR/server-key.pem"
echo "  PDF_MTLS_CLIENT_CA_FILE=$CERT_DIR/client-ca.pem"
echo "  PDF_MTLS_VERIFY_MODE=optional  # or 'require' for strict"
echo ""
echo "To test with curl and YubiKey:"
echo ""
echo "  # First, export your YubiKey cert and key to PKCS12"
echo "  # Then convert to PEM and use with curl:"
echo "  curl --cert client.pem --key client-key.pem --cacert $CERT_DIR/server-ca.pem https://localhost:8085/api/documents"
echo ""
