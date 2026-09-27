// Typed input that starts with + or - is a formula when it is not a number
// ("+5+5" → =5+5, "-A1" → =-A1), as in Excel and OnlyOffice; other text is
// left alone. The formula drops a unary + written right before a number
// (=+5 → =5, "++1" → =+1) and closes parentheses left open ("-SUM(1,2" →
// =-SUM(1,2)). Text with spaces ("- buy milk") stays text.

import { parseInput } from "./numberFormat";

const UNARY_BEFORE = new Set(["=", "+", "-", "*", "/", "^", "&", "(", ",", ";", "<", ">", "{", "%"]);

/** Removes each unary + that directly precedes a number literal. */
export function dropUnaryPlus(formula: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (ch === '"') inStr = !inStr;
    if (!inStr && ch === "+" && /[0-9.]/.test(formula[i + 1] ?? "")) {
      let j = out.length - 1;
      while (j >= 0 && out[j] === " ") j--;
      const prev = j >= 0 ? out[j] : "=";
      if (UNARY_BEFORE.has(prev)) continue;
    }
    out += ch;
  }
  return out;
}

/** Appends the ) a formula leaves open (outside strings). */
export function closeParens(formula: string): string {
  let depth = 0;
  let inStr = false;
  for (const ch of formula) {
    if (ch === '"') inStr = !inStr;
    else if (!inStr && ch === "(") depth++;
    else if (!inStr && ch === ")") depth = Math.max(0, depth - 1);
  }
  return depth > 0 ? formula + ")".repeat(depth) : formula;
}

/**
 * The formula typed input stands for: the input itself when it starts with
 * "=", "=" + the normalised expression for a +/- expression, or null when it
 * is a value or text.
 */
export function entryToFormula(raw: string): string | null {
  const t = raw.trim();
  if (t.startsWith("=")) return t;
  if (!/^[+-]/.test(t) || t.length < 2) return null;
  if (parseInput(t)) return null; // a number: +5, -5, -5%, -$5 …
  if (/\s/.test(t.replace(/"[^"]*"/g, '""'))) return null;
  const body = t.replace(/^[+-]+/, "");
  if (!body || !/^[0-9.A-Za-z_$@({"#']/.test(body)) return null;
  return closeParens(dropUnaryPlus(`=${t}`));
}
