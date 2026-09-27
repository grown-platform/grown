// Sequence diff for the document diff engine (Docs M12): Myers' O(ND)
// algorithm over string keys, plus the clean-ups that make a diff read like
// an edit a person made — edits slid together (so "H[e]l[l]o" becomes
// "H[el]lo"), and short equalities between two edits folded into them (so a
// rewritten sentence is one replacement, not a comb of one-letter matches).
//
// Pure; no ProseMirror. Indices refer to the input arrays.

export type OpKind = "eq" | "del" | "ins";

/** One edit-script entry: `a` indexes the old sequence (eq, del), `b` the
 *  new one (eq, ins); the other is -1. */
export interface Op {
  kind: OpKind;
  a: number;
  b: number;
}

/**
 * myers returns the shortest edit script from `a` to `b`, deletions before
 * insertions within a change, or null when more than `maxD` edits would be
 * needed (callers then treat the range as replaced wholesale).
 */
export function myers(a: readonly string[], b: readonly string[], maxD = 3000): Op[] | null {
  // Common prefix and suffix are cheap and shrink the search.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const out: Op[] = [];
  for (let i = 0; i < pre; i++) out.push({ kind: "eq", a: i, b: i });
  const mid = middle(a, b, pre, a.length - suf, pre, b.length - suf, maxD);
  if (!mid) return null;
  out.push(...mid);
  for (let i = suf; i > 0; i--) out.push({ kind: "eq", a: a.length - i, b: b.length - i });
  return out;
}

function middle(a: readonly string[], b: readonly string[], a0: number, a1: number, b0: number, b1: number, maxD: number): Op[] | null {
  const N = a1 - a0;
  const M = b1 - b0;
  if (N === 0) return Array.from({ length: M }, (_, i) => ({ kind: "ins" as const, a: -1, b: b0 + i }));
  if (M === 0) return Array.from({ length: N }, (_, i) => ({ kind: "del" as const, a: a0 + i, b: -1 }));
  const max = N + M;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] holds v[k] for k in [-d-1, d+1] as it was *before* step d.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= N && y >= M) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;
  // Backtrack.
  const rev: Op[] = [];
  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const t = trace[d];
    const at = (k: number) => t[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      rev.push({ kind: "eq", a: a0 + x, b: b0 + y });
    }
    if (x === prevX) rev.push({ kind: "ins", a: -1, b: b0 + prevY });
    else rev.push({ kind: "del", a: a0 + prevX, b: -1 });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    rev.push({ kind: "eq", a: a0 + x, b: b0 + y });
  }
  return rev.reverse();
}

// --- clean-up ---------------------------------------------------------------------------

interface Seg {
  kind: OpKind;
  a: number[];
  b: number[];
}

export interface CleanupOpts {
  /** Weight of a token (its text length); default 1. */
  weight?: (side: "a" | "b", i: number) => number;
  /** Tokens an equality must never be folded across (paragraph marks). */
  barrier?: (side: "a" | "b", i: number) => boolean;
  /** Fold short equalities between edits into them (default true). */
  semantic?: boolean;
}

function toSegs(ops: Op[]): Seg[] {
  const segs: Seg[] = [];
  for (const op of ops) {
    const last = segs[segs.length - 1];
    if (last && last.kind === op.kind) {
      if (op.a >= 0) last.a.push(op.a);
      if (op.b >= 0) last.b.push(op.b);
    } else segs.push({ kind: op.kind, a: op.a >= 0 ? [op.a] : [], b: op.b >= 0 ? [op.b] : [] });
  }
  return segs;
}

/** normalize merges neighbours of a kind, puts deletions before insertions
 *  in every change and drops empty segments. */
function normalize(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  let del: Seg | null = null;
  let ins: Seg | null = null;
  const flush = () => {
    if (del && del.a.length) out.push(del);
    if (ins && ins.b.length) out.push(ins);
    del = ins = null;
  };
  for (const s of segs) {
    if (s.kind === "eq") {
      if (!s.a.length) continue;
      flush();
      const last = out[out.length - 1];
      if (last && last.kind === "eq") {
        last.a.push(...s.a);
        last.b.push(...s.b);
      } else out.push({ kind: "eq", a: [...s.a], b: [...s.b] });
    } else if (s.kind === "del") {
      if (!del) del = { kind: "del", a: [], b: [] };
      del.a.push(...s.a);
    } else {
      if (!ins) ins = { kind: "ins", a: [], b: [] };
      ins.b.push(...s.b);
    }
  }
  flush();
  return out;
}

function fromSegs(segs: Seg[]): Op[] {
  const ops: Op[] = [];
  for (const s of segs) {
    if (s.kind === "eq") s.a.forEach((ai, i) => ops.push({ kind: "eq", a: ai, b: s.b[i] }));
    else if (s.kind === "del") for (const ai of s.a) ops.push({ kind: "del", a: ai, b: -1 });
    else for (const bi of s.b) ops.push({ kind: "ins", a: -1, b: bi });
  }
  return ops;
}

/**
 * slide moves single edits (a lone deletion or insertion between two
 * equalities) left or right over identical text so they join the edits
 * next to them (diff-match-patch's merge pass).
 */
function slide(segs: Seg[], ka: readonly string[], kb: readonly string[]): { segs: Seg[]; changed: boolean } {
  let changed = false;
  const keys = (s: Seg) => (s.kind === "ins" ? s.b.map((i) => kb[i]) : s.a.map((i) => ka[i]));
  for (let i = 1; i < segs.length - 1; i++) {
    const P = segs[i - 1];
    const E = segs[i];
    const N = segs[i + 1];
    if (P.kind !== "eq" || N.kind !== "eq" || E.kind === "eq") continue;
    const e = keys(E);
    const p = keys(P);
    const n = keys(N);
    const isDel = E.kind === "del";
    const eIdx = isDel ? E.a : E.b;
    if (p.length <= e.length && p.every((k, j) => e[e.length - p.length + j] === k)) {
      // Shift left: E takes P's place; P's text moves after E.
      const cut = eIdx.length - p.length;
      const movedE = [...(isDel ? P.a : P.b), ...eIdx.slice(0, cut)];
      const tail = eIdx.slice(cut);
      if (isDel) {
        N.a = [...tail, ...N.a];
        N.b = [...P.b, ...N.b];
        E.a = movedE;
      } else {
        N.b = [...tail, ...N.b];
        N.a = [...P.a, ...N.a];
        E.b = movedE;
      }
      P.a = [];
      P.b = [];
      changed = true;
    } else if (n.length <= e.length && n.every((k, j) => e[j] === k)) {
      // Shift right: N's text joins P; E moves past it.
      const head = eIdx.slice(0, n.length);
      const movedE = [...eIdx.slice(n.length), ...(isDel ? N.a : N.b)];
      if (isDel) {
        P.a = [...P.a, ...head];
        P.b = [...P.b, ...N.b];
        E.a = movedE;
      } else {
        P.b = [...P.b, ...head];
        P.a = [...P.a, ...N.a];
        E.b = movedE;
      }
      N.a = [];
      N.b = [];
      changed = true;
    }
  }
  return { segs: normalize(segs), changed };
}

/** fold turns equalities shorter than the edits on both sides into a
 *  deletion plus an insertion (diff-match-patch's semantic clean-up). */
function fold(segs: Seg[], o: Required<Pick<CleanupOpts, "weight" | "barrier">>): { segs: Seg[]; changed: boolean } {
  let changed = false;
  const wA = (s: Seg) => s.a.reduce((t, i) => t + o.weight("a", i), 0);
  const wB = (s: Seg) => s.b.reduce((t, i) => t + o.weight("b", i), 0);
  const around = (from: number, step: number) => {
    let del = 0;
    let ins = 0;
    for (let j = from; j >= 0 && j < segs.length && segs[j].kind !== "eq"; j += step) {
      if (segs[j].kind === "del") del += wA(segs[j]);
      else ins += wB(segs[j]);
    }
    return Math.max(del, ins);
  };
  for (let i = 1; i < segs.length - 1; i++) {
    const s = segs[i];
    if (s.kind !== "eq") continue;
    if (segs[i - 1].kind === "eq" || segs[i + 1].kind === "eq") continue;
    if (s.a.some((ai) => o.barrier("a", ai)) || s.b.some((bi) => o.barrier("b", bi))) continue;
    const len = wA(s);
    if (len < around(i - 1, -1) && len < around(i + 1, 1)) {
      segs.splice(i, 1, { kind: "del", a: s.a, b: [] }, { kind: "ins", a: [], b: s.b });
      changed = true;
      i++;
    }
  }
  return { segs: normalize(segs), changed };
}

/** cleanup tidies an edit script (see the module comment). */
export function cleanup(ops: Op[], ka: readonly string[], kb: readonly string[], opts: CleanupOpts = {}): Op[] {
  const o = { weight: opts.weight ?? (() => 1), barrier: opts.barrier ?? (() => false) };
  let segs = normalize(toSegs(ops));
  for (let round = 0; round < 8; round++) {
    let r = slide(segs, ka, kb);
    segs = r.segs;
    let changed = r.changed;
    if (opts.semantic !== false) {
      r = fold(segs, o);
      segs = r.segs;
      changed = changed || r.changed;
    }
    if (!changed) break;
  }
  return fromSegs(segs);
}
