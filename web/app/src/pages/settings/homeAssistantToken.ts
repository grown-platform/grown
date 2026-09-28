/** Scopes for the "Connect Home Assistant" token preset: exactly what the HA
 *  `grown` integration needs (calendar + todo entities, notify + sensors). The
 *  server maps "<svc>:read" to GET/HEAD and "<svc>:write" to writes under
 *  /api/v1/<svc>/*; /api/v1/integrations/homeassistant/info is scope-free. */
export const HOME_ASSISTANT_SCOPES = [
  "calendar:read",
  "calendar:write",
  "tasks:read",
  "tasks:write",
  "notifications:read",
  "notifications:write",
] as const;

export const HOME_ASSISTANT_TOKEN_NAME = "Home Assistant";

/** Where the HA custom integration can be downloaded (served by grown). */
export const HOME_ASSISTANT_INTEGRATION_ZIP = "/integrations/homeassistant/grown.zip";

/** Docs for running your own Home Assistant alongside grown. */
export const HOME_ASSISTANT_DOCS =
  "https://code.pick.haus/grown/grown/src/branch/main/docs/services/homeassistant.md";

/** homeAssistantTokenRequest is the POST /api/v1/me/tokens body for the
 *  preset: no expiry, like the default "Never" option. */
export function homeAssistantTokenRequest(): {
  name: string;
  scopes: string[];
  expires_in_days: number;
} {
  return {
    name: HOME_ASSISTANT_TOKEN_NAME,
    scopes: [...HOME_ASSISTANT_SCOPES],
    expires_in_days: 0,
  };
}
