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

/** Window name for the sign-in popup, so repeated clicks reuse one window. */
export const HA_SIGNIN_WINDOW = "grown-homeassistant-signin";

/** signInPopupFeatures centres a sign-in-sized popup on the current screen.
 *  Single sign-on pages (e.g. Zitadel) refuse to be framed, so Home
 *  Assistant's SSO login has to run in a top-level window; HA keeps the
 *  session in its own origin's storage, which the frame shares afterwards. */
export function signInPopupFeatures(
  screen: { availWidth: number; availHeight: number; availLeft?: number; availTop?: number },
  size: { width: number; height: number } = { width: 520, height: 720 },
): string {
  const width = Math.min(size.width, screen.availWidth);
  const height = Math.min(size.height, screen.availHeight);
  const left = Math.round((screen.availLeft ?? 0) + (screen.availWidth - width) / 2);
  const top = Math.round((screen.availTop ?? 0) + (screen.availHeight - height) / 2);
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}
