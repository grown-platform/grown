#!/usr/bin/env bash
# Seed development data for pdf
set -euo pipefail

# Configuration
S3_ENDPOINT="${PDF_STORAGE_ENDPOINT:-http://localhost:9020}"
S3_BUCKET="${PDF_STORAGE_BUCKET:-pdf-documents}"
S3_ACCESS_KEY="${PDF_STORAGE_ACCESS_KEY:-pdf-access-key}"
S3_SECRET_KEY="${PDF_STORAGE_SECRET_KEY:-pdf-secret-key}"
POSTGRES_CONTAINER="pdf-postgres"

# Test data
DOC_ID="test-doc-001"
SIGNER_ID="test-signer-001"
FIELD_ID="test-field-001"
ORG_ID="test-org"
STORAGE_KEY="documents/${DOC_ID}/original.pdf"
# Fixed access token for easy testing
ACCESS_TOKEN="test-signing-token-12345"
ACCESS_TOKEN_EXPIRES="2099-12-31T23:59:59Z"

# Helper function to run psql in the postgres container
run_psql() {
    docker exec -e PGPASSWORD=pdf "$POSTGRES_CONTAINER" psql -U pdf -d pdf -tAc "$1"
}

run_psql_cmd() {
    docker exec -e PGPASSWORD=pdf "$POSTGRES_CONTAINER" psql -U pdf -d pdf -c "$1"
}

echo "=== Seeding Pdf Development Data ==="

# Check if data already exists
EXISTING=$(run_psql "SELECT COUNT(*) FROM documents WHERE id = '$DOC_ID'" 2>/dev/null || echo "0")
if [ "$EXISTING" != "0" ]; then
    echo "Test document already exists, skipping seed."
    echo ""
    echo "Test signing URL: http://localhost:5173/sign/${ACCESS_TOKEN}"
    exit 0
fi

echo ""
echo "1. Creating sample PDF..."
# Create a simple PDF using pure bash (minimal valid PDF)
TEMP_PDF=$(mktemp /tmp/test-document-XXXXXX.pdf)
cat > "$TEMP_PDF" << 'PDFEOF'
%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 189 >>
stream
BT
/F1 24 Tf
100 700 Td
(Test Document for Signing) Tj
0 -40 Td
/F1 14 Tf
(This is a sample document for testing the Pdf) Tj
0 -20 Td
(document signing workflow.) Tj
0 -60 Td
(Please sign below:) Tj
0 -100 Td
(_________________________________) Tj
0 -20 Td
(Signature) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
0000000507 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
580
%%EOF
PDFEOF

echo "   Created: $TEMP_PDF"

echo ""
echo "2. Uploading PDF to S3 (RustFS)..."

# Create bucket first (ignore error if exists)
docker run --rm --network host \
    -e AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY}" \
    -e AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY}" \
    amazon/aws-cli --endpoint-url "${S3_ENDPOINT}" \
    s3 mb "s3://${S3_BUCKET}" 2>/dev/null || true

# Upload the PDF using AWS CLI in docker
docker run --rm --network host \
    -v "${TEMP_PDF}:/tmp/upload.pdf:ro" \
    -e AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY}" \
    -e AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY}" \
    amazon/aws-cli --endpoint-url "${S3_ENDPOINT}" \
    s3 cp /tmp/upload.pdf "s3://${S3_BUCKET}/${STORAGE_KEY}" \
    --content-type "application/pdf" \
    || { echo "   Warning: Upload may have failed, continuing anyway"; }
echo "   Uploaded to: ${STORAGE_KEY}"

echo ""
echo "3. Inserting database records..."

# Get file size
FILE_SIZE=$(stat -c%s "$TEMP_PDF" 2>/dev/null || stat -f%z "$TEMP_PDF")

# Insert document
run_psql_cmd "
INSERT INTO documents (
    id, organization_id, name, description, status, storage_key,
    total_pages, file_size_bytes, signing_order, created_by
) VALUES (
    '${DOC_ID}',
    '${ORG_ID}',
    'Test Contract Agreement',
    'A sample document for testing the signing workflow',
    'pending',
    '${STORAGE_KEY}',
    1,
    ${FILE_SIZE},
    false,
    'dev-seed'
) ON CONFLICT (id) DO NOTHING;
"
echo "   Created document: ${DOC_ID}"

# Insert signer
run_psql_cmd "
INSERT INTO signers (
    id, document_id, email, name, signer_type, signing_order,
    access_token, access_token_expires_at
) VALUES (
    '${SIGNER_ID}',
    '${DOC_ID}',
    'lpick@pick.haus',
    'Lucas Pick',
    'signer',
    1,
    '${ACCESS_TOKEN}',
    '${ACCESS_TOKEN_EXPIRES}'
) ON CONFLICT (id) DO NOTHING;
"
echo "   Created signer: ${SIGNER_ID}"

# Insert signature field (positioned in the signature area of the PDF)
run_psql_cmd "
INSERT INTO signature_fields (
    id, document_id, signer_id, field_type, page_number,
    x, y, width, height, required, label
) VALUES (
    '${FIELD_ID}',
    '${DOC_ID}',
    '${SIGNER_ID}',
    'signature',
    1,
    0.15,
    0.45,
    0.35,
    0.08,
    true,
    'Your Signature'
) ON CONFLICT (id) DO NOTHING;
"
echo "   Created signature field: ${FIELD_ID}"

# Insert audit trail entry
run_psql_cmd "
INSERT INTO audit_trail (
    id, document_id, user_id, action, action_details, ip_address
) VALUES (
    'audit-seed-001',
    '${DOC_ID}',
    'dev-seed',
    'document_created',
    '{\"source\": \"dev-seed\", \"name\": \"Test Contract Agreement\"}',
    '127.0.0.1'
) ON CONFLICT (id) DO NOTHING;
"
echo "   Created audit trail entry"

# Cleanup
rm -f "$TEMP_PDF"

echo ""
echo "=== Seed Complete ==="
echo ""
echo "Test document created with:"
echo "  - Document ID: ${DOC_ID}"
echo "  - Signer: lpick@pick.haus (Lucas Pick)"
echo "  - Access Token: ${ACCESS_TOKEN}"
echo ""
echo "URLs for testing:"
echo "  - Document list: http://localhost:5173/documents"
echo "  - Guest signing: http://localhost:5173/sign/${ACCESS_TOKEN}"
echo ""
