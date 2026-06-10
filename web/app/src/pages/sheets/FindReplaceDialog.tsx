import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  FormControl,
  FormLabel,
  Input,
  Checkbox,
  Select,
  Option,
  Button,
  Box,
  Stack,
  Chip,
} from "@mui/joy";
import {
  buildMatcher,
  replaceInText,
  findMatches,
  cellText,
  type Cell,
  type CellGrid,
  type CellRef,
  type FindOptions,
} from "./sheetOps";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

interface FindReplaceDialogProps {
  open: boolean;
  onClose: () => void;
  getWb: () => any;
}

type Scope = "sheet" | "all" | "range";

// Read the full used grid of a sheet as cell objects, with the origin (always 0,0
// for whole-sheet). FortuneSheet stores the grid in sheet.data (CellMatrix).
function sheetGrid(sheet: any): CellGrid {
  const grid = sheet?.data;
  if (Array.isArray(grid)) return grid as CellGrid;
  // celldata fallback (sparse): rebuild a dense grid.
  const cd: any[] = sheet?.celldata || [];
  let maxR = 0,
    maxC = 0;
  cd.forEach((c) => {
    maxR = Math.max(maxR, c.r);
    maxC = Math.max(maxC, c.c);
  });
  const out: CellGrid = Array.from({ length: maxR + 1 }, () =>
    Array<Cell>(maxC + 1).fill(null),
  );
  cd.forEach((c) => {
    out[c.r][c.c] = c.v;
  });
  return out;
}

export function FindReplaceDialog({
  open,
  onClose,
  getWb,
}: FindReplaceDialogProps) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [matchEntire, setMatchEntire] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [scope, setScope] = useState<Scope>("sheet");
  const [matches, setMatches] = useState<CellRef[] | null>(null);
  const [active, setActive] = useState(0); // index into matches for "Find next"
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const opts: FindOptions = useMemo(
    () => ({ matchCase, matchEntireCell: matchEntire, useRegex }),
    [matchCase, matchEntire, useRegex],
  );

  // Re-focus the Find field whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setMatches(null);
      setActive(0);
      setError(null);
      setInfo(null);
      setTimeout(() => findRef.current?.focus(), 0);
    }
  }, [open]);

  // Invalidate cached matches when the query/options/scope change.
  useEffect(() => {
    setMatches(null);
    setActive(0);
    setInfo(null);
  }, [find, opts, scope]);

  // Collect candidate sheets (current sheet, or all sheets) plus the active range.
  const collect = useCallback((): {
    sheetId: string;
    origin: CellRef;
    grid: CellGrid;
  }[] => {
    const wb = getWb();
    if (!wb) return [];
    const all = wb.getAllSheets?.() || [];
    const cur = wb.getSheet?.();
    if (scope === "all") {
      return all.map((s: any) => ({
        sheetId: s.id,
        origin: { r: 0, c: 0 },
        grid: sheetGrid(s),
      }));
    }
    if (scope === "range") {
      const selArr = wb.getSelection?.();
      const sel = Array.isArray(selArr) ? selArr[0] : selArr;
      if (!sel) return [];
      const r0 = sel.row[0],
        r1 = sel.row[1],
        c0 = sel.column[0],
        c1 = sel.column[1];
      const full = sheetGrid(cur);
      const grid: CellGrid = [];
      for (let r = r0; r <= r1; r++) {
        const row: Cell[] = [];
        for (let c = c0; c <= c1; c++) row.push(full[r]?.[c] ?? null);
        grid.push(row);
      }
      return [{ sheetId: cur?.id, origin: { r: r0, c: c0 }, grid }];
    }
    return [{ sheetId: cur?.id, origin: { r: 0, c: 0 }, grid: sheetGrid(cur) }];
  }, [getWb, scope]);

  // Flatten matches across the collected sheets, tagging each with its sheet id.
  type Hit = CellRef & { sheetId: string };
  const runFind = useCallback((): Hit[] => {
    setError(null);
    let hits: Hit[] = [];
    try {
      for (const { sheetId, origin, grid } of collect()) {
        const found = findMatches(grid, origin, find, opts);
        hits = hits.concat(found.map((h) => ({ ...h, sheetId })));
      }
    } catch (e) {
      setError((e as Error).message || "Invalid search");
      return [];
    }
    return hits;
  }, [collect, find, opts]);

  const findNext = useCallback(() => {
    if (!find) return;
    const hits = runFind();
    setMatches(hits);
    if (hits.length === 0) {
      setInfo("No results found.");
      return;
    }
    const idx =
      matches && matches.length === hits.length
        ? (active + 1) % hits.length
        : 0;
    setActive(idx);
    const h = hits[idx];
    const wb = getWb();
    try {
      // Switch to the matching sheet if needed, then select + scroll to the cell.
      if (h.sheetId && wb.getSheet?.()?.id !== h.sheetId)
        wb.activateSheet?.({ id: h.sheetId });
      wb.setSelection?.({ row: [h.r, h.r], column: [h.c, h.c] });
      wb.scroll?.({ targetRow: h.r, targetColumn: h.c });
    } catch {
      /* ignore navigation errors */
    }
    setInfo(`Match ${idx + 1} of ${hits.length}`);
  }, [find, runFind, matches, active, getWb]);

  const doReplace = useCallback(
    (all: boolean) => {
      if (!find) return;
      const wb = getWb();
      if (!wb) return;
      setError(null);
      let hits: Hit[];
      try {
        hits = runFind();
      } catch {
        return;
      }
      if (hits.length === 0) {
        setInfo("No results found.");
        return;
      }

      const targets = all ? hits : [hits[matches ? active % hits.length : 0]];
      let changed = 0;
      try {
        const calls: { name: string; args: any[] }[] = [];
        for (const h of targets) {
          const sheet =
            (wb.getAllSheets?.() || []).find((s: any) => s.id === h.sheetId) ||
            wb.getSheet?.();
          const cell = sheetGrid(sheet)[h.r]?.[h.c] ?? null;
          const text = cellText(cell);
          const next = replaceInText(text, find, replace, opts);
          if (next !== text) {
            calls.push({
              name: "setCellValue",
              args: [h.r, h.c, next, { id: h.sheetId }],
            });
            changed++;
          }
        }
        if (calls.length) {
          if (wb.batchCallApis) wb.batchCallApis(calls);
          else calls.forEach((c) => wb[c.name]?.(...c.args));
        }
      } catch (e) {
        setError((e as Error).message || "Replace failed");
        return;
      }
      setMatches(null);
      setActive(0);
      setInfo(
        changed === 0
          ? "No replacements made."
          : all
            ? `Replaced ${changed} instance${changed === 1 ? "" : "s"}.`
            : "Replaced 1 instance.",
      );
    },
    [find, replace, opts, runFind, matches, active, getWb],
  );

  // Validate regex live so we can disable actions + show feedback.
  const regexError = useMemo(() => {
    if (!useRegex || !find) return null;
    try {
      buildMatcher(find, opts);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [useRegex, find, opts]);

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{ width: 440, maxWidth: "95vw" }}
        aria-labelledby="fr-title"
      >
        <ModalClose />
        <Typography id="fr-title" level="title-lg">
          Find and replace
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <FormControl error={!!regexError}>
            <FormLabel>Find</FormLabel>
            <Input
              slotProps={{ input: { ref: findRef, "aria-label": "Find" } }}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  findNext();
                }
              }}
              placeholder="Search text"
            />
          </FormControl>
          <FormControl>
            <FormLabel>Replace with</FormLabel>
            <Input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              slotProps={{ input: { "aria-label": "Replace with" } }}
              placeholder="Replacement text"
            />
          </FormControl>
          <FormControl>
            <FormLabel>Search</FormLabel>
            <Select
              value={scope}
              onChange={(_, v) => v && setScope(v)}
              aria-label="Search scope"
            >
              <Option value="sheet">This sheet</Option>
              <Option value="all">All sheets</Option>
              <Option value="range">Specific range (current selection)</Option>
            </Select>
          </FormControl>
          <Box>
            <Checkbox
              label="Match case"
              checked={matchCase}
              sx={{ mb: 0.5 }}
              onChange={(e) => setMatchCase(e.target.checked)}
            />
            <br />
            <Checkbox
              label="Match entire cell contents"
              checked={matchEntire}
              sx={{ mb: 0.5 }}
              onChange={(e) => setMatchEntire(e.target.checked)}
            />
            <br />
            <Checkbox
              label="Search using regular expressions"
              checked={useRegex}
              onChange={(e) => setUseRegex(e.target.checked)}
            />
          </Box>
          {regexError && (
            <Typography level="body-sm" color="danger">
              Invalid regular expression: {regexError}
            </Typography>
          )}
          {error && (
            <Typography level="body-sm" color="danger">
              {error}
            </Typography>
          )}
          {info && !error && (
            <Chip
              size="sm"
              variant="soft"
              color={info.startsWith("No") ? "neutral" : "success"}
            >
              {info}
            </Chip>
          )}
          <Box
            sx={{
              display: "flex",
              gap: 1,
              flexWrap: "wrap",
              justifyContent: "flex-end",
              mt: 0.5,
            }}
          >
            <Button variant="plain" onClick={onClose}>
              Done
            </Button>
            <Button
              variant="outlined"
              disabled={!find || !!regexError}
              onClick={findNext}
            >
              Find
            </Button>
            <Button
              variant="outlined"
              disabled={!find || !!regexError}
              onClick={() => doReplace(false)}
            >
              Replace
            </Button>
            <Button
              disabled={!find || !!regexError}
              onClick={() => doReplace(true)}
            >
              Replace all
            </Button>
          </Box>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
