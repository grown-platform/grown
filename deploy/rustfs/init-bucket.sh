#!/usr/bin/env bash
# Creates the grown-default bucket inside rustfs on first boot.
# Idempotent — safe to run on every stack boot.
set -euo pipefail

ENDPOINT="${RUSTFS_ENDPOINT:-http://127.0.0.1:9100}"
ACCESS="${RUSTFS_ACCESS_KEY:-grown}"
SECRET="${RUSTFS_SECRET_KEY:-DevPassword!1}"
BUCKET="${RUSTFS_BUCKET:-grown-default}"

export AWS_ACCESS_KEY_ID="$ACCESS"
export AWS_SECRET_ACCESS_KEY="$SECRET"
export AWS_DEFAULT_REGION="us-east-1"

# Check if bucket exists. head-bucket exits 0 on existence, non-zero for 404
# AND any other error (network, auth, 5xx). We suppress stderr here because a
# transient root cause will resurface immediately and loudly on the create-bucket
# call below — losing the head-bucket diagnostic is acceptable since the same
# underlying error will produce a clear failure one syscall later.
if aws --endpoint-url "$ENDPOINT" s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "bucket $BUCKET exists, skipping create"
  exit 0
fi

aws --endpoint-url "$ENDPOINT" s3api create-bucket --bucket "$BUCKET" >/dev/null
echo "bucket $BUCKET created"
