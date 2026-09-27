// Where Compare / Combine get the other document from (Docs M12): another
// Grown doc (its live Yjs content, read through a short-lived collab
// connection), a saved version (HTML snapshot), or an uploaded .docx (the
// M6 reader) — and how a result becomes a new Grown doc (the docx seed
// channel the importer uses, so styles and lists come along).
import type { Editor } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { createCollab } from "../collab";
import { createDoc, getVersion, listVersions } from "../api";
import { getDocModel } from "../docModel";
import type { DocxImport } from "../docx/model";
import { stashDocxSeed } from "../docx/seed";
import { htmlToDoc } from "./index";

export interface LoadedDoc {
  doc: PMNode;
  /** A suggested author for changes made by this document. */
  author: string;
  label: string;
  /** Styles / lists that came with it (an uploaded .docx). */
  model?: Pick<DocxImport, "styles" | "numbering">;
}

/** loadGrownDoc reads another Grown doc's current content. */
export async function loadGrownDoc(schema: Schema, id: string, title = "", timeoutMs = 10_000): Promise<LoadedDoc> {
  const collab = createCollab(id);
  try {
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error("Timed out loading the document.")), timeoutMs);
      const done = (synced: boolean) => {
        if (!synced) return;
        window.clearTimeout(t);
        resolve();
      };
      if (collab.provider.synced) done(true);
      collab.provider.on("sync", done);
      collab.provider.on("connection-close", (ev: CloseEvent | null) => {
        if (ev && (ev.code === 4401 || ev.code === 4403 || ev.code === 1008)) {
          window.clearTimeout(t);
          reject(new Error("You don't have access to that document."));
        }
      });
    });
    const frag = collab.ydoc.getXmlFragment("default");
    const doc = frag.length ? yXmlFragmentToProseMirrorRootNode(frag, schema) : schema.nodes.doc.createAndFill()!;
    let author = title;
    try {
      const vs = await listVersions(id);
      if (vs[0]?.author_name) author = vs[0].author_name;
    } catch {
      /* versions are optional */
    }
    return { doc, author: author || "Compared document", label: title || "Untitled document" };
  } finally {
    collab.destroy();
  }
}

/** loadVersionDoc reads a saved version of a doc. */
export async function loadVersionDoc(schema: Schema, docId: string, versionId: string): Promise<LoadedDoc> {
  const v = await getVersion(docId, versionId);
  return {
    doc: htmlToDoc(schema, v.content_html ?? ""),
    author: v.author_name || "Earlier version",
    label: v.label || new Date(v.created_at).toLocaleString(),
  };
}

/** docxAuthor reads docProps/core.xml's last-modified-by (else creator). */
async function docxAuthor(file: Blob): Promise<string> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(file);
    const core = await zip.file("docProps/core.xml")?.async("string");
    if (!core) return "";
    const pick = (tag: string) => new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`).exec(core)?.[1]?.trim() ?? "";
    return pick("lastModifiedBy") || pick("creator");
  } catch {
    return "";
  }
}

/** loadDocxFile reads an uploaded .docx with the direct reader. */
export async function loadDocxFile(schema: Schema, file: File): Promise<LoadedDoc> {
  const { readDocx } = await import("../docx/read");
  const imp = await readDocx(file);
  const doc = schema.nodeFromJSON(imp.doc);
  return {
    doc,
    author: (await docxAuthor(file)) || file.name.replace(/\.docx$/i, ""),
    label: file.name,
    model: { styles: imp.styles, numbering: imp.numbering },
  };
}

/** currentModel snapshots the editor's styles and lists for a new doc. */
function currentModel(editor: Editor): Pick<DocxImport, "styles" | "numbering"> {
  const { sheet, numbering } = getDocModel(editor);
  return { styles: sheet.map.toJSON() as DocxImport["styles"], numbering: numbering.map.toJSON() as DocxImport["numbering"] };
}

/** createDocFrom creates a Grown doc holding `doc` (styles and lists from
 *  the current document, plus `extra`) and returns its id; the editor
 *  seeds it when it opens. */
export async function createDocFrom(editor: Editor, title: string, doc: PMNode, extra?: Pick<DocxImport, "styles" | "numbering">): Promise<string> {
  const d = await createDoc(title);
  const base = currentModel(editor);
  stashDocxSeed(d.id, {
    doc: doc.toJSON(),
    styles: { ...(extra?.styles ?? {}), ...base.styles },
    numbering: { ...(extra?.numbering ?? {}), ...base.numbering },
    header: null,
    footer: null,
    comments: [],
    page: null,
    warnings: [],
  });
  return d.id;
}
