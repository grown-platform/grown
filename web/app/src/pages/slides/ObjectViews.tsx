// Element bodies added in M11: charts (drawn by the shared Sheets
// ChartRenderer), video/audio clips, and warped word art (SVG textPath).
import { useId, useMemo, useState } from "react";
import { ChartRenderer } from "../sheets/ChartRenderer";
import { chartConfigOf, chartInputOf } from "./chartElement";
import { embedUrl } from "./media";
import type { SlideElement, SlideMedia } from "./model";
import { activeTheme } from "./theme";
import { warpSvgMarkup, warpText } from "./wordArt";

/** A chart element's body: the Sheets renderer at the element's size, with
 *  the open deck's theme accents. */
export function ChartBody({ el }: { el: SlideElement }) {
  const theme = activeTheme();
  const chart = el.chart;
  const cfg = useMemo(() => (chart ? chartConfigOf(chart, theme, el.id) : null), [chart, theme, el.id]);
  const input = useMemo(() => (chart ? chartInputOf(chart) : null), [chart]);
  if (!cfg || !input) return null;
  return (
    <div data-chart="" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <ChartRenderer config={cfg} input={input} width={Math.max(40, el.w)} height={Math.max(30, el.h)} />
    </div>
  );
}

const PLAY_GLYPH = (
  <svg viewBox="0 0 68 48" width="68" height="48" aria-hidden="true">
    <rect x="0" y="0" width="68" height="48" rx="12" fill="rgba(0,0,0,0.6)" />
    <path d="M27 14 L47 24 L27 34 Z" fill="#fff" />
  </svg>
);

const SPEAKER_GLYPH = (
  <svg viewBox="0 0 24 24" width="60%" height="60%" aria-hidden="true">
    <path d="M3 9v6h4l5 5V4L7 9H3z" fill="currentColor" />
    <path d="M16.5 12A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z" fill="currentColor" />
    <path d="M14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" fill="currentColor" />
  </svg>
);

/** The still picture of a clip: its poster frame (or a dark placeholder)
 *  with a play badge; a speaker for audio. */
export function MediaPoster({ media }: { media: SlideMedia }) {
  if (media.kind === "audio")
    return (
      <div
        data-media-poster=""
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 12,
          background: "#e8f0fe",
          color: "#1a73e8",
        }}
      >
        {SPEAKER_GLYPH}
      </div>
    );
  return (
    <div data-media-poster="" style={{ position: "absolute", inset: 0, background: "#000", overflow: "hidden" }}>
      {media.poster && (
        <img src={media.poster} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      )}
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{PLAY_GLYPH}</div>
    </div>
  );
}

/**
 * A media element's body. Outside the slideshow (`live` false: editor,
 * thumbnails, presenter previews) it is the poster. In the show it plays:
 * a native <video>/<audio> with controls (autoplay, loop, muted as set), or
 * the YouTube/Vimeo player in a frame — framed at once when autoplaying,
 * else after a click on the poster. Clicks on a clip don't advance the show.
 */
export function MediaBody({ el, live }: { el: SlideElement; live?: boolean }) {
  const m = el.media;
  const [started, setStarted] = useState(false);
  if (!m) return null;
  if (!live || (!m.src && !m.embed)) return <MediaPoster media={m} />;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (m.embed) {
    const play = m.autoplay || started;
    if (!play)
      return (
        <div data-media-start="" onClick={(e) => (stop(e), setStarted(true))} style={{ position: "absolute", inset: 0, cursor: "pointer" }}>
          <MediaPoster media={m} />
        </div>
      );
    return (
      <iframe
        data-media-embed={m.embed.provider}
        src={embedUrl(m, true) ?? undefined}
        title={el.alt || "Video"}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        onClick={stop}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
      />
    );
  }
  if (m.kind === "audio")
    return (
      <div onClick={stop} onPointerDown={stop} style={{ position: "absolute", inset: 0 }}>
        <MediaPoster media={m} />
        <audio
          data-media-player="audio"
          src={m.src}
          autoPlay={m.autoplay}
          loop={m.loop}
          controls
          style={{ position: "absolute", left: "50%", bottom: -44, transform: "translateX(-50%)", width: Math.max(240, el.w) }}
        />
      </div>
    );
  return (
    <video
      data-media-player="video"
      src={m.src}
      poster={m.poster}
      autoPlay={m.autoplay}
      loop={m.loop}
      muted={m.muted}
      controls
      playsInline
      onClick={stop}
      onPointerDown={stop}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
    />
  );
}

/** Word art with a text warp: the text as one line along the preset's
 *  path (SVG textPath), with its fill, gradient, outline and effects. */
export function WarpedText({ el }: { el: SlideElement }) {
  const uid = "wa" + useId().replace(/[^a-zA-Z0-9]/g, "");
  if (!el.wordArt?.warp) return null;
  return (
    <div
      data-warp={el.wordArt.warp}
      aria-label={warpText(el)}
      style={{ position: "absolute", left: 0, top: 0, width: el.w, height: el.h, pointerEvents: "none", overflow: "visible" }}
      dangerouslySetInnerHTML={{ __html: warpSvgMarkup(el, uid) }}
    />
  );
}
