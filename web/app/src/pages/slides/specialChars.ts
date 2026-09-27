// Insert ▸ Special characters: a small categorised symbol table with names
// for search. Plain data; the picker is SpecialCharsDialog.tsx.

export interface SpecialChar {
  ch: string;
  name: string;
}

export interface CharCategory {
  label: string;
  chars: SpecialChar[];
}

const c = (spec: string): SpecialChar[] =>
  spec
    .trim()
    .split("\n")
    .map((line) => {
      const [ch, ...name] = line.trim().split(" ");
      return { ch, name: name.join(" ") };
    });

export const CHAR_CATEGORIES: CharCategory[] = [
  {
    label: "Punctuation",
    chars: c(`
– en dash
— em dash
… horizontal ellipsis
‘ left single quotation mark
’ right single quotation mark
“ left double quotation mark
” right double quotation mark
« left guillemet
» right guillemet
• bullet
· middle dot
¶ pilcrow sign
§ section sign
† dagger
‡ double dagger
¡ inverted exclamation mark
¿ inverted question mark
‰ per mille sign
′ prime
″ double prime`),
  },
  {
    label: "Symbols",
    chars: c(`
© copyright sign
® registered sign
™ trade mark sign
° degree sign
℃ degree celsius
℉ degree fahrenheit
№ numero sign
℗ sound recording copyright
✓ check mark
✗ ballot x
★ black star
☆ white star
♥ black heart suit
♦ black diamond suit
♣ black club suit
♠ black spade suit
☺ white smiling face
☎ black telephone
✉ envelope
⚠ warning sign`),
  },
  {
    label: "Currency",
    chars: c(`
€ euro sign
£ pound sign
¥ yen sign
¢ cent sign
$ dollar sign
₹ indian rupee sign
₽ ruble sign
₩ won sign
₪ new sheqel sign
₿ bitcoin sign
₺ turkish lira sign
₫ dong sign
฿ baht sign
¤ currency sign`),
  },
  {
    label: "Math",
    chars: c(`
± plus-minus sign
× multiplication sign
÷ division sign
≠ not equal to
≈ almost equal to
≤ less-than or equal to
≥ greater-than or equal to
∞ infinity
√ square root
∑ n-ary summation
∏ n-ary product
∫ integral
∂ partial differential
∆ increment
∈ element of
∉ not an element of
∩ intersection
∪ union
⊂ subset of
∀ for all
∃ there exists
¬ not sign
∧ logical and
∨ logical or
½ vulgar fraction one half
¼ vulgar fraction one quarter
¾ vulgar fraction three quarters
² superscript two
³ superscript three
‰ per mille sign`),
  },
  {
    label: "Arrows",
    chars: c(`
← leftwards arrow
→ rightwards arrow
↑ upwards arrow
↓ downwards arrow
↔ left right arrow
↕ up down arrow
⇐ leftwards double arrow
⇒ rightwards double arrow
⇔ left right double arrow
↩ leftwards arrow with hook
↪ rightwards arrow with hook
➜ heavy round-tipped rightwards arrow
➤ black rightwards arrowhead
⟶ long rightwards arrow`),
  },
  {
    label: "Greek",
    chars: c(`
α alpha
β beta
γ gamma
δ delta
ε epsilon
θ theta
λ lambda
μ mu
π pi
σ sigma
τ tau
φ phi
ω omega
Γ capital gamma
Δ capital delta
Θ capital theta
Λ capital lambda
Π capital pi
Σ capital sigma
Φ capital phi
Ω capital omega`),
  },
  {
    label: "Latin",
    chars: c(`
à a with grave
á a with acute
â a with circumflex
ä a with diaeresis
ã a with tilde
å a with ring above
æ ae
ç c with cedilla
è e with grave
é e with acute
ê e with circumflex
ë e with diaeresis
ì i with grave
í i with acute
ñ n with tilde
ò o with grave
ó o with acute
ö o with diaeresis
ø o with stroke
œ oe
ß sharp s
ù u with grave
ú u with acute
ü u with diaeresis
ÿ y with diaeresis`),
  },
  {
    label: "Spaces",
    chars: [
      { ch: " ", name: "no-break space" },
      { ch: " ", name: "en space" },
      { ch: " ", name: "em space" },
      { ch: " ", name: "thin space" },
      { ch: "­", name: "soft hyphen" },
      { ch: "‑", name: "non-breaking hyphen" },
    ],
  },
];

/** searchChars finds characters by name (all words must match) or by the
 *  character itself / its U+ code. */
export function searchChars(query: string): SpecialChar[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const seen = new Set<string>();
  const out: SpecialChar[] = [];
  for (const cat of CHAR_CATEGORIES)
    for (const s of cat.chars) {
      const code = "u+" + s.ch.codePointAt(0)!.toString(16).padStart(4, "0");
      const hit = s.ch === query.trim() || code === q || words.every((w) => s.name.includes(w));
      if (hit && !seen.has(s.ch)) {
        seen.add(s.ch);
        out.push(s);
      }
    }
  return out;
}

/** Label for a character tile's tooltip, e.g. "euro sign (U+20AC)". */
export function charLabel(s: SpecialChar): string {
  return `${s.name} (U+${s.ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`;
}
