// In-place rich text editor for a slide text box (F1). The DOM is owned
// imperatively (buildEditorDom), never by React, so typing is native
// contentEditable; the model is read back (readEditorDom) whenever an edit
// command runs and when editing ends.

import { useEffect, useLayoutEffect, useRef } from "react";
import type { SlideElement } from "./model";
import {
  buildEditorDom,
  readEditorDom,
  selectionOffsets,
  setSelectionOffsets,
} from "./textDom";
import { indentParas, paraIndices, withRuns } from "./textOps";
import { textKeyAction, type TextKeyAction } from "./keymap";

export type EditResult = SlideElement | { el: SlideElement; sel?: [number, number] };

export interface TextEditorHandle {
  id: string;
  /** The element as edited so far (DOM read back into runs). */
  current(): SlideElement;
  /** The selection as [from, to] (ordered model offsets). */
  selection(): [number, number];
  /** Apply an edit to the selection: the DOM is rebuilt from the result and
   *  the selection restored (or moved to `sel`); the result is committed. */
  apply(fn: (el: SlideElement, from: number, to: number) => EditResult | null): void;
  /** Insert text at the caret natively (keeps the browser's undo). */
  insertNative(text: string): void;
}

/** CSS for list markers in the editor (the marker is not editable text). */
export const EDITOR_CSS = `
[data-text-editor] [data-para][data-marker]::before {
  content: attr(data-marker);
  display: inline-block;
  width: 42px;
  text-indent: 0;
  text-decoration: none;
}
::highlight(slides-find) { background-color: #fde293; }`;

function sameContent(a: SlideElement, b: SlideElement): boolean {
  return (
    (a.text || "") === (b.text || "") &&
    JSON.stringify(a.runs ?? null) === JSON.stringify(b.runs ?? null) &&
    JSON.stringify(a.paras ?? null) === JSON.stringify(b.paras ?? null) &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.baseline === b.baseline &&
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily &&
    a.color === b.color
  );
}

export function TextEditor({
  el,
  initialSel,
  handleRef,
  onCommit,
  onExit,
  onTextKey,
  onMouseUp,
}: {
  el: SlideElement;
  /** Selection on entry: model offsets, "all", or "end" (default). */
  initialSel?: [number, number] | "all" | "end";
  handleRef?: React.MutableRefObject<TextEditorHandle | null>;
  /** An edit command changed the text (one undo entry each). */
  onCommit: (el: SlideElement) => void;
  /** Editing ended (blur or Esc): the final element (null when unchanged)
   *  and the last selection. */
  onExit: (el: SlideElement | null, sel: [number, number]) => void;
  /** A formatting shortcut the editor doesn't handle itself. Return true if
   *  it was handled (the key's default is then prevented). */
  onTextKey?: (a: TextKeyAction, h: TextEditorHandle) => boolean;
  onMouseUp?: (h: TextEditorHandle) => void;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const elRef = useRef(el);
  elRef.current = el;
  // The model as of the last build/commit, to detect changes on exit.
  const base = useRef(el);
  const lastSel = useRef<[number, number]>([0, 0]);
  const exited = useRef(false);

  const read = (): SlideElement => {
    const n = root.current;
    if (!n) return elRef.current;
    const { runs, paras } = readEditorDom(n);
    return withRuns(elRef.current, runs, paras);
  };
  const sel = (): [number, number] => {
    const n = root.current;
    const s = n ? selectionOffsets(n) : null;
    if (s) lastSel.current = [Math.min(s[0], s[1]), Math.max(s[0], s[1])];
    return lastSel.current;
  };

  const handle: TextEditorHandle = {
    id: el.id,
    current: read,
    selection: sel,
    apply(fn) {
      const n = root.current;
      if (!n) return;
      const cur = read();
      const [from, to] = sel();
      const res = fn(cur, from, to);
      if (!res) return;
      const next = "el" in res && !("type" in res) ? res.el : (res as SlideElement);
      const nsel = "el" in res && !("type" in res) && res.sel ? res.sel : [from, to];
      elRef.current = next;
      buildEditorDom(n, next);
      n.focus();
      setSelectionOffsets(n, nsel[0], nsel[1]);
      lastSel.current = [Math.min(nsel[0], nsel[1]), Math.max(nsel[0], nsel[1])];
      base.current = next;
      onCommit(next);
    },
    insertNative(text) {
      root.current?.focus();
      document.execCommand("insertText", false, text);
    },
  };
  if (handleRef) handleRef.current = handle;
  useEffect(
    () => () => {
      if (handleRef && handleRef.current?.id === el.id) handleRef.current = null;
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Build the DOM once, on entering edit mode, and place the caret.
  useLayoutEffect(() => {
    const n = root.current;
    if (!n) return;
    buildEditorDom(n, el);
    n.focus();
    const len = (el.text || "").length;
    const s = initialSel === "all" ? [0, len] : Array.isArray(initialSel) ? initialSel : [len, len];
    setSelectionOffsets(n, Math.min(s[0], len), Math.min(s[1], len));
    lastSel.current = [s[0], s[1]];
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = () => {
    if (exited.current) return;
    exited.current = true;
    const s = sel();
    const next = read();
    onExit(sameContent(next, base.current) ? null : next, s);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const a = textKeyAction(e.nativeEvent, { editing: true, hasFormat: true });
    if (!a) return;
    if (a.type === "exitEdit") {
      e.preventDefault();
      root.current?.blur();
      return;
    }
    if (a.type === "insert") {
      e.preventDefault();
      handle.insertNative(a.text);
      return;
    }
    if (a.type === "tab") {
      e.preventDefault();
      const cur = read();
      const [from, to] = sel();
      const text = cur.text || "";
      const idxs = paraIndices(text, from, to);
      const paraStart = text.lastIndexOf("\n", from - 1) + 1;
      const level = cur.paras?.[idxs[0]]?.level ?? 0;
      // Lists (and multi-paragraph selections, and Shift+Tab on an indented
      // paragraph) change the level; otherwise Tab types a tab character.
      if (cur.list || idxs.length > 1 || (a.dir < 0 && level > 0) || (from === paraStart && level > 0 && a.dir > 0)) {
        handle.apply((m) => indentParas(m, idxs, a.dir));
      } else if (a.dir > 0) handle.insertNative("\t");
      return;
    }
    if (onTextKey?.(a, handle)) e.preventDefault();
  };

  return (
    <div
      ref={root}
      data-text-editor=""
      contentEditable
      suppressContentEditableWarning
      spellCheck
      style={{ width: "100%", outline: "none", cursor: "text", minHeight: "1em" }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      onKeyUp={() => sel()}
      onMouseUp={() => {
        sel();
        onMouseUp?.(handle);
      }}
      onPaste={(e) => {
        // Paste as plain text in the run at the caret.
        const t = e.clipboardData.getData("text/plain");
        if (!t) return;
        e.preventDefault();
        document.execCommand("insertText", false, t);
      }}
      onBlur={finish}
    />
  );
}
