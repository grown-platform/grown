// Insert and document dialogs for Docs (M13): Symbol table (font, Unicode
// block, hex code, recently used), Date and time, Drop cap, Document
// statistics, and Insert ▸ Text from file.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  List,
  ListItemButton,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Table,
  Typography,
} from "@mui/joy";
import type { Editor } from "@tiptap/react";
import { DATE_FORMATS, formatDate } from "./fields";
import { PICKER_FONTS, fontStack } from "../../lib/fonts";
import { docStats } from "./docStats";
import { getLayout } from "./paginationPlugin";
import { dropCapOf, type DropCapKind } from "./dropCap";
import { getDocModel } from "./docModel";
import { importDoc } from "./api";

export type InsertDialogKind = "symbol" | "datetime" | "dropcap" | "stats";
const EVENT = "grown-docs-insert-dialog";

export function openInsertDialog(kind: InsertDialogKind) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: kind }));
}

export function InsertDialogs({ editor }: { editor: Editor | null }) {
  const [kind, setKind] = useState<InsertDialogKind | null>(null);
  useEffect(() => {
    const on = (e: Event) => setKind((e as CustomEvent<InsertDialogKind>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  if (!editor || !kind) return null;
  const close = () => {
    setKind(null);
    editor.commands.focus();
  };
  switch (kind) {
    case "symbol":
      return <SymbolDialog editor={editor} onClose={close} />;
    case "datetime":
      return <DateTimeDialog editor={editor} onClose={close} />;
    case "dropcap":
      return <DropCapDialog editor={editor} onClose={close} />;
    case "stats":
      return <StatsDialog editor={editor} onClose={close} />;
  }
}

// --- symbol table ----------------------------------------------------------------------------

/** Unicode blocks offered in the Symbol dialog ("Subset"). */
export const SYMBOL_BLOCKS: { name: string; from: number; to: number }[] = [
  { name: "Basic Latin", from: 0x20, to: 0x7e },
  { name: "Latin-1 Supplement", from: 0xa1, to: 0xff },
  { name: "Latin Extended-A", from: 0x100, to: 0x17f },
  { name: "Latin Extended-B", from: 0x180, to: 0x24f },
  { name: "IPA Extensions", from: 0x250, to: 0x2af },
  { name: "Spacing Modifier Letters", from: 0x2b0, to: 0x2ff },
  { name: "Greek and Coptic", from: 0x370, to: 0x3ff },
  { name: "Cyrillic", from: 0x400, to: 0x4ff },
  { name: "Hebrew", from: 0x590, to: 0x5ff },
  { name: "Arabic", from: 0x600, to: 0x6ff },
  { name: "General Punctuation", from: 0x2010, to: 0x205e },
  { name: "Superscripts and Subscripts", from: 0x2070, to: 0x209c },
  { name: "Currency Symbols", from: 0x20a0, to: 0x20c0 },
  { name: "Letterlike Symbols", from: 0x2100, to: 0x214f },
  { name: "Number Forms", from: 0x2150, to: 0x218b },
  { name: "Arrows", from: 0x2190, to: 0x21ff },
  { name: "Mathematical Operators", from: 0x2200, to: 0x22ff },
  { name: "Miscellaneous Technical", from: 0x2300, to: 0x23ff },
  { name: "Enclosed Alphanumerics", from: 0x2460, to: 0x24ff },
  { name: "Box Drawing", from: 0x2500, to: 0x257f },
  { name: "Block Elements", from: 0x2580, to: 0x259f },
  { name: "Geometric Shapes", from: 0x25a0, to: 0x25ff },
  { name: "Miscellaneous Symbols", from: 0x2600, to: 0x26ff },
  { name: "Dingbats", from: 0x2700, to: 0x27bf },
  { name: "Supplemental Arrows-A", from: 0x27f0, to: 0x27ff },
  { name: "Alphabetic Presentation Forms", from: 0xfb00, to: 0xfb4f },
];

const RECENT_KEY = "grown.docs.recentSymbols";

export function loadRecentSymbols(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function pushRecentSymbol(ch: string): string[] {
  const next = [ch, ...loadRecentSymbols().filter((c) => c !== ch)].slice(0, 20);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private window */
  }
  return next;
}

/** Code points of a block that are assigned, printable characters. */
export function blockChars(from: number, to: number): string[] {
  const out: string[] = [];
  for (let cp = from; cp <= to; cp++) {
    const ch = String.fromCodePoint(cp);
    if (/[\p{Cn}\p{Cc}\p{Cs}\p{Co}]/u.test(ch)) continue;
    out.push(ch);
  }
  return out;
}

const hex = (ch: string) => (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");

/** insertSymbol inserts a character, in `font` when one was picked. */
export function insertSymbol(editor: Editor, ch: string, font: string | null) {
  const chain = editor.chain().focus();
  if (font) chain.insertContent({ type: "text", text: ch, marks: [{ type: "textStyle", attrs: { fontFamily: font } }] });
  else chain.insertContent(ch);
  chain.run();
  pushRecentSymbol(ch);
}

function SymbolDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [font, setFont] = useState<string>("");
  const [block, setBlock] = useState(SYMBOL_BLOCKS[0].name);
  const [sel, setSel] = useState<string>(" ");
  const [code, setCode] = useState("0020");
  const [recent, setRecent] = useState(loadRecentSymbols);
  const gridRef = useRef<HTMLDivElement>(null);
  const b = SYMBOL_BLOCKS.find((x) => x.name === block) ?? SYMBOL_BLOCKS[0];
  const chars = useMemo(() => blockChars(b.from, b.to), [b.from, b.to]);
  const family = font ? fontStack(font) : "inherit";
  const pick = (ch: string, scroll = false) => {
    setSel(ch);
    setCode(hex(ch));
    if (scroll) {
      const cp = ch.codePointAt(0) ?? 0;
      const blk = SYMBOL_BLOCKS.find((x) => cp >= x.from && cp <= x.to);
      if (blk && blk.name !== block) setBlock(blk.name);
      setTimeout(() => gridRef.current?.querySelector(`[data-cp="${cp}"]`)?.scrollIntoView({ block: "nearest" }), 0);
    }
  };
  const insert = (ch = sel) => {
    insertSymbol(editor, ch, font || null);
    setRecent(loadRecentSymbols());
  };
  const cell = (ch: string, key: string) => (
    <Box
      key={key}
      data-cp={ch.codePointAt(0)}
      data-testid="symbol-cell"
      title={`U+${hex(ch)}`}
      onClick={() => pick(ch)}
      onDoubleClick={() => insert(ch)}
      sx={{
        fontFamily: family,
        fontSize: 20,
        lineHeight: "32px",
        height: 34,
        textAlign: "center",
        cursor: "pointer",
        border: "1px solid",
        borderColor: ch === sel ? "primary.500" : "divider",
        bgcolor: ch === sel ? "primary.softBg" : "background.surface",
        userSelect: "none",
      }}
    >
      {ch}
    </Box>
  );
  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: { xs: "calc(100vw - 32px)", sm: 620 } }} data-testid="symbol-dialog">
        <ModalClose />
        <DialogTitle>Symbol</DialogTitle>
        <Stack direction="row" spacing={1}>
          <FormControl sx={{ flex: 1 }}>
            <FormLabel>Font</FormLabel>
            <Select size="sm" value={font} onChange={(_, v) => setFont(v ?? "")} slotProps={{ button: { "aria-label": "Symbol font" } }}>
              <Option value="">(normal text)</Option>
              {PICKER_FONTS.map((f) => (
                <Option key={f} value={f} sx={{ fontFamily: fontStack(f) }}>
                  {f}
                </Option>
              ))}
            </Select>
          </FormControl>
          <FormControl sx={{ flex: 1 }}>
            <FormLabel>Subset</FormLabel>
            <Select size="sm" value={block} onChange={(_, v) => v && setBlock(v)} slotProps={{ button: { "aria-label": "Symbol subset" } }}>
              {SYMBOL_BLOCKS.map((x) => (
                <Option key={x.name} value={x.name}>
                  {x.name}
                </Option>
              ))}
            </Select>
          </FormControl>
        </Stack>
        <Box ref={gridRef} data-testid="symbol-grid" sx={{ display: "grid", gridTemplateColumns: "repeat(16, 1fr)", gap: "2px", maxHeight: 260, overflowY: "auto", mt: 1 }}>
          {chars.map((ch) => cell(ch, `c${ch.codePointAt(0)}`))}
        </Box>
        <Typography level="body-xs" sx={{ mt: 1 }}>
          Recently used symbols
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(20, 1fr)", gap: "2px", minHeight: 34 }} data-testid="symbol-recent">
          {recent.map((ch, i) => cell(ch, `r${i}`))}
        </Box>
        <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ mt: 1 }}>
          <Box sx={{ fontFamily: family, fontSize: 40, width: 64, height: 64, border: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", justifyContent: "center" }} data-testid="symbol-preview">
            {sel}
          </Box>
          <FormControl>
            <FormLabel>Character code (Unicode hex)</FormLabel>
            <Input
              size="sm"
              value={code}
              slotProps={{ input: { "aria-label": "Character code", "data-testid": "symbol-code" } }}
              onChange={(e) => {
                const v = e.target.value.replace(/^u\+/i, "").toUpperCase();
                setCode(v);
                const cp = parseInt(v, 16);
                if (/^[0-9A-F]{2,6}$/.test(v) && cp > 0x1f && cp <= 0x10ffff) pick(String.fromCodePoint(cp), true);
              }}
            />
          </FormControl>
          <Typography level="body-sm" sx={{ pb: 0.5 }}>
            U+{hex(sel)}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button variant="plain" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => insert()} data-testid="symbol-insert">
            Insert
          </Button>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}

// --- date & time -------------------------------------------------------------------------------

function DateTimeDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const now = useMemo(() => new Date(), []);
  const [fmt, setFmt] = useState(DATE_FORMATS[0]);
  const [auto, setAuto] = useState(false);
  const ok = () => {
    if (auto) editor.chain().focus().insertField(`${/[dMy]/.test(fmt) ? "DATE" : "TIME"} \\@ "${fmt}"`).run();
    else editor.chain().focus().insertContent(formatDate(new Date(), fmt)).run();
    onClose();
  };
  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: 380 }} data-testid="datetime-dialog">
        <ModalClose />
        <DialogTitle>Date and time</DialogTitle>
        <FormLabel>Available formats</FormLabel>
        <List size="sm" variant="outlined" sx={{ maxHeight: 280, overflow: "auto", borderRadius: "sm" }}>
          {DATE_FORMATS.map((f) => (
            <ListItemButton key={f} selected={f === fmt} onClick={() => setFmt(f)} onDoubleClick={ok} data-testid="datetime-format">
              {formatDate(now, f)}
            </ListItemButton>
          ))}
        </List>
        <Checkbox size="sm" label="Update automatically (insert a field)" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <Stack direction="row" justifyContent="flex-end" spacing={1}>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={ok} data-testid="datetime-ok">
            Insert
          </Button>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}

// --- drop cap ---------------------------------------------------------------------------------

function DropCapDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const cur = dropCapOf(editor.state.selection.$from.parent.attrs);
  const [kind, setKind] = useState<DropCapKind | "none">(cur?.kind ?? "drop");
  const [lines, setLines] = useState(cur?.lines ?? 3);
  const [font, setFont] = useState(cur?.font ?? "");
  const [distance, setDistance] = useState(cur?.distance ?? 0);
  const ok = () => {
    if (kind === "none") editor.chain().focus().setDropCap(null).run();
    else editor.chain().focus().setDropCap({ kind, lines, font: font || null, distance }).run();
    onClose();
  };
  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: 360 }} data-testid="dropcap-dialog">
        <ModalClose />
        <DialogTitle>Drop cap</DialogTitle>
        <RadioGroup orientation="horizontal" value={kind} onChange={(e) => setKind(e.target.value as DropCapKind | "none")}>
          <Radio value="none" label="None" />
          <Radio value="drop" label="Dropped" />
          <Radio value="margin" label="In margin" />
        </RadioGroup>
        <FormControl>
          <FormLabel>Font</FormLabel>
          <Select size="sm" value={font} onChange={(_, v) => setFont(v ?? "")}>
            <Option value="">(paragraph font)</Option>
            {PICKER_FONTS.map((f) => (
              <Option key={f} value={f}>
                {f}
              </Option>
            ))}
          </Select>
        </FormControl>
        <Stack direction="row" spacing={1}>
          <FormControl sx={{ flex: 1 }}>
            <FormLabel>Lines to drop</FormLabel>
            <Input size="sm" type="number" value={lines} slotProps={{ input: { min: 1, max: 10, "aria-label": "Lines to drop" } }} onChange={(e) => setLines(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
          </FormControl>
          <FormControl sx={{ flex: 1 }}>
            <FormLabel>Distance from text (pt)</FormLabel>
            <Input size="sm" type="number" value={distance} slotProps={{ input: { min: 0, max: 72 } }} onChange={(e) => setDistance(Math.max(0, Number(e.target.value) || 0))} />
          </FormControl>
        </Stack>
        <Stack direction="row" justifyContent="flex-end" spacing={1}>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={ok} data-testid="dropcap-ok">
            OK
          </Button>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}

// --- statistics ---------------------------------------------------------------------------------

/** Lines of text in the layout (flow blocks). */
function layoutLines(editor: Editor): number | null {
  const dl = getLayout(editor);
  if (!dl) return null;
  let n = 0;
  for (const b of dl.measured.boxes) if (b.kind === "flow" && !b.atomic) n += b.lines.length;
  return n;
}

function StatsDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [notes, setNotes] = useState(false);
  const { from, to, empty } = editor.state.selection;
  const pages = getLayout(editor)?.layout.pages.length ?? 1;
  const all = docStats(editor.state.doc, { includeNotes: notes, pages, lines: layoutLines(editor) });
  const part = empty ? null : docStats(editor.state.doc, { from, to, includeNotes: notes });
  const rows: [string, keyof typeof all][] = [
    ["Pages", "pages"],
    ["Words", "words"],
    ["Characters (no spaces)", "chars"],
    ["Characters (with spaces)", "charsWithSpaces"],
    ["Paragraphs", "paragraphs"],
    ["Lines", "lines"],
  ];
  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ width: 400 }} data-testid="stats-dialog">
        <ModalClose />
        <DialogTitle>Document statistics</DialogTitle>
        <Table size="sm" sx={{ "& td:not(:first-of-type), & th:not(:first-of-type)": { textAlign: "right" } }}>
          <thead>
            <tr>
              <th>Statistic</th>
              <th>Document</th>
              {part && <th>Selection</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, k]) => (
              <tr key={k} data-testid={`stats-${k}`}>
                <td>{label}</td>
                <td>{all[k] == null ? "—" : Number(all[k]).toLocaleString()}</td>
                {part && <td>{k === "pages" || k === "lines" ? "—" : Number(part[k]).toLocaleString()}</td>}
              </tr>
            ))}
          </tbody>
        </Table>
        <Checkbox size="sm" label="Include footnotes and endnotes" checked={notes} onChange={(e) => setNotes(e.target.checked)} />
        <Stack direction="row" justifyContent="flex-end">
          <Button onClick={onClose}>Close</Button>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}

// --- text from file -----------------------------------------------------------------------------

/** insertTextFromFile inserts another document's content at the caret
 *  (Word's Insert ▸ Text from File): .docx through the direct reader
 *  (its styles are added when missing), .txt as plain paragraphs, other
 *  formats through the server importer. */
export async function insertTextFromFile(editor: Editor, file: File): Promise<void> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt" || ext === "text" || file.type === "text/plain") {
    const text = await fileText(file);
    const paras = text.replace(/\r\n?/g, "\n").split("\n");
    editor
      .chain()
      .focus()
      .insertContent(paras.map((p) => ({ type: "paragraph", content: p ? [{ type: "text", text: p }] : [] })))
      .run();
    return;
  }
  if (ext === "docx") {
    const { readDocx } = await import("./docx/read");
    const imp = await readDocx(file);
    const { sheet } = getDocModel(editor);
    for (const def of Object.values(imp.styles)) if (!sheet.get(def.id)) sheet.put(def);
    editor.chain().focus().insertContent(imp.doc.content ?? []).run();
    return;
  }
  const html = await importDoc(file);
  editor.chain().focus().insertContent(html).run();
}

function fileText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result ?? ""));
    r.onerror = () => fail(r.error);
    r.readAsText(file);
  });
}

/** Open a file picker and insert the chosen file. */
export function pickTextFromFile(editor: Editor) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".docx,.odt,.rtf,.txt,.md,.markdown,.html,.htm,.epub";
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) insertTextFromFile(editor, f).catch((e) => window.alert(`Could not insert the file: ${(e as Error).message}`));
  };
  input.click();
}
