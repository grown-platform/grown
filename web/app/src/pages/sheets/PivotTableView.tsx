import { Table, Sheet } from "@mui/joy";
import type { PivotResult } from "./pivotData";

function fmt(n: number): string {
  if (!isFinite(n)) return "";
  const r = Math.round(n * 100) / 100;
  return r.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** PivotTableView renders a pivot result as an HTML table with row/col totals. */
export function PivotTableView({ result }: { result: PivotResult }) {
  const hasCols = result.colFieldName != null && result.colKeys.length > 0;
  return (
    <Sheet variant="outlined" sx={{ borderRadius: "sm", overflow: "auto", maxWidth: "100%" }}>
      <Table size="sm" borderAxis="both" stickyHeader sx={{ "--TableCell-height": "28px", minWidth: 280 }}>
        <thead>
          <tr>
            <th style={{ minWidth: 120 }}>
              {result.rowFieldName}
              {hasCols ? "" : ` · ${result.valueLabel}`}
            </th>
            {hasCols &&
              result.colKeys.map((c, i) => (
                <th key={i} style={{ textAlign: "right" }}>
                  {c}
                </th>
              ))}
            {hasCols && <th style={{ textAlign: "right", fontWeight: 700 }}>Total</th>}
          </tr>
          {hasCols && (
            <tr>
              <th style={{ fontWeight: 400, fontStyle: "italic", opacity: 0.7 }}>{result.valueLabel}</th>
              {result.colKeys.map((_, i) => (
                <th key={i} />
              ))}
              <th />
            </tr>
          )}
        </thead>
        <tbody>
          {result.rows.map((row, ri) => (
            <tr key={ri}>
              <td>{row.key}</td>
              {hasCols &&
                row.values.map((v, ci) => (
                  <td key={ci} style={{ textAlign: "right" }}>
                    {fmt(v)}
                  </td>
                ))}
              <td style={{ textAlign: "right", fontWeight: hasCols ? 700 : 400 }}>{fmt(row.total)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ fontWeight: 700 }}>Grand total</td>
            {hasCols &&
              result.colTotals.map((v, ci) => (
                <td key={ci} style={{ textAlign: "right", fontWeight: 700 }}>
                  {fmt(v)}
                </td>
              ))}
            <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt(result.grandTotal)}</td>
          </tr>
        </tbody>
      </Table>
    </Sheet>
  );
}
