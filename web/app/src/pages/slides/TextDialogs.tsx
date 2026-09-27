// Dialogs for M4 text features: hyperlink (web/email or a slide in the
// deck), find and replace, special characters, text box options.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  IconButton,
  Input,
  Modal,
  ModalDialog,
  Option,
  Radio,
  RadioGroup,
  Select,
  Sheet,
  Tooltip,
  Typography,
} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import type { DeckDoc, Slide, SlideElement } from "./model";
import { classifyLink, parseSlideLink, slideLink, slideTitle, type SlideJump } from "./links";
import { findMatches, type FindOptions, type Match } from "./findReplace";
import { CHAR_CATEGORIES, charLabel, searchChars } from "./specialChars";
import { insetsOf } from "./textOps";

// ------------------------------------------------------------ hyperlink

export interface LinkDialogInit {
  url: string;
  /** Display text; undefined when the link applies to a whole element. */
  text?: string;
}

const JUMP_LABELS: [SlideJump, string][] = [
  ["next", "Next slide"],
  ["prev", "Previous slide"],
  ["first", "First slide"],
  ["last", "Last slide"],
];

export function HyperlinkDialog({
  open,
  init,
  slides,
  onApply,
  onRemove,
  onClose,
}: {
  open: boolean;
  init: LinkDialogInit | null;
  slides: readonly Slide[];
  onApply: (url: string, text?: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"web" | "slide">("web");
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState("next");
  const [text, setText] = useState("");
  useEffect(() => {
    if (!open || !init) return;
    const t = parseSlideLink(init.url);
    setKind(t ? "slide" : "web");
    setUrl(t ? "" : init.url);
    setTarget(t ? (typeof t === "string" ? t : `id:${t.id}`) : "next");
    setText(init.text ?? "");
  }, [open, init]);

  const cls = classifyLink(url);
  const href =
    kind === "slide"
      ? target.startsWith("id:")
        ? slideLink({ id: target.slice(3) })
        : slideLink(target as SlideJump)
      : cls.href;
  const valid = kind === "slide" || (url.trim() !== "" && cls.kind !== "invalid");
  const hint =
    kind === "slide"
      ? null
      : !url.trim()
        ? null
        : cls.kind === "http"
          ? { color: "success" as const, text: "Web address" }
          : cls.kind === "email"
            ? { color: "success" as const, text: "Email address" }
            : cls.kind === "unsafe"
              ? { color: "warning" as const, text: "Not a web or email link; it may be unsafe to open" }
              : cls.kind === "internal"
                ? { color: "warning" as const, text: "An anchor inside this deck" }
                : { color: "danger" as const, text: "Not a valid link" };

  return (
    <Modal open={open} onClose={onClose} disableRestoreFocus>
      <ModalDialog sx={{ minWidth: 380 }} aria-label="Hyperlink">
        <Typography level="title-md">Hyperlink</Typography>
        <RadioGroup
          orientation="horizontal"
          value={kind}
          onChange={(e) => setKind(e.target.value as "web" | "slide")}
          sx={{ gap: 2, my: 1 }}
        >
          <Radio value="web" label="Web address or email" />
          <Radio value="slide" label="Slide in this presentation" />
        </RadioGroup>
        {kind === "web" ? (
          <>
            <Input
              autoFocus
              placeholder="https://example.com or name@example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              slotProps={{ input: { "aria-label": "Link address" } }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid) onApply(href, init?.text !== undefined ? text : undefined);
              }}
            />
            {hint && (
              <Chip size="sm" variant="soft" color={hint.color} sx={{ mt: 0.5 }} data-testid="link-kind">
                {hint.text}
              </Chip>
            )}
          </>
        ) : (
          <Select
            value={target}
            onChange={(_, v) => v && setTarget(v)}
            slotProps={{ button: { "aria-label": "Link to slide" } }}
          >
            {JUMP_LABELS.map(([v, l]) => (
              <Option key={v} value={v}>
                {l}
              </Option>
            ))}
            {slides.map((s, i) => (
              <Option key={s.id} value={`id:${s.id}`}>
                {`Slide ${i + 1}${slideTitle(s) ? `: ${slideTitle(s)}` : ""}`}
              </Option>
            ))}
          </Select>
        )}
        {init?.text !== undefined && (
          <Input
            sx={{ mt: 1 }}
            placeholder="Text to display"
            value={text}
            onChange={(e) => setText(e.target.value)}
            slotProps={{ input: { "aria-label": "Text to display" } }}
          />
        )}
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 2 }}>
          {init?.url && (
            <Button size="sm" variant="plain" color="danger" onClick={onRemove}>
              Remove link
            </Button>
          )}
          <Button size="sm" variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid}
            onClick={() => onApply(href, init?.text !== undefined ? text : undefined)}
          >
            Apply
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// ------------------------------------------------------------ find & replace

export function FindReplacePanel({
  open,
  doc,
  onClose,
  onGoto,
  onReplace,
  onReplaceAll,
}: {
  open: boolean;
  doc: DeckDoc;
  onClose: () => void;
  onGoto: (m: Match) => void;
  onReplace: (m: Match, repl: string) => void;
  onReplaceAll: (query: string, repl: string, opts: FindOptions) => number;
}) {
  const [query, setQuery] = useState("");
  const [repl, setRepl] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [idx, setIdx] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const opts: FindOptions = { matchCase, wholeWord };
  const matches = useMemo(() => findMatches(doc, query, opts), [doc, query, matchCase, wholeWord]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = matches.length ? Math.min(idx, matches.length - 1) : -1;
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);
  if (!open) return null;
  const go = (d: 1 | -1) => {
    if (!matches.length) return;
    const n = (cur + d + matches.length) % matches.length;
    setIdx(n);
    onGoto(matches[n]);
  };
  return (
    <Sheet
      variant="outlined"
      role="dialog"
      aria-label="Find and replace"
      sx={{
        position: "fixed",
        top: 120,
        right: 24,
        zIndex: 1250,
        p: 1.5,
        borderRadius: "md",
        boxShadow: "lg",
        width: 320,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <Typography level="title-sm" sx={{ flex: 1 }}>
          Find and replace
        </Typography>
        <IconButton size="sm" variant="plain" aria-label="Close find and replace" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Input
        size="sm"
        placeholder="Find"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIdx(0);
          setMsg(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") go(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") onClose();
        }}
        endDecorator={
          <Typography level="body-xs" data-testid="find-count">
            {query ? `${cur + 1 > 0 ? cur + 1 : 0} of ${matches.length}` : ""}
          </Typography>
        }
        slotProps={{ input: { ref: inputRef, "aria-label": "Find" } }}
      />
      <Input
        size="sm"
        placeholder="Replace with"
        value={repl}
        onChange={(e) => setRepl(e.target.value)}
        slotProps={{ input: { "aria-label": "Replace with" } }}
      />
      <Box sx={{ display: "flex", gap: 2 }}>
        <Checkbox size="sm" label="Match case" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
        <Checkbox size="sm" label="Whole words" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
      </Box>
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
        <Button size="sm" variant="outlined" disabled={!matches.length} onClick={() => go(-1)}>
          Previous
        </Button>
        <Button size="sm" variant="outlined" disabled={!matches.length} onClick={() => go(1)}>
          Next
        </Button>
        <Button
          size="sm"
          variant="soft"
          disabled={cur < 0}
          onClick={() => {
            onReplace(matches[cur], repl);
            setMsg(null);
          }}
        >
          Replace
        </Button>
        <Button
          size="sm"
          disabled={!matches.length}
          onClick={() => {
            const n = onReplaceAll(query, repl, opts);
            setMsg(`Replaced ${n} occurrence${n === 1 ? "" : "s"}`);
          }}
        >
          Replace all
        </Button>
      </Box>
      {msg && (
        <Typography level="body-xs" data-testid="find-msg">
          {msg}
        </Typography>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------ special characters

export function SpecialCharsDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (ch: string) => void;
  onClose: () => void;
}) {
  const [cat, setCat] = useState(0);
  const [q, setQ] = useState("");
  const shown = q.trim() ? searchChars(q) : CHAR_CATEGORIES[cat].chars;
  return (
    <Modal open={open} onClose={onClose} disableRestoreFocus>
      <ModalDialog sx={{ width: 460, maxWidth: "95vw" }} aria-label="Special characters">
        <Typography level="title-md">Special characters</Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Select
            size="sm"
            value={cat}
            onChange={(_, v) => v !== null && setCat(v)}
            sx={{ minWidth: 140 }}
            slotProps={{ button: { "aria-label": "Character category" } }}
          >
            {CHAR_CATEGORIES.map((c, i) => (
              <Option key={c.label} value={i}>
                {c.label}
              </Option>
            ))}
          </Select>
          <Input
            size="sm"
            sx={{ flex: 1 }}
            placeholder="Search (e.g. euro, arrow, U+2013)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            slotProps={{ input: { "aria-label": "Search characters" } }}
          />
        </Box>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(38px, 1fr))",
            gap: 0.5,
            maxHeight: 280,
            overflowY: "auto",
            mt: 1,
          }}
        >
          {shown.map((s) => (
            <Tooltip key={s.ch} title={charLabel(s)}>
              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                aria-label={`Insert ${s.name}`}
                onClick={() => onPick(s.ch)}
                sx={{ fontSize: 18, minHeight: 38, px: 0 }}
              >
                {/\s|­/.test(s.ch) ? "␣" : s.ch}
              </Button>
            </Tooltip>
          ))}
          {!shown.length && (
            <Typography level="body-sm" sx={{ gridColumn: "1 / -1", opacity: 0.6 }}>
              No characters match.
            </Typography>
          )}
        </Box>
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
          <Button size="sm" variant="plain" onClick={onClose}>
            Close
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// ------------------------------------------------------------ text options

export interface TextOptions {
  insets: { l: number; t: number; r: number; b: number };
  spaceBefore: number;
  spaceAfter: number;
  autofit: boolean;
  direction: "ltr" | "rtl" | "vert" | "vert270";
}

export function textOptionsOf(el: SlideElement): TextOptions {
  return {
    insets: insetsOf(el),
    spaceBefore: el.spaceBefore ?? 0,
    spaceAfter: el.spaceAfter ?? 0,
    autofit: el.autofit === "shrink",
    direction: el.vert ?? (el.rtl ? "rtl" : "ltr"),
  };
}

export function TextOptionsDialog({
  open,
  el,
  onApply,
  onClose,
}: {
  open: boolean;
  el: SlideElement | undefined;
  onApply: (o: TextOptions) => void;
  onClose: () => void;
}) {
  const [o, setO] = useState<TextOptions | null>(null);
  useEffect(() => {
    if (open && el) setO(textOptionsOf(el));
  }, [open, el?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return null;
  const numIn = (label: string, v: number, set: (n: number) => void) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Typography level="body-sm" sx={{ width: 90 }}>
        {label}
      </Typography>
      <Input
        size="sm"
        type="number"
        value={v}
        onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))}
        slotProps={{ input: { min: 0, step: 1, "aria-label": label } }}
        endDecorator={<Typography level="body-xs">px</Typography>}
        sx={{ width: 110 }}
      />
    </Box>
  );
  return (
    <Modal open={open} onClose={onClose} disableRestoreFocus>
      <ModalDialog sx={{ minWidth: 340 }} aria-label="Text options">
        <Typography level="title-md">Text options</Typography>
        <Typography level="title-sm" sx={{ mt: 1 }}>
          Padding
        </Typography>
        {numIn("Left", o.insets.l, (n) => setO({ ...o, insets: { ...o.insets, l: n } }))}
        {numIn("Top", o.insets.t, (n) => setO({ ...o, insets: { ...o.insets, t: n } }))}
        {numIn("Right", o.insets.r, (n) => setO({ ...o, insets: { ...o.insets, r: n } }))}
        {numIn("Bottom", o.insets.b, (n) => setO({ ...o, insets: { ...o.insets, b: n } }))}
        <Typography level="title-sm" sx={{ mt: 1 }}>
          Paragraph spacing
        </Typography>
        {numIn("Before", o.spaceBefore, (n) => setO({ ...o, spaceBefore: n }))}
        {numIn("After", o.spaceAfter, (n) => setO({ ...o, spaceAfter: n }))}
        <Checkbox
          sx={{ mt: 1 }}
          label="Shrink text on overflow"
          checked={o.autofit}
          onChange={(e) => setO({ ...o, autofit: e.target.checked })}
        />
        <Typography level="title-sm" sx={{ mt: 1 }}>
          Text direction
        </Typography>
        <RadioGroup value={o.direction} onChange={(e) => setO({ ...o, direction: e.target.value as TextOptions["direction"] })}>
          <Radio value="ltr" label="Left to right" />
          <Radio value="rtl" label="Right to left" />
          <Radio value="vert" label="Rotate text 90°" />
          <Radio value="vert270" label="Rotate text 270°" />
        </RadioGroup>
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mt: 2 }}>
          <Button size="sm" variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onApply(o)}>
            Apply
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
