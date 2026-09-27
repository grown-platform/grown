// Delimited-text parsing for paste-from-text and CSV import.
//
// Behaviour follows Excel's text import (and OnlyOffice's parseText): one
// record per line (\n, \r\n or \r), fields split on the delimiter, and when a
// text qualifier is set, qualified fields may hold delimiters, line breaks
// (normalised to \n) and doubled qualifiers as a literal qualifier.

export interface CsvOptions {
  /** Field delimiter; "" or null keeps each line as a single field. */
  delimiter?: string | null;
  /** Text qualifier (default '"'); null turns quoting off. */
  qualifier?: string | null;
}

/**
 * parseDelimited splits text into rows of fields. A trailing line break does
 * not add an empty row; an empty line in the middle is a row with one empty
 * field; empty input is a single row with no fields.
 */
export function parseDelimited(text: string, opts: CsvOptions = {}): string[][] {
  const delim = opts.delimiter ?? "";
  const q = opts.qualifier === undefined ? '"' : opts.qualifier;
  if (text === "") return [[]];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  // True right after a delimiter or line start: a qualifier here opens a quoted field.
  let atFieldStart = true;
  const n = text.length;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
    atFieldStart = true;
  };
  while (i < n) {
    const ch = text[i];
    if (q && ch === q && atFieldStart) {
      // Quoted field: runs to the next lone qualifier.
      i++;
      while (i < n) {
        if (text[i] === q) {
          if (text[i + 1] === q) {
            field += q;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (text[i] === "\r") {
          field += "\n";
          i += text[i + 1] === "\n" ? 2 : 1;
          continue;
        }
        field += text[i++];
      }
      atFieldStart = false;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      endRow();
      continue;
    }
    if (delim && text.startsWith(delim, i)) {
      row.push(field);
      field = "";
      i += delim.length;
      atFieldStart = true;
      continue;
    }
    field += ch;
    i++;
    atFieldStart = false;
  }
  // Text ending in a line break has already closed its last row.
  const last = text[n - 1];
  if (!(last === "\n" || last === "\r") || field !== "" || row.length) endRow();
  return rows;
}

/** Delimiter guess for pasted text: tab beats comma beats semicolon; none when no candidate appears. */
export function guessDelimiter(text: string): string {
  const sample = text.split(/\r\n|\r|\n/).slice(0, 20);
  for (const d of ["\t", ",", ";", "|"]) {
    if (sample.some((l) => l.includes(d))) return d;
  }
  return "";
}
