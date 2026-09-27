import { describe, expect, it } from "vitest";
import { embedUrl, mediaBox, mediaFileError, mimeFromName, newMediaElement, parseMediaUrl, setPlayback } from "./media";

describe("media URLs", () => {
  it("recognises YouTube links in their common forms", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      const p = parseMediaUrl(u);
      expect(p?.embed).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
      expect(p?.kind).toBe("video");
    }
  });

  it("recognises Vimeo links", () => {
    expect(parseMediaUrl("https://vimeo.com/76979871")?.embed).toEqual({ provider: "vimeo", id: "76979871" });
    expect(parseMediaUrl("https://player.vimeo.com/video/76979871?h=1")?.embed).toEqual({ provider: "vimeo", id: "76979871" });
  });

  it("accepts direct media files and refuses other pages and schemes", () => {
    expect(parseMediaUrl("https://example.com/clip.mp4")).toMatchObject({ kind: "video", mime: "video/mp4" });
    expect(parseMediaUrl("https://example.com/a/song.mp3?x=1")).toMatchObject({ kind: "audio", mime: "audio/mpeg" });
    expect(parseMediaUrl("https://example.com/page.html")).toBeNull();
    expect(parseMediaUrl("javascript:alert(1)//x.mp4")).toBeNull();
    expect(parseMediaUrl("ftp://example.com/x.mp4")).toBeNull();
    expect(parseMediaUrl("not a url")).toBeNull();
  });

  it("builds player URLs with autoplay and loop", () => {
    const yt = embedUrl({ kind: "video", src: "", embed: { provider: "youtube", id: "dQw4w9WgXcQ" }, loop: true }, true)!;
    expect(yt).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    expect(yt).toContain("autoplay=1");
    expect(yt).toContain("loop=1");
    expect(yt).toContain("playlist=dQw4w9WgXcQ");
    expect(embedUrl({ kind: "video", src: "", embed: { provider: "vimeo", id: "123456" } }, false)).toBe("https://player.vimeo.com/video/123456");
    expect(embedUrl({ kind: "video", src: "x.mp4" }, true)).toBeNull();
  });
});

describe("media upload allowlist", () => {
  it("accepts listed types under the size limit", () => {
    expect(mediaFileError({ name: "a.mp4", type: "video/mp4", size: 1000 })).toBeNull();
    expect(mediaFileError({ name: "a.m4a", type: "", size: 1000 })).toBeNull();
    expect(mimeFromName("x.WEBM")).toBe("video/webm");
  });
  it("refuses other types, empty and oversized files", () => {
    expect(mediaFileError({ name: "a.exe", type: "application/x-msdownload", size: 10 })).toMatch(/Unsupported/);
    expect(mediaFileError({ name: "a.mp4", type: "video/mp4", size: 0 })).toMatch(/empty/);
    expect(mediaFileError({ name: "a.mp4", type: "video/mp4", size: 101 << 20 })).toMatch(/larger/);
  });
});

describe("media elements", () => {
  it("video boxes keep the clip's aspect; audio is a small square", () => {
    expect(mediaBox("video", { w: 960, h: 540 }, { w: 640, h: 480 })).toEqual({ x: 264, y: 108, w: 432, h: 324 });
    expect(mediaBox("audio", { w: 960, h: 540 })).toEqual({ x: 432, y: 222, w: 96, h: 96 });
  });
  it("YouTube clips get the provider's poster", () => {
    const el = newMediaElement({ kind: "video", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", embed: { provider: "youtube", id: "dQw4w9WgXcQ" } }, { w: 960, h: 540 });
    expect(el.media!.poster).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(el.type).toBe("media");
  });
  it("playback options toggle on and off", () => {
    let el = newMediaElement({ kind: "audio", src: "/a.mp3" }, { w: 960, h: 540 });
    el = setPlayback(el, { autoplay: true, loop: true });
    expect(el.media).toMatchObject({ autoplay: true, loop: true });
    el = setPlayback(el, { loop: false });
    expect(el.media!.loop).toBeUndefined();
    expect(el.media!.autoplay).toBe(true);
  });
});
