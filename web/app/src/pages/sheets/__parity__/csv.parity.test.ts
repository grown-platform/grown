// Port of OnlyOffice's CSV text parsing test (behaviour only, clean-room):
//   cell/spreadsheet-calculation/copy-paste-tests.js — "parseText CSV parsing"
// against ../csvText.ts (paste from text / import).

import { describe, expect, it } from "vitest";
import { parseDelimited } from "../csvText";

const comma = { delimiter: ",", qualifier: null };
const quoted = (delimiter: string) => ({ delimiter, qualifier: '"' });

describe("sheets parity: delimited text", () => {
  it("oo:cell/spreadsheet-calculation/copy-paste-tests.js#Test: parseText CSV parsing", () => {
    // Delimiters.
    expect(parseDelimited("a,b,c\nd,e,f", comma)).toEqual([["a", "b", "c"], ["d", "e", "f"]]);
    expect(parseDelimited("x;y;z\n1;2;3", { delimiter: ";" })).toEqual([["x", "y", "z"], ["1", "2", "3"]]);
    expect(parseDelimited("c1\tc2\nv1\tv2", { delimiter: "\t" })).toEqual([["c1", "c2"], ["v1", "v2"]]);
    expect(parseDelimited("one two three\nfour five six", { delimiter: " " })).toEqual([
      ["one", "two", "three"],
      ["four", "five", "six"],
    ]);
    expect(parseDelimited("a|b|c\nd|e|f", { delimiter: "|" })).toEqual([["a", "b", "c"], ["d", "e", "f"]]);
    expect(parseDelimited("hello\nworld\ntest", { delimiter: null })).toEqual([["hello"], ["world"], ["test"]]);

    // Qualified fields: plain, holding delimiters, empty, mixed, at line end.
    expect(parseDelimited('"p","q"\n"r","s"', quoted(","))).toEqual([["p", "q"], ["r", "s"]]);
    expect(parseDelimited('"hi, there","1,2",plain\n"a,b",x', quoted(","))).toEqual([
      ["hi, there", "1,2", "plain"],
      ["a,b", "x"],
    ]);
    expect(parseDelimited('"","mid",""\n"e","","f"', quoted(","))).toEqual([["", "mid", ""], ["e", "", "f"]]);
    expect(parseDelimited('bare,"wrapped",bare2,"two words"', quoted(","))).toEqual([
      ["bare", "wrapped", "bare2", "two words"],
    ]);
    expect(parseDelimited('a,b,"end"\nc,d,"last"', quoted(","))).toEqual([["a", "b", "end"], ["c", "d", "last"]]);
    expect(
      parseDelimited('Who,"Where",Tel\n"Ann Lee","1 High St, Flat 2",555-0100', quoted(",")),
    ).toEqual([
      ["Who", "Where", "Tel"],
      ["Ann Lee", "1 High St, Flat 2", "555-0100"],
    ]);

    // Empty fields and rows; line endings.
    expect(parseDelimited("a,,c\n,b,\nd,,f", comma)).toEqual([["a", "", "c"], ["", "b", ""], ["d", "", "f"]]);
    expect(parseDelimited("a,b\n\nc,d\n\n", comma)).toEqual([["a", "b"], [""], ["c", "d"], [""]]);
    expect(parseDelimited("a,b\r\nc,d", comma)).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseDelimited("a,b\rc,d", comma)).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseDelimited("k,v\nx,1\ny,2", comma)).toEqual([["k", "v"], ["x", "1"], ["y", "2"]]);
    expect(parseDelimited("i1\ni2\ni3", comma)).toEqual([["i1"], ["i2"], ["i3"]]);
    expect(parseDelimited("h1,h2,h3,h4", comma)).toEqual([["h1", "h2", "h3", "h4"]]);
    expect(parseDelimited("a,b,\nc,d,", comma)).toEqual([["a", "b", ""], ["c", "d", ""]]);
    expect(parseDelimited(",a,b\n,c,d", comma)).toEqual([["", "a", "b"], ["", "c", "d"]]);
    expect(parseDelimited("", comma)).toEqual([[]]);
    expect(parseDelimited(",,\n,,", comma)).toEqual([["", "", ""], ["", "", ""]]);
    const spaced = parseDelimited(" lead trail \n  two  gaps  ", { delimiter: " " });
    expect(spaced.length).toBeGreaterThan(0);

    // Doubled qualifiers and line breaks inside qualified fields (normalised to \n).
    expect(parseDelimited('"say ""hi""","ok"\n"a ""b"" c","z"', quoted(","))).toEqual([
      ['say "hi"', "ok"],
      ['a "b" c', "z"],
    ]);
    expect(parseDelimited('"A","l1\r\nl2","B"\n"C","D","E"', quoted(","))).toEqual([
      ["A", "l1\nl2", "B"],
      ["C", "D", "E"],
    ]);
    expect(parseDelimited('"A","l1\rl2","B"', quoted(","))).toEqual([["A", "l1\nl2", "B"]]);
    expect(parseDelimited('"two ""q""\nlines",x', quoted(","))).toEqual([['two "q"\nlines', "x"]]);
    expect(parseDelimited('"x\ny"|z', quoted("|"))).toEqual([["x\ny", "z"]]);
    expect(parseDelimited('"s\nm\r\ne",foo', quoted(","))).toEqual([["s\nm\ne", "foo"]]);
  });
});
