/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet workbook model is loosely typed. */

export type SheetFormat = "xlsx" | "ods" | "pdf" | "html" | "csv" | "tsv";

// Mirrors Google Sheets' File → Download menu.
export const SHEET_DOWNLOAD_FORMATS: { fmt: SheetFormat; label: string }[] = [
  { fmt: "xlsx", label: "Microsoft Excel (.xlsx)" },
  { fmt: "ods", label: "OpenDocument (.ods)" },
  { fmt: "pdf", label: "PDF Document (.pdf)" },
  { fmt: "html", label: "Web Page (.html)" },
  { fmt: "csv", label: "Comma Separated Values (.csv)" },
  { fmt: "tsv", label: "Tab Separated Values (.tsv)" },
];

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Convert one FortuneSheet sheet to a trimmed array-of-arrays of raw values.
function sheetToAoa(sheet: any): any[][] {
  let aoa: any[][] = [];
  const grid = sheet?.data;
  if (Array.isArray(grid) && grid.length) {
    aoa = grid.map((row: any[]) =>
      (row || []).map((c: any) => (c == null ? "" : (c.v ?? c.m ?? ""))),
    );
  } else {
    const cd: any[] = sheet?.celldata || [];
    let maxR = 0,
      maxC = 0;
    cd.forEach((c) => {
      maxR = Math.max(maxR, c.r);
      maxC = Math.max(maxC, c.c);
    });
    aoa = Array.from({ length: maxR + 1 }, () => Array(maxC + 1).fill(""));
    cd.forEach((c) => {
      const v = c.v;
      aoa[c.r][c.c] = v == null ? "" : (v.v ?? v.m ?? "");
    });
  }
  // Trim trailing empty rows and columns so we don't export the full 100×26 blank grid.
  let lastRow = -1,
    lastCol = -1;
  aoa.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v !== "" && v != null) {
        lastRow = Math.max(lastRow, r);
        lastCol = Math.max(lastCol, c);
      }
    }),
  );
  if (lastRow < 0) return [[]];
  return aoa.slice(0, lastRow + 1).map((row) => row.slice(0, lastCol + 1));
}

function aoaToTable(aoa: any[][]): string {
  const rows = aoa
    .map(
      (r) =>
        "<tr>" +
        r.map((c) => `<td>${esc(String(c ?? ""))}</td>`).join("") +
        "</tr>",
    )
    .join("");
  return `<table border="1" cellspacing="0" cellpadding="4">${rows}</table>`;
}

function allSheets(wb: any): any[] {
  try {
    const all = wb?.getAllSheets?.();
    if (Array.isArray(all) && all.length) return all;
  } catch {
    /* ignore */
  }
  try {
    const s = wb?.getSheet?.();
    if (s) return [s];
  } catch {
    /* ignore */
  }
  return [{ name: "Sheet1", data: [] }];
}

function currentSheet(wb: any): any {
  try {
    const s = wb?.getSheet?.();
    if (s) return s;
  } catch {
    /* ignore */
  }
  return allSheets(wb)[0];
}

/**
 * downloadSheet exports the spreadsheet in the requested format. xlsx/ods are
 * produced via SheetJS, csv/tsv/html in-browser, and pdf by routing an HTML
 * table through the backend pandoc/tectonic convert endpoint (shared with Docs).
 */
export async function downloadSheet(
  wb: any,
  title: string,
  fmt: SheetFormat,
): Promise<void> {
  const name = (title || "sheet").replace(/[/\\?%*:|"<>]/g, "-");

  if (fmt === "csv" || fmt === "tsv") {
    const sep = fmt === "tsv" ? "\t" : ",";
    const aoa = sheetToAoa(currentSheet(wb));
    const text = aoa
      .map((row) =>
        row
          .map((v) => {
            const s = String(v ?? "").replace(/"/g, '""');
            return (fmt === "csv" ? /[",\n]/ : /[\t"\n]/).test(s)
              ? `"${s}"`
              : s;
          })
          .join(sep),
      )
      .join("\n");
    triggerDownload(
      new Blob([text], {
        type: fmt === "tsv" ? "text/tab-separated-values" : "text/csv",
      }),
      `${name}.${fmt}`,
    );
    return;
  }

  if (fmt === "html") {
    const body = allSheets(wb)
      .map(
        (s) => `<h3>${esc(s.name || "Sheet")}</h3>${aoaToTable(sheetToAoa(s))}`,
      )
      .join("<br/>");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title></head><body>${body}</body></html>`;
    triggerDownload(new Blob([html], { type: "text/html" }), `${name}.html`);
    return;
  }

  if (fmt === "pdf") {
    const body = allSheets(wb)
      .map(
        (s) => `<h3>${esc(s.name || "Sheet")}</h3>${aoaToTable(sheetToAoa(s))}`,
      )
      .join("<br/>");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title></head><body>${body}</body></html>`;
    const resp = await fetch(
      `/api/v1/docs/convert?to=pdf&name=${encodeURIComponent(name)}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "text/html" },
        body: html,
      },
    );
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(
        `Export failed: HTTP ${resp.status}${detail ? " — " + detail.slice(0, 400) : ""}`,
      );
    }
    triggerDownload(await resp.blob(), `${name}.pdf`);
    return;
  }

  // xlsx / ods — build a multi-sheet workbook with SheetJS.
  const XLSX = await import("xlsx");
  const out = XLSX.utils.book_new();
  const used = new Set<string>();
  allSheets(wb).forEach((s, i) => {
    let nm =
      (s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) ||
      `Sheet${i + 1}`;
    while (used.has(nm)) nm = `${nm.slice(0, 28)}_${i}`;
    used.add(nm);
    XLSX.utils.book_append_sheet(
      out,
      XLSX.utils.aoa_to_sheet(sheetToAoa(s)),
      nm,
    );
  });
  XLSX.writeFile(out, `${name}.${fmt}`, { bookType: fmt });
}
