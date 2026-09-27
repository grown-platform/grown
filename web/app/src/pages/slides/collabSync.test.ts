import { describe, expect, it } from "vitest";
import type { DeckDoc, SlideElement } from "./model";
import { DeckSync, OwnHistory, applyOp, type WireOp } from "./collabSync";
import { diffOps } from "./deckDiff";

// A model of internal/slides/collab.go's rules (seq, log, ack, stale-op
// rejection on overlapping keys, de-duplication, catch-up) with explicit
// per-client delivery queues, so tests can interleave messages.

function keys(m: WireOp): string[] {
  const si = m.si as string;
  switch (m.t) {
    case "upsert":
      return [`e:${si}:${(m.el as SlideElement).id}`];
    case "remove":
      return [`e:${si}:${m.elId}`];
    case "upsertMany":
      return (m.els as SlideElement[]).map((e) => `e:${si}:${e.id}`);
    case "removeMany":
      return (m.ids as string[]).map((id) => `e:${si}:${id}`);
    case "reorder":
    case "setElements":
      return [`s:${si}`];
    case "slideProps":
      return [`p:${si}`];
    case "comment":
      return [`c:${(m.c as { id: string }).id}`];
  }
  return ["*"];
}
function overlap(a: string, b: string) {
  if (a === "*" || b === "*" || a === b) return true;
  const sl = (k: string) => (k.startsWith("s:") ? k.slice(2) : null);
  const es = (k: string) => (k.startsWith("e:") ? k.split(":")[1] : null);
  return (sl(a) !== null && sl(a) === es(b)) || (sl(b) !== null && sl(b) === es(a));
}

interface Entry {
  seq: number;
  cid: string;
  id: string;
  keys: string[];
  msg: WireOp;
}

class FakeHub {
  seq = 0;
  log: Entry[] = [];
  epoch = "E1";
  clients = new Map<string, Client>();

  hello(c: Client, h: WireOp) {
    this.clients.set(c.sync.cid, c);
    const fresh = h.epoch !== this.epoch || (h.since as number) > this.seq;
    const from = fresh ? 0 : (h.since as number);
    c.inbox.push({ t: "welcome", epoch: this.epoch, seq: this.seq, fresh });
    for (const e of this.log) if (e.seq > from) c.inbox.push(e.msg);
    c.inbox.push({ t: "synced", seq: this.seq });
  }

  route(c: Client, m: WireOp) {
    const cid = c.sync.cid;
    const id = m.id as string;
    const dup = this.log.find((e) => e.cid === cid && e.id === id);
    if (dup) return c.inbox.push({ t: "ack", id, seq: dup.seq });
    const ks = keys(m);
    const base = m.base as number;
    if (this.log.some((e) => e.seq > base && e.cid !== cid && ks.some((k) => e.keys.some((k2) => overlap(k, k2)))))
      return c.inbox.push({ t: "reject", id, seq: this.seq });
    this.seq++;
    const stamped = { seq: this.seq, cid, ...m };
    this.log.push({ seq: this.seq, cid, id, keys: ks, msg: stamped });
    for (const [k, o] of this.clients) if (k !== cid) o.inbox.push(stamped);
    c.inbox.push({ t: "ack", id, seq: this.seq });
  }
}

class Client {
  sync = new DeckSync();
  doc!: DeckDoc;
  inbox: WireOp[] = [];
  outbox: WireOp[] = [];
  rejected: WireOp[] = [];
  online = false;
  constructor(
    public hub: FakeHub,
    snapshot: DeckDoc,
  ) {
    this.doc = this.sync.setSnapshot(snapshot);
  }
  connect() {
    this.online = true;
    this.hub.hello(this, this.sync.onOpen());
  }
  disconnect() {
    this.online = false;
    this.hub.clients.delete(this.sync.cid);
    this.sync.onClose();
    this.inbox = [];
    this.outbox = [];
  }
  /** A local edit: applied at once, sent when possible. */
  edit(op: WireOp) {
    this.doc = applyOp(this.doc, op);
    const w = this.sync.push(op);
    if (w) this.outbox.push(w);
  }
  /** Deliver our queued messages to the hub. */
  flushOut() {
    for (const m of this.outbox.splice(0)) this.hub.route(this, m);
  }
  /** Process everything in our inbox. */
  drain() {
    while (this.inbox.length) {
      const e = this.sync.receive(this.inbox.shift()!);
      if (e.remote) this.doc = applyOp(this.doc, e.remote);
      if (e.doc) this.doc = e.doc;
      if (e.rejected) this.rejected.push(...e.rejected);
      if (e.send) this.outbox.push(...e.send);
      if (e.refetch) this.doc = this.sync.setSnapshot(this.hub.snapshot!);
    }
  }
}
interface FakeHub {
  snapshot?: DeckDoc;
}

const el = (id: string, x = 0): SlideElement => ({ id, type: "shape", x, y: 0, w: 10, h: 10 }) as SlideElement;
const start = (): DeckDoc => ({ slides: [{ id: "s1", background: "#fff", elements: [el("x"), el("y")] }] });
const move = (id: string, x: number): WireOp => ({ t: "upsert", si: "s1", el: el(id, x) });
const xOf = (d: DeckDoc, id: string) => d.slides[0].elements.find((e) => e.id === id)?.x;

function settle(...cs: Client[]) {
  for (let i = 0; i < 20; i++) {
    for (const c of cs) c.flushOut();
    for (const c of cs) c.drain();
  }
}

describe("DeckSync", () => {
  it("two clients moving the same element at once converge on the first stamped", () => {
    const hub = new FakeHub();
    const a = new Client(hub, start());
    const b = new Client(hub, start());
    a.connect();
    b.connect();
    settle(a, b);
    // Both move x before seeing the other's move.
    a.edit(move("x", 100));
    b.edit(move("x", 200));
    a.flushOut(); // A's op is stamped first
    b.flushOut(); // B's is stale → rejected
    settle(a, b);
    expect(xOf(a.doc, "x")).toBe(100);
    expect(xOf(b.doc, "x")).toBe(100);
    expect(b.rejected).toHaveLength(1);
    expect(a.doc).toEqual(b.doc);
  });

  it("concurrent edits of different elements both land", () => {
    const hub = new FakeHub();
    const a = new Client(hub, start());
    const b = new Client(hub, start());
    a.connect();
    b.connect();
    settle(a, b);
    a.edit(move("x", 1));
    b.edit(move("y", 2));
    settle(a, b);
    expect(xOf(a.doc, "x")).toBe(1);
    expect(xOf(a.doc, "y")).toBe(2);
    expect(a.doc).toEqual(b.doc);
    expect(a.rejected.length + b.rejected.length).toBe(0);
  });

  it("a rejected op rolls back to confirmed + the other pending ops", () => {
    const hub = new FakeHub();
    const a = new Client(hub, start());
    const b = new Client(hub, start());
    a.connect();
    b.connect();
    settle(a, b);
    a.edit(move("x", 100));
    a.flushOut();
    b.edit(move("x", 200)); // stale
    b.edit(move("y", 7)); // fine
    // B learns about A's op only after its own two are sent.
    b.flushOut();
    b.drain();
    expect(xOf(b.doc, "x")).toBe(100);
    expect(xOf(b.doc, "y")).toBe(7);
    settle(a, b);
    expect(a.doc).toEqual(b.doc);
  });

  it("reconnect catches up the missed ops and resends offline edits", () => {
    const hub = new FakeHub();
    const a = new Client(hub, start());
    const b = new Client(hub, start());
    a.connect();
    b.connect();
    settle(a, b);
    b.disconnect();
    a.edit(move("x", 5));
    settle(a);
    b.edit(move("y", 9)); // offline: queued
    expect(b.outbox).toHaveLength(0);
    b.connect();
    settle(a, b);
    expect(xOf(b.doc, "x")).toBe(5);
    expect(xOf(a.doc, "y")).toBe(9);
    expect(a.doc).toEqual(b.doc);
  });

  it("an op whose ack was lost is resent once and not applied twice", () => {
    const hub = new FakeHub();
    const a = new Client(hub, start());
    a.connect();
    settle(a);
    a.edit({ t: "upsert", si: "s1", el: el("n") });
    a.flushOut(); // stamped, but the ack never arrives
    a.disconnect();
    a.connect();
    settle(a);
    expect(hub.log).toHaveLength(1);
    expect(a.sync.pending).toHaveLength(0);
    expect(a.doc.slides[0].elements.filter((e) => e.id === "n")).toHaveLength(1);
  });

  it("a new room epoch re-bases on the stored snapshot, keeping pending edits", () => {
    const hub = new FakeHub();
    const a = new Client(hub, start());
    a.connect();
    settle(a);
    a.disconnect();
    // Meanwhile the room was recreated and someone else saved a change.
    hub.epoch = "E2";
    hub.log = [];
    hub.seq = 0;
    hub.snapshot = { slides: [{ id: "s1", background: "#000", elements: [el("x", 42), el("y")] }] };
    a.edit(move("y", 3));
    a.connect();
    settle(a);
    expect(a.doc.slides[0].background).toBe("#000");
    expect(xOf(a.doc, "x")).toBe(42);
    expect(xOf(a.doc, "y")).toBe(3);
    expect(hub.log).toHaveLength(1);
  });

  it("buffers ops that arrive before the snapshot", () => {
    const s = new DeckSync("me");
    s.onOpen();
    s.receive({ t: "welcome", epoch: "E", seq: 1, fresh: true });
    s.receive({ seq: 1, cid: "o", t: "upsert", si: "s1", el: el("x", 8) });
    s.receive({ t: "synced", seq: 1 });
    const d = s.setSnapshot(start());
    expect(xOf(d, "x")).toBe(8);
    expect(s.lastSeq).toBe(1);
  });

  it("ignores duplicate seqs and asks for a reload on a version restore", () => {
    const s = new DeckSync("me");
    s.setSnapshot(start());
    expect(s.receive({ seq: 1, cid: "o", t: "upsert", si: "s1", el: el("x", 8) }).remote).toBeTruthy();
    expect(s.receive({ seq: 1, cid: "o", t: "upsert", si: "s1", el: el("x", 8) }).remote).toBeUndefined();
    expect(s.receive({ t: "versionRestored" }).reload).toBe(true);
  });
});

describe("OwnHistory", () => {
  it("undo reverts only my change; a collaborator's edit made since stays", () => {
    const h = new OwnHistory();
    let doc = start();
    h.record(doc, 1000);
    const mine = applyOp(doc, move("x", 50));
    h.note(doc, mine);
    doc = mine;
    // A collaborator moves y.
    doc = applyOp(doc, move("y", 77));
    const undone = h.undo(doc)!;
    expect(xOf(undone, "x")).toBe(0);
    expect(xOf(undone, "y")).toBe(77);
    // Only the change is sent: one op for x.
    expect(diffOps(doc, undone)).toEqual([{ t: "upsert", si: "s1", el: el("x", 0) }]);
    const redone = h.redo(undone)!;
    expect(xOf(redone, "x")).toBe(50);
    expect(xOf(redone, "y")).toBe(77);
  });

  it("does not undo over a collaborator who changed the same element", () => {
    const h = new OwnHistory();
    const d0 = start();
    h.record(d0, 1000);
    const d1 = applyOp(d0, move("x", 50));
    h.note(d0, d1);
    const d2 = applyOp(d1, move("x", 60)); // peer
    expect(h.undo(d2)).toEqual(d2);
  });

  it("coalesces quick edits into one step", () => {
    const h = new OwnHistory();
    let d = start();
    for (const [t, x] of [
      [1000, 1],
      [1100, 2],
      [1200, 3],
    ]) {
      h.record(d, t);
      const n = applyOp(d, move("x", x));
      h.note(d, n);
      d = n;
    }
    expect(h.past).toHaveLength(1);
    expect(xOf(h.undo(d)!, "x")).toBe(0);
  });
});
