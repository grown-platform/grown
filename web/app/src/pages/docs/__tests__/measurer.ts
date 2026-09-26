// MockMeasurer: deterministic text metrics for pagination tests (Docs M9).
//
// jsdom has no layout engine — every element measures 0x0. Pagination logic
// (keep-with-next, table header repeat, page breaks inside tables) should
// therefore be written against a small measuring interface that the browser
// implements with real DOM metrics and tests implement with this mock.
//
// The model is a monospace grid: every character is `charWidth` wide, every
// line is `lineHeight` tall, and lines wrap greedily at word boundaries
// within `pageWidth`. That is enough to express "this paragraph takes three
// lines, so it does not fit in the remaining two" without a browser.

export interface Measurer {
  /** Width of a run of text in px. */
  textWidth(text: string): number;
  /** Lines the text wraps to within `width` px. Empty text is one line. */
  lineCount(text: string, width: number): number;
  /** Height of a paragraph with `text` laid out in `width` px. */
  paragraphHeight(text: string, width: number): number;
}

export interface MockMeasurerOpts {
  charWidth?: number;
  lineHeight?: number;
}

export class MockMeasurer implements Measurer {
  readonly charWidth: number;
  readonly lineHeight: number;

  constructor(opts: MockMeasurerOpts = {}) {
    this.charWidth = opts.charWidth ?? 10;
    this.lineHeight = opts.lineHeight ?? 20;
  }

  textWidth(text: string): number {
    return [...text].length * this.charWidth;
  }

  lineCount(text: string, width: number): number {
    const perLine = Math.max(1, Math.floor(width / this.charWidth));
    let lines = 0;
    for (const hard of text.split("\n")) {
      lines += 1;
      let used = 0;
      for (const word of hard.split(/(\s+)/)) {
        let len = [...word].length;
        if (!len) continue;
        if (used + len <= perLine) {
          used += len;
          continue;
        }
        if (/^\s+$/.test(word)) {
          // Trailing whitespace hangs past the margin, as in word processors.
          used = perLine;
          continue;
        }
        if (used > 0) {
          lines += 1;
          used = 0;
        }
        // A word longer than a line breaks mid-word.
        while (len > perLine) {
          lines += 1;
          len -= perLine;
        }
        used = len;
      }
    }
    return lines;
  }

  paragraphHeight(text: string, width: number): number {
    return this.lineCount(text, width) * this.lineHeight;
  }
}
