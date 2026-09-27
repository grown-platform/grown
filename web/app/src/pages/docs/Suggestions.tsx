import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Sheet,
  Box,
  Typography,
  Button,
  IconButton,
  Chip,
  Divider,
  Tooltip,
  Select,
  Option,
  Dropdown,
  MenuButton,
  Menu,
  MenuItem,
  ListDivider,
} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import RateReviewIcon from "@mui/icons-material/RateReview";
import type { Editor } from "@tiptap/react";
import { changeAt, collectChanges, describeChange, type TrackedChange } from "./changes";
import { DISPLAY_MODES, formatChangeDate, type DisplayMode } from "./review";

// Review panel for tracked changes (M5): the track-changes switch (for me /
// for everyone), the display mode, previous/next navigation, accept/reject
// the current change or all changes, and the list of logical changes
// (grouped by change id) across the body, header and footer.

export interface ReviewSource {
  label: string;
  editor: Editor | null;
}

export interface TrackControls {
  /** Whether my edits are tracked right now. */
  tracking: boolean;
  /** The document-wide setting (null = not set). */
  everyone: boolean | null;
  /** My default for documents without a setting. */
  byDefault: boolean;
  setMine: (on: boolean) => void;
  setEveryone: (on: boolean) => void;
  setDefault: (on: boolean) => void;
}

interface Item {
  source: number;
  label: string;
  change: TrackedChange;
}

const KIND: Record<TrackedChange["kind"], { label: string; color: "success" | "danger" | "warning" | "primary" | "neutral" }> = {
  insert: { label: "Insertion", color: "success" },
  delete: { label: "Deletion", color: "danger" },
  replace: { label: "Replacement", color: "warning" },
  format: { label: "Formatting", color: "primary" },
  paragraph: { label: "Paragraph", color: "neutral" },
};

/** collectAll lists the changes of every source, header first. */
function collectAll(sources: ReviewSource[]): Item[] {
  const out: Item[] = [];
  sources.forEach((s, i) => {
    if (!s.editor || s.editor.isDestroyed) return;
    for (const change of collectChanges(s.editor.state.doc)) out.push({ source: i, label: s.label, change });
  });
  return out;
}

/** selectChange selects a change in its editor and scrolls to it. */
export function selectChange(editor: Editor, c: TrackedChange) {
  const size = editor.state.doc.content.size;
  editor.chain().focus().setTextSelection({ from: c.from, to: Math.min(c.to, size) }).scrollIntoView().run();
}

interface SuggestionsProps {
  sources: ReviewSource[];
  track: TrackControls;
  display: DisplayMode;
  onDisplay: (m: DisplayMode) => void;
  onClose: () => void;
}

export function Suggestions({ sources, track, display, onDisplay, onClose }: SuggestionsProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [current, setCurrent] = useState<{ source: number; id: string } | null>(null);
  const editors = useMemo(() => sources.map((s) => s.editor), [sources]);

  const refresh = useCallback(() => {
    const all = collectAll(sources);
    setItems(all);
    // The current change follows the caret of the focused editor.
    sources.forEach((s, i) => {
      const e = s.editor;
      if (!e || e.isDestroyed || !e.isFocused) return;
      const { from, to } = e.state.selection;
      const c = changeAt(
        all.filter((it) => it.source === i).map((it) => it.change),
        from,
        from === to ? from : to,
      );
      setCurrent(c ? { source: i, id: c.id } : null);
    });
  }, [sources]);

  useEffect(() => {
    refresh();
    const live = editors.filter((e): e is Editor => !!e);
    for (const e of live) {
      e.on("update", refresh);
      e.on("selectionUpdate", refresh);
    }
    return () => {
      for (const e of live) {
        e.off("update", refresh);
        e.off("selectionUpdate", refresh);
      }
    };
  }, [editors, refresh]);

  const curIndex = current ? items.findIndex((it) => it.source === current.source && it.change.id === current.id) : -1;
  const go = (dir: 1 | -1) => {
    if (!items.length) return;
    let i: number;
    if (curIndex >= 0) i = (curIndex + dir + items.length) % items.length;
    else {
      // From the caret of the body editor (or the first source).
      const body = sources.findIndex((s) => s.label === "Body");
      const e = sources[body]?.editor;
      const pos = e ? e.state.selection.from : 0;
      const after = items.findIndex((it) => it.source > body || (it.source === body && it.change.from > pos));
      i = dir > 0 ? (after === -1 ? 0 : after) : after === -1 ? items.length - 1 : (after - 1 + items.length) % items.length;
    }
    const it = items[i];
    const e = sources[it.source].editor;
    if (!e) return;
    setCurrent({ source: it.source, id: it.change.id });
    selectChange(e, it.change);
  };
  const resolve = (it: Item, accept: boolean) => {
    const e = sources[it.source].editor;
    if (!e) return;
    if (accept) e.chain().focus().acceptChange(it.change.id).run();
    else e.chain().focus().rejectChange(it.change.id).run();
  };
  const resolveCurrent = (accept: boolean) => {
    const it = curIndex >= 0 ? items[curIndex] : null;
    if (it) resolve(it, accept);
  };
  const resolveAll = (accept: boolean) => {
    for (const s of sources) {
      const e = s.editor;
      if (!e || e.isDestroyed) continue;
      if (accept) e.commands.acceptAllSuggestions();
      else e.commands.rejectAllSuggestions();
    }
  };

  const trackLabel = track.tracking ? (track.everyone ? "On for everyone" : "On for me") : track.everyone === false ? "Off for everyone" : "Off";

  return (
    <Sheet
      variant="outlined"
      data-testid="review-panel"
      sx={{ width: 320, p: 1.5, borderRadius: "sm", height: "100%", overflowY: "auto" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        <RateReviewIcon fontSize="small" sx={{ mr: 0.75, opacity: 0.7 }} />
        <Typography level="title-sm" sx={{ flex: 1 }}>
          Suggestions
        </Typography>
        <IconButton size="sm" variant="plain" onClick={onClose} aria-label="Close suggestions">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ display: "flex", gap: 1, mb: 1, alignItems: "center" }}>
        <Dropdown>
          <MenuButton
            size="sm"
            variant="soft"
            color={track.tracking ? "success" : "neutral"}
            data-testid="track-changes-menu"
            sx={{ flex: 1, justifyContent: "flex-start" }}
          >
            Track changes: {trackLabel}
          </MenuButton>
          <Menu size="sm" placement="bottom-start">
            <MenuItem data-testid="track-on-me" selected={track.tracking && !track.everyone} onClick={() => track.setMine(true)}>
              On for me
            </MenuItem>
            <MenuItem data-testid="track-off-me" selected={!track.tracking} onClick={() => track.setMine(false)}>
              Off for me
            </MenuItem>
            <MenuItem data-testid="track-on-everyone" selected={track.everyone === true} onClick={() => track.setEveryone(true)}>
              On for me and everyone
            </MenuItem>
            <MenuItem data-testid="track-off-everyone" selected={track.everyone === false} onClick={() => track.setEveryone(false)}>
              Off for me and everyone
            </MenuItem>
            <ListDivider />
            <MenuItem onClick={() => track.setDefault(!track.byDefault)}>
              {track.byDefault ? "✓ " : ""}Track my changes by default
            </MenuItem>
          </Menu>
        </Dropdown>
      </Box>

      <Select
        size="sm"
        value={display}
        onChange={(_, v) => v && onDisplay(v)}
        slotProps={{ button: { "aria-label": "Display mode", "data-testid": "review-display" } as Record<string, string> }}
        sx={{ mb: 1 }}
      >
        {DISPLAY_MODES.map((m) => (
          <Option key={m.id} value={m.id} label={m.label} data-testid={`display-${m.id}`}>
            <Box>
              <Typography level="body-sm">{m.label}</Typography>
              <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                {m.hint}
              </Typography>
            </Box>
          </Option>
        ))}
      </Select>

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
        <Tooltip title="Previous change" size="sm">
          <span>
            <IconButton size="sm" variant="outlined" aria-label="Previous change" disabled={!items.length} onClick={() => go(-1)}>
              <ChevronLeftIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Next change" size="sm">
          <span>
            <IconButton size="sm" variant="outlined" aria-label="Next change" disabled={!items.length} onClick={() => go(1)}>
              <ChevronRightIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Typography level="body-xs" sx={{ flex: 1, textAlign: "center", opacity: 0.7 }} data-testid="change-count">
          {items.length ? `${curIndex >= 0 ? curIndex + 1 : "–"} of ${items.length}` : "No changes"}
        </Typography>
        <Tooltip title="Accept current change" size="sm">
          <span>
            <IconButton size="sm" variant="soft" color="success" aria-label="Accept current change" disabled={curIndex < 0} onClick={() => resolveCurrent(true)}>
              <CheckIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Reject current change" size="sm">
          <span>
            <IconButton size="sm" variant="soft" color="danger" aria-label="Reject current change" disabled={curIndex < 0} onClick={() => resolveCurrent(false)}>
              <ClearIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {items.length === 0 ? (
        <Typography level="body-xs" sx={{ opacity: 0.6 }}>
          No suggestions yet. With track changes on, your edits appear here for review.
        </Typography>
      ) : (
        <>
          <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
            <Button size="sm" variant="soft" color="success" fullWidth startDecorator={<DoneAllIcon />} onClick={() => resolveAll(true)}>
              Accept all
            </Button>
            <Button size="sm" variant="soft" color="danger" fullWidth startDecorator={<ClearIcon />} onClick={() => resolveAll(false)}>
              Reject all
            </Button>
          </Box>
          <Divider sx={{ mb: 1 }} />
          {items.map((it, i) => {
            const c = it.change;
            const k = KIND[c.kind];
            const isCur = i === curIndex;
            return (
              <Box
                key={`${it.source}-${c.id}`}
                data-testid="change-card"
                data-change-id={c.id}
                data-kind={c.kind}
                data-current={isCur ? "true" : undefined}
                onClick={() => {
                  const e = sources[it.source].editor;
                  if (!e) return;
                  setCurrent({ source: it.source, id: c.id });
                  selectChange(e, c);
                }}
                sx={{
                  mb: 1,
                  p: 1,
                  borderRadius: "sm",
                  cursor: "pointer",
                  bgcolor: "background.level1",
                  outline: isCur ? "2px solid" : "none",
                  outlineColor: "primary.400",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
                  <Chip size="sm" variant="soft" color={k.color}>
                    {k.label}
                  </Chip>
                  {it.label !== "Body" && (
                    <Chip size="sm" variant="outlined">
                      {it.label}
                    </Chip>
                  )}
                  <Box sx={{ flex: 1 }} />
                  <IconButton
                    size="sm"
                    variant="plain"
                    color="success"
                    aria-label="Accept"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      resolve(it, true);
                    }}
                  >
                    <CheckIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="sm"
                    variant="plain"
                    color="danger"
                    aria-label="Reject"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      resolve(it, false);
                    }}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Box>
                <Typography level="body-xs" sx={{ opacity: 0.75 }}>
                  {c.author || "Unknown"}
                  {c.date ? ` · ${formatChangeDate(c.date)}` : ""}
                </Typography>
                <Typography
                  level="body-sm"
                  title={describeChange(c)}
                  sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {describeChange(c)}
                </Typography>
              </Box>
            );
          })}
        </>
      )}
    </Sheet>
  );
}
