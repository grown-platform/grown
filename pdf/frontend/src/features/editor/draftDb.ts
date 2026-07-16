// ---- Autosave draft persistence (Wave 6a) -----------------------------------
// A tiny IndexedDB wrapper storing ONE editor draft so an accidental refresh /
// tab-close doesn't lose in-progress work. We use IndexedDB (not localStorage)
// because a draft carries the raw PDF bytes (a Uint8Array), which are far too
// large — and binary — for localStorage. IDB persists structured-cloneable
// values natively, so the Uint8Array + plain-JSON annotation/page model round-
// trip without any base64 encoding.
//
// Everything here is best-effort: private-browsing / disabled-storage
// environments make `indexedDB` throw or return errors, so every call is guarded
// and simply resolves to a no-op (autosave silently skips) rather than crashing
// the editor.

// The DB + store names are part of the public contract with the e2e suite, which
// clears the database between tests (see editor-persist.spec.ts). Keep in sync.
export const DRAFT_DB_NAME = "pdf-editor-drafts";
const DRAFT_STORE = "drafts";
const DRAFT_KEY = "current"; // single-record store → one fixed key
const DB_VERSION = 1;

// The persisted draft. `pdfBytes` is binary (stored as a Uint8Array); everything
// else is plain JSON. Typed loosely here so this module stays decoupled from the
// editor's Annotation / PageEntry / HeaderFooterConfig types (the caller casts).
export interface EditorDraft {
  pdfBytes: Uint8Array;
  pages: unknown[];
  annotations: unknown[];
  docName: string;
  hf: unknown;
  // Wave 6b — document metadata (Info dictionary). Optional for back-compat with
  // drafts written before it existed.
  meta?: unknown;
  savedAt: number;
}

// Open (creating/upgrading) the draft database. Rejects if IDB is unavailable.
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DRAFT_DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e instanceof Error ? e : new Error("IndexedDB open failed"));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open error"));
  });
}

// Wrap an IDBRequest in a promise.
function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request error"));
  });
}

// Persist (replace) the single draft record. Best-effort: resolves even on
// failure so a debounced autosave never surfaces an error to the user.
export async function saveDraft(draft: EditorDraft): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(DRAFT_STORE, "readwrite");
      // `pdfBytes` may be a subarray view over a larger buffer; slice() so the
      // structured clone stores exactly the document bytes, decoupled from any
      // buffer that other code (react-pdf) might later detach.
      const record: EditorDraft = { ...draft, pdfBytes: draft.pdfBytes.slice() };
      tx.objectStore(DRAFT_STORE).put(record, DRAFT_KEY);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx error"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx aborted"));
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore — autosave is best-effort.
  }
}

// Read the stored draft, or null if there is none / IDB is unavailable. A
// restored Uint8Array is normalized (some engines may hand back an ArrayBuffer).
export async function loadDraft(): Promise<EditorDraft | null> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(DRAFT_STORE, "readonly");
      const rec = await reqPromise<EditorDraft | undefined>(tx.objectStore(DRAFT_STORE).get(DRAFT_KEY));
      if (!rec) return null;
      const bytes = rec.pdfBytes;
      const pdfBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
      if (!pdfBytes.byteLength) return null;
      return { ...rec, pdfBytes };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

// Delete the stored draft (Close / New / after a successful save). Best-effort.
export async function clearDraft(): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(DRAFT_STORE, "readwrite");
      tx.objectStore(DRAFT_STORE).delete(DRAFT_KEY);
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore.
  }
}
