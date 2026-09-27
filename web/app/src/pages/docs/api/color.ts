// ApiColor for the Docs scripting API (M13): a colour that is automatic,
// a theme slot, or an RGB(A) value, with a JSON form so scripts and
// plugins can pass colours across the message boundary.

export type ThemeSlot = "dk1" | "lt1" | "dk2" | "lt2" | "accent1" | "accent2" | "accent3" | "accent4" | "accent5" | "accent6" | "hlink" | "folHlink";

/** Word's default ("Office 2007-2010") theme colours, which the document
 *  uses until it carries a theme of its own. */
export const DEFAULT_THEME: Record<ThemeSlot, string> = {
  dk1: "#000000",
  lt1: "#FFFFFF",
  dk2: "#1F497D",
  lt2: "#EEECE1",
  accent1: "#4F81BD",
  accent2: "#C0504D",
  accent3: "#9BBB59",
  accent4: "#8064A2",
  accent5: "#4BACC6",
  accent6: "#F79646",
  hlink: "#0000FF",
  folHlink: "#800080",
};

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Rgba extends Rgb {
  a: number;
}

export type ColorJson = { type: "auto" } | { type: "theme"; slot: ThemeSlot } | { type: "rgba"; r: number; g: number; b: number; a: number };

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(Number.isFinite(n) ? n : 0)));

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export class ApiColor {
  private constructor(
    private readonly kind: "auto" | "theme" | "rgba",
    private readonly rgba: Rgba,
    private readonly slot: ThemeSlot | null = null,
  ) {}

  static auto(): ApiColor {
    return new ApiColor("auto", { r: 0, g: 0, b: 0, a: 255 });
  }

  static theme(slot: string, theme: Record<string, string> = DEFAULT_THEME): ApiColor {
    const s = (slot in DEFAULT_THEME ? slot : "dk1") as ThemeSlot;
    const rgb = parseHex(theme[s] ?? DEFAULT_THEME[s]) ?? { r: 0, g: 0, b: 0 };
    return new ApiColor("theme", { ...rgb, a: 255 }, s);
  }

  static rgb(r: number, g: number, b: number, a = 255): ApiColor {
    return new ApiColor("rgba", { r: clamp(r), g: clamp(g), b: clamp(b), a: clamp(a) });
  }

  /** Invalid hex reads as black (as OnlyOffice's HexColor does). */
  static hex(hex: string): ApiColor {
    const rgb = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
    return ApiColor.rgb(rgb.r, rgb.g, rgb.b);
  }

  static fromJSON(json: ColorJson | string): ApiColor {
    const j = (typeof json === "string" ? JSON.parse(json) : json) as ColorJson;
    if (j.type === "auto") return ApiColor.auto();
    if (j.type === "theme") return ApiColor.theme(j.slot);
    return ApiColor.rgb(j.r, j.g, j.b, j.a);
  }

  GetClassType(): "color" {
    return "color";
  }
  IsAutoColor(): boolean {
    return this.kind === "auto";
  }
  IsThemeColor(): boolean {
    return this.kind === "theme";
  }
  GetRGB(): Rgb {
    return { r: this.rgba.r, g: this.rgba.g, b: this.rgba.b };
  }
  GetRGBA(): Rgba {
    return { ...this.rgba };
  }
  GetHex(): string {
    const h = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
    return `#${h(this.rgba.r)}${h(this.rgba.g)}${h(this.rgba.b)}`;
  }
  ToJSON(): string {
    const j: ColorJson = this.kind === "auto" ? { type: "auto" } : this.kind === "theme" ? { type: "theme", slot: this.slot! } : { type: "rgba", ...this.rgba };
    return JSON.stringify(j);
  }
  /** CSS colour for applying to text (auto -> null: inherit). */
  toCss(): string | null {
    return this.kind === "auto" ? null : this.GetHex().toLowerCase();
  }
}
