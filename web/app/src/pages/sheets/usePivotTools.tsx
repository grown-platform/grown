/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// The editor side of pivot tables: the create/edit dialog, the pivots panel,
// writing reports onto the grid, refreshing them after edits, the guard
// against typing into them, and "show details".

import { useRef, useState, type MutableRefObject } from "react";
import { PivotDialog, type Placement } from "./PivotDialog";
import { PivotPanel } from "./PivotPanel";
import type { PivotConfig } from "./pivotData";
import { clearPivot, createPivotSync, pivotAt, showDetails, writePivot } from "./pivotGrid";

type Wb = any;

function notify(kind: "error" | "info", title: string, message: string): void {
  try {
    window.dispatchEvent(new CustomEvent("grown-sheet-notice", { detail: { kind, title, message } }));
  } catch {
    /* ignore */
  }
}

export function usePivotTools(opts: {
  getWb: () => Wb;
  pivotsRef: MutableRefObject<PivotConfig[]>;
  pivots: PivotConfig[];
  setPivots: (p: PivotConfig[]) => void;
  persist: () => void;
  dialogOpen: boolean;
  setDialogOpen: (v: boolean) => void;
  panelOpen: boolean;
  setPanelOpen: (v: boolean) => void;
}) {
  const { getWb, pivotsRef } = opts;
  const [editing, setEditing] = useState<PivotConfig | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const commit = (next: PivotConfig[]) => {
    pivotsRef.current = next;
    optsRef.current.setPivots(next);
    optsRef.current.persist();
  };

  const sync = useRef<ReturnType<typeof createPivotSync> | null>(null);
  if (!sync.current) {
    sync.current = createPivotSync({ getWb, getPivots: () => pivotsRef.current, setPivots: commit });
  }

  function save(cfg: PivotConfig, placement: Placement) {
    const wb = getWb();
    if (!wb) return;
    const prev = pivotsRef.current.find((p) => p.id === cfg.id);
    let next: PivotConfig = { ...cfg };
    let activate: string | null = null;
    if (placement.kind === "newSheet") {
      const names = new Set((wb.getAllSheets?.() ?? []).map((s: any) => s.name));
      let n = 1;
      while (names.has(`Pivot table ${n}`)) n++;
      const id = `pivot_${Date.now().toString(36)}`;
      wb.addSheet?.(id);
      try {
        wb.setSheetName?.(`Pivot table ${n}`, { id });
      } catch {
        /* keep the default name */
      }
      next.anchor = { sheetId: id, r: 0, c: 0 };
      activate = id;
    } else if (placement.kind === "existing") {
      next.anchor = { sheetId: placement.sheetId, r: placement.r, c: placement.c };
    }
    const moved =
      prev?.output &&
      (!next.anchor || String(prev.output.sheetId) !== String(next.anchor.sheetId) || prev.output.r0 !== next.anchor.r || prev.output.c0 !== next.anchor.c);
    if (moved && prev) {
      clearPivot(wb, prev);
      next = { ...next, output: undefined };
    }
    const others = pivotsRef.current.filter((p) => p.id !== next.id);
    const list = prev ? pivotsRef.current.map((p) => (p.id === next.id ? next : p)) : [...pivotsRef.current, next];
    commit(list);
    // Write once the new sheet exists.
    window.setTimeout(() => {
      const res = writePivot(wb, next, others);
      if (res.blocked) {
        notify(
          "error",
          "Pivot table not placed",
          res.blocked === "protected"
            ? "The pivot table's cells are protected. Choose another place."
            : "Other data is in the way of the pivot table. Choose an empty place or a new sheet.",
        );
      }
      if (res.cfg !== next) commit(pivotsRef.current.map((p) => (p.id === next.id ? res.cfg : p)));
      if (activate) {
        try {
          wb.activateSheet?.({ id: activate });
        } catch {
          /* ignore */
        }
      }
    }, 0);
  }

  function remove(id: string) {
    const wb = getWb();
    const p = pivotsRef.current.find((x) => x.id === id);
    if (wb && p) clearPivot(wb, p);
    commit(pivotsRef.current.filter((x) => x.id !== id));
  }

  function detailsHere() {
    const wb = getWb();
    if (!wb) return;
    const sel = wb.getSelection?.()?.[0];
    const sheetId = String(wb.getSheet?.()?.id ?? "");
    const r = sel?.row?.[0];
    const c = sel?.column?.[0];
    const p = r != null && c != null ? pivotAt(pivotsRef.current, sheetId, r, c) : null;
    if (!p?.output) {
      notify("info", "Show details", "Select a value cell of a pivot table on the sheet first.");
      return;
    }
    if (!showDetails(wb, p, r - p.output.r0, c - p.output.c0)) {
      notify("info", "Show details", "That cell is not a value of the pivot table.");
      return;
    }
    optsRef.current.setPanelOpen(false);
  }

  const element = (
    <>
      <PivotDialog
        open={opts.dialogOpen}
        onClose={() => {
          opts.setDialogOpen(false);
          setEditing(null);
        }}
        getWb={getWb}
        editing={editing}
        onSave={save}
      />
      <PivotPanel
        open={opts.panelOpen}
        onClose={() => opts.setPanelOpen(false)}
        getWb={getWb}
        pivots={opts.pivots}
        onDelete={remove}
        onNew={() => {
          opts.setPanelOpen(false);
          setEditing(null);
          opts.setDialogOpen(true);
        }}
        onEdit={(p) => {
          opts.setPanelOpen(false);
          setEditing(p);
          opts.setDialogOpen(true);
        }}
        onRefresh={() => sync.current?.runNow()}
        onDetails={(p, r, c) => {
          const wb = getWb();
          if (wb && showDetails(wb, p, r, c)) opts.setPanelOpen(false);
        }}
        onDetailsHere={detailsHere}
      />
    </>
  );

  return {
    element,
    /** beforeUpdateCell hook part: refuses typing into a pivot's cells. */
    guard: (r: number, c: number) => sync.current!.guard(r, c),
    /** Call after every workbook change: refreshes the pivots (debounced). */
    changed: () => sync.current!.schedule(),
  };
}
