import { Sheet } from "@mui/joy";
import { cellText, type PivotReport } from "./pivotEngine";

/**
 * PivotTableView shows a pivot report as a table, cell for cell as it is
 * written on the grid. Value cells are clickable (show details).
 */
export function PivotTableView({
  report,
  onValueClick,
  maxRows = 400,
}: {
  report: PivotReport;
  onValueClick?: (r: number, c: number) => void;
  maxRows?: number;
}) {
  const rows = report.cells.slice(0, maxRows);
  return (
    <Sheet variant="outlined" sx={{ borderRadius: "sm", overflow: "auto", maxWidth: "100%" }}>
      <table
        data-testid="pivot-table"
        style={{ borderCollapse: "collapse", fontSize: 12, fontFamily: "Arial, sans-serif", minWidth: 120 }}
      >
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => {
                const kind = cell?.kind;
                const isValue = kind === "value" || kind === "subtotal" || kind === "grand";
                const numeric = typeof cell?.v === "number" || (cell?.v && typeof cell.v === "object");
                const header = kind === "caption" || kind === "colLabel" || kind === "pageName";
                const clickable = !!onValueClick && isValue && r >= report.tableRow + report.headerRows;
                return (
                  <td
                    key={c}
                    onClick={clickable ? () => onValueClick!(r, c) : undefined}
                    title={clickable ? "Show details" : undefined}
                    style={{
                      border: "1px solid #e0e0e0",
                      padding: "2px 6px",
                      whiteSpace: "nowrap",
                      textAlign: numeric ? "right" : "left",
                      fontWeight: cell?.bold ? 700 : 400,
                      background: header ? "#e8f0fe" : undefined,
                      cursor: clickable ? "pointer" : undefined,
                    }}
                  >
                    {cellText(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Sheet>
  );
}
