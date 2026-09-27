// Pagination (Docs M9), pure layout.
//
// The editor stays one ProseMirror document in one contenteditable; pages
// are computed, not laid out by us. A measurer (the DOM in the app, the
// MockMeasurer grid in tests) turns every top-level block into a box: a
// stack of line heights for text blocks, a stack of row heights for
// tables, with CSS margins. `paginate` then walks the boxes and assigns
// them to pages and columns, honouring
//   * page / column / section breaks and "page break before";
//   * keep with next (a chain moves to the next page with the first line
//     of what follows), keep lines together, widow/orphan control (at
//     least two lines at each end of a split paragraph);
//   * tables split between rows, the header rows repeated on every page,
//     a table never left with only its header rows at the bottom of a
//     page (Word 2013+), rows taller than a page split (pure layout only);
//   * sections: page size, orientation and margins per section, next
//     page / continuous / even / odd starts (a blank page when the parity
//     is wrong), page-number restarts, columns (filled in order and
//     balanced before a continuous break), mirror margins and gutter.
//
// Coordinates are "virtual": y from the top of the first page, with a
// fixed gap between pages, in the measurer's unit (CSS px in the app).
// The plugin (paginationPlugin.ts) realises the result with decorations:
// spacers before blocks and inside split paragraphs / tables, offsets for
// columns and differently sized sections.
import type { SectionStart } from "./sections";

// --- input ---------------------------------------------------------------------------------

export interface FlowBox {
  kind: "flow";
  /** Line heights, top to bottom; their sum is the border-box height. */
  lines: number[];
  /** CSS margins (collapse with the neighbours' margins). */
  mt: number;
  mb: number;
  keepNext?: boolean;
  keepLines?: boolean;
  /** Widow/orphan control; default on (Word). */
  widow?: boolean;
  breakBefore?: boolean;
  /** A page or column break node: what follows starts a new page/column. */
  breakAfter?: "page" | "column" | null;
  /** Split points are not allowed (atoms: images, rules, breaks). */
  atomic?: boolean;
}

export interface RowBox {
  h: number;
  /** Repeated at the top of each page (a leading run of header rows). */
  header?: boolean;
  /** Tall-row splitting: the row's content can break at any offset. */
  cantSplit?: boolean;
}

export interface TableBox {
  kind: "table";
  /** From the border-box top to the first row, and after the last row. */
  top: number;
  bottom: number;
  rows: RowBox[];
  mt: number;
  mb: number;
  keepNext?: boolean;
  breakBefore?: boolean;
}

export type Box = FlowBox | TableBox;

export interface ColumnSpec {
  /** Offset from the text's left edge, and width. */
  x: number;
  w: number;
}

export interface PageSpec {
  w: number;
  h: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  header: number;
  footer: number;
  gutter: number;
  cols: ColumnSpec[];
}

export interface SectionSpec {
  fromBlock: number;
  toBlock: number;
  start: SectionStart;
  page: PageSpec;
  /** Restart page numbering at this number. */
  pgStart?: number | null;
}

export interface LayoutOptions {
  /** Gap between pages. */
  gap?: number;
  /** Mirror margins: even pages swap left and right. */
  mirror?: boolean;
  /** Split rows taller than a page (the app can't draw a split row). */
  splitRows?: boolean;
}

// --- output --------------------------------------------------------------------------------

export interface PageBox {
  index: number;
  /** Displayed page number (after restarts). */
  number: number;
  section: number;
  /** 1-based page within its section. */
  sectionPage: number;
  /** Virtual y of the page's top edge. */
  top: number;
  spec: PageSpec;
  /** Inserted to fix odd/even parity: no content. */
  blank: boolean;
  /** Left edge of the text (after gutter / mirror), from the page's left. */
  textLeft: number;
}

export interface Piece {
  block: number;
  page: number;
  col: number;
  /** Virtual y of the piece's top (the first piece: the border-box top). */
  top: number;
  bottom: number;
  /** Lines (flow) or rows (table) [from, to). A row split across pages
   *  appears in both pieces; `rowOffset` is where the first one resumes. */
  from: number;
  to: number;
  rowOffset?: number;
  /** Table continuation: the repeated header rows drawn first. */
  headerRows?: number[];
  headerHeight?: number;
}

export interface Layout {
  pages: PageBox[];
  /** Pieces per block, in order. */
  blocks: Piece[][];
  /** Virtual y after the last page. */
  height: number;
  gap: number;
  /** Engine state before each block (incremental re-layout). */
  snaps: Snapshot[];
  /** The section specs this layout used. */
  sections: SectionSpec[];
}

export interface Snapshot {
  cur: Cursor;
  pages: number;
  section: number;
}

// --- helpers -------------------------------------------------------------------------------

const EPS = 0.5;

/** CSS margin collapsing between adjacent siblings. */
export function collapse(a: number, b: number): number {
  const pos = Math.max(0, a, b);
  const neg = Math.min(0, a, b);
  return pos + neg;
}

const sum = (xs: number[], from = 0, to = xs.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += xs[i];
  return s;
};

export const boxHeight = (b: Box) => (b.kind === "flow" ? sum(b.lines) : b.top + sum(b.rows.map((r) => r.h)) + b.bottom);

export interface Cursor {
  page: number;
  col: number;
  /** Bottom of the content placed in this column. */
  y: number;
  /** Bottom margin waiting to collapse with the next block. */
  mb: number;
  /** Nothing placed in this column yet. */
  empty: boolean;
  /** Where the current column region starts (page text top, or below the
   *  previous section on a continuous break). */
  regionTop: number;
  /** Deepest content of the region's columns (for continuous starts). */
  regionBottom: number;
  /** Balanced column bottom for this region (null = the page's). */
  colBottom: number | null;
}

// --- the layout engine ---------------------------------------------------------------------

class Engine {
  pages: PageBox[] = [];
  blocks: Piece[][];
  gap: number;
  cur!: Cursor;
  section = 0;

  constructor(
    readonly boxes: Box[],
    readonly sections: SectionSpec[],
    readonly opts: LayoutOptions,
  ) {
    this.blocks = boxes.map(() => []);
    this.gap = opts.gap ?? 16;
  }

  spec(): PageSpec {
    return this.pages[this.cur.page].spec;
  }

  cols(): ColumnSpec[] {
    return this.sections[this.section].page.cols;
  }

  colBottom(): number {
    const p = this.pages[this.cur.page];
    return this.cur.colBottom ?? p.top + p.spec.h - p.spec.bottom;
  }

  textLeft(spec: PageSpec, number: number): number {
    const mirrored = !!this.opts.mirror && number % 2 === 0;
    return mirrored ? spec.right : spec.left + spec.gutter;
  }

  /** addPage appends a page for the current section. */
  addPage(blank = false): number {
    const sec = this.sections[this.section];
    const prev = this.pages[this.pages.length - 1];
    const top = prev ? prev.top + prev.spec.h + this.gap : 0;
    let number = prev ? prev.number + 1 : 1;
    // A restart applies on the section's first page of its own.
    if (!blank && sec.pgStart != null && (!prev || prev.section !== this.section)) number = sec.pgStart;
    const sectionPage = prev && prev.section === this.section ? prev.sectionPage + 1 : 1;
    const page: PageBox = {
      index: this.pages.length,
      number,
      section: this.section,
      sectionPage,
      top,
      spec: sec.page,
      blank,
      textLeft: this.textLeft(sec.page, number),
    };
    this.pages.push(page);
    return page.index;
  }

  /** startPage moves the cursor to a fresh page of the current section. */
  startPage() {
    const i = this.addPage();
    const p = this.pages[i];
    const top = p.top + p.spec.top;
    this.cur = { page: i, col: 0, y: top, mb: 0, empty: true, regionTop: top, regionBottom: top, colBottom: null };
  }

  /** nextColumn moves to the next column, or the next page. */
  nextColumn() {
    const c = this.cur;
    c.regionBottom = Math.max(c.regionBottom, c.y);
    if (c.col + 1 < this.cols().length) {
      c.col++;
      c.y = c.regionTop;
      c.mb = 0;
      c.empty = true;
      return;
    }
    this.startPage();
  }

  nextPage() {
    this.startPage();
  }

  /** Where a block's border box starts in the current column. */
  blockTop(mt: number): number {
    return this.cur.empty ? this.cur.y + mt : this.cur.y + collapse(this.cur.mb, mt);
  }

  piece(p: Piece) {
    this.blocks[p.block].push(p);
  }

  // --- flow blocks ---------------------------------------------------------------------------

  placeFlow(i: number, b: FlowBox) {
    const n = b.lines.length;
    const multiCol = this.cols().length > 1;
    let from = 0;
    let first = true;
    for (let guard = 0; guard < n + 1000; guard++) {
      const top = first ? this.blockTop(b.mt) : this.cur.y;
      const limit = this.colBottom();
      let k = from;
      let y = top;
      while (k < n && y + b.lines[k] <= limit + EPS) y += b.lines[k++];
      if (k === n) {
        this.piece({ block: i, page: this.cur.page, col: this.cur.col, top, bottom: y, from, to: n });
        this.cur.y = y;
        this.cur.mb = b.mb;
        this.cur.empty = false;
        return;
      }
      const splittable = !b.atomic && !b.keepLines && !multiCol && n - from > 1;
      let cut = splittable ? k : from;
      if (splittable && b.widow !== false) {
        // At least two lines stay behind and two move on.
        if (n - cut < 2) cut = n - 2;
        if (cut - from < 2) cut = from;
      }
      if (cut === from) {
        if (this.cur.empty) {
          // Taller than a whole column and can't move on: split where it
          // overflows when we may (ignoring widow control), else let it
          // overflow the page.
          const hard = !b.atomic && !multiCol && n - from > 1 ? Math.max(from + 1, k) : n;
          y = top + sum(b.lines, from, hard);
          this.piece({ block: i, page: this.cur.page, col: this.cur.col, top, bottom: y, from, to: hard });
          this.cur.y = y;
          this.cur.empty = false;
          if (hard === n) {
            this.cur.mb = b.mb;
            return;
          }
          from = hard;
          first = false;
          this.nextColumn();
          continue;
        }
        this.nextColumn();
        continue;
      }
      y = top + sum(b.lines, from, cut);
      this.piece({ block: i, page: this.cur.page, col: this.cur.col, top, bottom: y, from, to: cut });
      this.cur.y = y;
      this.cur.empty = false;
      from = cut;
      first = false;
      this.nextColumn();
    }
  }

  // --- tables --------------------------------------------------------------------------------

  placeTable(i: number, b: TableBox) {
    const rows = b.rows;
    let headers = 0;
    while (headers < rows.length && rows[headers].header) headers++;
    // Only repeat when there is body after the header rows.
    const repeat = headers < rows.length ? headers : 0;
    const headerH = sum(rows.slice(0, repeat).map((r) => r.h));
    const splitRows = !!this.opts.splitRows;
    const multiCol = this.cols().length > 1;

    let top = this.blockTop(b.mt);
    let y = top + b.top;
    let pieceFrom = 0;
    let pieceTop = top;
    let bodyRows = 0; // non-header rows placed in this piece
    let headerRows: number[] | undefined;
    let headerHeight = 0;
    let offset = 0; // resumed part of a split row
    let r = 0;
    let firstPiece = true;
    const close = (to: number, bottom: number) => {
      const p: Piece = { block: i, page: this.cur.page, col: this.cur.col, top: pieceTop, bottom, from: pieceFrom, to };
      if (headerRows) {
        p.headerRows = headerRows;
        p.headerHeight = headerHeight;
      }
      if (offset && pieceFrom < rows.length) p.rowOffset = offset;
      this.piece(p);
    };
    const newPiece = () => {
      this.cur.y = Math.max(this.cur.y, pieceTop);
      this.cur.empty = false;
      this.nextColumn();
      pieceTop = this.cur.y;
      y = pieceTop;
      firstPiece = false;
      bodyRows = 0;
      headerRows = undefined;
      headerHeight = 0;
      if (repeat && r >= repeat) {
        headerRows = rows.slice(0, repeat).map((_, k) => k);
        headerHeight = headerH;
        y += headerH;
      }
      pieceFrom = r;
    };
    for (let guard = 0; r < rows.length && guard < rows.length * 4 + 1000; guard++) {
      const h = rows[r].h - offset;
      const limit = this.colBottom();
      if (y + h <= limit + EPS) {
        y += h;
        if (!rows[r].header || r >= repeat) bodyRows++;
        offset = 0;
        r++;
        continue;
      }
      const atTop = firstPiece ? this.cur.empty && r === 0 : bodyRows === 0 && !offset;
      // Nothing but header rows (or nothing) on this page and the table
      // started mid-page: move the whole table on (Word 2013+).
      if (firstPiece && bodyRows === 0 && !this.cur.empty && !multiCol) {
        this.nextColumn();
        top = this.blockTop(b.mt);
        pieceTop = top;
        y = top + b.top;
        r = 0;
        pieceFrom = 0;
        offset = 0;
        bodyRows = 0;
        firstPiece = true;
        continue;
      }
      if (firstPiece && multiCol && !this.cur.empty) {
        // Tables don't break across columns on screen: move it on whole.
        this.nextColumn();
        top = this.blockTop(b.mt);
        pieceTop = top;
        y = top + b.top;
        r = 0;
        pieceFrom = 0;
        bodyRows = 0;
        continue;
      }
      if (atTop || bodyRows === 0) {
        // The row alone is taller than the space on an empty page.
        if (splitRows && !rows[r].cantSplit && limit - y > EPS) {
          const part = limit - y;
          close(r + 1, limit);
          offset += part;
          newPiece();
          pieceFrom = r;
          continue;
        }
        // Overflow the page with it.
        y += h;
        bodyRows++;
        offset = 0;
        r++;
        continue;
      }
      if (multiCol) {
        // Let it overflow rather than split across columns.
        y += h;
        bodyRows++;
        r++;
        continue;
      }
      close(r, y);
      newPiece();
    }
    y += b.bottom;
    close(rows.length, y);
    this.cur.y = y;
    this.cur.mb = b.mb;
    this.cur.empty = false;
  }

  // --- blocks and sections ---------------------------------------------------------------------

  place(i: number, force = false) {
    const b = this.boxes[i];
    if ((b.breakBefore && !this.cur.empty) || (force && !this.cur.empty)) {
      if (b.breakBefore) this.nextPage();
      else this.nextColumn();
    }
    if (b.kind === "flow") this.placeFlow(i, b);
    else this.placeTable(i, b);
  }

  firstPiece(i: number): Piece | undefined {
    return this.blocks[i][0];
  }

  lastPiece(i: number): Piece | undefined {
    const ps = this.blocks[i];
    return ps[ps.length - 1];
  }

  snapshot(): Snapshot {
    return { cur: { ...this.cur }, pages: this.pages.length, section: this.section };
  }

  restore(s: Snapshot, fromBlock: number, toBlock: number) {
    this.cur = { ...s.cur };
    this.pages.length = s.pages;
    for (let k = fromBlock; k < toBlock; k++) this.blocks[k] = [];
  }

  /** Lays out blocks [from, to) of the current section. */
  run(from: number, to: number) {
    const forced = new Set<number>();
    for (let i = from; i < to; i++) {
      this.snaps.set(i, this.snapshot());
      this.place(i, forced.has(i));
      // Keep with next: the chain before this block must share the page
      // (and column) of this block's first line.
      if (i > from && this.boxes[i - 1].keepNext) {
        const prev = this.lastPiece(i - 1)!;
        const mine = this.firstPiece(i)!;
        if (prev.page !== mine.page || prev.col !== mine.col) {
          let c = i - 1;
          while (c > from && this.boxes[c - 1].keepNext) c--;
          const snap = this.snaps.get(c)!;
          const start = this.firstPiece(c)!;
          // Nothing to gain when the chain already starts a page.
          if (!snap.cur.empty && !forced.has(c) && !(start.page === mine.page && start.col === mine.col)) {
            this.restore(snap, c, i + 1);
            forced.add(c);
            i = c - 1;
            continue;
          }
        }
      }
      const b = this.boxes[i];
      if (b.kind === "flow" && b.breakAfter && i + 1 < this.boxes.length) {
        if (b.breakAfter === "page") this.nextPage();
        else this.nextColumn();
      }
    }
  }

  /** Snapshots before each block (keep-with-next and balancing). */
  snaps = new Map<number, Snapshot>();

  /** Balance the columns of the section's last region (before a
   *  continuous break): the smallest column height that still fits. */
  balance(from: number, to: number) {
    if (this.cols().length < 2) return;
    // The region: blocks whose first piece is on the section's last page.
    const page = this.cur.page;
    let start = to;
    while (start > from && this.firstPiece(start - 1)?.page === page) start--;
    if (start >= to) return;
    const snap = this.snaps.get(start);
    if (!snap || snap.cur.page !== page) return;
    const fits = (h: number | null) => {
      this.restore(snap, start, to);
      this.cur.colBottom = h == null ? null : this.cur.regionTop + h;
      this.run(start, to);
      return this.cur.page === page && this.pages.length === snap.pages;
    };
    const full = Math.ceil(this.pages[page].top + this.pages[page].spec.h - this.pages[page].spec.bottom - snap.cur.regionTop);
    let lo = 0;
    let hi = full;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    if (!fits(hi)) fits(null);
    this.cur.colBottom = null;
  }

  layout(resume?: { prev: Layout; from: number }): Layout {
    let first = 0;
    let fromBlock = -1;
    if (resume) {
      const snap = resume.prev.snaps[resume.from];
      first = snap.section;
      fromBlock = resume.from;
      this.pages = resume.prev.pages.slice(0, snap.pages);
      for (let k = 0; k < resume.from; k++) {
        this.blocks[k] = resume.prev.blocks[k];
        this.snaps.set(k, resume.prev.snaps[k]);
      }
      this.cur = { ...snap.cur };
      this.section = first;
    }
    for (let s = first; s < this.sections.length; s++) {
      const sec = this.sections[s];
      const prevSec = this.sections[s - 1];
      this.section = s;
      if (s === first && fromBlock >= 0) {
        /* resuming inside this section */
      } else if (s === 0) this.startPage();
      else {
        const samePage =
          sec.start === "continuous" &&
          prevSec &&
          Math.abs(prevSec.page.w - sec.page.w) < EPS &&
          Math.abs(prevSec.page.h - sec.page.h) < EPS;
        if (samePage) {
          const c = this.cur;
          const bottom = Math.max(c.regionBottom, c.y);
          c.regionTop = bottom;
          c.regionBottom = bottom;
          c.y = bottom;
          c.col = 0;
          c.colBottom = null;
        } else {
          const want = sec.start === "evenPage" ? 0 : sec.start === "oddPage" ? 1 : -1;
          const prev = this.pages[this.pages.length - 1];
          const next = sec.pgStart != null ? sec.pgStart : prev.number + 1;
          if (want >= 0 && next % 2 !== want) {
            // A blank page of the previous section fixes the parity.
            this.section = s - 1;
            this.addPage(true);
            this.section = s;
          }
          this.startPage();
        }
      }
      this.run(s === first && fromBlock >= 0 ? fromBlock : sec.fromBlock, sec.toBlock);
      const next = this.sections[s + 1];
      if (next && next.start === "continuous") this.balance(sec.fromBlock, sec.toBlock);
      // Where the region's deepest column ends (a continuous start).
      this.cur.regionBottom = Math.max(this.cur.regionBottom, this.cur.y);
    }
    const last = this.pages[this.pages.length - 1];
    const snaps: Snapshot[] = [];
    for (let k = 0; k < this.boxes.length; k++) snaps.push(this.snaps.get(k)!);
    return {
      pages: this.pages,
      blocks: this.blocks,
      height: last.top + last.spec.h,
      gap: this.gap,
      snaps,
      sections: this.sections,
    };
  }
}

/**
 * paginate lays the boxes out on pages. With `prev` (the previous layout)
 * and `changed` (the first block whose box changed), it resumes from the
 * start of that block's keep-with-next chain instead of starting over.
 */
export function paginate(
  boxes: Box[],
  sections: SectionSpec[],
  opts: LayoutOptions = {},
  prev?: Layout | null,
  changed?: number,
): Layout {
  const secs = sections.length
    ? sections
    : [{ fromBlock: 0, toBlock: boxes.length, start: "nextPage" as SectionStart, page: letterSpec() }];
  const engine = new Engine(boxes, secs, opts);
  if (prev && changed != null && changed > 0 && changed <= boxes.length && canResume(prev, secs, boxes, changed, opts)) {
    let from = Math.min(changed, boxes.length - 1);
    while (from > 0 && boxes[from - 1].keepNext) from--;
    // A continuous break balances the region it ends; start over there.
    if (from > 0 && prev.snaps[from]) return engine.layout({ prev, from });
  }
  return engine.layout();
}

function canResume(prev: Layout, secs: SectionSpec[], boxes: Box[], changed: number, opts: LayoutOptions): boolean {
  if ((prev.gap ?? 16) !== (opts.gap ?? 16) || prev.snaps.length < changed) return false;
  // Sections up to the changed block must be unchanged.
  for (let s = 0; s < secs.length; s++) {
    const a = secs[s];
    const b = prev.sections[s];
    if (!b) return false;
    if (a.fromBlock > changed) break;
    if (a.fromBlock !== b.fromBlock || a.start !== b.start || JSON.stringify(a.page) !== JSON.stringify(b.page) || a.pgStart !== b.pgStart) return false;
    if (a.toBlock !== b.toBlock && a.toBlock <= changed) return false;
    if (a.page.cols.length > 1 && a.toBlock > changed) return false;
  }
  return boxes.length > 0;
}

/** A Letter page with 1in margins, in px. */
export function letterSpec(): PageSpec {
  return { w: 816, h: 1056, top: 96, bottom: 96, left: 96, right: 96, header: 48, footer: 48, gutter: 0, cols: [{ x: 0, w: 624 }] };
}

// --- queries -------------------------------------------------------------------------------

/** The page a block starts on (its first piece). */
export const startPage = (l: Layout, block: number) => l.blocks[block][0]?.page ?? 0;

/** The pages a block occupies, in order (distinct). */
export function blockPages(l: Layout, block: number): number[] {
  const out: number[] = [];
  for (const p of l.blocks[block]) if (out[out.length - 1] !== p.page) out.push(p.page);
  return out;
}

/** Page-relative bounds of a table row on a page (repeated header rows
 *  included), like OnlyOffice's getRowBounds. */
export function rowBounds(l: Layout, boxes: Box[], block: number, row: number, pageIndex: number): { top: number; bottom: number } | null {
  const b = boxes[block];
  if (b.kind !== "table") return null;
  const pieces = l.blocks[block].filter((p) => p.page === pageIndex);
  for (const p of pieces) {
    const pageTop = l.pages[p.page].top;
    let y = p.top + (p === l.blocks[block][0] ? b.top : 0);
    if (p.headerRows) {
      for (const h of p.headerRows) {
        if (h === row && p.from > h) return { top: y - pageTop, bottom: y + b.rows[h].h - pageTop };
        y += b.rows[h].h;
      }
    }
    for (let r = p.from; r < p.to; r++) {
      const h = b.rows[r].h - (r === p.from ? p.rowOffset ?? 0 : 0);
      if (r === row) return { top: y - pageTop, bottom: y + h - pageTop };
      y += h;
    }
  }
  return null;
}

/** The first row on a table's n-th piece. */
export const pieceFirstRow = (l: Layout, block: number, n: number) => l.blocks[block][n]?.from ?? -1;
