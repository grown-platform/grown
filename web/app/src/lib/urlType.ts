/**
 * Hyperlink target classification, shared by the Docs/Slides/Sheets link
 * dialogs.
 *
 * - `http`     — a web address (http/https/ftp/ftps, or a bare host such as
 *                `example.com/page` that will be opened over https)
 * - `email`    — `mailto:` or a bare `user@domain` address
 * - `internal` — an in-document anchor (`#heading-1`)
 * - `unsafe`   — well-formed but not a web link (file:, smb:, app-specific
 *                schemes, malformed web URLs, local files); ask before using
 * - `invalid`  — not usable as a link at all (including script schemes)
 */
export type UrlType = "http" | "email" | "internal" | "unsafe" | "invalid";

export interface UrlTypeOptions {
  /**
   * Returns true when a scheme-less input names a local file. Set by hosts
   * that can open local files (a desktop shell); such inputs are then
   * `unsafe` instead of being read as a host name or rejected.
   */
  isLocalFile?: (input: string) => boolean;
}

const WEB_SCHEMES = new Set(["http", "https", "ftp", "ftps"]);
/** Schemes that execute or embed content; never valid link targets. */
const SCRIPT_SCHEMES = new Set(["javascript", "vbscript", "data"]);

// Letters/digits in any script, so internationalised host names are hosts.
const LABEL_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;
const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
// RFC 5322 dot-atom local part.
const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):/;
// Windows drive path (C:\… or C:/…), which would otherwise parse as scheme "c".
const DRIVE_RE = /^[A-Za-z]:[\\/]/;
// "host:port…" without a scheme ("example.com:8080/x"), not scheme "example.com".
const HOST_PORT_RE = /^[^:/?#]+:\d{1,5}(?:[/?#]|$)/;

function isHostName(host: string, requireDot: boolean): boolean {
  if (IPV4_RE.test(host)) return true;
  if (/^\[[0-9A-Fa-f:.]+\]$/.test(host)) return true; // IPv6 literal
  const labels = host.split(".");
  if (requireDot && labels.length < 2) return false;
  if (!labels.every((l) => LABEL_RE.test(l))) return false;
  // A top-level domain is never all digits (rules out "1.2" etc.).
  return !/^\d+$/.test(labels[labels.length - 1]);
}

/** Authority ("user:pw@host:port") of a web URL is well-formed. */
function isAuthority(auth: string): boolean {
  const at = auth.lastIndexOf("@");
  const hostPort = at >= 0 ? auth.slice(at + 1) : auth;
  const m = /^(.*?)(?::(\d{1,5}))?$/.exec(hostPort);
  return !!m && m[1] !== "" && isHostName(m[1], false);
}

function isEmail(s: string): boolean {
  const at = s.lastIndexOf("@");
  if (at <= 0) return false;
  return LOCAL_RE.test(s.slice(0, at)) && isHostName(s.slice(at + 1), true);
}

/** Classify a hyperlink target typed or pasted by the user. */
export function getUrlType(input: string, opts: UrlTypeOptions = {}): UrlType {
  const s = input.trim();
  if (!s || /\s/.test(s)) return "invalid";
  if (s.startsWith("#")) return s.length > 1 ? "internal" : "invalid";

  const scheme = DRIVE_RE.test(s) || HOST_PORT_RE.test(s) ? null : SCHEME_RE.exec(s)?.[1].toLowerCase();
  if (scheme) {
    const rest = s.slice(scheme.length + 1);
    if (SCRIPT_SCHEMES.has(scheme)) return "invalid";
    if (scheme === "mailto") return isEmail(rest.split("?")[0]) ? "email" : "invalid";
    if (scheme === "file") {
      // A quoted path pasted after file:// is not a URL.
      return /["']/.test(rest) ? "invalid" : "unsafe";
    }
    if (WEB_SCHEMES.has(scheme)) {
      if (!rest.startsWith("//")) return "unsafe";
      const auth = rest.slice(2).split(/[/?#]/, 1)[0];
      // Malformed web URLs ("http://", "http:///a", "http://.x") can't be
      // opened as intended; flag rather than silently rewrite them.
      return isAuthority(auth) ? "http" : "unsafe";
    }
    // Any other scheme (smb:, app deep links, …) launches something else.
    return "unsafe";
  }

  if (s.includes("@") && !s.includes("/")) return isEmail(s) ? "email" : "invalid";
  if (opts.isLocalFile?.(s)) return "unsafe";
  // A bare host with an optional path: "example.com", "foo.bar/x?y".
  const host = s.split(/[/?#]/, 1)[0];
  return isAuthority(host) && host.includes(".") ? "http" : "invalid";
}

export interface NormalizedLink {
  type: UrlType;
  /** The href to store; empty for `invalid`. */
  href: string;
}

/**
 * Turn user input into an href: bare hosts get `https://`, bare email
 * addresses get `mailto:`; everything else is kept as typed.
 */
export function normalizeLink(input: string, opts: UrlTypeOptions = {}): NormalizedLink {
  const s = input.trim();
  const type = getUrlType(s, opts);
  switch (type) {
    case "invalid":
      return { type, href: "" };
    case "http":
      return { type, href: /^(?:https?|ftps?):/i.test(s) ? s : `https://${s}` };
    case "email":
      return { type, href: /^mailto:/i.test(s) ? s : `mailto:${s}` };
    default:
      return { type, href: s };
  }
}

/**
 * Prompt-style link editing shared by the editors: returns the href to set,
 * `""` to remove the link, or `null` to cancel (dismissed, rejected input, or
 * an unsafe target the user declined). `ask`/`warn` default to the browser's
 * confirm/alert so callers can stay one line.
 */
export function resolveLinkInput(
  input: string | null,
  ui: {
    confirm?: (msg: string) => boolean;
    alert?: (msg: string) => void;
  } = {},
): string | null {
  if (input === null) return null;
  if (input.trim() === "") return "";
  const { type, href } = normalizeLink(input);
  if (type === "invalid") {
    (ui.alert ?? window.alert)(`"${input.trim()}" is not a valid link.`);
    return null;
  }
  if (type === "unsafe") {
    const ok = (ui.confirm ?? window.confirm)(
      `"${href}" is not a web or email link and may be unsafe to open. Use it anyway?`,
    );
    return ok ? href : null;
  }
  return href;
}
