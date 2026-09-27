// The shared font bundle (CC7 part 2), used by the Docs, Sheets and Slides
// font pickers and by their DOCX / XLSX / PPTX importers.
//
// A small set of open fonts is served from /fonts (woff2, latin +
// latin-ext subsets, 400/700 roman/italic; see public/fonts/README.md):
// Noto Sans / Serif / Sans Mono, and the metric-compatible Carlito
// (Calibri), Caladea (Cambria) and Arimo / Tinos / Cousine (Arial / Times
// New Roman / Courier New; Liberation Sans / Serif / Mono 2.x are these
// designs under the Liberation names, so those names map to the same
// files).
//
// Documents keep the font names they were written with (so export writes
// "Calibri" back). `installFonts()` declares @font-face rules for every
// name in FONT_FALLBACKS whose first source is the locally installed font
// (`local("Calibri")`) and whose fallback is the bundled substitute, so an
// imported Word document renders with metrically identical text on
// machines without Microsoft's fonts. Faces only download when used.

export type FontCategory = "sans" | "serif" | "mono";

export interface BundledFont {
  family: string;
  /** Directory under /fonts. */
  slug: string;
  category: FontCategory;
  italic: boolean;
  /** SPDX licence id (full texts in public/fonts/<slug>/LICENSE.txt). */
  licence: string;
}

export const BUNDLED_FONTS: BundledFont[] = [
  { family: "Noto Sans", slug: "noto-sans", category: "sans", italic: true, licence: "OFL-1.1" },
  { family: "Noto Serif", slug: "noto-serif", category: "serif", italic: true, licence: "OFL-1.1" },
  { family: "Noto Sans Mono", slug: "noto-sans-mono", category: "mono", italic: false, licence: "OFL-1.1" },
  { family: "Carlito", slug: "carlito", category: "sans", italic: true, licence: "OFL-1.1" },
  { family: "Caladea", slug: "caladea", category: "serif", italic: true, licence: "OFL-1.1" },
  { family: "Arimo", slug: "arimo", category: "sans", italic: true, licence: "OFL-1.1" },
  { family: "Tinos", slug: "tinos", category: "serif", italic: true, licence: "OFL-1.1" },
  { family: "Cousine", slug: "cousine", category: "mono", italic: true, licence: "OFL-1.1" },
];

/** Names served by a bundled font's files under another name. */
export const FONT_ALIASES: Record<string, string> = {
  "Liberation Sans": "Arimo",
  "Liberation Serif": "Tinos",
  "Liberation Mono": "Cousine",
};

/**
 * FONT_FALLBACKS: a font a document may name -> the bundled font that
 * renders it when the machine doesn't have it. `metric: true` marks a
 * metric-compatible substitute (same advance widths, so line breaks and
 * page counts match); the others only share the style.
 */
export const FONT_FALLBACKS: Record<string, { font: string; metric: boolean }> = {
  Calibri: { font: "Carlito", metric: true },
  "Calibri Light": { font: "Carlito", metric: false },
  Cambria: { font: "Caladea", metric: true },
  Arial: { font: "Liberation Sans", metric: true },
  Helvetica: { font: "Liberation Sans", metric: true },
  "Helvetica Neue": { font: "Liberation Sans", metric: false },
  "Arial Nova": { font: "Liberation Sans", metric: false },
  "Times New Roman": { font: "Liberation Serif", metric: true },
  Times: { font: "Liberation Serif", metric: true },
  "Courier New": { font: "Liberation Mono", metric: true },
  Courier: { font: "Liberation Mono", metric: true },
  Consolas: { font: "Liberation Mono", metric: false },
  "Segoe UI": { font: "Noto Sans", metric: false },
  Aptos: { font: "Noto Sans", metric: false },
  Tahoma: { font: "Noto Sans", metric: false },
  Verdana: { font: "Noto Sans", metric: false },
  "Trebuchet MS": { font: "Noto Sans", metric: false },
  "Century Gothic": { font: "Noto Sans", metric: false },
  Georgia: { font: "Noto Serif", metric: false },
  Garamond: { font: "Noto Serif", metric: false },
  "Book Antiqua": { font: "Noto Serif", metric: false },
  "Palatino Linotype": { font: "Noto Serif", metric: false },
  "Lucida Console": { font: "Liberation Mono", metric: false },
};

/** The one font list every picker offers (Docs, Sheets, Slides). */
export const PICKER_FONTS = [
  "Arial",
  "Calibri",
  "Cambria",
  "Courier New",
  "Georgia",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Carlito",
  "Caladea",
  "Liberation Sans",
  "Liberation Serif",
  "Liberation Mono",
  "Noto Sans",
  "Noto Serif",
  "Noto Sans Mono",
];

const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

const bundled = (family: string): BundledFont | undefined => {
  const target = FONT_ALIASES[family] ?? family;
  return BUNDLED_FONTS.find((f) => f.family === target);
};

/** Strip quotes and fallbacks: `"Calibri", sans-serif` -> `Calibri`. */
export function primaryFamily(css: string | null | undefined): string {
  if (!css) return "";
  return css.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

/** The bundled font that renders `family` ("" when none). */
export function substituteFor(family: string): string {
  const f = primaryFamily(family);
  if (bundled(f)) return FONT_ALIASES[f] ?? f;
  const fb = FONT_FALLBACKS[f];
  if (!fb) return "";
  return FONT_ALIASES[fb.font] ?? fb.font;
}

/** Generic CSS family for a font name (for stacks). */
export function fontCategory(family: string): FontCategory {
  const f = primaryFamily(family);
  const b = bundled(substituteFor(f) || f);
  if (b) return b.category;
  if (/mono|courier|consol|code/i.test(f)) return "mono";
  if (/serif|times|georgia|garamond|cambria|roman|book|palatino|minion/i.test(f) && !/sans/i.test(f)) return "serif";
  return "sans";
}

/** fontStack: a CSS font-family value that renders `family` or its
 *  substitute, then a generic family. */
export function fontStack(family: string): string {
  const f = primaryFamily(family);
  if (!f) return "";
  const q = (s: string) => (/^[\w-]+$/.test(s) ? s : `"${s}"`);
  const sub = substituteFor(f);
  const generic = { sans: "sans-serif", serif: "serif", mono: "monospace" }[fontCategory(f)];
  return [q(f), ...(sub && sub !== f ? [q(sub)] : []), generic].join(", ");
}

/**
 * resolveImportedFont: the font name an importer stores for a name found
 * in a DOCX / XLSX / PPTX. Theme placeholders (`+mn-lt`) and quoted or
 * listed values are normalised; the name itself is kept (export writes it
 * back), and its fallback face is installed so it renders with the
 * metric-compatible substitute.
 */
export function resolveImportedFont(name: string | null | undefined, theme: { major?: string; minor?: string } = {}): string {
  let f = primaryFamily(name);
  if (/^\+m[jn]-/.test(f)) f = (f.startsWith("+mj") ? theme.major : theme.minor) ?? "";
  if (!f) return "";
  if (FONT_FALLBACKS[f] || bundled(f)) installFonts();
  return f;
}

// --- @font-face ----------------------------------------------------------------------------

type Style = { weight: 400 | 700; style: "normal" | "italic" };
const STYLES: Style[] = [
  { weight: 400, style: "normal" },
  { weight: 700, style: "normal" },
  { weight: 400, style: "italic" },
  { weight: 700, style: "italic" },
];

/** fontFaceCss builds the @font-face rules (pure; `base` is the URL
 *  prefix of /fonts). */
export function fontFaceCss(base = "/fonts"): string {
  const rules: string[] = [];
  const face = (family: string, b: BundledFont, s: Style, local: string[]) => {
    if (s.style === "italic" && !b.italic) return;
    for (const [subset, range] of [
      ["latin", LATIN],
      ["latin-ext", LATIN_EXT],
    ] as const) {
      const src = [...local.map((l) => `local("${l}")`), `url(${base}/${b.slug}/${subset}-${s.weight}-${s.style}.woff2) format("woff2")`].join(", ");
      rules.push(`@font-face{font-family:"${family}";font-style:${s.style};font-weight:${s.weight};font-display:swap;src:${src};unicode-range:${range}}`);
    }
  };
  const localNames = (family: string, s: Style) => {
    const suffix = s.weight === 700 ? (s.style === "italic" ? " Bold Italic" : " Bold") : s.style === "italic" ? " Italic" : "";
    return [...new Set([family + suffix, family.replace(/\s+/g, "") + (suffix ? `-${suffix.trim().replace(/\s+/g, "")}` : "")])];
  };
  for (const b of BUNDLED_FONTS) for (const s of STYLES) face(b.family, b, s, []);
  for (const [alias, target] of Object.entries(FONT_ALIASES)) {
    const b = bundled(target)!;
    for (const s of STYLES) face(alias, b, s, localNames(alias, s));
  }
  for (const [name, fb] of Object.entries(FONT_FALLBACKS)) {
    const b = bundled(fb.font);
    if (!b) continue;
    for (const s of STYLES) face(name, b, s, localNames(name, s));
  }
  return rules.join("\n");
}

let installed = false;

/** installFonts adds the @font-face rules to the page once. */
export function installFonts(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const el = document.createElement("style");
  el.id = "grown-font-bundle";
  el.textContent = fontFaceCss();
  document.head.appendChild(el);
}

/** loadFonts waits for the faces a canvas renderer (Sheets) needs; the
 *  DOM loads faces on use, a canvas doesn't. */
export async function loadFonts(families: Iterable<string>): Promise<void> {
  installFonts();
  const fonts = typeof document !== "undefined" ? (document as Document & { fonts?: FontFaceSet }).fonts : undefined;
  if (!fonts?.load) return;
  const jobs: Promise<unknown>[] = [];
  for (const f of new Set(families)) {
    const fam = primaryFamily(f);
    if (!fam || (!FONT_FALLBACKS[fam] && !bundled(fam))) continue;
    for (const w of ["400", "700"]) jobs.push(fonts.load(`${w} 16px "${fam}"`).catch(() => []));
  }
  await Promise.all(jobs);
}
