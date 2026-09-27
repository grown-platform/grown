/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet API is loosely typed. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Box, Dropdown, Menu, MenuButton, MenuItem, Typography } from "@mui/joy";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { dataRect, tableName } from "./tables";
import { selectTable, workbookTables } from "./tableTools";
import { currentSheet } from "./sheetDataTools";

// The name box shows a table's name when the selection is its data rows (or
// the whole table), as Excel's does, and its dropdown lists the workbook's
// tables and named ranges to go to. FortuneSheet's name box is a plain
// element; this overlays it.

let version = 0;
const listeners = new Set<() => void>();
/** Bumped on every selection change (afterSelectionChange). */
export const selectionStore = {
  bump() {
    version++;
    listeners.forEach((l) => l());
  },
  get: () => version,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

function selectionName(wb: any): string | null {
  try {
    const sheet = currentSheet(wb);
    const s = wb?.getSelection?.();
    const sel = Array.isArray(s) ? s[s.length - 1] : s;
    if (!sheet || !sel?.row || !sel?.column) return null;
    const r1 = Math.min(sel.row[0], sel.row[1]);
    const r2 = Math.max(sel.row[0], sel.row[1]);
    const c1 = Math.min(sel.column[0], sel.column[1]);
    const c2 = Math.max(sel.column[0], sel.column[1]);
    for (const { sheet: sh, table } of workbookTables(wb)) {
      if (sh.id !== sheet.id) continue;
      for (const rc of [dataRect(table), table.ref]) {
        if (rc.r1 === r1 && rc.r2 === r2 && rc.c1 === c1 && rc.c2 === c2) return tableName(table);
      }
    }
  } catch {
    /* no name */
  }
  return null;
}

export function TableNameBox({ getWb, container, onGoToName }: { getWb: () => any; container: HTMLElement | null; onGoToName?: (name: string) => void }) {
  useSyncExternalStore(selectionStore.subscribe, selectionStore.get);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!container) return;
    const find = () => setHost(container.querySelector<HTMLElement>(".fortune-name-box-container"));
    find();
    const t = window.setInterval(find, 1000);
    return () => window.clearInterval(t);
  }, [container]);
  if (!host) return null;
  const wb = getWb();
  const name = selectionName(wb);
  const tables = workbookTables(wb);
  const named: any[] = (() => {
    try {
      const nr = wb?.getAllSheets?.()?.[0]?._namedRanges;
      return Array.isArray(nr) ? nr : [];
    } catch {
      return [];
    }
  })();
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  return createPortal(
    <>
      {name && (
        <Box
          data-testid="table-name-box"
          sx={{
            position: "absolute",
            inset: 0,
            right: 22,
            bgcolor: "#fff",
            display: "flex",
            alignItems: "center",
            px: 1,
            fontSize: 14,
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          {name}
        </Box>
      )}
      {(tables.length > 0 || named.length > 0) && (
        <Box sx={{ position: "absolute", right: 0, top: 0, bottom: 0, zIndex: 3, display: "flex", alignItems: "center" }}>
          <Dropdown>
            <MenuButton size="sm" variant="plain" aria-label="Go to a table or named range" sx={{ minHeight: 0, px: 0, py: 0 }}>
              <ArrowDropDownIcon fontSize="small" />
            </MenuButton>
            <Menu size="sm" placement="bottom-start" sx={{ zIndex: 2000 }}>
              {tables.map(({ table }) => (
                <MenuItem key={`t-${tableName(table)}`} onClick={() => selectTable(wb, tableName(table))}>
                  <Typography level="body-sm">{tableName(table)}</Typography>
                  <Typography level="body-xs" sx={{ ml: "auto", pl: 2, opacity: 0.6 }}>
                    Table
                  </Typography>
                </MenuItem>
              ))}
              {named.map((n) => (
                <MenuItem key={`n-${n.name}`} onClick={() => onGoToName?.(n.name)}>
                  <Typography level="body-sm">{n.name}</Typography>
                  <Typography level="body-xs" sx={{ ml: "auto", pl: 2, opacity: 0.6 }}>
                    Named range
                  </Typography>
                </MenuItem>
              ))}
            </Menu>
          </Dropdown>
        </Box>
      )}
    </>,
    host,
  );
}
