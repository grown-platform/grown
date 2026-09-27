// Math autocorrect: typing an equation in the linear format, the way Word
// and OnlyOffice build it up as you type.
//
// Rules (checked after every typed character, in this order):
//  1. \word + space (or + a closing character) becomes its symbol
//     (\alpha -> α, \sqrt -> √, \of -> ▒); "->" "<=" … become → ≤ ….
//  2. Two spaces in a row never convert (a way to type a literal space).
//  3. A function name + space ("sin ") becomes a function; the caret moves
//     into its argument. A function name + ^ or _ gets the function-apply
//     mark (U+2061) so its script becomes a limit.
//  4. A closing bracket builds up the content inside its pair.
//  5. "/" builds up the operand in front of it (so 1/2/3 is ((1/2)/3)).
//  6. An operator builds up everything since the last unmatched opening
//     bracket.
//  7. A space builds up around the last structure character: the operand
//     before an infix one (/ ┴ ┬ ^ _) and everything after it, a prefix one
//     (√ □ ▭ ▁ ∑ ■ …) and everything after it, a postfix accent with its
//     base, or after ▒ the n-ary operand (else the whole n-ary).
//  8. Otherwise a space after a bracket pair turns the pair into a
//     delimiter object.
// Every conversion is its own undo step: undo right after one restores the
// typed text without converting it.
import { type Content, type MObj, clone, isObj, isRun, normalize, run, slots } from "./model";
import { type Cell, cellCh, cellsOf, cellsToContent, isCharCell, parseCells, toLinear } from "./linear";
import {
  BARS,
  BOXES,
  FRACTION_OPS,
  FUNC_NAMES,
  GROUP_CHARS,
  MATH_SEQUENCES,
  MATH_WORDS,
  PRIMES,
  RADICALS,
  inStr,
  isAlnum,
  isClose,
  isCombining,
  isLR,
  isNary,
  isOpen,
  isOperator,
  isSpace,
} from "./symbols";

/** A step into an object argument: the object's index and its slot (see slots()). */
export interface PathStep {
  index: number;
  slot: number;
}

interface Snapshot {
  root: Content;
  path: PathStep[];
  elem: number;
  offset: number;
}

/** Bracket partners within a cell list (index -> partner index). */
function pairsOf(cells: Cell[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const findClose = (start: number, inner: boolean): number => {
    const open = cellCh(cells[start]);
    let j = start + 1;
    if (open === "├") j++;
    while (j < cells.length) {
      const c = cellCh(cells[j]);
      if (open === "├") {
        if (c === "┤") return j;
      } else if (c === "┤") return inner ? -1 : j;
      if (c === "├" || isOpen(c)) {
        const k = findClose(j, false);
        if (k < 0) {
          j++;
          continue;
        }
        pairs.set(j, k).set(k, j);
        j = k + (cellCh(cells[k]) === "┤" ? 2 : 1);
        continue;
      }
      if (open !== "├" && isClose(c)) return inner ? -1 : j;
      if (isLR(c)) {
        const k = findClose(j, true);
        if (k >= 0) {
          pairs.set(j, k).set(k, j);
          j = k + 1;
          continue;
        }
        if (open !== "├") return j;
      }
      j++;
    }
    return -1;
  };
  for (let i = 0; i < cells.length; i++) {
    const c = cellCh(cells[i]);
    if (pairs.has(i)) {
      const k = pairs.get(i)!;
      if (k > i) i = k;
      continue;
    }
    if (c === "├" || isOpen(c) || isLR(c)) {
      const k = findClose(i, false);
      if (k >= 0) {
        pairs.set(i, k).set(k, i);
        i = k;
      }
    }
  }
  return pairs;
}

const isRuleChar = (c: string) =>
  isNary(c) ||
  isCombining(c) ||
  inStr(PRIMES, c) ||
  inStr(BOXES, c) ||
  inStr(FRACTION_OPS, c) ||
  c === "⁡" ||
  c === "■" ||
  c === "█" ||
  inStr(RADICALS, c) ||
  inStr(BARS, c) ||
  inStr(GROUP_CHARS, c) ||
  c === "▒" ||
  c === "├" ||
  c === "┤" ||
  c === "┴" ||
  c === "┬";

const isPrefixChar = (c: string) =>
  inStr(RADICALS, c) || inStr(BOXES, c) || inStr(BARS, c) || inStr(GROUP_CHARS, c) || isNary(c) || c === "■" || c === "█";

/** Structural signature, to tell whether a build-up changed anything. */
const sig = (c: Content) => JSON.stringify(normalize(c));

export interface MathInputOptions {
  /** Convert as you type (default true). */
  autoConvert?: boolean;
}

/** MathInput: one equation being typed, with a caret and undo. */
export class MathInput {
  root: Content;
  path: PathStep[] = [];
  /** Caret: index of the run in the current content, and the offset in it. */
  elem = 0;
  offset = 0;
  autoConvert: boolean;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** An object selected by Backspace (the next Backspace deletes it). */
  private selectedObj = -1;

  constructor(content: Content = [run()], opts: MathInputOptions = {}) {
    this.root = normalize(clone(content));
    this.autoConvert = opts.autoConvert ?? true;
    this.moveToEnd();
  }

  /** current: the content the caret is in. */
  current(): Content {
    let c = this.root;
    for (const s of this.path) c = slots(c[s.index] as MObj)[s.slot];
    return c;
  }

  snapshot(): Snapshot {
    return { root: clone(this.root), path: [...this.path], elem: this.elem, offset: this.offset };
  }
  private restore(s: Snapshot) {
    this.root = clone(s.root);
    this.path = [...s.path];
    this.elem = s.elem;
    this.offset = s.offset;
  }
  private push() {
    this.undoStack.push(this.snapshot());
    this.redoStack = [];
  }

  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push(this.snapshot());
    this.restore(s);
    return true;
  }
  redo(): boolean {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push(this.snapshot());
    this.restore(s);
    return true;
  }

  moveToEnd() {
    this.path = [];
    this.elem = this.root.length - 1;
    const r = this.root[this.elem];
    this.offset = isRun(r) ? r.text.length : 0;
  }

  /** moveLeft by characters within the current content (objects count as one). */
  moveLeft(n = 1) {
    for (let k = 0; k < n; k++) {
      const c = this.current();
      const r = c[this.elem];
      if (isRun(r) && this.offset > 0) {
        const chars = [...r.text.slice(0, this.offset)];
        this.offset -= chars[chars.length - 1].length;
      } else if (this.elem >= 2) {
        // step over the object before this run
        this.elem -= 2;
        const prev = c[this.elem];
        this.offset = isRun(prev) ? prev.text.length : 0;
      } else if (this.path.length) {
        const step = this.path.pop()!;
        this.elem = step.index - 1;
        const prev = this.current()[this.elem];
        this.offset = isRun(prev) ? prev.text.length : 0;
      }
    }
  }

  /** Put the caret at the start of an object's argument. */
  enter(pathToContent: PathStep[], atEnd = false) {
    this.path = [...pathToContent];
    const c = this.current();
    this.elem = atEnd ? c.length - 1 : 0;
    const r = c[this.elem];
    this.offset = atEnd && isRun(r) ? r.text.length : 0;
  }

  /** type enters text character by character (with autocorrect). */
  type(text: string) {
    for (const ch of text) this.typeChar(ch);
  }

  typeChar(ch: string) {
    this.push();
    this.selectedObj = -1;
    const c = this.current();
    const r = c[this.elem];
    if (!isRun(r)) return;
    r.text = r.text.slice(0, this.offset) + ch + r.text.slice(this.offset);
    this.offset += ch.length;
    if (!this.autoConvert) return;
    const before = this.snapshot();
    if (this.autocorrect()) {
      this.undoStack.push(before);
    }
  }

  backspace() {
    this.push();
    const c = this.current();
    const r = c[this.elem];
    if (isRun(r) && this.offset > 0) {
      const chars = [...r.text.slice(0, this.offset)];
      const last = chars.pop()!;
      r.text = chars.join("") + r.text.slice(this.offset);
      this.offset -= last.length;
      return;
    }
    if (this.elem > 0 && isObj(c[this.elem - 1])) {
      if (this.selectedObj !== this.elem - 1) {
        this.selectedObj = this.elem - 1;
        return;
      }
      c.splice(this.elem - 1, 1);
      this.selectedObj = -1;
      const merged = normalize(c);
      const prevLen = isRun(c[this.elem - 2]) ? (c[this.elem - 2] as { text: string }).text.length : 0;
      c.length = 0;
      c.push(...merged);
      this.elem = Math.max(0, this.elem - 2);
      this.offset = prevLen;
    }
  }

  /** insertObject puts a template object at the caret; the caret goes to its first empty argument. */
  insertObject(o: MObj) {
    this.push();
    const c = this.current();
    const r = c[this.elem];
    if (!isRun(r)) return;
    const head = run(r.text.slice(0, this.offset), styleOf(r));
    const tail = run(r.text.slice(this.offset), styleOf(r));
    const obj = normalizeObj(o);
    c.splice(this.elem, 1, head, obj, tail);
    const idx = this.elem + 1;
    const all = slots(obj);
    const firstEmpty = all.findIndex((s) => toLinear(s) === "");
    if (firstEmpty >= 0) this.enter([...this.path, { index: idx, slot: firstEmpty }]);
    else {
      this.elem = idx + 1;
      this.offset = 0;
    }
  }

  /** convertAll: build up the whole equation (linear -> professional). */
  convertAll() {
    this.push();
    this.root = parseCells(cellsOf(this.root));
    this.moveToEnd();
  }

  /** toLinearView: the whole equation as one run of linear text. */
  toLinearView() {
    this.push();
    this.root = [run(toLinear(this.root))];
    this.moveToEnd();
  }

  // --- autocorrect -----------------------------------------------------------
  private autocorrect(): boolean {
    const c = this.current();
    const r = c[this.elem] as { text: string };
    // prefix cells (before the caret) and the rest of the content
    const prefixNodes: Content = [...c.slice(0, this.elem), run(r.text.slice(0, this.offset), styleOf(c[this.elem]))];
    const suffixNodes: Content = [run(r.text.slice(this.offset), styleOf(c[this.elem])), ...c.slice(this.elem + 1)];
    const P = cellsOf(prefixNodes);
    const res = correct(P);
    if (!res || res.noop) return false;
    const pre = normalize(res.cells ? cellsToContent(res.cells) : res.content!);
    const cursorElem = pre.length - 1;
    const cursorOffset = (pre[cursorElem] as { text: string }).text.length;
    const suf = normalize(suffixNodes);
    // join the boundary runs
    const lastPre = pre[pre.length - 1];
    const firstSuf = suf[0];
    let merged: Content;
    if (isRun(lastPre) && isRun(firstSuf) && JSON.stringify(styleOf(lastPre)) === JSON.stringify(styleOf(firstSuf)))
      merged = [...pre.slice(0, -1), { ...lastPre, text: lastPre.text + firstSuf.text }, ...suf.slice(1)];
    else merged = [...pre, ...suf];
    c.length = 0;
    c.push(...merged);
    this.elem = cursorElem;
    this.offset = cursorOffset;
    if (res.enterLast) {
      // caret into the empty argument of the object just built
      let idx = -1;
      for (let i = cursorElem; i >= 0; i--)
        if (isObj(c[i])) {
          idx = i;
          break;
        }
      const o = c[idx] as MObj | undefined;
      if (o && (o.t === "func" || o.t === "nary")) {
        const sl = slots(o);
        this.enter([...this.path, { index: idx, slot: sl.length - 1 }]);
      }
    }
    return true;
  }
}

function styleOf(n: Content[number] | undefined) {
  if (!n || !isRun(n)) return {};
  const { t: _t, text: _x, ...s } = n;
  void _t;
  void _x;
  return s;
}

function normalizeObj(o: MObj): MObj {
  return normalize([o]).find(isObj) as MObj;
}

interface Correction {
  cells?: Cell[];
  content?: Content;
  /** Put the caret into the last object's empty argument (functions, n-ary). */
  enterLast?: boolean;
  /** Stop here without changing anything. */
  noop?: boolean;
}

const ch = (P: Cell[], i: number) => cellCh(P[i]);
const isLetter = (c: string) => /^[A-Za-z]$/.test(c);

/** correct applies the autocorrect rules to the cells before the caret. */
function correct(P: Cell[]): Correction | null {
  const n = P.length;
  if (!n || !isCharCell(P[n - 1])) return null;
  const last = ch(P, n - 1);

  // 1. \words and character sequences
  {
    const trigger = isSpace(last) || isOperator(last) || isClose(last) || isOpen(last) || isLR(last) || last === "^" || last === "_" || last === "/" || last === "\\";
    if (trigger) {
      let k = n - 2;
      while (k >= 0 && isLetter(ch(P, k))) k--;
      if (k >= 0 && k < n - 2 && ch(P, k) === "\\") {
        const word = P.slice(k + 1, n - 1).map(cellCh).join("");
        const rep = MATH_WORDS[word];
        if (rep !== undefined) {
          const keep = isSpace(last) ? [] : [P[n - 1]];
          return { cells: [...P.slice(0, k), ...[...rep].map((x) => ({ ch: x })), ...keep] };
        }
      }
    }
    if (n >= 2 && isCharCell(P[n - 2])) {
      const seq = MATH_SEQUENCES[ch(P, n - 2) + last];
      if (seq) return { cells: [...P.slice(0, n - 2), { ch: seq }] };
    }
  }
  if (isSpace(last) && n >= 2 && isSpace(ch(P, n - 2))) return null;

  const pairs = pairsOf(P.slice(0, n - 1));
  const pairsAll = pairsOf(P);

  // 3. functions
  if (isSpace(last) || last === "^" || last === "_") {
    let k = n - 2;
    while (k >= 0 && isLetter(ch(P, k))) k--;
    const name = P.slice(k + 1, n - 1).map(cellCh).join("");
    if (name && FUNC_NAMES.includes(name) && !(k >= 0 && ch(P, k) === "\\")) {
      if (isSpace(last) && ruleBefore(P, n - 1, pairs) === null) {
        const f: MObj = { t: "func", name: [run(name, { sty: "p" })], arg: [run()] };
        return { cells: [...P.slice(0, k + 1), { obj: f }], enterLast: true };
      }
      if (!isSpace(last)) {
        const nameCells = P.slice(k + 1, n - 1).map((c) => ({ ch: cellCh(c), tpl: run("", { sty: "p" }) }));
        return { cells: [...P.slice(0, k + 1), ...nameCells, { ch: "⁡" }, P[n - 1]] };
      }
    }
  }

  // 4. a closing bracket builds up its content
  if (isClose(last) || isLR(last) || last === "┤") {
    const o = pairsAll.get(n - 1);
    if (o !== undefined && o < n - 1) {
      const first = ch(P, o + 1);
      if (first !== "_" && first !== "^") {
        const from = o + (ch(P, o) === "├" ? 2 : 1);
        const conv = convert(P, from, n - 1);
        return conv ?? { cells: P, noop: true };
      }
    }
  }

  // 5. division builds up the operand before it
  if (inStr(FRACTION_OPS, last)) {
    const s = blockStart(P, n - 1, "divide", pairs);
    const conv = convert(P, s, n - 1, true);
    if (conv) return conv;
    return null;
  }

  // 6. an operator builds up since the last unmatched opening bracket
  if (isOperator(last)) {
    const s = lastUnmatchedOpen(P, n - 1, pairs) + 1;
    const conv = convert(P, s, n - 1);
    if (conv) return conv;
  }

  // 7. a space builds up around the last structure character
  if (isSpace(last)) {
    const rule = ruleBefore(P, n - 1, pairs);
    if (rule !== null) {
      const r = ch(P, rule);
      let res: Correction | null = null;
      if (r === "▒") {
        res = convert(P, rule + 1, n - 1, false, true);
        if (!res) {
          let nary = -1;
          for (let j = rule - 1; j >= 0; j--)
            if (isNary(ch(P, j))) {
              nary = j;
              break;
            }
          if (nary >= 0) res = convert(P, nary, n - 1, false, true);
        }
      } else if (r === "┴" || r === "┬" || r === "^" || r === "_" || inStr(FRACTION_OPS, r)) {
        const s = blockStart(P, rule, inStr(FRACTION_OPS, r) ? "divide" : r, pairs);
        // "_a^b" with no base yet may still become a pre-script ("_a^b x")
        const seg = P.slice(s, n - 1).map(cellCh).join("");
        const prescript = /^[_^]/.test(seg) && seg.includes("_") && seg.includes("^") && !/\s/.test(seg);
        if (!prescript) res = convert(P, s, n - 1, false, true);
      } else if (isCombining(r) || inStr(PRIMES, r)) {
        const s = blockStart(P, rule, "postfix", pairs);
        res = convert(P, s, rule + 1, false, true, n - 1);
      } else if (r === "⁡") {
        let s = rule - 1;
        while (s >= 0 && isAlnum(ch(P, s))) s--;
        res = convert(P, s + 1, n - 1, false, true);
      } else if (r === "┤" || r === "├") {
        let s = rule;
        if (r === "┤") for (s = rule; s >= 0 && ch(P, s) !== "├"; s--);
        if (s >= 0) res = convert(P, s, n - 1, false, true);
      } else if (isPrefixChar(r)) {
        res = convert(P, rule, n - 1, false, true);
      }
      if (res) {
        const built = res.cells ?? cellsOf(res.content!);
        const lastObj = [...built].reverse().find((c) => "obj" in c) as { obj: MObj } | undefined;
        if (lastObj && ((lastObj.obj.t === "nary" && toLinear(lastObj.obj.base) === "") || (lastObj.obj.t === "func" && toLinear(lastObj.obj.arg) === "")))
          res.enterLast = true;
        return res;
      }
      return null;
    }
  }

  // pre-scripts: (_a^b)c + space
  if (isSpace(last)) {
    for (const [o, cl] of pairs) {
      if (o < cl && (ch(P, o + 1) === "_" || ch(P, o + 1) === "^") && ch(P, o) === "(") {
        const res = convert(P, o, n - 1, false, true);
        if (res) return res;
      }
    }
  }

  // 8. a bracket pair followed by a space or an operator becomes a delimiter
  if ((isSpace(last) || isOperator(last)) && n >= 2) {
    const o = pairs.get(n - 2);
    if (o !== undefined && o < n - 2) {
      const res = convert(P, o, n - 1, false, isSpace(last));
      if (res) return res;
    }
  }
  return null;
}

/** ruleBefore: the last structure character before `end` outside bracket pairs
 *  (a script character only if there is nothing else). */
function ruleBefore(P: Cell[], end: number, pairs: Map<number, number>): number | null {
  let script: number | null = null;
  for (let j = end - 1; j >= 0; j--) {
    if (!isCharCell(P[j])) continue;
    const c = ch(P, j);
    const partner = pairs.get(j);
    if (partner !== undefined && partner < j && (isClose(c) || isLR(c) || c === "┤")) {
      if (c === "┤") return j;
      j = partner;
      continue;
    }
    if (c === "┤" || c === "├") return j;
    if (isOpen(c) || isClose(c) || isLR(c) || isSpace(c) || isOperator(c)) continue;
    if (c === "^" || c === "_") {
      if (script === null) script = j;
      continue;
    }
    if (isRuleChar(c)) return j;
  }
  return script;
}

function lastUnmatchedOpen(P: Cell[], end: number, pairs: Map<number, number>): number {
  for (let j = end - 1; j >= 0; j--) {
    const c = ch(P, j);
    const partner = pairs.get(j);
    if (partner !== undefined) {
      if (partner < j) j = partner;
      continue;
    }
    if (isOpen(c) || c === "├" || isLR(c)) return j;
  }
  return -1;
}

/** blockStart: where the operand in front of the structure character at `at` starts. */
function blockStart(P: Cell[], at: number, mode: string, pairs: Map<number, number>): number {
  let k = at - 1;
  if (mode === "postfix") {
    while (k >= 0 && isCharCell(P[k]) && (isCombining(ch(P, k)) || inStr(PRIMES, ch(P, k)))) k--;
    const partner = pairs.get(k);
    if (partner !== undefined && partner < k) return partner;
    return Math.max(0, k);
  }
  while (k >= 0) {
    if (!isCharCell(P[k])) {
      k--;
      continue;
    }
    const c = ch(P, k);
    const partner = pairs.get(k);
    if (partner !== undefined && partner < k) {
      k = partner - (ch(P, partner - 1) === "├" ? 1 : 0) - 1;
      continue;
    }
    if (isAlnum(c) || isCombining(c) || inStr(PRIMES, c) || isPrefixChar(c)) {
      k--;
      continue;
    }
    if (c === "^" || c === "_" || c === "┴" || c === "┬" || inStr(FRACTION_OPS, c)) {
      if (mode === "divide") {
        k--;
        continue;
      }
      if (c === mode || inStr(FRACTION_OPS, c)) break;
      if ((mode === "^" || mode === "_") && (c === "┴" || c === "┬")) break;
      k--;
      continue;
    }
    break;
  }
  return k + 1;
}

/** convert builds up cells [from, to). Returns null when nothing changes.
 *  keepAfter: keep the cell at `to` (the divide sign). dropSpace: remove the
 *  trigger (the last cell) and one space in front of the built part. */
function convert(P: Cell[], from: number, to: number, keepAfter = false, dropSpace = false, restTo?: number): Correction | null {
  if (from < 0) from = 0;
  if (to <= from && !keepAfter) {
    if (to < from) return null;
  }
  const seg = P.slice(from, to);
  const built = parseCells(seg);
  if (sig(built) === sig(cellsToContent(seg))) return null;
  let head = P.slice(0, from);
  if (dropSpace && head.length && isSpace(cellCh(head[head.length - 1]))) head = head.slice(0, -1);
  const between = restTo !== undefined ? P.slice(to, restTo) : [];
  const tail = keepAfter ? P.slice(to) : dropSpace ? [] : P.slice(restTo ?? to);
  if (!dropSpace && !keepAfter && restTo === undefined) {
    // the trigger character stays after the built part
    return { content: [...cellsToContent(head), ...built, ...cellsToContent(P.slice(to))] };
  }
  return { content: [...cellsToContent(head), ...built, ...cellsToContent(between), ...cellsToContent(tail)] };
}
