// Splitting a function call into its argument texts, for Insert ▸ Function:
// the wizard opens on the active cell's formula (possibly half typed) and
// fills one field per argument.

export type CallError = null | "parentheses" | "operand";

export interface ParsedCall {
  /** Function name, upper case ("" when the text is not a call). */
  name: string;
  /** Raw text of each top-level argument, trimmed. */
  args: string[];
  /** "operand": the text stops where an argument is expected ("SUM(", "SUM(A1,");
   *  "parentheses": the call is not closed ("SUM(A1"). */
  error: CallError;
}

/**
 * parseFunctionCall reads "=NAME(arg1, arg2, …)" (the "=" is optional).
 * Arguments are split on top-level commas or semicolons only: commas inside
 * quotes, nested calls, parentheses and array constants stay in their
 * argument. An empty argument inside a closed call is kept as "".
 */
export function parseFunctionCall(text: string): ParsedCall {
  const s = text.trim().replace(/^=/, "").trimStart();
  const m = /^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(s);
  if (!m) return { name: "", args: [], error: null };
  const name = m[1].toUpperCase();
  const args: string[] = [];
  let depth = 0; // nesting inside the call's own parentheses
  let cur = "";
  let closed = false;
  let i = m[0].length;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      // A string, with "" as an escaped quote.
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') j += 2;
          else break;
        } else j++;
      }
      cur += s.slice(i, Math.min(j + 1, s.length));
      i = j;
      continue;
    }
    if (ch === "'") {
      // A quoted sheet name.
      const j = s.indexOf("'", i + 1);
      const end = j < 0 ? s.length - 1 : j;
      cur += s.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") {
      if (depth === 0 && ch === ")") {
        closed = true;
        break;
      }
      depth--;
    } else if ((ch === "," || ch === ";") && depth === 0) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  args.push(cur.trim());
  let error: CallError = null;
  if (!closed) error = args[args.length - 1] === "" ? "operand" : "parentheses";
  return { name, args, error };
}

/**
 * buildFunctionCall writes "=NAME(a, b)". Trailing empty arguments are
 * dropped (they are the optional ones the user left blank); empty ones in the
 * middle stay, as omitted arguments.
 */
export function buildFunctionCall(name: string, args: string[]): string {
  const list = args.map((a) => a.trim());
  while (list.length && list[list.length - 1] === "") list.pop();
  return `=${name.toUpperCase()}(${list.join(",")})`;
}
