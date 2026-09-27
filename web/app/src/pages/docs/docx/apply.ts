// Glue between the DOCX reader/writer and a live editor (Docs M6):
// applying an import to a document (body, `styles` / `numbering` maps,
// header/footer fragments, comment threads) and collecting a document's
// model for export.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import * as Y from "yjs";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { getDocModel } from "../docModel";
import { marginSchema } from "../margin";
import type { DocxComment, DocxImport } from "./model";
import type { DocxWriteInput } from "./write";

/** The Yjs document behind the editor's styles/numbering maps. */
export function modelDoc(editor: Editor): Y.Doc | null {
  return (getDocModel(editor).sheet.map.doc as Y.Doc | null) ?? null;
}

/**
 * applyDocxImport writes an import into the editor's document: style and
 * list definitions first (so numbering labels resolve), then the body,
 * then the header/footer fragments when they are still empty.
 */
export function applyDocxImport(editor: Editor, imp: DocxImport): void {
  const { sheet, numbering } = getDocModel(editor);
  const ydoc = modelDoc(editor);
  const write = () => {
    for (const def of Object.values(imp.styles)) sheet.put(def);
    for (const [key, v] of Object.entries(imp.numbering)) numbering.map.set(key, JSON.parse(JSON.stringify(v)));
    if (ydoc) {
      for (const kind of ["header", "footer"] as const) {
        const json = imp[kind];
        const frag = ydoc.getXmlFragment(kind);
        if (json && frag.length === 0) prosemirrorJSONToYXmlFragment(marginSchema(), json, frag);
      }
    }
  };
  if (ydoc) ydoc.transact(write);
  else write();
  editor.commands.setContent(imp.doc);
}

/** Comment marks on the body: comment id -> [from, to]. */
export function commentRanges(doc: PMNode): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const m of node.marks) {
      if (m.type.name !== "commentMark") continue;
      const id = m.attrs.commentId as string;
      const r = out.get(id);
      out.set(id, r ? [Math.min(r[0], pos), Math.max(r[1], pos + node.nodeSize)] : [pos, pos + node.nodeSize]);
    }
    return false;
  });
  return out;
}

export interface CommentApi {
  add(body: string, quote: string, from: number, to: number): Promise<{ id: string }>;
  reply(parentId: string, body: string): Promise<unknown>;
  resolve(id: string): Promise<unknown>;
}

/**
 * importComments creates the imported threads on the server (anchored at
 * their marks), then renames the marks to the server ids. The original
 * author is kept in the text when it isn't the importing user.
 */
export async function importComments(
  editor: Editor,
  comments: DocxComment[],
  api: CommentApi,
  currentUser = "",
): Promise<number> {
  const ranges = commentRanges(editor.state.doc);
  const body = (c: DocxComment) =>
    c.author && c.author !== currentUser ? `${c.text}\n\n— ${c.author}` : c.text || "(empty comment)";
  const newIds = new Map<string, string>();
  let n = 0;
  for (const c of comments) {
    if (c.parentId) continue;
    const [from, to] = ranges.get(c.id) ?? [0, 0];
    const quote = to > from ? editor.state.doc.textBetween(from, to, " ") : "";
    try {
      const created = await api.add(body(c), quote, from, to);
      newIds.set(c.id, created.id);
      n++;
      if (c.resolved) await api.resolve(created.id).catch(() => {});
    } catch {
      /* keep going; the mark stays as an orphan highlight */
    }
  }
  for (const c of comments) {
    const parent = c.parentId && newIds.get(c.parentId);
    if (!parent) continue;
    try {
      await api.reply(parent, body(c));
      n++;
    } catch {
      /* ignore */
    }
  }
  // Point the marks at the server's ids.
  editor.commands.command(({ tr, state }) => {
    const type = state.schema.marks.commentMark;
    if (!type) return false;
    state.doc.descendants((node, pos) => {
      if (!node.isInline) return true;
      for (const m of node.marks) {
        if (m.type !== type) continue;
        const next = newIds.get(m.attrs.commentId as string);
        tr.removeMark(pos, pos + node.nodeSize, m);
        if (next) tr.addMark(pos, pos + node.nodeSize, type.create({ commentId: next }));
      }
      return false;
    });
    return true;
  });
  return n;
}

/** A server comment thread, as api.ts returns it. */
export interface ServerComment {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
  resolved: boolean;
  anchor_from: number;
  anchor_to: number;
  replies?: ServerComment[];
}

/** serverComments flattens server threads for the writer. */
export function serverComments(list: ServerComment[]): DocxComment[] {
  const out: DocxComment[] = [];
  for (const c of list) {
    out.push({ id: c.id, author: c.author_name, date: c.created_at, text: c.body, resolved: c.resolved });
    for (const r of c.replies ?? [])
      out.push({ id: r.id, author: r.author_name, date: r.created_at, text: r.body, parentId: c.id });
  }
  return out;
}

/**
 * collectDocxInput gathers what the writer needs from an editor. Comments
 * whose marks are missing (the comments panel draws them only while open)
 * are anchored from their stored positions on a copy of the body.
 */
export function collectDocxInput(
  editor: Editor,
  opts: { title?: string; comments?: ServerComment[] } = {},
): DocxWriteInput {
  const { sheet, numbering } = getDocModel(editor);
  let doc = editor.state.doc;
  const threads = opts.comments ?? [];
  const marked = commentRanges(doc);
  const type = editor.schema.marks.commentMark;
  if (type && threads.some((c) => !marked.has(c.id))) {
    const tr = editor.state.tr;
    const size = doc.content.size;
    for (const c of threads) {
      if (marked.has(c.id)) continue;
      const from = Math.min(Math.max(1, c.anchor_from), size);
      const to = Math.min(Math.max(from, c.anchor_to), size);
      if (to > from) tr.addMark(from, to, type.create({ commentId: c.id }));
    }
    doc = tr.doc;
  }
  const ydoc = modelDoc(editor);
  const margin = (kind: "header" | "footer") => {
    if (!ydoc) return null;
    const frag = ydoc.getXmlFragment(kind);
    if (!frag.length) return null;
    try {
      return yXmlFragmentToProseMirrorRootNode(frag, marginSchema());
    } catch {
      return null;
    }
  };
  return {
    doc,
    sheet,
    numbering,
    header: margin("header"),
    footer: margin("footer"),
    comments: serverComments(threads),
    title: opts.title,
  };
}
