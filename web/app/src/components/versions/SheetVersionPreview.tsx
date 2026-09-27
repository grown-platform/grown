import { useMemo, useState } from "react";
import { Box, Button, Typography } from "@mui/joy";
import { cellText, columnName, diffWorkbooks, workbookSheets, summarizeWorkbookDiff } from "./diff";
import { VersionHistoryPanel, type VersionHistoryPanelProps } from "./VersionHistoryPanel";

const MAX_ROWS = 100;
const MAX_COLS = 26;

/** SheetVersionPreview renders a stored workbook read-only as a plain grid
 *  (first 100 rows × 26 columns per sheet), highlighting the cells that changed
 *  since the previous version. */
export function SheetVersionPreview({ data, older }: { data: string; older: string | null }) {
  const sheets = useMemo(() => workbookSheets(data), [data]);
  const diff = useMemo(() => (older === null ? null : diffWorkbooks(older, data)), [older, data]);
  const [tab, setTab] = useState(0);
  if (!sheets.length) {
    return (
      <Typography level="body-sm" sx={{ opacity: 0.6, p: 1 }}>
        This version has no sheets.
      </Typography>
    );
  }
  const sheet = sheets[Math.min(tab, sheets.length - 1)];
  const changed = diff?.changed.get(sheet.id);
  const rows = Math.min(Math.max(sheet.rows, 10), MAX_ROWS);
  const cols = Math.min(Math.max(sheet.cols, 5), MAX_COLS);
  const cell = { border: "1px solid #e0e0e0", px: 0.75, py: 0.25, whiteSpace: "nowrap" } as const;
  const head = { ...cell, bgcolor: "#f1f3f4", color: "#5f6368", fontWeight: 500, textAlign: "center" } as const;
  return (
    <Box>
      {sheets.length > 1 && (
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: 1 }}>
          {sheets.map((s, i) => (
            <Button
              key={s.id}
              size="sm"
              variant={s === sheet ? "solid" : "outlined"}
              color={diff?.changed.has(s.id) ? "warning" : "neutral"}
              onClick={() => setTab(i)}
            >
              {s.name}
            </Button>
          ))}
        </Box>
      )}
      <Box
        component="table"
        data-testid="sheet-version-grid"
        sx={{ borderCollapse: "collapse", fontSize: 12, fontFamily: "Arial, sans-serif" }}
      >
        <thead>
          <tr>
            <Box component="th" sx={head} />
            {Array.from({ length: cols }, (_, c) => (
              <Box component="th" key={c} sx={head}>
                {columnName(c)}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              <Box component="th" sx={head}>
                {r + 1}
              </Box>
              {Array.from({ length: cols }, (_, c) => {
                const key = `${r},${c}`;
                const v = sheet.cells.get(key);
                const isChanged = changed?.has(key);
                return (
                  <Box
                    component="td"
                    key={c}
                    data-cell={`${columnName(c)}${r + 1}`}
                    data-changed={isChanged ? "true" : undefined}
                    title={v?.f ? String(v.f) : undefined}
                    sx={{
                      ...cell,
                      minWidth: 56,
                      maxWidth: 160,
                      textAlign: typeof v?.v === "number" ? "right" : undefined,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      bgcolor: isChanged ? "#fff3bf" : (v?.bg ?? undefined),
                      fontWeight: v?.bl ? 700 : undefined,
                      fontStyle: v?.it ? "italic" : undefined,
                      color: v?.fc ?? undefined,
                    }}
                  >
                    {cellText(v)}
                  </Box>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Box>
      {(sheet.rows > MAX_ROWS || sheet.cols > MAX_COLS) && (
        <Typography level="body-xs" sx={{ mt: 1, opacity: 0.7 }}>
          Showing the first {MAX_ROWS} rows and {MAX_COLS} columns.
        </Typography>
      )}
      {diff && (
        <Typography level="body-xs" sx={{ mt: 1, opacity: 0.7 }}>
          Highlighted cells changed since the previous version.
        </Typography>
      )}
    </Box>
  );
}

type SheetVersionHistoryProps = Omit<VersionHistoryPanelProps, "kind" | "renderPreview" | "summarize">;

/** File ▸ Version history for Sheets. */
export function SheetVersionHistory(props: SheetVersionHistoryProps) {
  return (
    <VersionHistoryPanel
      {...props}
      kind="sheets"
      renderPreview={(data, older) => <SheetVersionPreview data={data} older={older} />}
      summarize={(older, newer) => summarizeWorkbookDiff(diffWorkbooks(older, newer))}
    />
  );
}
