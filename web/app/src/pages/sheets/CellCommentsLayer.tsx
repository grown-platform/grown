import { useCallback, useEffect, useImperativeHandle, useState, useSyncExternalStore, forwardRef } from "react";
import {
  addThread,
  deleteComment,
  editComment,
  reopenThread,
  replyTo,
  resolveThread,
  sheetComments,
  threadAt,
  type CommentAuthor,
  type CommentThread,
} from "./cellComments";
import { CommentThreadCard, CommentsPanel } from "./SheetComments";
import { gridGeometry } from "./chartAnchor";
import { currentSheet, patchSheet } from "./sheetDataTools";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Cell comments in the editor: the card next to the selected cell when it
// has a thread (or the composer after Insert ▸ Comment / Ctrl+Alt+M), and the
// View ▸ Comments side panel. Threads live on each sheet as `grownComments`
// and are written with patchSheet, which also relays the op to collaborators.
// The selection arrives through a tiny store fed by FortuneSheet's
// afterSelectionChange hook, so selecting cells doesn't re-render the editor.

type Active = { sheetId: string; r: number; c: number } | null;
let active: Active = null;
const listeners = new Set<() => void>();
export const activeCellStore = {
  set(next: Active) {
    if (active && next && active.sheetId === next.sheetId && active.r === next.r && active.c === next.c) return;
    active = next;
    listeners.forEach((l) => l());
  },
  get: () => active,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

// Threads of the sheet being painted, cached per repaint (afterRenderCell runs per cell).
let paintThreads: CommentThread[] = [];
export function refreshPaintThreads(wb: any): void {
  try {
    paintThreads = sheetComments(currentSheet(wb));
  } catch {
    paintThreads = [];
  }
}
export function threadsForPaint(): CommentThread[] {
  return paintThreads;
}

export interface CellCommentsHandle {
  /** Opens the composer on the active cell (a reply when it has a thread). */
  compose: () => void;
}

interface Props {
  getWb: () => any;
  container: HTMLElement | null;
  author: CommentAuthor;
  panelOpen: boolean;
  onPanelClose: () => void;
}

export const CellCommentsLayer = forwardRef<CellCommentsHandle, Props>(function CellCommentsLayer(
  { getWb, container, author, panelOpen, onPanelClose },
  ref,
) {
  const cell = useSyncExternalStore(activeCellStore.subscribe, activeCellStore.get);
  // The cell whose card was closed (it stays closed until the selection moves).
  const [dismissed, setDismissed] = useState<string>("");
  const [composing, setComposing] = useState<string>("");
  const [, bump] = useState(0);
  const key = cell ? `${cell.sheetId}:${cell.r}:${cell.c}` : "";

  useEffect(() => {
    if (dismissed && dismissed !== key) setDismissed("");
    if (composing && composing !== key) setComposing("");
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const sheetOf = useCallback(
    (sheetId: string): any => {
      try {
        return (getWb()?.getAllSheets?.() ?? []).find((s: any) => String(s?.id) === sheetId) ?? null;
      } catch {
        return null;
      }
    },
    [getWb],
  );

  const save = (sheetId: string, next: CommentThread[]) => {
    const wb = getWb();
    if (!wb) return;
    patchSheet(wb, sheetId, { grownComments: next });
    bump((n) => n + 1);
  };

  useImperativeHandle(ref, () => ({
    compose: () => {
      const a = activeCellStore.get();
      if (!a) return;
      setDismissed("");
      setComposing(`${a.sheetId}:${a.r}:${a.c}`);
    },
  }));

  let card: React.ReactNode = null;
  if (cell && dismissed !== key) {
    const sheet = sheetOf(cell.sheetId);
    const threads = sheetComments(sheet);
    const thread = threadAt(threads, cell.r, cell.c) ?? null;
    const showCard = composing === key || (thread && !thread.resolved);
    const area = container?.querySelector<HTMLElement>(".fortune-cell-area");
    if (showCard && sheet && area) {
      const g = gridGeometry(sheet);
      const rect = area.getBoundingClientRect();
      const x = Math.min(window.innerWidth - 290, rect.left + g.colLeft(cell.c + 1) - area.scrollLeft + 6);
      const y = Math.max(rect.top, rect.top + g.rowTop(cell.r) - area.scrollTop);
      const upd = (fn: (t: CommentThread[]) => CommentThread[]) => save(cell.sheetId, fn(sheetComments(sheetOf(cell.sheetId))));
      card = (
        <CommentThreadCard
          thread={composing === key && !thread ? null : thread}
          cell={{ r: cell.r, c: cell.c }}
          x={x}
          y={y}
          userId={author.id}
          onAdd={(body) => {
            upd((t) => addThread(t, cell.r, cell.c, body, author));
            setComposing("");
          }}
          onReply={(tid, body) => upd((t) => replyTo(t, tid, body, author))}
          onEdit={(tid, cid, body) => upd((t) => editComment(t, tid, cid, body, author.id))}
          onDelete={(tid, cid) => upd((t) => deleteComment(t, tid, cid, author.id))}
          onResolve={(tid) => {
            upd((t) => resolveThread(t, tid));
            setDismissed(key);
          }}
          onReopen={(tid) => upd((t) => reopenThread(t, tid))}
          onClose={() => {
            setComposing("");
            setDismissed(key);
          }}
        />
      );
    }
  }

  let panel: React.ReactNode = null;
  if (panelOpen) {
    let sheets: any[] = [];
    try {
      sheets = getWb()?.getAllSheets?.() ?? [];
    } catch {
      /* not mounted */
    }
    panel = (
      <CommentsPanel
        sheets={sheets.map((s) => ({ id: String(s.id), name: String(s.name), threads: sheetComments(s) }))}
        onJump={(sheetId, r, c) => {
          const wb = getWb();
          try {
            if (String(wb?.getSheet?.()?.id) !== sheetId) wb?.activateSheet?.({ id: sheetId });
            wb?.setSelection?.([{ row: [r, r], column: [c, c] }], { id: sheetId });
          } catch {
            /* ignore */
          }
          activeCellStore.set({ sheetId, r, c });
          setDismissed("");
        }}
        onClose={onPanelClose}
      />
    );
  }
  return (
    <>
      {card}
      {panel}
    </>
  );
});
