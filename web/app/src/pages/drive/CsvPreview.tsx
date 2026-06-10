import { useEffect, useState } from "react";
import { Box, Table, Sheet, Typography } from "@mui/joy";

interface CsvPreviewProps {
  url: string;
}

const MAX_ROWS = 1000;

/**
 * CsvPreview fetches a text/csv file and renders it as a table.
 * Uses an inline RFC 4180-style parser (quoted fields, escaped "", CRLF or LF).
 * Truncates at MAX_ROWS to keep the DOM lean — large CSVs should be edited in
 * Sheets (not yet built) rather than previewed.
 */
export function CsvPreview({ url }: CsvPreviewProps) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(url, { credentials: "same-origin" });
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        const text = await r.text();
        if (cancelled) return;
        const parsed = parseCsv(text);
        setTotalRows(parsed.length);
        setRows(parsed.slice(0, MAX_ROWS));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <Box sx={{ p: 2, color: "danger.plainColor" }} role="alert">
        CSV load failed: {error}
      </Box>
    );
  }
  if (!rows) {
    return <Box sx={{ p: 2, opacity: 0.6 }}>Loading CSV…</Box>;
  }
  if (rows.length === 0) {
    return <Box sx={{ p: 2 }}>(empty file)</Box>;
  }

  const [header, ...body] = rows;
  const truncated = totalRows > MAX_ROWS;

  return (
    <Box sx={{ p: 1 }}>
      <Sheet
        variant="outlined"
        sx={{ borderRadius: "sm", overflow: "auto", maxHeight: "75vh" }}
      >
        <Table
          aria-label="CSV preview"
          stickyHeader
          hoverRow
          sx={{
            "& thead th": { fontWeight: 600, bgcolor: "background.level1" },
            "& td, & th": {
              whiteSpace: "nowrap",
              px: 1.5,
              py: 0.75,
              fontFamily: "monospace",
              fontSize: "0.85rem",
            },
          }}
        >
          <thead>
            <tr>
              <th style={{ width: 56, textAlign: "right" }}>#</th>
              {header.map((cell, i) => (
                <th key={i}>{cell}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>
                <td style={{ textAlign: "right", opacity: 0.5 }}>{ri + 2}</td>
                {row.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
                {/* Pad short rows so columns stay aligned with the header. */}
                {row.length < header.length &&
                  Array.from({ length: header.length - row.length }).map(
                    (_, i) => <td key={`pad-${i}`} />,
                  )}
              </tr>
            ))}
          </tbody>
        </Table>
      </Sheet>
      {truncated && (
        <Typography level="body-xs" sx={{ mt: 1, opacity: 0.7 }}>
          Showing first {MAX_ROWS.toLocaleString()} rows of{" "}
          {totalRows.toLocaleString()}. Download the full file for the rest.
        </Typography>
      )}
    </Box>
  );
}

/**
 * parseCsv implements RFC 4180 with the common loosenings (LF or CRLF, optional
 * trailing newline). Handles quoted fields containing commas and newlines, and
 * "" as an escaped quote inside a quoted field.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      // CRLF: skip the LF that follows
      if (text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush trailing field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
