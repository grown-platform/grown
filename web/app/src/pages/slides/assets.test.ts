import { describe, expect, it } from "vitest";
import { newElement, type SlideElement } from "./model";
import { assetDeck, rehomeAssets } from "./assets";

const img = (id: string, src: string): SlideElement => ({ ...newElement("image", src), id });

describe("rehomeAssets (paste between decks)", () => {
  it("finds the owning deck of an asset URL", () => {
    expect(assetDeck("/api/v1/slides/d/abc/assets/f00")).toBe("abc");
    expect(assetDeck("data:image/png;base64,AA")).toBeNull();
  });

  it("copies other decks' pictures and clip posters, keeps this deck's and inline ones", async () => {
    const copied: string[] = [];
    const els: SlideElement[] = [
      img("a", "/api/v1/slides/d/other/assets/1"),
      img("b", "/api/v1/slides/d/me/assets/2"),
      { ...newElement("rect"), id: "g", type: "group", children: [img("c", "/api/v1/slides/d/other/assets/1")] },
      { id: "m", type: "media", x: 0, y: 0, w: 10, h: 10, media: { kind: "video", src: "https://youtu.be/x", poster: "/api/v1/slides/d/other/assets/3" } },
      img("d", "/api/v1/slides/d/other/assets/broken"),
    ];
    const out = await rehomeAssets(els, "me", async (u) => {
      copied.push(u);
      if (u.endsWith("broken")) throw new Error("404");
      return u.replace("/other/", "/me/");
    });
    expect(copied.sort()).toEqual(["/api/v1/slides/d/other/assets/1", "/api/v1/slides/d/other/assets/3", "/api/v1/slides/d/other/assets/broken"]);
    expect(out[0].src).toBe("/api/v1/slides/d/me/assets/1");
    expect(out[1].src).toBe("/api/v1/slides/d/me/assets/2");
    expect(out[2].children![0].src).toBe("/api/v1/slides/d/me/assets/1");
    expect(out[3].media!.poster).toBe("/api/v1/slides/d/me/assets/3");
    expect(out[4].src).toBe("/api/v1/slides/d/other/assets/broken");
  });

  it("returns the same array when nothing is foreign", async () => {
    const els = [img("a", "data:image/png;base64,AA")];
    expect(await rehomeAssets(els, "me", async () => "x")).toBe(els);
  });
});
