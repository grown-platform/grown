"""Constants for the Grown Workspace integration."""

from __future__ import annotations

from datetime import timedelta
from typing import Final

DOMAIN: Final = "grown"
MANUFACTURER: Final = "Grown Workspace"

# Polling interval for task lists, unread notifications and the upcoming
# calendar window. Grown has no push channel to Home Assistant (yet).
UPDATE_INTERVAL: Final = timedelta(minutes=2)

# Window the coordinator keeps for the calendar entity's current/next event.
CALENDAR_LOOKBEHIND: Final = timedelta(days=1)
CALENDAR_LOOKAHEAD: Final = timedelta(days=14)

# Limits the Grown push endpoint enforces (POST /api/v1/notifications/push).
PUSH_TITLE_MAX: Final = 200
PUSH_MESSAGE_MAX: Final = 2000
DEFAULT_PUSH_TITLE: Final = "Home Assistant"

# Scopes the "Connect Home Assistant" token preset grants.
RECOMMENDED_SCOPES: Final = (
    "calendar:read",
    "calendar:write",
    "tasks:read",
    "tasks:write",
    "notifications:read",
    "notifications:write",
)
