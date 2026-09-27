// Deck themes (M7): a colour scheme plus a font scheme, as data.
//
// Elements keep literal colours and fonts (every renderer and export reads
// hex/family values as before). An element that took a value from the
// theme records where it came from in `themeRefs` — a scheme slot such as
// "accent1" or "tx1" (optionally with DrawingML modifiers,
// "accent1/lumMod:75000/lumOff:25000") or a font role ("major"/"minor").
// Changing the theme re-resolves only those references, so explicit
// colours and fonts are kept. This is the "themes as data" alternative to
// a master editor (flagged exception F3).

import {
  isColorModName,
  parseHex,
  resolveColor,
  toHex,
  type ColorMod,
} from "../../lib/colorMods";
import type {
  DeckDoc,
  DeckTheme,
  Slide,
  SlideElement,
  SlideLayout,
  ThemeColors,
  ThemeRefs,
} from "./model";

/** The scheme slots, in PowerPoint's palette order. */
export const SCHEME_SLOTS: (keyof ThemeColors)[] = [
  "lt1",
  "dk1",
  "lt2",
  "dk2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
];

export const SLOT_LABELS: Record<keyof ThemeColors, string> = {
  dk1: "Dark 1",
  lt1: "Light 1",
  dk2: "Dark 2",
  lt2: "Light 2",
  accent1: "Accent 1",
  accent2: "Accent 2",
  accent3: "Accent 3",
  accent4: "Accent 4",
  accent5: "Accent 5",
  accent6: "Accent 6",
  hlink: "Hyperlink",
  folHlink: "Followed hyperlink",
};

const t = (
  id: string,
  name: string,
  fonts: [string, string],
  c: string[],
  dark = false,
): DeckTheme => ({
  id,
  name,
  fonts: { major: fonts[0], minor: fonts[1] },
  colors: {
    dk1: c[0],
    lt1: c[1],
    dk2: c[2],
    lt2: c[3],
    accent1: c[4],
    accent2: c[5],
    accent3: c[6],
    accent4: c[7],
    accent5: c[8],
    accent6: c[9],
    hlink: c[10],
    folHlink: c[11],
  },
  ...(dark ? { dark: true } : {}),
});

/** The implicit theme of a deck without one: the Office 2013+ colour
 *  scheme (the table styles' historic colours) with Arial, Grown's
 *  default font. */
export const OFFICE_THEME: DeckTheme = t("office", "Office", ["Arial", "Arial"], [
  "#000000", "#ffffff", "#44546a", "#e7e6e6",
  "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47",
  "#0563c1", "#954f72",
]);

/** Built-in theme gallery (Slide ▸ Change theme). */
export const BUILTIN_THEMES: DeckTheme[] = [
  OFFICE_THEME,
  t("simple-light", "Simple Light", ["Arial", "Arial"], [
    "#202124", "#ffffff", "#3c4043", "#f1f3f4",
    "#4285f4", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6",
    "#1a73e8", "#681da8",
  ]),
  t("simple-dark", "Simple Dark", ["Arial", "Arial"], [
    "#202124", "#ffffff", "#303134", "#e8eaed",
    "#8ab4f8", "#f28b82", "#fdd663", "#81c995", "#fcad70", "#78d9ec",
    "#8ab4f8", "#c58af9",
  ], true),
  t("streamline", "Streamline", ["Georgia", "Verdana"], [
    "#1b2a41", "#ffffff", "#324a5f", "#eef2f6",
    "#0c7c8c", "#e4572e", "#76b041", "#ffc914", "#2e86ab", "#a23b72",
    "#0c7c8c", "#6c4675",
  ]),
  t("focus", "Focus", ["Trebuchet MS", "Verdana"], [
    "#111827", "#ffffff", "#1f2937", "#f3f4f6",
    "#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#10b981",
    "#818cf8", "#c084fc",
  ], true),
  t("coral", "Coral", ["Georgia", "Arial"], [
    "#3d2c2e", "#fffaf5", "#5e3b3f", "#fbe9df",
    "#f25f5c", "#ffa62b", "#247ba0", "#70c1b3", "#50514f", "#b56576",
    "#247ba0", "#6d597a",
  ]),
  t("forest", "Forest", ["Verdana", "Verdana"], [
    "#1e2d24", "#fbfdf9", "#2f4b3a", "#e7efe4",
    "#2d6a4f", "#95d5b2", "#d4a373", "#6c584c", "#40916c", "#b7b7a4",
    "#2d6a4f", "#6c584c",
  ]),
  t("slate", "Slate", ["Courier New", "Verdana"], [
    "#0f172a", "#f8fafc", "#1e293b", "#cbd5e1",
    "#38bdf8", "#f472b6", "#a3e635", "#facc15", "#fb923c", "#a78bfa",
    "#7dd3fc", "#f0abfc",
  ], true),
];

export function findTheme(id: string): DeckTheme | undefined {
  return BUILTIN_THEMES.find((x) => x.id === id);
}

/** The deck's theme (the Office theme when it has none). */
export function themeOf(deck: Pick<DeckDoc, "theme"> | null | undefined): DeckTheme {
  return deck?.theme ?? OFFICE_THEME;
}

/** Slot a clrMap alias (bg1/tx1/bg2/tx2) resolves to under a theme. */
export function mapSlot(name: string, theme: DeckTheme): keyof ThemeColors | undefined {
  const dark = !!theme.dark;
  switch (name) {
    case "bg1":
      return dark ? "dk1" : "lt1";
    case "tx1":
      return dark ? "lt1" : "dk1";
    case "bg2":
      return dark ? "dk2" : "lt2";
    case "tx2":
      return dark ? "lt2" : "dk2";
  }
  return name in theme.colors ? (name as keyof ThemeColors) : undefined;
}

export interface ParsedRef {
  slot: string;
  mods: ColorMod[];
}

/** Parse "accent1/lumMod:75000/lumOff:25000". Null for a malformed ref. */
export function parseRef(ref: string): ParsedRef | null {
  const [slot, ...rest] = ref.split("/");
  if (!/^(dk[12]|lt[12]|bg[12]|tx[12]|accent[1-6]|hlink|folHlink)$/.test(slot)) return null;
  const mods: ColorMod[] = [];
  for (const m of rest) {
    const [name, v] = m.split(":");
    if (!isColorModName(name)) return null;
    if (v === undefined || v === "") mods.push({ name });
    else {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      mods.push({ name, val: n });
    }
  }
  return { slot, mods };
}

/** Build a ref string from a slot and its modifiers. */
export function formatRef(slot: string, mods: readonly ColorMod[] = []): string {
  return [slot, ...mods.map((m) => (m.val === undefined ? m.name : `${m.name}:${m.val}`))].join("/");
}

/** Resolve a colour ref under a theme; undefined for a malformed ref. */
export function resolveRef(ref: string, theme: DeckTheme): string | undefined {
  const p = parseRef(ref);
  if (!p) return undefined;
  const slot = mapSlot(p.slot, theme);
  if (!slot) return undefined;
  if (!p.mods.length) return theme.colors[slot].toLowerCase();
  return toHex(
    resolveColor({ scheme: slot, mods: p.mods }, (n) =>
      n in theme.colors ? theme.colors[n as keyof ThemeColors].replace("#", "") : undefined,
    ),
  );
}

/** Theme font for a role. */
export function themeFont(role: "major" | "minor", theme: DeckTheme): string {
  return role === "major" ? theme.fonts.major : theme.fonts.minor;
}

/** A lighter/darker variant ref of a slot, like PowerPoint's palette rows:
 *  `k` > 0 lightens (lumMod/lumOff), `k` < 0 darkens (lumMod). */
export function shadeRef(slot: string, k: number): string {
  if (!k) return slot;
  if (k > 0)
    return formatRef(slot, [
      { name: "lumMod", val: Math.round((1 - k) * 100000) },
      { name: "lumOff", val: Math.round(k * 100000) },
    ]);
  return formatRef(slot, [{ name: "lumMod", val: Math.round((1 + k) * 100000) }]);
}

/** The palette rows shown in a theme colour picker: base slots + 4 tints/shades. */
export const PALETTE_SHADES = [0, 0.8, 0.6, 0.4, -0.25, -0.5];
export const PALETTE_SLOTS = ["bg1", "tx1", "bg2", "tx2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];

// ------------------------------------------------------------ applying

/** Re-resolve an element's refs (and its group members') under `theme`. */
export function restyleElement(el: SlideElement, theme: DeckTheme): SlideElement {
  let out = el;
  const refs = el.themeRefs;
  if (refs) {
    const patch: Partial<SlideElement> = {};
    for (const k of ["fill", "stroke", "color"] as const) {
      const r = refs[k];
      if (!r) continue;
      const v = resolveRef(r, theme);
      if (v && v !== el[k]) patch[k] = v;
    }
    if (refs.font) {
      const f = themeFont(refs.font, theme);
      if (f !== el.fontFamily) patch.fontFamily = f;
    }
    if (Object.keys(patch).length) out = { ...el, ...patch };
  }
  if (el.children?.length) {
    const kids = el.children.map((c) => restyleElement(c, theme));
    if (kids.some((c, i) => c !== el.children![i])) out = { ...out, children: kids };
  }
  return out;
}

function restyleBg<T extends { background?: string; bgRef?: string }>(s: T, theme: DeckTheme): T {
  if (!s.bgRef) return s;
  const v = resolveRef(s.bgRef, theme);
  return v && v !== s.background ? { ...s, background: v } : s;
}

export function restyleSlide(s: Slide, theme: DeckTheme): Slide {
  const els = s.elements.map((e) => restyleElement(e, theme));
  const changed = els.some((e, i) => e !== s.elements[i]);
  const bg = restyleBg(s, theme);
  return changed ? { ...bg, elements: els } : bg;
}

export function restyleLayout(l: SlideLayout, theme: DeckTheme): SlideLayout {
  const els = l.elements.map((e) => restyleElement(e, theme));
  return { ...restyleBg(l, theme), elements: els };
}

/** applyTheme sets the deck theme and re-resolves every theme reference in
 *  slides and layouts. Explicit colours/fonts are left alone. */
export function applyTheme(deck: DeckDoc, theme: DeckTheme): DeckDoc {
  return {
    ...deck,
    theme,
    slides: deck.slides.map((s) => restyleSlide(s, theme)),
    ...(deck.layouts ? { layouts: deck.layouts.map((l) => restyleLayout(l, theme)) } : {}),
  };
}

const REF_PROPS: [keyof ThemeRefs, keyof SlideElement][] = [
  ["fill", "fill"],
  ["stroke", "stroke"],
  ["color", "color"],
  ["font", "fontFamily"],
];

/** reconcileRefs drops the refs of properties an edit changed to an
 *  explicit value (a picked hex colour, a chosen font), so a later theme
 *  change keeps them. An edit that set a new ref along with the value
 *  keeps it. */
export function reconcileRefs(prev: SlideElement | undefined, next: SlideElement): SlideElement {
  const refs = next.themeRefs;
  if (!prev || !refs) return next;
  const out: ThemeRefs = { ...refs };
  let changed = false;
  for (const [rk, pk] of REF_PROPS) {
    if (!out[rk]) continue;
    const sameRef = prev.themeRefs?.[rk] === out[rk];
    if (sameRef && prev[pk] !== next[pk]) {
      delete out[rk];
      changed = true;
    }
  }
  if (!changed) return next;
  const res = { ...next };
  if (Object.keys(out).length) res.themeRefs = out;
  else delete res.themeRefs;
  return res;
}

/** setRef sets a property to a theme colour: the resolved value plus its ref. */
export function withColorRef(
  el: SlideElement,
  prop: "fill" | "stroke" | "color",
  ref: string,
  theme: DeckTheme,
): SlideElement {
  const v = resolveRef(ref, theme);
  if (!v) return el;
  return { ...el, [prop]: v, themeRefs: { ...el.themeRefs, [prop]: ref } };
}

/** withFontRef sets the font to a theme role. */
export function withFontRef(el: SlideElement, role: "major" | "minor", theme: DeckTheme): SlideElement {
  return { ...el, fontFamily: themeFont(role, theme), themeRefs: { ...el.themeRefs, font: role } };
}

/** Relative luminance-ish check used to pick readable prompt colours. */
export function isDark(hex: string): boolean {
  const c = parseHex(hex);
  if (!c) return false;
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 128;
}

// ------------------------------------------------------------ active theme

// The theme of the open deck, for renderers that have no deck at hand
// (table style colours). Set by the editor alongside setCanvasSize.
let active: DeckTheme = OFFICE_THEME;
const listeners = new Set<() => void>();

export function setActiveTheme(theme: DeckTheme | undefined): void {
  const next = theme ?? OFFICE_THEME;
  if (next === active) return;
  active = next;
  for (const f of listeners) f();
}

export function activeTheme(): DeckTheme {
  return active;
}

export function onActiveTheme(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
