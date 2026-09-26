// Floating find & replace bar (Ctrl+F / Ctrl+H). Drives the Search
// extension in search.ts: every keystroke updates the highlighted matches;
// Enter / Shift+Enter step through them; Esc closes and clears.
import { useEffect, useReducer, useRef, useState } from "react";
import {
  Box,
  Button,
  GlobalStyles,
  IconButton,
  Input,
  Sheet,
  Tooltip,
  Typography,
} from "@mui/joy";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import CloseIcon from "@mui/icons-material/Close";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import type { Editor } from "@tiptap/react";
import { getSearchState, type SearchOptions } from "./search";

export type FindMode = "find" | "replace";

interface FindBarProps {
  editor: Editor | null;
  mode: FindMode;
  onModeChange: (m: FindMode) => void;
  onClose: () => void;
  /** Changes whenever the bar is (re)opened, to refocus the input. */
  focusKey: number;
}

const toggleSx = { minHeight: 28, minWidth: 32, px: 0.75, fontFamily: "monospace", fontSize: 13 };

export function FindBar({ editor, mode, onModeChange, onClose, focusKey }: FindBarProps) {
  const [query, setQuery] = useState(() => {
    // Seed with a short single-line selection, like most editors.
    if (!editor) return "";
    const { from, to } = editor.state.selection;
    const t = editor.state.doc.textBetween(from, to, "\n");
    return t && !t.includes("\n") && t.length <= 200 ? t : "";
  });
  const [replacement, setReplacement] = useState("");
  const [opts, setOpts] = useState<SearchOptions>({});
  const [note, setNote] = useState<string | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const findRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
  }, [focusKey]);

  // Re-render on every transaction so the "n of m" count stays current.
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", rerender);
    return () => {
      editor.off("transaction", rerender);
    };
  }, [editor]);

  useEffect(() => {
    editor?.commands.setSearch(query, opts);
    setNote(null);
  }, [editor, query, opts]);

  // Clear highlights when the bar goes away.
  useEffect(
    () => () => {
      if (editor && !editor.isDestroyed) editor.commands.clearSearch();
    },
    [editor],
  );

  const s = editor ? getSearchState(editor.state) : null;
  const count = s?.matches.length ?? 0;
  const status = !query
    ? ""
    : s?.error
      ? "Invalid expression"
      : count
        ? `${s!.current >= 0 ? s!.current + 1 : 0} of ${count}${count >= 5000 ? "+" : ""}`
        : "No results";

  const next = () => editor?.commands.findNext();
  const prev = () => editor?.commands.findPrevious();
  const replaceOne = () => editor?.commands.replaceCurrent(replacement);
  const replaceAll = () => {
    if (!editor) return;
    const n = getSearchState(editor.state).matches.length;
    if (editor.commands.replaceAllMatches(replacement)) setNote(`Replaced ${n}`);
  };
  const close = () => {
    onClose();
    editor?.commands.focus();
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const toggle = (k: keyof SearchOptions) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  return (
    <Sheet
      variant="outlined"
      data-testid="docs-find-bar"
      onKeyDown={keys}
      sx={{
        position: "fixed",
        top: { xs: 64, md: 120 },
        right: { xs: 16, md: 32 },
        left: { xs: 16, sm: "auto" },
        zIndex: 1100,
        width: { sm: 440 },
        p: 1,
        borderRadius: "md",
        boxShadow: "lg",
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
      }}
    >
      <GlobalStyles
        styles={{
          ".ProseMirror .search-match": { backgroundColor: "#fce8b2", borderRadius: 2 },
          ".ProseMirror .search-match-current": {
            backgroundColor: "#f9ab00",
            boxShadow: "0 0 0 1px #e37400",
          },
        }}
      />
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Tooltip title={mode === "replace" ? "Hide replace" : "Replace"}>
          <IconButton
            size="sm"
            variant="plain"
            aria-label="Toggle replace"
            onClick={() => onModeChange(mode === "replace" ? "find" : "replace")}
          >
            <UnfoldMoreIcon />
          </IconButton>
        </Tooltip>
        <Input
          size="sm"
          placeholder="Find in document"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{ input: { ref: findRef, "data-testid": "docs-find-input", "aria-label": "Find" } }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) prev();
              else next();
            }
          }}
          endDecorator={
            <Typography level="body-xs" data-testid="docs-find-count" sx={{ whiteSpace: "nowrap" }}>
              {status}
            </Typography>
          }
          sx={{ flex: 1, minWidth: 0 }}
        />
        <Tooltip title="Previous (Shift+Enter)">
          <IconButton size="sm" variant="plain" aria-label="Previous match" data-testid="docs-find-prev" onClick={prev} disabled={!count}>
            <KeyboardArrowUpIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Next (Enter)">
          <IconButton size="sm" variant="plain" aria-label="Next match" data-testid="docs-find-next" onClick={next} disabled={!count}>
            <KeyboardArrowDownIcon />
          </IconButton>
        </Tooltip>
        <IconButton size="sm" variant="plain" aria-label="Close find" data-testid="docs-find-close" onClick={close}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Box sx={{ display: "flex", gap: 0.5, pl: 4.5, alignItems: "center", flexWrap: "wrap" }}>
        <Tooltip title="Match case">
          <Button size="sm" variant={opts.caseSensitive ? "solid" : "plain"} color="neutral" sx={toggleSx} aria-pressed={!!opts.caseSensitive} data-testid="docs-find-case" onClick={() => toggle("caseSensitive")}>
            Aa
          </Button>
        </Tooltip>
        <Tooltip title="Whole words">
          <Button size="sm" variant={opts.wholeWord ? "solid" : "plain"} color="neutral" sx={{ ...toggleSx, textDecoration: "underline" }} aria-pressed={!!opts.wholeWord} data-testid="docs-find-word" onClick={() => toggle("wholeWord")}>
            ab
          </Button>
        </Tooltip>
        <Tooltip title="Regular expression">
          <Button size="sm" variant={opts.regex ? "solid" : "plain"} color="neutral" sx={toggleSx} aria-pressed={!!opts.regex} data-testid="docs-find-regex" onClick={() => toggle("regex")}>
            .*
          </Button>
        </Tooltip>
        {note && (
          <Typography level="body-xs" color="success" sx={{ ml: "auto" }} data-testid="docs-replace-note">
            {note}
          </Typography>
        )}
      </Box>
      {mode === "replace" && (
        <Box sx={{ display: "flex", gap: 0.5, pl: 4.5, alignItems: "center", flexWrap: "wrap" }}>
          <Input
            size="sm"
            placeholder={opts.regex ? "Replace with ($1 for groups)" : "Replace with"}
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            slotProps={{ input: { "data-testid": "docs-replace-input", "aria-label": "Replace with" } }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                replaceOne();
              }
            }}
            sx={{ flex: 1, minWidth: 160 }}
          />
          <Button size="sm" variant="soft" data-testid="docs-replace-one" onClick={replaceOne} disabled={!count}>
            Replace
          </Button>
          <Button size="sm" data-testid="docs-replace-all" onClick={replaceAll} disabled={!count}>
            Replace all
          </Button>
        </Box>
      )}
    </Sheet>
  );
}
