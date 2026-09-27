// Two-level alignment of token streams (Docs M12): paragraphs first (Myers
// over paragraph hashes, so identical paragraphs anchor the diff and common
// words in unrelated paragraphs never match), then a word- or
// character-level diff of each run of changed paragraphs, taken as one
// stream so paragraph splits and merges show as paragraph-mark changes.
import { cleanup, myers, type Op } from "./myers";
import { charClass, PARA_KEY, units, type Granularity, type Tok } from "./stream";

/** align returns the edit script from stream `a` to stream `b`. With
 *  character granularity (streams of one-character tokens) changed
 *  paragraphs are still aligned word by word first, and only a replaced
 *  run of words that shares at least half of its characters is refined
 *  character by character — "Hello" → "Hlo" shows "el" deleted, while a
 *  rewritten phrase stays one replacement instead of a comb of letters. */
export function align(a: Tok[], b: Tok[], gran: Granularity = "word"): Op[] {
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
    out.push(...(gran === "char" ? charRegion(a, b, ta, tb) : region(a, b, ta, tb)));
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

/** Words over a character stream: runs of word or space characters, one
 *  group per other character, paragraph mark or object. */
function words(toks: Tok[], idx: number[]): { key: string; idx: number[] }[] {
  const out: { key: string; idx: number[] }[] = [];
  let cls = "";
  for (const i of idx) {
    const t = toks[i];
    const c = t.kind === "inline" && t.key.length <= 2 ? charClass(t.key) : "x";
    const last = out[out.length - 1];
    if (last && c === cls && (c === "w" || c === "s")) {
      last.key += t.key;
      last.idx.push(i);
    } else out.push({ key: t.kind === "inline" ? t.key : `\u0000${t.key}`, idx: [i] });
    cls = c;
  }
  return out;
}

function charRegion(a: Tok[], b: Tok[], ta: number[], tb: number[]): Op[] {
  const wa = words(a, ta);
  const wb = words(b, tb);
  const ka = wa.map((w) => w.key);
  const kb = wb.map((w) => w.key);
  let wops = myers(ka, kb);
  if (!wops) return region(a, b, ta, tb);
  wops = cleanup(wops, ka, kb, {
    weight: (side, i) => (side === "a" ? wa[i].idx.length : wb[i].idx.length),
    barrier: (side, i) => (side === "a" ? wa[i].key : wb[i].key).startsWith("\u0000"),
  });
  const out: Op[] = [];
  let D: number[] = [];
  let I: number[] = [];
  const flush = () => {
    if (!D.length && !I.length) return;
    const refined = D.length && I.length ? region(a, b, D, I) : null;
    const same = refined ? refined.filter((o) => o.kind === "eq").length : 0;
    if (refined && same * 2 >= Math.min(D.length, I.length)) out.push(...refined);
    else {
      for (const i of D) out.push({ kind: "del", a: i, b: -1 });
      for (const i of I) out.push({ kind: "ins", a: -1, b: i });
    }
    D = [];
    I = [];
  };
  for (const op of wops) {
    if (op.kind === "eq") {
      flush();
      wa[op.a].idx.forEach((ai, k) => out.push({ kind: "eq", a: ai, b: wb[op.b].idx[k] }));
    } else if (op.kind === "del") D.push(...wa[op.a].idx);
    else I.push(...wb[op.b].idx);
  }
  flush();
  return out;
}
