// Video and audio on slides (M11): the upload allowlist, URL
// classification (YouTube/Vimeo players, direct media files), player URLs
// and the default element boxes. Pure; the element renders in SlideView.

import { uid, type SlideElement, type SlideMedia } from "./model";

/** Upload limit for one clip; mirrors internal/slides/assets.go MaxMediaBytes. */
export const MAX_MEDIA_BYTES = 100 << 20;

/** Accepted upload types (the server sniffs the bytes again). */
export const MEDIA_TYPES: Record<string, SlideMedia["kind"]> = {
  "video/mp4": "video",
  "video/webm": "video",
  "video/ogg": "video",
  "video/quicktime": "video",
  "audio/mpeg": "audio",
  "audio/mp3": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "audio/aac": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/wave": "audio",
  "audio/webm": "audio",
};

const EXT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
};

/** The MIME type of a file name / URL path by extension (undefined if unknown). */
export function mimeFromName(name: string): string | undefined {
  const m = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(name);
  return m ? EXT_TYPES[m[1].toLowerCase()] : undefined;
}

/** Why a picked file can't be inserted as media (null = fine). */
export function mediaFileError(file: { name?: string; type?: string; size: number }): string | null {
  const type = file.type || mimeFromName(file.name ?? "") || "";
  if (!MEDIA_TYPES[type]) return "Unsupported media type. Use MP4, WebM, Ogg, MP3, M4A or WAV.";
  if (file.size > MAX_MEDIA_BYTES) return `The file is larger than ${MAX_MEDIA_BYTES >> 20} MB.`;
  if (!file.size) return "The file is empty.";
  return null;
}

/** The media kind of a MIME type (undefined if not accepted). */
export function mediaKindOf(mime: string | undefined): SlideMedia["kind"] | undefined {
  return mime ? MEDIA_TYPES[mime.toLowerCase()] : undefined;
}

export interface ParsedMediaUrl {
  kind: SlideMedia["kind"];
  src: string;
  embed?: SlideMedia["embed"];
  mime?: string;
}

/**
 * Classify a pasted URL: a YouTube or Vimeo page (framed player), or a
 * direct http(s) link to a media file. Null for anything else (other
 * schemes are refused outright).
 */
export function parseMediaUrl(input: string): ParsedMediaUrl | null {
  const raw = input.trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^(www\.|m\.)/, "").toLowerCase();
  const ytId = (s: string | null | undefined) => (s && /^[\w-]{11}$/.test(s) ? s : null);
  let yt: string | null = null;
  if (host === "youtu.be") yt = ytId(u.pathname.slice(1).split("/")[0]);
  else if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") yt = ytId(u.searchParams.get("v"));
    else {
      const m = /^\/(?:embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname);
      yt = m ? m[1] : null;
    }
  }
  if (yt) return { kind: "video", src: `https://www.youtube.com/watch?v=${yt}`, embed: { provider: "youtube", id: yt } };
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = /\/(?:video\/)?(\d{5,12})(?:\/|$)/.exec(u.pathname);
    if (m) return { kind: "video", src: `https://vimeo.com/${m[1]}`, embed: { provider: "vimeo", id: m[1] } };
    return null;
  }
  const mime = mimeFromName(u.pathname);
  const kind = mediaKindOf(mime);
  if (kind) return { kind, src: u.toString(), mime };
  return null;
}

/** The framed player URL for an online video (autoplay/loop/mute applied). */
export function embedUrl(m: SlideMedia, autoplay: boolean): string | null {
  if (!m.embed) return null;
  const id = encodeURIComponent(m.embed.id);
  const q = new URLSearchParams();
  if (m.embed.provider === "youtube") {
    q.set("rel", "0");
    q.set("playsinline", "1");
    if (autoplay) q.set("autoplay", "1");
    if (m.loop) {
      q.set("loop", "1");
      q.set("playlist", m.embed.id);
    }
    if (m.muted || autoplay) q.set("mute", m.muted ? "1" : "0");
    return `https://www.youtube-nocookie.com/embed/${id}?${q}`;
  }
  if (autoplay) q.set("autoplay", "1");
  if (m.loop) q.set("loop", "1");
  if (m.muted) q.set("muted", "1");
  const qs = q.toString();
  return `https://player.vimeo.com/video/${id}${qs ? `?${qs}` : ""}`;
}

/** A poster image an online provider serves without an API call. */
export function defaultPoster(m: Pick<SlideMedia, "embed">): string | undefined {
  if (m.embed?.provider === "youtube") return `https://i.ytimg.com/vi/${encodeURIComponent(m.embed.id)}/hqdefault.jpg`;
  return undefined;
}

/** The default box for a new clip: 16:9 video (or its own aspect), a small
 *  square speaker for audio; centred on the slide. */
export function mediaBox(
  kind: SlideMedia["kind"],
  slide: { w: number; h: number },
  natural?: { w: number; h: number } | null,
): { x: number; y: number; w: number; h: number } {
  let w = kind === "audio" ? 96 : 480;
  let h = kind === "audio" ? 96 : 270;
  if (kind === "video" && natural && natural.w > 0 && natural.h > 0) {
    const s = Math.min((slide.w * 0.6) / natural.w, (slide.h * 0.6) / natural.h);
    w = Math.round(natural.w * s);
    h = Math.round(natural.h * s);
  }
  return { x: Math.round((slide.w - w) / 2), y: Math.round((slide.h - h) / 2), w, h };
}

/** A new media element. */
export function newMediaElement(
  media: SlideMedia,
  slide: { w: number; h: number },
  natural?: { w: number; h: number } | null,
): SlideElement {
  const m: SlideMedia = { ...media };
  if (!m.poster) {
    const p = defaultPoster(m);
    if (p) m.poster = p;
  }
  return { id: uid(), type: "media", ...mediaBox(m.kind, slide, natural), media: m, name: m.kind === "audio" ? "Audio" : "Video" };
}

/** Playback options (Format ▸ Media): start and loop. */
export function setPlayback(el: SlideElement, p: Partial<Pick<SlideMedia, "autoplay" | "loop" | "muted">>): SlideElement {
  if (!el.media) return el;
  const media: SlideMedia = { ...el.media };
  for (const k of ["autoplay", "loop", "muted"] as const) {
    if (!(k in p)) continue;
    if (p[k]) media[k] = true;
    else delete media[k];
  }
  return { ...el, media };
}
