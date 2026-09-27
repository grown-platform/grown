// Page-level UI around the paginated editor (Docs M9): the status bar
// (page x of y, words, zoom, print layout / pageless), the page
// thumbnails pane and print preview with page ranges.
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, IconButton, Input, Modal, ModalClose, ModalDialog, Option, Select, Typography } from "@mui/joy";
import type { Editor } from "@tiptap/react";
import { getLayout, onLayout, paginationState, setForcePaged, afterNextLayout, type PaginationState } from "./paginationPlugin";
import { pageIndexAt, pageSnippets, type DocLayout } from "./paginationModel";
import { setDocSettings } from "./pageLayout";

// --- live pagination state -----------------------------------------------------------------

/** usePagination re-renders on every new layout. */
export function usePagination(editor: Editor | null): PaginationState | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const off = onLayout(editor, () => setTick((t) => t + 1));
    const onTr = ({ transaction }: { transaction: { getMeta: (k: unknown) => unknown } }) => {
      if (transaction.getMeta(paginationKeyName)) setTick((t) => t + 1);
    };
    editor.on("transaction", onTr as never);
    return () => {
      off();
      editor.off("transaction", onTr as never);
    };
  }, [editor]);
  return editor && !editor.isDestroyed ? paginationState(editor) ?? null : null;
}
const paginationKeyName = "pagination$";

// --- status bar -------------------------------------------------------------------------------

export const ZOOMS = [50, 75, 90, 100, 125, 150, 200];

function countWords(editor: Editor): number {
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, " ", " ");
  return (text.match(/\S+/g) || []).length;
}

export function StatusBar({
  editor,
  state,
  zoom,
  onZoom,
  onShowPages,
}: {
  editor: Editor | null;
  state: PaginationState | null;
  zoom: number;
  onZoom: (z: number) => void;
  onShowPages: () => void;
}) {
  const [words, setWords] = useState(0);
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (!editor) return;
    let t: number | undefined;
    const upd = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (editor.isDestroyed) return;
        setWords(countWords(editor));
      }, 250);
    };
    const sel = () => {
      const dl = getLayout(editor);
      if (dl) setPage(pageIndexAt(dl, editor.state.selection.from) + 1);
    };
    upd();
    sel();
    editor.on("update", upd);
    editor.on("selectionUpdate", sel);
    editor.on("transaction", sel);
    return () => {
      window.clearTimeout(t);
      editor.off("update", upd);
      editor.off("selectionUpdate", sel);
      editor.off("transaction", sel);
    };
  }, [editor]);
  const dl = state?.dl;
  const total = dl?.layout.pages.length ?? 1;
  const pageless = !!state?.settings.pageless;
  return (
    <Box
      data-testid="doc-status-bar"
      sx={{
        position: "sticky",
        bottom: 0,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: 2,
        py: 0.25,
        fontSize: 12,
        color: "text.secondary",
        bgcolor: "background.surface",
        borderTop: "1px solid",
        borderColor: "divider",
      }}
    >
      <Box component="button" onClick={onShowPages} data-testid="status-page" sx={{ all: "unset", cursor: "pointer" }} title="Show page thumbnails">
        Page {Math.min(page, total)} of {total}
      </Box>
      <Box data-testid="status-words">
        {words.toLocaleString()} word{words === 1 ? "" : "s"}
      </Box>
      <Box sx={{ flex: 1 }} />
      <Box
        component="button"
        data-testid="status-pageless"
        onClick={() => editor && setDocSettings(editor, { pageless: !pageless })}
        sx={{ all: "unset", cursor: "pointer" }}
        title="Switch between print layout (pages) and pageless"
      >
        {pageless ? "Pageless" : "Print layout"}
      </Box>
      <IconButton size="sm" variant="plain" aria-label="Zoom out" onClick={() => onZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)] ?? 100)} sx={{ minHeight: 20, minWidth: 20, fontSize: 14 }}>
        −
      </IconButton>
      <Select
        size="sm"
        variant="plain"
        value={zoom}
        onChange={(_, v) => v && onZoom(v)}
        slotProps={{ button: { "aria-label": "Zoom", "data-testid": "status-zoom" } }}
        sx={{ minHeight: 22, fontSize: 12, py: 0 }}
      >
        {ZOOMS.map((z) => (
          <Option key={z} value={z}>
            {z}%
          </Option>
        ))}
      </Select>
      <IconButton size="sm" variant="plain" aria-label="Zoom in" onClick={() => onZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)] ?? 100)} sx={{ minHeight: 20, minWidth: 20, fontSize: 14 }}>
        +
      </IconButton>
    </Box>
  );
}

// --- thumbnails -------------------------------------------------------------------------------

export function scrollToPage(index: number) {
  const el = document.querySelector(`.doc-pages .doc-page[data-page="${index + 1}"]`);
  el?.scrollIntoView({ block: "start", behavior: "smooth" });
}

export function PageThumbnails({ editor, dl, onClose }: { editor: Editor; dl: DocLayout | null; onClose: () => void }) {
  const snippets = useMemo(() => (dl ? pageSnippets(dl, editor.state.doc) : []), [dl, editor]);
  if (!dl) return null;
  const scale = 0.16;
  return (
    <Box
      data-testid="page-thumbnails"
      sx={{ width: 180, p: 1, borderRight: "1px solid", borderColor: "divider", overflowY: "auto", maxHeight: "calc(100vh - 160px)", position: "sticky", top: 0 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        <Typography level="title-sm" sx={{ flex: 1 }}>
          Pages
        </Typography>
        <IconButton size="sm" variant="plain" onClick={onClose} aria-label="Close pages">
          ×
        </IconButton>
      </Box>
      {dl.layout.pages.map((p, i) => (
        <Box
          key={i}
          component="button"
          data-testid="page-thumb"
          onClick={() => scrollToPage(i)}
          sx={{ all: "unset", display: "block", cursor: "pointer", mb: 1.5, mx: "auto", textAlign: "center" }}
        >
          <Box
            sx={{
              width: p.spec.w * scale,
              height: p.spec.h * scale,
              mx: "auto",
              bgcolor: dl.settings.pageColor || "#fff",
              boxShadow: "0 1px 2px rgba(60,64,67,.3)",
              border: "1px solid #dadce0",
              p: `${p.spec.top * scale}px ${p.spec.right * scale}px 0 ${p.spec.left * scale}px`,
              overflow: "hidden",
              fontSize: 5,
              lineHeight: 1.3,
              textAlign: "left",
              color: "#5f6368",
            }}
          >
            {p.blank ? "" : snippets[i]}
          </Box>
          <Typography level="body-xs" sx={{ mt: 0.25 }}>
            {p.number}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

// --- print --------------------------------------------------------------------------------

/** parseRanges reads "1-3, 5" as 0-based page indices (all when empty). */
export function parseRanges(text: string, count: number): number[] {
  const t = text.trim();
  if (!t) return Array.from({ length: count }, (_, i) => i);
  const out = new Set<number>();
  for (const part of t.split(/[,;\s]+/)) {
    if (!part) continue;
    const m = /^(\d+)(?:-(\d*))?$/.exec(part);
    if (!m) continue;
    const a = Math.max(1, +m[1]);
    const b = m[2] === undefined ? a : m[2] === "" ? count : +m[2];
    for (let k = Math.min(a, b); k <= Math.min(count, Math.max(a, b)); k++) out.add(k - 1);
  }
  return [...out].sort((x, y) => x - y);
}

/**
 * buildPageDom clones one laid-out page from the live editor: the page
 * sheet, its header/footer and line numbers from the page layer, and the
 * text blocks that fall on the page, placed at the same offsets and
 * clipped to the page.
 */
export function buildPageDom(sheet: HTMLElement, dl: DocLayout, index: number): HTMLElement {
  const page = dl.layout.pages[index];
  const maxW = Math.max(...dl.layout.pages.map((p) => p.spec.w));
  const px = (maxW - page.spec.w) / 2;
  const out = sheet.cloneNode(false) as HTMLElement;
  out.removeAttribute("data-testid");
  out.style.cssText = `position:relative;width:${page.spec.w}px;height:${page.spec.h}px;min-width:0;min-height:0;padding:0;margin:0;overflow:hidden;box-shadow:none;background:${dl.settings.pageColor || "#fff"}`;
  out.classList.add("print-page");
  const shift = (el: HTMLElement) => {
    el.style.left = `${(parseFloat(el.style.left) || el.offsetLeft) - px}px`;
    el.style.top = `${(parseFloat(el.style.top) || el.offsetTop) - page.top}px`;
  };
  // Page sheet (border, watermark) and line numbers.
  const sheetEl = sheet.querySelector(`.doc-pages .doc-page[data-page="${index + 1}"]`) as HTMLElement | null;
  if (sheetEl) {
    const c = sheetEl.cloneNode(true) as HTMLElement;
    c.style.cssText += ";position:absolute;left:0;top:0;box-shadow:none";
    out.appendChild(c);
  }
  sheet.querySelectorAll<HTMLElement>(".doc-pages .doc-line-number, .doc-pages .doc-col-line").forEach((ln) => {
    const top = ln.offsetTop;
    if (top < page.top || top >= page.top + page.spec.h) return;
    const c = ln.cloneNode(true) as HTMLElement;
    c.style.position = "absolute";
    c.style.left = `${ln.offsetLeft - px}px`;
    c.style.top = `${top - page.top}px`;
    c.style.width = `${ln.offsetWidth}px`;
    c.style.height = `${ln.offsetHeight}px`;
    out.appendChild(c);
  });
  // Text.
  const pm = sheet.querySelector(".ProseMirror:not(.margin-editor .ProseMirror)") as HTMLElement | null;
  if (pm) {
    const pmRect = pm.getBoundingClientRect();
    const scale = pm.offsetWidth ? pmRect.width / pm.offsetWidth : 1;
    const kids = Array.from(pm.children) as HTMLElement[];
    const top = page.top - pm.offsetTop;
    const bottom = top + page.spec.h;
    let a = -1;
    let b = -1;
    kids.forEach((k, i) => {
      const r = k.getBoundingClientRect();
      const y0 = (r.top - pmRect.top) / scale;
      const y1 = (r.bottom - pmRect.top) / scale;
      const flow0 = k.offsetTop;
      const flow1 = k.offsetTop + k.offsetHeight;
      if ((y1 > top && y0 < bottom) || (flow1 > top && flow0 < bottom)) {
        if (a < 0) a = i;
        b = i;
      }
    });
    if (a >= 0) {
      const box = pm.cloneNode(false) as HTMLElement;
      box.removeAttribute("contenteditable");
      const first = kids[a];
      const mt = parseFloat(getComputedStyle(first).marginTop) || 0;
      box.style.cssText = `position:absolute;left:${pm.offsetLeft - px}px;width:${pm.offsetWidth}px;top:${first.offsetTop - mt + pm.offsetTop - page.top}px;min-height:0;display:flow-root`;
      for (let i = a; i <= b; i++) box.appendChild(kids[i].cloneNode(true));
      box.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
      box.querySelectorAll(".collaboration-cursor__caret, .ProseMirror-widget:not(.pg-spacer)").forEach((el) => {
        if (!(el as HTMLElement).classList.contains("pg-inner") && !(el as HTMLElement).classList.contains("pg-spacer")) el.remove();
      });
      out.appendChild(box);
    }
  }
  // Header and footer (live editors and static copies look the same).
  sheet.querySelectorAll<HTMLElement>(`.doc-page-chrome .doc-hf[data-page="${index + 1}"]`).forEach((hf) => {
    const c = hf.cloneNode(true) as HTMLElement;
    c.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
    shift(c);
    out.appendChild(c);
  });
  out.querySelectorAll(".ProseMirror-selectednode").forEach((el) => el.classList.remove("ProseMirror-selectednode"));
  return out;
}

/** printPages prints page clones with one @page size per page size. */
export function printPages(sheet: HTMLElement, dl: DocLayout, pages: number[]) {
  const root = document.createElement("div");
  root.className = "grown-print-root";
  const sizes = new Map<string, string>();
  for (const i of pages) {
    const p = dl.layout.pages[i];
    const name = `grown-${Math.round(p.spec.w)}x${Math.round(p.spec.h)}`;
    sizes.set(name, `@page ${name} { size: ${p.spec.w}px ${p.spec.h}px; margin: 0; }`);
    const el = buildPageDom(sheet, dl, i);
    el.style.setProperty("page", name);
    el.style.breakAfter = "page";
    root.appendChild(el);
  }
  const style = document.createElement("style");
  style.textContent =
    [...sizes.values()].join("\n") +
    `\n@media print { body > *:not(.grown-print-root) { display: none !important; } .grown-print-root { display: block !important; } .grown-print-root > .print-page:last-child { break-after: auto !important; } }` +
    `\n@media screen { .grown-print-root { display: none; } }`;
  document.head.appendChild(style);
  document.body.appendChild(root);
  const cleanup = () => {
    root.remove();
    style.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  // Browsers that don't fire afterprint (or print asynchronously).
  window.setTimeout(cleanup, 60_000);
}

export function PrintPreview({ editor, sheetRef, open, onClose }: { editor: Editor | null; sheetRef: React.RefObject<HTMLDivElement>; open: boolean; onClose: () => void }) {
  const [range, setRange] = useState("");
  const [ready, setReady] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const dl = editor ? getLayout(editor) : null;
  const total = dl?.layout.pages.length ?? 0;
  const pages = useMemo(() => parseRanges(range, total), [range, total]);
  // Pageless documents are laid out as pages while the preview is open.
  useEffect(() => {
    if (!open || !editor) return;
    setForcePaged(editor, true);
    afterNextLayout(editor, () => requestAnimationFrame(() => setReady((r) => r + 1)));
    return () => setForcePaged(editor, false);
  }, [open, editor]);
  useEffect(() => {
    const list = listRef.current;
    const sheet = sheetRef.current;
    if (!open || !list || !sheet || !editor) return;
    const layout = getLayout(editor);
    list.innerHTML = "";
    if (!layout) return;
    const scale = 0.5;
    for (const i of pages.slice(0, 60)) {
      const p = layout.layout.pages[i];
      const wrap = document.createElement("div");
      wrap.className = "print-preview-page";
      wrap.style.cssText = `width:${p.spec.w * scale}px;height:${p.spec.h * scale}px;margin:0 auto 16px;position:relative;box-shadow:0 1px 3px rgba(0,0,0,.3);overflow:hidden`;
      const el = buildPageDom(sheet, layout, i);
      el.style.transform = `scale(${scale})`;
      el.style.transformOrigin = "0 0";
      wrap.appendChild(el);
      const label = document.createElement("div");
      label.textContent = `${i + 1}`;
      label.style.cssText = "text-align:center;font-size:12px;color:#5f6368;margin:-12px 0 12px";
      list.appendChild(wrap);
      list.appendChild(label);
    }
  }, [open, pages, ready, editor, sheetRef]);
  if (!open) return null;
  return (
    <Modal open onClose={onClose}>
      <ModalDialog layout="fullscreen" data-testid="print-preview" sx={{ bgcolor: "#e8eaed" }}>
        <ModalClose />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography level="h4">Print preview</Typography>
          <Typography level="body-sm" sx={{ ml: 2 }}>
            Pages
          </Typography>
          <Input
            size="sm"
            placeholder={`All (1-${total})`}
            value={range}
            onChange={(e) => setRange(e.target.value)}
            slotProps={{ input: { "aria-label": "Page range", "data-testid": "print-range" } }}
            sx={{ width: 160 }}
          />
          <Typography level="body-xs" data-testid="print-count">
            {pages.length} of {total} page{total === 1 ? "" : "s"}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            data-testid="print-go"
            onClick={() => {
              const sheet = sheetRef.current;
              const layout = editor && getLayout(editor);
              if (sheet && layout) printPages(sheet, layout, pages);
            }}
          >
            Print
          </Button>
        </Box>
        <Box ref={listRef} sx={{ overflowY: "auto", flex: 1, pt: 2 }} />
      </ModalDialog>
    </Modal>
  );
}
