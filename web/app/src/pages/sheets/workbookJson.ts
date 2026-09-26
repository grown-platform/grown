/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet models are loosely typed. */

// storableWorkbook turns FortuneSheet's live sheets (a dense `data` matrix per
// loaded sheet) into the stored form: sparse `celldata` [{r, c, v}]. The
// server formula engine (RecomputeWorkbook, /recalc) reads `celldata` only, so
// saving the matrix would hide every edited cell from it; FortuneSheet loads
// either form.
export function storableWorkbook(sheets: any[]): any[] {
  if (!Array.isArray(sheets)) return sheets;
  return sheets.map((sheet) => {
    if (!sheet || !Array.isArray(sheet.data)) return sheet;
    const { data, ...rest } = sheet;
    const celldata: Array<{ r: number; c: number; v: any }> = [];
    data.forEach((row: any[], r: number) => {
      if (!Array.isArray(row)) return;
      row.forEach((v: any, c: number) => {
        if (v !== null && v !== undefined) celldata.push({ r, c, v });
      });
    });
    return { ...rest, celldata };
  });
}
