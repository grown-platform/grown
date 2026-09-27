// Reference dialogs (Docs M8): Bookmarks, Link settings (hyperlink with
// internal targets, display text and ScreenTip), Caption, Cross-reference,
// Table of contents / figures settings and Field. Mounted once
// (<ReferenceDialogs editor/>) and opened from menus with
// openReferenceDialog(kind), like ParagraphDialogs.
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  Box,
  Button,
  Checkbox,
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
  Typography,
} from "@mui/joy";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  goToBookmark,
  isHiddenBookmark,
  isValidBookmarkName,
  listBookmarks,
  removeBookmark,
  setBookmark,
  ensureBookmark,
} from "./bookmarks";
import { insertTableOfContents, updateTocAt } from "./references";
import { tocInstr, tocOptions, tocNodes, type TocLeader, type TocOptions } from "./toc";
import {
  CHAPTER_SEPARATORS,
  captionLabels,
  customLabels,
  defaultCaptionPosition,
  insertCaption,
  saveCustomLabels,
} from "./captions";
import { insertCrossReference, kindsFor, refTargets, refTypes, type RefKind } from "./crossref";
import { DATE_FORMATS, formatDate, outlineLevelOf, SEQ_FORMATS, textWithFields } from "./fields";
import { getDocModel } from "./docModel";
import { syncSelectionFromDOM } from "./links";

export type ReferenceDialogKind = "bookmarks" | "hyperlink" | "caption" | "crossref" | "toc" | "tof" | "field";

const EVENT = "grown-docs-reference-dialog";

/** openReferenceDialog opens one of the mounted reference dialogs. */
export function openReferenceDialog(kind: ReferenceDialogKind): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: kind }));
}

export function ReferenceDialogs({ editor }: { editor: Editor | null }) {
  const [kind, setKind] = useState<ReferenceDialogKind | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      if (editor) syncSelectionFromDOM(editor.view);
      setKind((e as CustomEvent<ReferenceDialogKind>).detail);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [editor]);
  const close = () => {
    // Unmount the modal now and focus the editor within the same event.
    // An insert's own view.focus() runs while the modal's focus trap is
    // still mounted: the trap takes focus back, so ProseMirror never
    // writes its caret to the DOM, and TipTap's commands.focus() waits a
    // frame. Keys typed in that frame went where the browser had parked
    // its caret (the start of the document) and were lost.
    flushSync(() => setKind(null));
    if (editor && !editor.isDestroyed) editor.view.focus();
  };
  if (!editor || !kind) return null;
  return (
    // disableRestoreFocus: focus stays in the editor after an insert
    // (restoring it to the menu button swallowed the next keystroke).
    <Modal open onClose={close} disableRestoreFocus>
      <ModalDialog
        data-testid={`ref-dialog-${kind}`}
        sx={{ width: { xs: "calc(100vw - 32px)", sm: 480 }, maxWidth: "calc(100vw - 32px)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <ModalClose />
        {kind === "bookmarks" && <BookmarksDialog editor={editor} onClose={close} />}
        {kind === "hyperlink" && <HyperlinkDialog editor={editor} onClose={close} />}
        {kind === "caption" && <CaptionDialog editor={editor} onClose={close} />}
        {kind === "crossref" && <CrossRefDialog editor={editor} onClose={close} />}
        {(kind === "toc" || kind === "tof") && <TocDialog editor={editor} figures={kind === "tof"} onClose={close} />}
        {kind === "field" && <FieldDialog editor={editor} onClose={close} />}
      </ModalDialog>
    </Modal>
  );
}

interface DialogProps {
  editor: Editor;
  onClose: () => void;
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <Typography level="body-sm" sx={{ fontWeight: 600, mb: 0.5 }}>
    {children}
  </Typography>
);

// --- Bookmarks -------------------------------------------------------------------------

function BookmarksDialog({ editor, onClose }: DialogProps) {
  const [version, setVersion] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [sort, setSort] = useState<"name" | "location">("name");
  const selText = useMemo(() => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, " ").trim();
  }, [editor]);
  const [name, setName] = useState(() => selText.replace(/[^\p{L}\p{N}_]+/gu, "_").replace(/^[^A-Za-z]+/, "").slice(0, 40));
  const all = useMemo(() => {
    void version;
    const l = listBookmarks(editor.state.doc).filter((b) => hidden || !b.hidden);
    return sort === "name" ? [...l].sort((a, b) => a.name.localeCompare(b.name)) : l;
  }, [editor, version, hidden, sort]);
  const exists = all.some((b) => b.name === name) || listBookmarks(editor.state.doc).some((b) => b.name === name);
  const valid = isValidBookmarkName(name);

  const add = () => {
    if (!valid) return;
    const { from, to } = editor.state.selection;
    const tr = editor.state.tr;
    setBookmark(tr, name, from, to);
    editor.view.dispatch(tr);
    onClose();
  };
  const del = () => {
    const tr = editor.state.tr;
    if (removeBookmark(tr, name)) editor.view.dispatch(tr);
    setVersion((v) => v + 1);
  };
  const go = () => {
    goToBookmark(editor, name);
    onClose();
  };
  return (
    <Stack spacing={1.5}>
      <Typography level="title-md">Bookmarks</Typography>
      <Box>
        <Label>Bookmark name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Results"
          error={!!name && !valid}
          slotProps={{ input: { "data-testid": "bookmark-name" } }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        {!!name && !valid && (
          <Typography level="body-xs" color="danger">
            Start with a letter; letters, digits and _ only; at most 40 characters.
          </Typography>
        )}
      </Box>
      <List
        size="sm"
        variant="outlined"
        data-testid="bookmark-list"
        sx={{ maxHeight: 180, overflowY: "auto", borderRadius: "sm", "--List-padding": "4px" }}
      >
        {all.length === 0 && (
          <Typography level="body-xs" sx={{ p: 1, opacity: 0.6 }}>
            No bookmarks yet.
          </Typography>
        )}
        {all.map((b) => (
          <ListItemButton
            key={b.name}
            selected={b.name === name}
            onClick={() => setName(b.name)}
            onDoubleClick={() => {
              goToBookmark(editor, b.name);
              onClose();
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography level="body-sm">{b.name}</Typography>
              {b.text && (
                <Typography level="body-xs" noWrap sx={{ opacity: 0.6 }}>
                  {b.text}
                </Typography>
              )}
            </Box>
          </ListItemButton>
        ))}
      </List>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
        <RadioGroup orientation="horizontal" value={sort} onChange={(e) => setSort(e.target.value as "name" | "location")}>
          <Radio value="name" label="Sort by name" size="sm" />
          <Radio value="location" label="Location" size="sm" />
        </RadioGroup>
        <Checkbox size="sm" label="Hidden bookmarks" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
      </Stack>
      <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
        <Button variant="plain" color="danger" disabled={!exists} onClick={del} data-testid="bookmark-delete">
          Delete
        </Button>
        <Button variant="outlined" disabled={!exists} onClick={go} data-testid="bookmark-goto">
          Go to
        </Button>
        <Button disabled={!valid} onClick={add} data-testid="bookmark-add">
          {exists ? "Move here" : "Add"}
        </Button>
      </Stack>
    </Stack>
  );
}

// --- Link settings -----------------------------------------------------------------------

interface PlaceItem {
  id: string;
  label: string;
  level: number;
  kind: "top" | "heading" | "bookmark";
  pos: number;
}

function placesIn(editor: Editor): PlaceItem[] {
  const doc = editor.state.doc;
  const sheet = getDocModel(editor)?.sheet;
  const out: PlaceItem[] = [{ id: "_top", label: "Beginning of document", level: 0, kind: "top", pos: 0 }];
  doc.descendants((n, pos) => {
    if (n.type.name === "tableOfContents") return false;
    if (!n.isTextblock) return true;
    const level = outlineLevelOf(n, sheet);
    const text = textWithFields(doc, pos + 1, pos + n.nodeSize - 1).trim();
    if (level && text) out.push({ id: `h:${pos}`, label: text, level, kind: "heading", pos });
    return false;
  });
  for (const b of listBookmarks(doc)) if (!isHiddenBookmark(b.name)) out.push({ id: `b:${b.name}`, label: b.name, level: 0, kind: "bookmark", pos: b.from });
  return out;
}

function HyperlinkDialog({ editor, onClose }: DialogProps) {
  const state = editor.state;
  const initial = useMemo(() => {
    const { from, to, empty } = state.selection;
    const attrs = editor.getAttributes("link") as { href?: string; title?: string };
    let range = { from, to };
    // Editing an existing link: take the whole link.
    if (attrs.href) {
      const $p = state.doc.resolve(from);
      const type = state.schema.marks.link;
      let a = from;
      let b = to;
      const start = $p.start();
      const parent = $p.parent;
      parent.forEach((c, off) => {
        const p = start + off;
        if (c.marks.some((m) => m.type === type && m.attrs.href === attrs.href) && p <= from && p + c.nodeSize >= to) {
          a = Math.min(a, p);
          b = Math.max(b, p + c.nodeSize);
        }
      });
      range = { from: a, to: b };
    }
    return {
      range,
      empty: empty && !attrs.href,
      href: attrs.href ?? "",
      title: attrs.title ?? "",
      text: state.doc.textBetween(range.from, range.to, " "),
    };
  }, [editor, state]);
  const places = useMemo(() => placesIn(editor), [editor]);
  const internalTarget = initial.href.startsWith("#") ? initial.href.slice(1) : null;
  const [mode, setMode] = useState<"external" | "internal">(internalTarget ? "internal" : "external");
  const [url, setUrl] = useState(internalTarget ? "" : initial.href);
  const [place, setPlace] = useState<string>(() => {
    if (!internalTarget) return "_top";
    if (internalTarget === "_top") return "_top";
    const bm = places.find((p) => p.kind === "bookmark" && p.id === `b:${internalTarget}`);
    if (bm) return bm.id;
    // A hidden heading bookmark: find the heading it covers.
    const r = listBookmarks(state.doc).find((b) => b.name === internalTarget);
    const h = r && places.find((p) => p.kind === "heading" && p.pos + 1 === r.from);
    return h?.id ?? "_top";
  });
  const [text, setText] = useState(initial.text);
  const [title, setTitle] = useState(initial.title);

  const apply = () => {
    const tr = editor.state.tr;
    let href: string;
    if (mode === "external") {
      href = url.trim();
      if (!href) return;
      if (!/^[a-z][\w+.-]*:|^#|^\//i.test(href)) href = `https://${href}`;
      if (/^(javascript|vbscript|data):/i.test(href)) return;
    } else {
      const p = places.find((x) => x.id === place);
      if (!p) return;
      if (p.kind === "top") href = "#_top";
      else if (p.kind === "bookmark") href = `#${p.id.slice(2)}`;
      else {
        const n = tr.doc.nodeAt(p.pos)!;
        href = `#${ensureBookmark(tr, p.pos + 1, p.pos + n.nodeSize - 1, "_Ref")}`;
      }
    }
    const mark = editor.schema.marks.link.create({ href, title: title.trim() || null });
    const label = text || (mode === "internal" ? places.find((x) => x.id === place)?.label ?? href : href);
    const { from, to } = initial.range;
    if (initial.empty || label !== initial.text) {
      const marks = (from < to ? editor.state.doc.resolve(from + 1).marks() : editor.state.storedMarks ?? editor.state.doc.resolve(from).marks()).filter(
        (m) => m.type.name !== "link",
      );
      tr.replaceWith(from, to, editor.schema.text(label, [...marks, mark]));
      tr.setSelection(TextSelection.create(tr.doc, from + label.length));
    } else {
      tr.removeMark(from, to, editor.schema.marks.link);
      tr.addMark(from, to, mark);
    }
    editor.view.dispatch(tr);
    onClose();
  };
  const remove = () => {
    const { from, to } = initial.range;
    editor.view.dispatch(editor.state.tr.removeMark(from, to, editor.schema.marks.link));
    onClose();
  };
  return (
    <Stack spacing={1.5}>
      <Typography level="title-md">Link settings</Typography>
      <RadioGroup orientation="horizontal" value={mode} onChange={(e) => setMode(e.target.value as "external" | "internal")}>
        <Radio value="external" label="External link" data-testid="link-external" />
        <Radio value="internal" label="Place in document" data-testid="link-internal" />
      </RadioGroup>
      {mode === "external" ? (
        <Box>
          <Label>Link to</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoFocus slotProps={{ input: { "data-testid": "link-url" } }} />
        </Box>
      ) : (
        <List size="sm" variant="outlined" data-testid="link-places" sx={{ maxHeight: 200, overflowY: "auto", borderRadius: "sm" }}>
          {places.map((p) => (
            <ListItemButton key={p.id} selected={p.id === place} onClick={() => setPlace(p.id)} sx={{ pl: 1 + Math.max(0, p.level - 1) * 1.5 }}>
              <Typography level="body-sm" noWrap>
                {p.kind === "bookmark" ? `Bookmark: ${p.label}` : p.label}
              </Typography>
            </ListItemButton>
          ))}
        </List>
      )}
      <Box>
        <Label>Display</Label>
        <Input value={text} onChange={(e) => setText(e.target.value)} slotProps={{ input: { "data-testid": "link-text" } }} />
      </Box>
      <Box>
        <Label>ScreenTip text</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} slotProps={{ input: { "data-testid": "link-title" } }} />
      </Box>
      <Typography level="body-xs" sx={{ opacity: 0.7 }}>
        Ctrl+click (or Alt+Enter) follows a link.
      </Typography>
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        {initial.href && (
          <Button variant="plain" color="danger" onClick={remove}>
            Remove link
          </Button>
        )}
        <Button onClick={apply} data-testid="link-apply">
          OK
        </Button>
      </Stack>
    </Stack>
  );
}

// --- Caption ------------------------------------------------------------------------------

function CaptionDialog({ editor, onClose }: DialogProps) {
  const [custom, setCustom] = useState<string[]>(customLabels);
  const labels = useMemo(() => captionLabels(editor.state.doc, custom), [editor, custom]);
  const [label, setLabel] = useState(labels[0] ?? "Figure");
  const [text, setText] = useState("");
  const [position, setPosition] = useState<"above" | "below">(() => defaultCaptionPosition(editor));
  const [exclude, setExclude] = useState(false);
  const [format, setFormat] = useState("ARABIC");
  const [chapter, setChapter] = useState(false);
  const [chapterLevel, setChapterLevel] = useState(1);
  const [sep, setSep] = useState("-");
  const [newLabel, setNewLabel] = useState<string | null>(null);
  const example = SEQ_FORMATS.find((f) => f.id === format)?.label.split(",")[0] ?? "1";
  const preview = `${exclude ? "" : `${label} `}${chapter ? `1${sep}` : ""}${example}${text}`;
  const insert = () => {
    insertCaption(editor, { label, text, position, excludeLabel: exclude, format, chapter: chapter ? { level: chapterLevel, separator: sep } : null });
    onClose();
  };
  const addLabel = () => {
    const l = (newLabel ?? "").trim();
    if (!l) return;
    const next = [...custom, l];
    setCustom(next);
    saveCustomLabels(next);
    setLabel(l);
    setNewLabel(null);
  };
  return (
    <Stack spacing={1.5}>
      <Typography level="title-md">Caption</Typography>
      <Box>
        <Label>Caption</Label>
        <Input
          startDecorator={<Typography level="body-sm">{preview.slice(0, preview.length - text.length)}</Typography>}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder=": description"
          autoFocus
          slotProps={{ input: { "data-testid": "caption-text" } }}
          onKeyDown={(e) => {
            if (e.key === "Enter") insert();
          }}
        />
      </Box>
      <Stack direction="row" spacing={1} alignItems="flex-end">
        <Box sx={{ flex: 1 }}>
          <Label>Label</Label>
          <Select value={label} onChange={(_, v) => v && setLabel(v)} data-testid="caption-label">
            {labels.map((l) => (
              <Option key={l} value={l}>
                {l}
              </Option>
            ))}
          </Select>
        </Box>
        <Button variant="outlined" size="sm" onClick={() => setNewLabel("")}>
          New label…
        </Button>
        {custom.includes(label) && (
          <Button
            variant="plain"
            color="danger"
            size="sm"
            onClick={() => {
              const next = custom.filter((l) => l !== label);
              setCustom(next);
              saveCustomLabels(next);
              setLabel("Figure");
            }}
          >
            Delete label
          </Button>
        )}
      </Stack>
      {newLabel != null && (
        <Stack direction="row" spacing={1}>
          <Input sx={{ flex: 1 }} value={newLabel} autoFocus placeholder="Label" onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLabel()} />
          <Button size="sm" onClick={addLabel}>
            Add
          </Button>
        </Stack>
      )}
      <Stack direction="row" spacing={2} flexWrap="wrap">
        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Label>Position</Label>
          <Select value={position} onChange={(_, v) => v && setPosition(v)}>
            <Option value="above">Above selected item</Option>
            <Option value="below">Below selected item</Option>
          </Select>
        </Box>
        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Label>Numbering</Label>
          <Select value={format} onChange={(_, v) => v && setFormat(v)}>
            {SEQ_FORMATS.map((f) => (
              <Option key={f.id} value={f.id}>
                {f.label}
              </Option>
            ))}
          </Select>
        </Box>
      </Stack>
      <Checkbox label="Exclude label from caption" checked={exclude} onChange={(e) => setExclude(e.target.checked)} />
      <Checkbox label="Include chapter number" checked={chapter} onChange={(e) => setChapter(e.target.checked)} />
      {chapter && (
        <Stack direction="row" spacing={2}>
          <Box sx={{ flex: 1 }}>
            <Label>Chapter starts with</Label>
            <Select value={chapterLevel} onChange={(_, v) => v && setChapterLevel(v)}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => (
                <Option key={l} value={l}>
                  Heading {l}
                </Option>
              ))}
            </Select>
          </Box>
          <Box sx={{ flex: 1 }}>
            <Label>Separator</Label>
            <Select value={sep} onChange={(_, v) => v && setSep(v)}>
              {CHAPTER_SEPARATORS.map((s) => (
                <Option key={s.id} value={s.id}>
                  {s.label}
                </Option>
              ))}
            </Select>
          </Box>
        </Stack>
      )}
      <Stack direction="row" justifyContent="flex-end">
        <Button onClick={insert} data-testid="caption-insert">
          Insert
        </Button>
      </Stack>
    </Stack>
  );
}

// --- Cross-reference -------------------------------------------------------------------------

function CrossRefDialog({ editor, onClose }: DialogProps) {
  const types = useMemo(() => refTypes(captionLabels(editor.state.doc)), [editor]);
  const [type, setType] = useState("heading");
  const kinds = kindsFor(type);
  const [kind, setKind] = useState<RefKind>("text");
  const [hidden, setHidden] = useState(false);
  const targets = useMemo(() => refTargets(editor, type, hidden), [editor, type, hidden]);
  const [sel, setSel] = useState(0);
  const [hyperlink, setHyperlink] = useState(true);
  const [aboveBelow, setAboveBelow] = useState(false);
  useEffect(() => {
    if (!kinds.some((k) => k.id === kind)) setKind(kinds[0]?.id ?? "text");
    setSel(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);
  const numberish = kind === "page" || kind.startsWith("number") || kind.startsWith("note");
  const insert = () => {
    const target = targets[sel];
    if (!target) return;
    insertCrossReference(editor, { type, target, kind, hyperlink, aboveBelow: numberish && aboveBelow });
    onClose();
  };
  return (
    <Stack spacing={1.5}>
      <Typography level="title-md">Cross-reference</Typography>
      <Stack direction="row" spacing={2} flexWrap="wrap">
        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Label>Reference type</Label>
          <Select value={type} onChange={(_, v) => v && setType(v)} data-testid="crossref-type">
            {types.map((t) => (
              <Option key={t.id} value={t.id}>
                {t.label}
              </Option>
            ))}
          </Select>
        </Box>
        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Label>Insert reference to</Label>
          <Select value={kind} onChange={(_, v) => v && setKind(v)} data-testid="crossref-kind">
            {kinds.map((k) => (
              <Option key={k.id} value={k.id}>
                {k.label}
              </Option>
            ))}
          </Select>
        </Box>
      </Stack>
      <Stack direction="row" spacing={2} flexWrap="wrap">
        <Checkbox size="sm" label="Insert as hyperlink" checked={hyperlink} onChange={(e) => setHyperlink(e.target.checked)} />
        <Checkbox size="sm" label="Include above/below" disabled={!numberish} checked={aboveBelow && numberish} onChange={(e) => setAboveBelow(e.target.checked)} />
        {type === "bookmark" && <Checkbox size="sm" label="Hidden bookmarks" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />}
      </Stack>
      <Box>
        <Label>For which {types.find((t) => t.id === type)?.label.toLowerCase()}</Label>
        <List size="sm" variant="outlined" data-testid="crossref-list" sx={{ maxHeight: 220, overflowY: "auto", borderRadius: "sm" }}>
          {targets.length === 0 && (
            <Typography level="body-xs" sx={{ p: 1, opacity: 0.6 }}>
              Nothing to refer to yet.
            </Typography>
          )}
          {targets.map((t, i) => (
            <ListItemButton
              key={`${t.pos}-${t.name ?? ""}`}
              selected={i === sel}
              onClick={() => setSel(i)}
              onDoubleClick={() => {
                setSel(i);
                insertCrossReference(editor, { type, target: t, kind, hyperlink, aboveBelow: numberish && aboveBelow });
                onClose();
              }}
              sx={{ pl: 1 + Math.max(0, (t.level ?? 1) - 1) * 1.5 }}
            >
              <Typography level="body-sm" noWrap>
                {t.label}
              </Typography>
            </ListItemButton>
          ))}
        </List>
      </Box>
      <Stack direction="row" justifyContent="flex-end">
        <Button disabled={!targets.length} onClick={insert} data-testid="crossref-insert">
          Insert
        </Button>
      </Stack>
    </Stack>
  );
}

// --- Table of contents / figures -----------------------------------------------------------

function TocDialog({ editor, figures, onClose }: DialogProps & { figures: boolean }) {
  // Editing the table at the caret, if any.
  const current = useMemo(() => {
    const { from } = editor.state.selection;
    return tocNodes(editor.state.doc).find((t) => t.pos <= from && from <= t.pos + t.node.nodeSize) ?? null;
  }, [editor]);
  const initial: TocOptions = current
    ? tocOptions(String(current.node.attrs.instr))
    : { from: 1, to: 3, hyperlinks: true, pageNumbers: true, caption: figures ? "Figure" : null };
  const isFigures = figures || !!initial.caption;
  const labels = useMemo(() => captionLabels(editor.state.doc), [editor]);
  const [o, setO] = useState<TocOptions>({ ...initial, caption: isFigures ? initial.caption ?? "Figure" : null });
  const [leader, setLeader] = useState<TocLeader>((current?.node.attrs.leader as TocLeader) ?? "dot");
  const apply = () => {
    const instr = tocInstr(o);
    if (current) {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(current.pos, undefined, { ...current.node.attrs, instr, leader }));
      updateTocAt(editor, current.pos);
    } else insertTableOfContents(editor, instr, leader);
    onClose();
  };
  return (
    <Stack spacing={1.5}>
      <Typography level="title-md">{isFigures ? "Table of figures" : "Table of contents"}</Typography>
      {isFigures ? (
        <Box>
          <Label>Caption label</Label>
          <Select value={o.caption} onChange={(_, v) => v && setO({ ...o, caption: v })}>
            {labels.map((l) => (
              <Option key={l} value={l}>
                {l}
              </Option>
            ))}
          </Select>
        </Box>
      ) : (
        <Stack direction="row" spacing={2}>
          <Box sx={{ flex: 1 }}>
            <Label>Show levels</Label>
            <Select value={o.to} onChange={(_, v) => v && setO({ ...o, from: 1, to: v })} data-testid="toc-levels">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => (
                <Option key={l} value={l}>
                  {l}
                </Option>
              ))}
            </Select>
          </Box>
          <Box sx={{ flex: 1 }}>
            <Label>Tab leader</Label>
            <Select value={leader} onChange={(_, v) => v && setLeader(v)}>
              <Option value="dot">. . . . . .</Option>
              <Option value="dash">- - - - - -</Option>
              <Option value="underline">______</Option>
              <Option value="none">(none)</Option>
            </Select>
          </Box>
        </Stack>
      )}
      <Checkbox label="Show page numbers" checked={o.pageNumbers} onChange={(e) => setO({ ...o, pageNumbers: e.target.checked })} />
      <Checkbox label="Use hyperlinks instead of page numbers only" checked={o.hyperlinks} onChange={(e) => setO({ ...o, hyperlinks: e.target.checked })} />
      <Typography level="body-xs" sx={{ opacity: 0.7 }}>
        Page numbers are estimated from the page layout until full pagination lands. Press F9 in the table (or use Update table) after
        editing headings.
      </Typography>
      <Stack direction="row" justifyContent="flex-end">
        <Button onClick={apply} data-testid="toc-apply">
          {current ? "Update" : "Insert"}
        </Button>
      </Stack>
    </Stack>
  );
}

// --- Field -----------------------------------------------------------------------------------

const FIELD_KINDS = [
  { id: "PAGE", label: "Page number" },
  { id: "NUMPAGES", label: "Number of pages" },
  { id: "DATE", label: "Date" },
  { id: "TIME", label: "Time" },
  { id: "custom", label: "Field code…" },
];

function FieldDialog({ editor, onClose }: DialogProps) {
  const [kind, setKind] = useState("DATE");
  const [fmt, setFmt] = useState(DATE_FORMATS[0]);
  const [code, setCode] = useState("");
  const now = new Date();
  const instr =
    kind === "custom" ? code.trim() : kind === "DATE" || kind === "TIME" ? `${kind} \\@ "${fmt}"` : kind;
  const insert = () => {
    if (!instr) return;
    editor.chain().focus().insertField(instr).run();
    onClose();
  };
  return (
    <Stack spacing={1.5}>
      <Typography level="title-md">Field</Typography>
      <Select value={kind} onChange={(_, v) => v && setKind(v)}>
        {FIELD_KINDS.map((k) => (
          <Option key={k.id} value={k.id}>
            {k.label}
          </Option>
        ))}
      </Select>
      {(kind === "DATE" || kind === "TIME") && (
        <List size="sm" variant="outlined" sx={{ maxHeight: 220, overflowY: "auto", borderRadius: "sm" }}>
          {DATE_FORMATS.filter((f) => (kind === "TIME" ? /[hH]/.test(f) : true)).map((f) => (
            <ListItemButton key={f} selected={f === fmt} onClick={() => setFmt(f)}>
              <Typography level="body-sm">{formatDate(now, f)}</Typography>
            </ListItemButton>
          ))}
        </List>
      )}
      {kind === "custom" && (
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder='e.g. SEQ Figure \* ARABIC' autoFocus sx={{ fontFamily: "monospace" }} />
      )}
      <Typography level="body-xs" sx={{ fontFamily: "monospace", opacity: 0.7 }}>
        {`{ ${instr} }`}
      </Typography>
      <Stack direction="row" justifyContent="flex-end">
        <Button onClick={insert} disabled={!instr} data-testid="field-insert">
          Insert
        </Button>
      </Stack>
    </Stack>
  );
}
