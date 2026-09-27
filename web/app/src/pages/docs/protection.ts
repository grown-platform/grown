// Document protection (Docs M10): Word's w:documentProtection. The setting
// lives in the doc's `protection` Yjs map (mode, enforced, and an optional
// password hash), so every collaborator's editor enforces it:
//   - readOnly: no edits;
//   - comments: only comments can be added / removed;
//   - trackedChanges: every edit is tracked and changes can't be accepted
//     or rejected;
//   - forms: only form fields can be filled (the fill-in view, sdt.ts).
// Enforcement is a filterTransaction (remote Yjs updates always apply; the
// server drops non-owners' writes for read-only documents, see
// internal/docs). A password is hashed as ECMA-376 specifies for
// w:documentProtection (SHA-512 over salt + UTF-16LE password, then
// `spinCount` rounds of hash + 4-byte little-endian round number); only the
// hash, salt and count are stored.
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep } from "@tiptap/pm/transform";
import * as Y from "yjs";
import { getDocModel } from "./docModel";
import { fromBase64, sha512, toBase64 } from "./sha512";

export type ProtectionMode = "none" | "readOnly" | "comments" | "trackedChanges" | "forms";

export const PROTECTION_LABEL: Record<ProtectionMode, string> = {
  none: "No protection",
  readOnly: "Read only",
  comments: "Comments only",
  trackedChanges: "Tracked changes only",
  forms: "Filling forms only",
};

export interface Protection {
  mode: ProtectionMode;
  enforced: boolean;
  /** Base64 SHA-512 hash, salt and spin count (w:hashValue etc.). */
  hash?: string;
  salt?: string;
  spinCount?: number;
  algorithm?: string;
}

export const NO_PROTECTION: Protection = { mode: "none", enforced: false };

export const SPIN_COUNT = 100_000;

/** hashPassword: the w:documentProtection hash of a password. */
export function hashPassword(password: string, saltB64: string, spinCount = SPIN_COUNT): string {
  const salt = fromBase64(saltB64);
  const pw = new Uint8Array(password.length * 2);
  for (let i = 0; i < password.length; i++) {
    const c = password.charCodeAt(i);
    pw[2 * i] = c & 0xff;
    pw[2 * i + 1] = c >> 8;
  }
  const first = new Uint8Array(salt.length + pw.length);
  first.set(salt);
  first.set(pw, salt.length);
  let h = sha512(first);
  const buf = new Uint8Array(68);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < spinCount; i++) {
    buf.set(h);
    dv.setUint32(64, i, true);
    h = sha512(buf);
  }
  return toBase64(h);
}

export function newSalt(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return toBase64(b);
}

/** protectWith: a protection setting, hashing the password if given. */
export function protectWith(mode: ProtectionMode, password = "", spinCount = SPIN_COUNT): Protection {
  if (mode === "none") return NO_PROTECTION;
  if (!password) return { mode, enforced: true };
  const salt = newSalt();
  return { mode, enforced: true, algorithm: "SHA-512", salt, spinCount, hash: hashPassword(password, salt, spinCount) };
}

/** checkPassword: does `password` open this protection? (No password set:
 *  always. A hash Grown can't verify — Word's legacy pre-hash — only for
 *  the owner, see canUnprotect.) */
export function checkPassword(p: Protection, password: string): boolean {
  if (!p.hash) return true;
  if (!p.salt || (p.algorithm && !/sha-?512/i.test(p.algorithm))) return false;
  return hashPassword(password, p.salt, p.spinCount ?? SPIN_COUNT) === p.hash;
}

// --- the store ---------------------------------------------------------------------------

export function readProtection(map: Y.Map<unknown>): Protection {
  const raw = map.get("value");
  if (typeof raw !== "string") return NO_PROTECTION;
  try {
    const p = JSON.parse(raw) as Protection;
    return p && p.mode ? p : NO_PROTECTION;
  } catch {
    return NO_PROTECTION;
  }
}

const maps = new WeakMap<Editor, Y.Map<unknown>>();

/** protectionMap: the editor's `protection` Yjs map. */
export function protectionMap(editor: Editor): Y.Map<unknown> {
  let m = maps.get(editor);
  if (!m) {
    const model = getDocModel(editor);
    const ydoc = (model?.sheet.map.doc as Y.Doc | null) ?? new Y.Doc();
    m = ydoc.getMap("protection");
    maps.set(editor, m);
  }
  return m;
}

export function getProtection(editor: Editor): Protection {
  return readProtection(protectionMap(editor));
}

/** setProtection stores a setting (the editor picks it up at once). */
export function setProtection(editor: Editor, p: Protection): void {
  protectionMap(editor).set("value", JSON.stringify(p));
  sync(editor);
}

function sync(editor: Editor): void {
  if (editor.isDestroyed) return;
  const p = getProtection(editor);
  const cur = protectionKey.getState(editor.state);
  if (cur && cur.mode === effective(p)) return;
  editor.view.dispatch(editor.state.tr.setMeta(protectionKey, { mode: effective(p) }));
}

const effective = (p: Protection): ProtectionMode => (p.enforced ? p.mode : "none");

// --- enforcement -------------------------------------------------------------------------

export const protectionKey = new PluginKey<{ mode: ProtectionMode }>("protection");

export function protectionState(state: EditorState): { mode: ProtectionMode } {
  return protectionKey.getState(state) ?? { mode: "none" };
}

/** Transactions that resolve tracked changes carry this meta. */
export const REVIEW_RESOLVE = "reviewResolve";

function remote(tr: Transaction): boolean {
  const y = tr.getMeta("y-sync$") as { isChangeOrigin?: boolean } | undefined;
  return !!y?.isChangeOrigin || !!tr.getMeta("preventUpdate") || !!tr.getMeta(protectionKey);
}

/** allowed: may a local transaction apply under `mode`? */
export function allowedUnder(mode: ProtectionMode, tr: Transaction): boolean {
  if (mode === "none" || mode === "forms" || !tr.docChanged || remote(tr)) return true;
  if (mode === "readOnly") return false;
  if (mode === "comments")
    return tr.steps.every((s) => (s instanceof AddMarkStep || s instanceof RemoveMarkStep) && s.mark.type.name === "commentMark");
  if (mode === "trackedChanges") return !tr.getMeta(REVIEW_RESOLVE);
  return true;
}

export const DocProtection = Extension.create({
  name: "docProtection",
  priority: 1200,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<{ mode: ProtectionMode }>({
        key: protectionKey,
        view() {
          const map = protectionMap(editor);
          const h = () => queueMicrotask(() => sync(editor));
          map.observe(h);
          h();
          return { destroy: () => map.unobserve(h) };
        },
        state: {
          init: () => ({ mode: "none" }),
          apply(tr, v) {
            const m = tr.getMeta(protectionKey) as { mode: ProtectionMode } | undefined;
            return m ? { mode: m.mode } : v;
          },
        },
        filterTransaction(tr, state) {
          return allowedUnder(protectionState(state).mode, tr);
        },
      }),
    ];
  },
});
