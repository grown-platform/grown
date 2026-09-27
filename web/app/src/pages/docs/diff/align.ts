// Two-level alignment of token streams (Docs M12): paragraphs first (Myers
// over paragraph hashes, so identical paragraphs anchor the diff and common
// words in unrelated paragraphs never match), then a word- or
// character-level diff of each run of changed paragraphs, taken as one
// stream so paragraph splits and merges show as paragraph-mark changes.
import { cleanup, myers, type Op } from "./myers";
import { PARA_KEY, units, type Tok } from "./stream";

/** align returns the edit script from stream `a` to stream `b`. */
export function align(a: Tok[], b: Tok[]): Op[] {
  const ua = units(a);
  const ub = units(b);
  const top = myers(
    ua.map((u) => u.key),
    ub.map((u) => u.key),
  ) ?? [
    ...ua.map((_, i) => ({ kind: "del" as const, a: i, b: -1 })),
    ...ub.map((_, i) => ({ kind: "ins" as const, a: -1, b: i })),
  ];
  const out: Op[] = [];
  let ra: number[] = [];
  let rb: number[] = [];
  const flush = () => {
    if (!ra.length && !rb.length) return;
    const ta: number[] = [];
    const tb: number[] = [];
    for (const u of ra) for (let i = ua[u].start; i < ua[u].end; i++) ta.push(i);
    for (const u of rb) for (let i = ub[u].start; i < ub[u].end; i++) tb.push(i);
    out.push(...region(a, b, ta, tb));
    ra = [];
    rb = [];
  };
  for (const op of top) {
    if (op.kind === "eq") {
      flush();
      const A = ua[op.a];
      const B = ub[op.b];
      for (let k = 0; k < A.end - A.start; k++) out.push({ kind: "eq", a: A.start + k, b: B.start + k });
    } else if (op.kind === "del") ra.push(op.a);
    else rb.push(op.b);
  }
  flush();
  return out;
}

/** region diffs the tokens of a run of changed paragraphs. */
function region(a: Tok[], b: Tok[], ta: number[], tb: number[]): Op[] {
  const ka = ta.map((i) => a[i].key);
  const kb = tb.map((i) => b[i].key);
  let ops = myers(ka, kb);
  if (!ops) {
    ops = [...ta.map((_, i) => ({ kind: "del" as const, a: i, b: -1 })), ...tb.map((_, i) => ({ kind: "ins" as const, a: -1, b: i }))];
  } else {
    ops = cleanup(ops, ka, kb, {
      weight: (side, i) => (side === "a" ? a[ta[i]].w : b[tb[i]].w),
      barrier: (side, i) => (side === "a" ? ka[i] : kb[i]) === PARA_KEY || (side === "a" ? a[ta[i]].kind : b[tb[i]].kind) === "block",
    });
  }
  return ops.map((op) => ({ kind: op.kind, a: op.a >= 0 ? ta[op.a] : -1, b: op.b >= 0 ? tb[op.b] : -1 }));
}
