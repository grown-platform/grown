import { afterEach, describe, expect, it } from "vitest";
import { collectCss, inlineResources, mediaMatches, pageSvg, splitSelectors } from "./domPdf";

afterEach(() => {
  document.head.querySelectorAll("style[data-test]").forEach((s) => s.remove());
  document.body.innerHTML = "";
});

function addStyle(css: string) {
  const s = document.createElement("style");
  s.dataset.test = "1";
  s.textContent = css;
  document.head.appendChild(s);
}

describe("domPdf", () => {
  it("splits selector lists at top-level commas only", () => {
    expect(splitSelectors("a, b:is(.x, .y) > c, [data-a='1,2']")).toEqual(["a", "b:is(.x, .y) > c", "[data-a='1,2']"]);
  });

  it("reads print/screen as the export medium", () => {
    expect(mediaMatches("print", window, true)).toBe(true);
    expect(mediaMatches("print", window, false)).toBe(false);
    expect(mediaMatches("screen", window, true)).toBe(false);
    expect(mediaMatches("all", window, false)).toBe(true);
    expect(mediaMatches("not print", window, true)).toBe(false);
  });

  it("keeps only the rules that apply to the pages, with their pseudo-elements", async () => {
    addStyle(`
      .page p { color: red; }
      .elsewhere { color: blue; }
      .page p::before { content: "x"; }
      .page p:hover { color: green; }
      :root { --accent: #123456; }
      @media print { .page p { font-weight: bold; } }
      @media screen { .page p { font-style: italic; } }
    `);
    const host = document.createElement("div");
    host.innerHTML = `<div class="page"><p>Hi</p></div>`;
    document.body.appendChild(host);
    const css = await collectCss(host, true);
    expect(css).toContain(".page p {color: red;}".replace(" {", "{"));
    expect(css).toContain("::before");
    expect(css).toContain("--accent");
    expect(css).toMatch(/html\s*\{/);
    expect(css).toContain("font-weight: bold");
    expect(css).not.toContain("italic");
    expect(css).not.toContain("blue");
    expect(css).not.toContain("green");
  });

  it("writes form state as attributes and wraps a page in well-formed SVG", async () => {
    const page = document.createElement("div");
    page.innerHTML = `<input type="checkbox"><p>a < b & "c"</p>`;
    (page.querySelector("input") as HTMLInputElement).checked = true;
    document.body.appendChild(page);
    await inlineResources(page);
    expect(page.querySelector("input")!.hasAttribute("checked")).toBe(true);
    const svg = pageSvg(page, "p::after{content:']]>'}", 816, 1056, 1632, 2112);
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(svg).toContain('viewBox="0 0 816 1056"');
    expect(parsed.documentElement.textContent).toContain("a < b & \"c\"");
  });
});
