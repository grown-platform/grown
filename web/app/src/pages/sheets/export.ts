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

  if (fmt === "xlsx") {
    const { workbookToXlsx } = await import("./xlsx/xlsxWrite");
    const bytes = await workbookToXlsx(allSheets(wb), { title });
    triggerDownload(
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${name}.xlsx`,
    );
    return;
  }

  // ods — SheetJS CE writes values, formulas, merges and column widths (its ODS
  // writer emits no number styles, so cell number formats are not kept).
  const XLSX = await import("xlsx");
  const out = sheetjsWorkbook(XLSX, allSheets(wb));
  XLSX.writeFile(out, `${name}.${fmt}`, { bookType: fmt });
}

/** A SheetJS workbook with values, formulas, number formats, merges and sizes. */
export function sheetjsWorkbook(XLSX: typeof import("xlsx"), sheets: any[]): import("xlsx").WorkBook {
  const out = XLSX.utils.book_new();
  const used = new Set<string>();
  sheets.forEach((s, i) => {
    let nm =
      (s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) ||
      `Sheet${i + 1}`;
    while (used.has(nm)) nm = `${nm.slice(0, 28)}_${i}`;
    used.add(nm);
    const ws: any = {};
    let maxR = 0;
    let maxC = 0;
    forEachCell(s, (r, c, cell) => {
      const x: any = {};
      const v = cell.ct?.t === "inlineStr" && Array.isArray(cell.ct.s) ? cell.ct.s.map((p: any) => p?.v ?? "").join("") : cell.v;
      if (typeof cell.f === "string" && cell.f.startsWith("=")) x.f = cell.f.slice(1);
      if (typeof v === "number") x.t = "n";
      else if (typeof v === "boolean") x.t = "b";
      else if (v === undefined || v === null || v === "") {
        if (!x.f) return;
        x.t = "s";
      } else x.t = "s";
      x.v = v ?? "";
      if (cell.ct?.fa && cell.ct.fa !== "General") x.z = cell.ct.fa;
      ws[XLSX.utils.encode_cell({ r, c })] = x;
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    });
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    const merges = Object.values(s.config?.merge ?? {}) as any[];
    if (merges.length) ws["!merges"] = merges.map((m) => ({ s: { r: m.r, c: m.c }, e: { r: m.r + m.rs - 1, c: m.c + m.cs - 1 } }));
    const cl = s.config?.columnlen ?? {};
    if (Object.keys(cl).length) {
      const cols: any[] = [];
      for (const [k, px] of Object.entries(cl)) cols[Number(k)] = { wpx: px };
      ws["!cols"] = cols;
    }
    XLSX.utils.book_append_sheet(out, ws, nm);
  });
  return out;
}

function forEachCell(sheet: any, fn: (r: number, c: number, cell: any) => void) {
  if (Array.isArray(sheet?.data)) {
    sheet.data.forEach((row: any[], r: number) =>
      row?.forEach?.((cell: any, c: number) => {
        if (cell && typeof cell === "object") fn(r, c, cell);
      }),
    );
    return;
  }
  for (const cd of Array.isArray(sheet?.celldata) ? sheet.celldata : []) {
    if (cd?.v && typeof cd.v === "object") fn(cd.r, cd.c, cd.v);
  }
}
