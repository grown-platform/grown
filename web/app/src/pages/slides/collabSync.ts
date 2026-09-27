// Client side of the hardened slides collab protocol (M10). The hub
// (internal/slides/collab.go) stamps each deck op with a room sequence number
// and acks the sender; this module keeps
//
//   confirmed — the deck as the server ordered it (snapshot + stamped ops),
//   pending   — this tab's ops not yet acknowledged (sent or queued offline),
//
// so that a rejected (stale) op is rolled back by re-basing: the local deck
// becomes confirmed + the remaining pending ops. Remote ops are applied to the
// local deck directly (they commute with pending ops on other keys; an op of
// ours on the same key is stale and will be rejected). On reconnect the tab
// says hello with the last seq it applied, gets the ops it missed, and resends
// what is still pending (the hub de-duplicates by op id). When the room
// changed epoch (everyone left, the log was reset by a restore, or the gap is
// too old), the tab reloads the stored snapshot and re-bases on it.
//
// OwnHistory is undo/redo that only undoes your own changes: each step keeps
// the deck before it and "before + my changes" (after); undo carries
// after→before onto the live deck strictly (deckDiff.carryChanges), so edits
// collaborators made since stay.

import { applyCollabOp } from "./deckOps";
import type { DeckDoc } from "./model";
import { uid } from "./model";
import { applyCommentOp, isCommentOp } from "./comments";
import { applySlidePatch, carryChanges, type WireOp } from "./deckDiff";
import { HISTORY_COALESCE_MS, HISTORY_LIMIT } from "./history";

export type { WireOp } from "./deckDiff";

/** applyOp applies any deck op (element, slide list, deck, slide props,
 *  comment). Unknown ops return the doc unchanged. */
export function applyOp(doc: DeckDoc, m: WireOp): DeckDoc {
  if (m.t === "slideProps" && typeof m.si === "string" && m.patch && typeof m.patch === "object") {
    const patch = m.patch as Record<string, unknown>;
    return { ...doc, slides: doc.slides.map((s) => (s.id === m.si ? applySlidePatch(s, patch) : s)) };
  }
  if (isCommentOp(m)) return applyCommentOp(doc, m);
  if (m.t === "deck") {
    // A whole-deck op carries the sender's comments, which have their own
    // ops: keep ours.
    const next = applyCollabOp(doc, m as Parameters<typeof applyCollabOp>[1]);
    return next === doc || !next ? doc : { ...next, comments: doc.comments };
  }
  return applyCollabOp(doc, m as Parameters<typeof applyCollabOp>[1]);
}

const CONTROL = new Set(["welcome", "synced", "ack", "reject", "presence", "hello", "saved"]);

interface Pending {
  id: string;
  op: WireOp;
  base: number;
}

/** What the editor must do after DeckSync handled a message. */
export interface SyncEffect {
  /** Apply this remote op to the local deck. */
  remote?: WireOp;
  /** Replace the local deck (after a rejection or a re-base). */
  doc?: DeckDoc;
  /** Messages to send. */
  send?: WireOp[];
  /** Fetch the stored snapshot and pass it to setSnapshot. */
  refetch?: boolean;
  /** Ops of ours the server rejected as stale. */
  rejected?: WireOp[];
  /** The deck was restored to a version: reload. */
  reload?: boolean;
  /** A presence message. */
  presence?: WireOp;
}

export class DeckSync {
  readonly cid: string;
  epoch: string | null = null;
  lastSeq = 0;
  confirmed: DeckDoc | null = null;
  pending: Pending[] = [];
  /** Stamped ops received while no snapshot is loaded. */
  private buffered: WireOp[] = [];
  /** Handshake done (welcome … synced) on the current socket. */
  synced = false;
  private open = false;
  private fresh = false;
  private n = 0;

  constructor(cid: string = `${uid()}${uid()}`) {
    this.cid = cid;
  }

  /** The socket opened: the hello to send. */
  onOpen(): WireOp {
    this.open = true;
    this.synced = false;
    return { t: "hello", cid: this.cid, since: this.lastSeq, epoch: this.epoch ?? "" };
  }

  onClose(): void {
    this.open = false;
    this.synced = false;
  }

  /** The stored deck was loaded (first load, or after a refetch). Returns
   *  the local deck: snapshot + buffered remote ops + pending ops. */
  setSnapshot(doc: DeckDoc): DeckDoc {
    let d = doc;
    for (const m of this.buffered) d = applyOp(d, m);
    this.buffered = [];
    this.confirmed = d;
    return this.local();
  }

  /** The local view: confirmed + pending. */
  local(): DeckDoc {
    let d = this.confirmed!;
    for (const p of this.pending) d = applyOp(d, p.op);
    return d;
  }

  /** A local op: queued as pending; returns the message to send now (null
   *  while offline or still catching up — it is sent after "synced"). */
  push(op: WireOp): WireOp | null {
    const p: Pending = { id: `${this.cid}.${++this.n}`, op, base: this.lastSeq };
    this.pending.push(p);
    return this.synced && this.open ? this.wire(p) : null;
  }

  private wire(p: Pending): WireOp {
    return { ...p.op, id: p.id, base: p.base };
  }

  /** The seq to report after a save of the local deck: the save includes
   *  every op up to it. */
  savedSeq(): number {
    return this.lastSeq;
  }

  receive(m: WireOp): SyncEffect {
    const t = m.t;
    if (t === "presence") return { presence: m };
    if (m.t === "versionRestored" || m.type === "versionRestored") return { reload: true };
    if (t === "welcome") {
      const epoch = String(m.epoch ?? "");
      const hadEpoch = this.epoch !== null;
      this.fresh = !!m.fresh;
      this.epoch = epoch;
      if (this.fresh) {
        this.lastSeq = 0;
        if (hadEpoch && this.confirmed) {
          // Re-base on the stored deck: it may hold edits made while we
          // were away that this room's log no longer has.
          this.confirmed = null;
          this.buffered = [];
          return { refetch: true };
        }
      }
      return {};
    }
    if (t === "synced") {
      this.synced = true;
      const seq = Number(m.seq ?? 0);
      if (seq > this.lastSeq) this.lastSeq = seq;
      if (this.fresh) for (const p of this.pending) p.base = this.lastSeq;
      this.fresh = false;
      return this.pending.length ? { send: this.pending.map((p) => this.wire(p)) } : {};
    }
    if (t === "ack") {
      const seq = Number(m.seq ?? 0);
      if (seq > this.lastSeq) this.lastSeq = seq;
      this.confirmOwn(String(m.id ?? ""));
      return {};
    }
    if (t === "reject") {
      const i = this.pending.findIndex((p) => p.id === m.id);
      if (i < 0) return {};
      const [p] = this.pending.splice(i, 1);
      if (!this.confirmed) return { rejected: [p.op] };
      return { doc: this.local(), rejected: [p.op] };
    }
    if (CONTROL.has(t)) return {};
    // A stamped deck op (or an unstamped one from an older client).
    const seq = typeof m.seq === "number" ? m.seq : null;
    if (seq !== null) {
      if (seq <= this.lastSeq) return {};
      this.lastSeq = seq;
    }
    const op = stripMeta(m);
    if (m.cid === this.cid && typeof m.id === "string" && this.pending.some((p) => p.id === m.id)) {
      this.confirmOwn(m.id);
      return {};
    }
    if (!this.confirmed) {
      this.buffered.push(op);
      return {};
    }
    this.confirmed = applyOp(this.confirmed, op);
    return { remote: op };
  }

  private confirmOwn(id: string) {
    const i = this.pending.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [p] = this.pending.splice(i, 1);
    if (this.confirmed) this.confirmed = applyOp(this.confirmed, p.op);
    else this.buffered.push(p.op);
  }
}

/** stripMeta drops the protocol fields from a relayed op. */
export function stripMeta(m: WireOp): WireOp {
  const { seq: _s, cid: _c, id: _i, base: _b, ...op } = m;
  void _s;
  void _c;
  void _i;
  void _b;
  return op as WireOp;
}

// ---- undo that only undoes your own changes ----

interface Step {
  before: DeckDoc;
  after: DeckDoc;
}

export class OwnHistory {
  past: Step[] = [];
  future: Step[] = [];
  private t = 0;

  /** Start a step before a local change (coalesced like history.ts). */
  record(current: DeckDoc | null, now: number): void {
    if (!current) return;
    if (now - this.t <= HISTORY_COALESCE_MS && this.past.length) return;
    this.t = now;
    this.past.push({ before: current, after: current });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  /** Note a local change prev→next into the current step. */
  note(prev: DeckDoc, next: DeckDoc): void {
    const top = this.past[this.past.length - 1];
    if (!top) return;
    top.after = carryChanges(prev, next, top.after, false);
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }
  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Undo your last step on the live deck. Null when there is nothing. */
  undo(current: DeckDoc): DeckDoc | null {
    const step = this.past.pop();
    if (!step) return null;
    this.future.push(step);
    this.t = 0;
    return carryChanges(step.after, step.before, current, true);
  }

  redo(current: DeckDoc): DeckDoc | null {
    const step = this.future.pop();
    if (!step) return null;
    this.past.push(step);
    this.t = 0;
    return carryChanges(step.before, step.after, current, true);
  }
}
