#!/usr/bin/env bash
# Run the grown custom integration's tests inside the Home Assistant image the
# chart pins (same Python + HA version as production), with
# pytest-homeassistant-custom-component installed on top.
#
#   integrations/homeassistant/run-tests.sh [pytest args...]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
IMAGE="${HA_IMAGE:-ghcr.io/home-assistant/home-assistant:2026.9.4}"
exec docker run --rm -e PYTHONDONTWRITEBYTECODE=1 -v "$HERE:/src" -w /src --entrypoint sh "$IMAGE" -c \
  'pip install -q --root-user-action=ignore -r requirements-test.txt >/dev/null && python -m pytest -p no:cacheprovider "$@"' \
  sh "$@"
