import type { OrgServiceSetting } from "../../catalog/serviceSettings";

export const HA_SERVICE_ID = "homeassistant";

/** resolveHomeAssistantUrl returns the org's effective Home Assistant URL (the
 *  org's own URL, or the deployment default the service-settings API reports),
 *  or null when unset, disabled, or not an http(s) URL. */
export function resolveHomeAssistantUrl(
  settings: readonly OrgServiceSetting[] | null | undefined,
): string | null {
  const s = (settings ?? []).find((x) => x.service_id === HA_SERVICE_ID);
  if (!s || !s.enabled) return null;
  const raw = s.external_url?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export type EmbedBlock = "mixed-content" | null;

/** embedBlockReason reports a framing failure we can know up front: an https
 *  Grown page can't frame an http HA (browsers block mixed content). Refusals
 *  by HA itself (X-Frame-Options) are invisible to script and are handled by
 *  the page's always-available fallback instead. */
export function embedBlockReason(
  haUrl: string,
  pageProtocol: string,
): EmbedBlock {
  try {
    const u = new URL(haUrl);
    if (pageProtocol === "https:" && u.protocol === "http:") {
      // Browsers treat loopback as potentially trustworthy.
      const h = u.hostname;
      if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return null;
      return "mixed-content";
    }
  } catch {
    /* resolveHomeAssistantUrl already rejected bad URLs */
  }
  return null;
}

/** The chart seeds this; bring-your-own users add it to configuration.yaml. */
export const HA_FRAME_CONFIG = `http:\n  use_x_frame_options: false`;
