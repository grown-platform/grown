// The editor's side of slides collaboration (M10): the WebSocket (with
// reconnect), the DeckSync protocol state, presence peers and undo/redo that
// only undoes your own changes. DeckEditor keeps doing its local mutations and
// calls `broadcast(op)`; this hook turns whole-deck ops into fine ones, notes
// them for undo, and sends them with the op id/base the hub checks.

import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { collabURL, getDeck } from "./api";
import { parseDeck, type DeckDoc } from "./model";
import { DeckSync, OwnHistory, applyOp, type WireOp } from "./collabSync";
import { diffOps } from "./deckDiff";
import { isCommentOp } from "./comments";
import { isVersionRestoredMsg } from "../../components/versions/api";

export interface CollabPeer {
  userId: string;
  username: string;
  color: string;
  slideIdx: number;
  /** The slide the peer is on, and its selection there (M10). */
  slideId?: string;
  sel?: string[];
  editingText?: boolean;
  ts: number;
}

export type CollabStatus = "connecting" | "live" | "offline";

const RECONNECT_MS = [500, 1000, 2000, 4000, 8000];

export interface DeckCollab {
  status: CollabStatus;
  peers: Record<string, CollabPeer>;
  setPeers: Dispatch<SetStateAction<Record<string, CollabPeer>>>;
  /** Send an op (or presence / a control message). */
  broadcast: (msg: object) => void;
  /** The loaded deck: returns the local deck to show. */
  setSnapshot: (d: DeckDoc) => DeckDoc;
  /** Start an undo step before a local change. */
  record: () => void;
  /** Undo/redo your own last change; returns the new deck or null. */
  undo: () => DeckDoc | null;
  redo: () => DeckDoc | null;
  /** Seq to report once a save started now has completed. */
  saveMark: () => number;
  saved: (seq: number) => void;
}

export function useDeckCollab(opts: {
  deckId: string;
  docRef: MutableRefObject<DeckDoc | null>;
  setDoc: Dispatch<SetStateAction<DeckDoc | null>>;
  /** Ops of ours rejected as stale (someone else changed the same thing). */
  onRejected?: (ops: WireOp[]) => void;
  /** A collaborator restored a version. */
  onRestored: () => void;
}): DeckCollab {
  const { deckId, docRef, setDoc } = opts;
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [peers, setPeers] = useState<Record<string, CollabPeer>>({});
  const sync = useRef<DeckSync>(new DeckSync());
  const own = useRef(new OwnHistory());
  const wsRef = useRef<WebSocket | null>(null);
  const cb = useRef(opts);
  cb.current = opts;

  const sendRaw = useCallback((m: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

  const pushOps = useCallback(
    (ops: WireOp[]) => {
      for (const op of ops) {
        const w = sync.current.push(op);
        if (w) sendRaw(w);
      }
    },
    [sendRaw],
  );

  // New deck ⇒ fresh protocol state.
  useEffect(() => {
    sync.current = new DeckSync();
    own.current = new OwnHistory();
  }, [deckId]);

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: number | undefined;
    const refetch = () => {
      getDeck(deckId)
        .then((d) => {
          if (closed) return;
          setDoc(sync.current.setSnapshot(parseDeck(d.data)));
        })
        .catch(() => {});
    };
    const connect = () => {
      const ws = new WebSocket(collabURL(deckId));
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        ws.send(JSON.stringify(sync.current.onOpen()));
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        sync.current.onClose();
        if (closed) return;
        setStatus("offline");
        timer = window.setTimeout(connect, RECONNECT_MS[Math.min(attempt++, RECONNECT_MS.length - 1)]);
      };
      ws.onmessage = (ev) => {
        let m: WireOp;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!m || typeof m !== "object") return;
        if (isVersionRestoredMsg(m)) {
          cb.current.onRestored();
          return;
        }
        const e = sync.current.receive(m);
        if (m.t === "synced") setStatus("live");
        if (e.presence) {
          const p = (e.presence as { p?: CollabPeer }).p;
          if (p && p.userId) setPeers((cur) => ({ ...cur, [p.userId]: { ...p, ts: Date.now() } }));
        }
        if (e.remote) {
          const op = e.remote;
          setDoc((d) => (d ? applyOp(d, op) : d));
        }
        if (e.doc) setDoc(e.doc);
        if (e.rejected?.length) cb.current.onRejected?.(e.rejected);
        if (e.send) for (const w of e.send) ws.send(JSON.stringify(w));
        if (e.refetch) refetch();
        if (e.reload) cb.current.onRestored();
      };
    };
    // Legacy clients stay "connecting" until the first message; we flip to
    // live on "synced".
    setStatus("connecting");
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [deckId, setDoc]);

  const broadcast = useCallback(
    (msg: object) => {
      const m = msg as WireOp;
      if (m.t === "presence" || isVersionRestoredMsg(m) || m.t === "saved") {
        sendRaw(m);
        return;
      }
      const prev = docRef.current;
      if (isCommentOp(m) || !prev) {
        pushOps([m]);
        return;
      }
      const next = applyOp(prev, m);
      own.current.note(prev, next);
      // Whole-deck ops go on the wire as the finest ops that make the change.
      pushOps(m.t === "slides" || m.t === "deck" ? diffOps(prev, next) : [m]);
    },
    [docRef, pushOps, sendRaw],
  );

  const setSnapshot = useCallback((d: DeckDoc) => sync.current.setSnapshot(d), []);
  const record = useCallback(() => own.current.record(docRef.current, Date.now()), [docRef]);
  const step = useCallback(
    (dir: "undo" | "redo") => {
      const cur = docRef.current;
      if (!cur) return null;
      const next = dir === "undo" ? own.current.undo(cur) : own.current.redo(cur);
      if (!next || next === cur) return next === cur ? cur : null;
      pushOps(diffOps(cur, next));
      return next;
    },
    [docRef, pushOps],
  );
  const undo = useCallback(() => step("undo"), [step]);
  const redo = useCallback(() => step("redo"), [step]);
  const saveMark = useCallback(() => sync.current.savedSeq(), []);
  const saved = useCallback((seq: number) => sendRaw({ t: "saved", seq }), [sendRaw]);

  return { status, peers, setPeers, broadcast, setSnapshot, record, undo, redo, saveMark, saved };
}
