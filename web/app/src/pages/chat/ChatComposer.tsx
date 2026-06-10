/**
 * ChatComposer — rich message composer for Chat.
 *
 * Features:
 *   - Markdown formatting toolbar (bold, italic, strikethrough, code, link, list)
 *   - Emoji picker (emoji-mart)
 *   - GIF picker (Giphy search via VITE_GIPHY_KEY or public beta key)
 *   - Paste-to-upload images (clipboard)
 *   - Drag & drop file attachments
 *   - Pending attachment chips with remove
 *   - Enter to send / Shift+Enter for newline
 *   - @ mention autocomplete (org members from /api/v1/directory)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  IconButton,
  Tooltip,
  CircularProgress,
  Input,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Avatar,
} from "@mui/joy";
import SendIcon from "@mui/icons-material/Send";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import StrikethroughSIcon from "@mui/icons-material/StrikethroughS";
import CodeIcon from "@mui/icons-material/Code";
import LinkIcon from "@mui/icons-material/Link";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import EmojiEmotionsOutlinedIcon from "@mui/icons-material/EmojiEmotionsOutlined";
import GifBoxOutlinedIcon from "@mui/icons-material/GifBoxOutlined";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CloseIcon from "@mui/icons-material/Close";
import EmojiPicker from "@emoji-mart/react";
import emojiData from "@emoji-mart/data";
import type { ChatAttachment } from "./types";
import { uploadAttachments } from "./api";

// ---- Giphy configuration ----------------------------------------------------

const GIPHY_KEY: string = import.meta.env.VITE_GIPHY_KEY ?? "dc6zaTOxFJmzC";
const GIPHY_BETA: boolean = !import.meta.env.VITE_GIPHY_KEY;

interface GiphyGif {
  id: string;
  title: string;
  images: { fixed_height_small: { url: string }; original: { url: string } };
}

// ---- Helpers ----------------------------------------------------------------

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function isImage(mime: string) {
  return mime.startsWith("image/");
}

// ---- Formatting toolbar helpers ---------------------------------------------
// These insert Markdown syntax around the current textarea selection.

type FormatAction = "bold" | "italic" | "strike" | "code" | "link" | "list";

function applyFormat(
  action: FormatAction,
  value: string,
  selStart: number,
  selEnd: number,
): { next: string; cursorStart: number; cursorEnd: number } {
  const selected = value.slice(selStart, selEnd);
  const before = value.slice(0, selStart);
  const after = value.slice(selEnd);

  switch (action) {
    case "bold": {
      const ins = `**${selected || "bold text"}**`;
      return {
        next: before + ins + after,
        cursorStart: selStart + 2,
        cursorEnd: selStart + ins.length - 2,
      };
    }
    case "italic": {
      const ins = `_${selected || "italic text"}_`;
      return {
        next: before + ins + after,
        cursorStart: selStart + 1,
        cursorEnd: selStart + ins.length - 1,
      };
    }
    case "strike": {
      const ins = `~~${selected || "strikethrough"}~~`;
      return {
        next: before + ins + after,
        cursorStart: selStart + 2,
        cursorEnd: selStart + ins.length - 2,
      };
    }
    case "code": {
      if (selected.includes("\n")) {
        const ins = `\`\`\`\n${selected || "code"}\n\`\`\``;
        return {
          next: before + ins + after,
          cursorStart: selStart + 4,
          cursorEnd: selStart + ins.length - 4,
        };
      }
      const ins = `\`${selected || "code"}\``;
      return {
        next: before + ins + after,
        cursorStart: selStart + 1,
        cursorEnd: selStart + ins.length - 1,
      };
    }
    case "link": {
      const text = selected || "link text";
      const ins = `[${text}](url)`;
      return {
        next: before + ins + after,
        cursorStart: selStart + text.length + 3,
        cursorEnd: selStart + text.length + 6,
      };
    }
    case "list": {
      // Prefix each line with "- "
      const lines = (selected || "item")
        .split("\n")
        .map((l) => `- ${l}`)
        .join("\n");
      return {
        next: before + lines + after,
        cursorStart: selStart,
        cursorEnd: selStart + lines.length,
      };
    }
  }
}

// ---- Component --------------------------------------------------------------

interface PendingAttachment {
  /** Local identifier (before upload) */
  localId: string;
  file: File;
  preview?: string; // object URL for images
  uploading: boolean;
  error?: string;
  /** Populated after successful upload */
  remote?: ChatAttachment;
}

export interface ComposerState {
  body: string;
  attachmentIds: string[];
}

interface OrgMember {
  id: string;
  name: string;
  email: string;
}

interface ChatComposerProps {
  disabled?: boolean;
  onSend: (state: ComposerState) => Promise<void>;
  /** Override the textarea placeholder text. */
  placeholder?: string;
  /**
   * Called when the user selects a mention via the @ picker and the channel is
   * a group/unknown context — lets the parent open or create a DM with that person.
   */
  onMentionOpenDM?: (member: OrgMember) => void;
}

export function ChatComposer({
  disabled,
  onSend,
  placeholder: placeholderProp,
  onMentionOpenDM,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingAtts, setPendingAtts] = useState<PendingAttachment[]>([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // ---- @ mention autocomplete state -----------------------------------------
  /**
   * Non-null when we are in an active @ mention query.
   * Holds the index in `value` where the `@` char starts.
   */
  const [mentionAnchor, setMentionAnchor] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionOptions, setMentionOptions] = useState<OrgMember[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const gifRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLUListElement>(null);

  // Close emoji/gif popover on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node))
        setShowEmoji(false);
      if (gifRef.current && !gifRef.current.contains(e.target as Node))
        setShowGif(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  // Giphy search
  useEffect(() => {
    if (!showGif) return;
    const q = gifQuery.trim() || "trending";
    const endpoint = gifQuery.trim()
      ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=18&rating=g`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=18&rating=g`;
    setGifLoading(true);
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(endpoint);
        const d = (await r.json()) as { data: GiphyGif[] };
        if (alive) setGifs(d.data ?? []);
      } catch {
        /* ignore */
      } finally {
        if (alive) setGifLoading(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [gifQuery, showGif]);

  // ---- @ mention: fetch org members debounced --------------------------------
  useEffect(() => {
    if (mentionAnchor === null) {
      setMentionOptions([]);
      return;
    }
    let alive = true;
    setMentionLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/v1/directory?q=${encodeURIComponent(mentionQuery)}`,
          {
            credentials: "same-origin",
          },
        );
        const d = (await r.json()) as { members?: OrgMember[] };
        if (alive) {
          setMentionOptions(d.members ?? []);
          setMentionIndex(0);
        }
      } catch {
        /* ignore */
      } finally {
        if (alive) setMentionLoading(false);
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [mentionAnchor, mentionQuery]);

  // ---- Upload helpers -------------------------------------------------------

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const newPending: PendingAttachment[] = files.map((f) => ({
      localId: Math.random().toString(36).slice(2),
      file: f,
      preview: isImage(f.type) ? URL.createObjectURL(f) : undefined,
      uploading: true,
    }));
    setPendingAtts((prev) => [...prev, ...newPending]);

    for (const p of newPending) {
      try {
        const [att] = await uploadAttachments([p.file]);
        setPendingAtts((prev) =>
          prev.map((x) =>
            x.localId === p.localId
              ? { ...x, uploading: false, remote: { ...att, url: att.url } }
              : x,
          ),
        );
      } catch {
        setPendingAtts((prev) =>
          prev.map((x) =>
            x.localId === p.localId
              ? { ...x, uploading: false, error: "Upload failed" }
              : x,
          ),
        );
      }
    }
  }, []);

  // ---- Paste handler --------------------------------------------------------

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(
      (i) => i.kind === "file" && i.type.startsWith("image/"),
    );
    if (imageItems.length) {
      e.preventDefault();
      const files = imageItems
        .map((i) => i.getAsFile())
        .filter(Boolean) as File[];
      uploadFiles(files);
    }
  }

  // ---- Drag & drop ----------------------------------------------------------

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function handleDragLeave() {
    setDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) uploadFiles(files);
  }

  // ---- GIF selection --------------------------------------------------------

  function handleGifSelect(gif: GiphyGif) {
    // Send the GIF URL as the message body (renders inline in message list).
    // We append it as a markdown image so it renders in the body renderer.
    const gifUrl = gif.images.original.url;
    setValue((v) =>
      v ? `${v}\n![${gif.title}](${gifUrl})` : `![${gif.title}](${gifUrl})`,
    );
    setShowGif(false);
    setGifQuery("");
    textareaRef.current?.focus();
  }

  // ---- Formatting toolbar ---------------------------------------------------

  function format(action: FormatAction) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd, value: v } = ta;
    const { next, cursorStart, cursorEnd } = applyFormat(
      action,
      v,
      selectionStart,
      selectionEnd,
    );
    setValue(next);
    // Restore selection after React re-render
    requestAnimationFrame(() => {
      ta.setSelectionRange(cursorStart, cursorEnd);
      ta.focus();
    });
  }

  // ---- Emoji insert ---------------------------------------------------------

  function handleEmojiSelect(emoji: { native: string }) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd, value: v } = ta;
    const next =
      v.slice(0, selectionStart) + emoji.native + v.slice(selectionEnd);
    const pos = selectionStart + emoji.native.length;
    setValue(next);
    requestAnimationFrame(() => {
      ta.setSelectionRange(pos, pos);
      ta.focus();
    });
    setShowEmoji(false);
  }

  // ---- @ mention: detect trigger, navigate list, select --------------------

  function detectMention(text: string, cursor: number) {
    // Walk back from cursor to find `@` not preceded by a word char.
    // Stop if we hit a space, newline, or the start of the string.
    let i = cursor - 1;
    while (i >= 0 && text[i] !== " " && text[i] !== "\n") {
      if (text[i] === "@") {
        // Valid trigger: must be at start or preceded by whitespace / newline.
        const before = text[i - 1];
        if (i === 0 || before === " " || before === "\n") {
          const query = text.slice(i + 1, cursor);
          return { anchor: i, query };
        }
        break;
      }
      i--;
    }
    return null;
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setValue(next);
    const cursor = e.target.selectionStart ?? next.length;
    const hit = detectMention(next, cursor);
    if (hit) {
      setMentionAnchor(hit.anchor);
      setMentionQuery(hit.query);
    } else {
      setMentionAnchor(null);
      setMentionQuery("");
    }
  }

  function selectMention(member: OrgMember) {
    if (mentionAnchor === null) return;
    const ta = textareaRef.current;
    // Replace "@query" (from anchor to current cursor) with "@name ".
    const cursor = ta?.selectionStart ?? value.length;
    const before = value.slice(0, mentionAnchor);
    const after = value.slice(cursor);
    const insertion = `@${member.name || member.email} `;
    const next = before + insertion + after;
    setValue(next);
    setMentionAnchor(null);
    setMentionQuery("");
    setMentionOptions([]);
    // Restore cursor
    requestAnimationFrame(() => {
      if (ta) {
        const pos = mentionAnchor + insertion.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
      }
    });
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mentionOpen = mentionAnchor !== null && mentionOptions.length > 0;

    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionOptions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const member = mentionOptions[mentionIndex];
        if (member) selectMention(member);
        return;
      }
      if (e.key === "Escape") {
        setMentionAnchor(null);
        setMentionOptions([]);
        return;
      }
    }

    // Default Enter-to-send (only when no mention popup is open).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ---- Send -----------------------------------------------------------------

  async function handleSend() {
    const body = value.trim();
    const uploadedIds = pendingAtts
      .filter((p) => p.remote && !p.error)
      .map((p) => p.remote!.id);
    if (!body && uploadedIds.length === 0) return;
    if (pendingAtts.some((p) => p.uploading)) return; // wait for uploads

    setSending(true);
    try {
      await onSend({ body: body || " ", attachmentIds: uploadedIds });
      setValue("");
      setMentionAnchor(null);
      setMentionQuery("");
      setMentionOptions([]);
      setPendingAtts((prev) => {
        // Revoke object URLs to avoid memory leaks
        prev.forEach((p) => {
          if (p.preview) URL.revokeObjectURL(p.preview);
        });
        return [];
      });
    } finally {
      setSending(false);
    }
  }

  function removeAttachment(localId: string) {
    setPendingAtts((prev) => {
      const removed = prev.find((p) => p.localId === localId);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((p) => p.localId !== localId);
    });
  }

  const canSend =
    !disabled &&
    !sending &&
    !pendingAtts.some((p) => p.uploading) &&
    (value.trim().length > 0 || pendingAtts.some((p) => p.remote && !p.error));

  // ---- Render ---------------------------------------------------------------

  return (
    <Box
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sx={{
        border: "1px solid",
        borderColor: dragOver ? "primary.500" : "divider",
        borderRadius: "md",
        bgcolor: "background.surface",
        outline: dragOver ? "2px dashed" : "none",
        outlineColor: "primary.300",
        transition: "border-color 0.15s",
        position: "relative",
      }}
    >
      {/* ---- Formatting toolbar ---- */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          px: 0.75,
          pt: 0.5,
          gap: 0.25,
          borderBottom: "1px solid",
          borderColor: "divider",
          flexWrap: "wrap",
        }}
      >
        <Tooltip title="Bold (Markdown **)" placement="top">
          <IconButton
            size="sm"
            variant="plain"
            onMouseDown={(e) => {
              e.preventDefault();
              format("bold");
            }}
            aria-label="Bold"
          >
            <FormatBoldIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Italic (Markdown _)" placement="top">
          <IconButton
            size="sm"
            variant="plain"
            onMouseDown={(e) => {
              e.preventDefault();
              format("italic");
            }}
            aria-label="Italic"
          >
            <FormatItalicIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Strikethrough (Markdown ~~)" placement="top">
          <IconButton
            size="sm"
            variant="plain"
            onMouseDown={(e) => {
              e.preventDefault();
              format("strike");
            }}
            aria-label="Strikethrough"
          >
            <StrikethroughSIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Code (Markdown `)" placement="top">
          <IconButton
            size="sm"
            variant="plain"
            onMouseDown={(e) => {
              e.preventDefault();
              format("code");
            }}
            aria-label="Code"
          >
            <CodeIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Link (Markdown [text](url))" placement="top">
          <IconButton
            size="sm"
            variant="plain"
            onMouseDown={(e) => {
              e.preventDefault();
              format("link");
            }}
            aria-label="Link"
          >
            <LinkIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Bullet list (Markdown -)" placement="top">
          <IconButton
            size="sm"
            variant="plain"
            onMouseDown={(e) => {
              e.preventDefault();
              format("list");
            }}
            aria-label="Bulleted list"
          >
            <FormatListBulletedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        {/* Emoji */}
        <Box sx={{ position: "relative" }} ref={emojiRef}>
          <Tooltip title="Emoji" placement="top">
            <IconButton
              size="sm"
              variant="plain"
              onClick={() => {
                setShowEmoji((v) => !v);
                setShowGif(false);
              }}
              aria-label="Emoji picker"
            >
              <EmojiEmotionsOutlinedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          {showEmoji && (
            <Box
              sx={{
                position: "absolute",
                bottom: "100%",
                right: 0,
                zIndex: 1400,
                boxShadow: "lg",
                borderRadius: "md",
                overflow: "hidden",
              }}
            >
              <EmojiPicker
                data={emojiData}
                onEmojiSelect={handleEmojiSelect}
                theme="light"
                previewPosition="none"
                skinTonePosition="none"
                maxFrequentRows={2}
              />
            </Box>
          )}
        </Box>

        {/* GIF */}
        <Box sx={{ position: "relative" }} ref={gifRef}>
          <Tooltip title="GIF (Giphy)" placement="top">
            <IconButton
              size="sm"
              variant="plain"
              onClick={() => {
                setShowGif((v) => !v);
                setShowEmoji(false);
              }}
              aria-label="GIF picker"
            >
              <GifBoxOutlinedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          {showGif && (
            <Box
              sx={{
                position: "absolute",
                bottom: "100%",
                right: 0,
                zIndex: 1400,
                width: { xs: "calc(100vw - 32px)", sm: 360 },
                maxHeight: 400,
                bgcolor: "background.surface",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: "md",
                boxShadow: "lg",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <Box
                sx={{ p: 1, borderBottom: "1px solid", borderColor: "divider" }}
              >
                <Input
                  size="sm"
                  placeholder="Search GIFs…"
                  value={gifQuery}
                  onChange={(e) => setGifQuery(e.target.value)}
                  autoFocus
                />
                {GIPHY_BETA && (
                  <Typography level="body-xs" sx={{ opacity: 0.5, mt: 0.5 }}>
                    Using Giphy public beta key. Set VITE_GIPHY_KEY for
                    production.
                  </Typography>
                )}
              </Box>
              <Box
                sx={{
                  flex: 1,
                  overflowY: "auto",
                  p: 0.5,
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 0.5,
                }}
              >
                {gifLoading ? (
                  <Box
                    sx={{
                      gridColumn: "span 3",
                      display: "flex",
                      justifyContent: "center",
                      py: 3,
                    }}
                  >
                    <CircularProgress size="sm" />
                  </Box>
                ) : (
                  gifs.map((g) => (
                    <Box
                      key={g.id}
                      component="button"
                      onClick={() => handleGifSelect(g)}
                      sx={{
                        p: 0,
                        border: "none",
                        cursor: "pointer",
                        borderRadius: "xs",
                        overflow: "hidden",
                        "&:hover img": { opacity: 0.85 },
                        "&:focus-visible": {
                          outline: "2px solid",
                          outlineColor: "primary.500",
                        },
                      }}
                    >
                      <img
                        src={g.images.fixed_height_small.url}
                        alt={g.title}
                        style={{
                          width: "100%",
                          height: 80,
                          objectFit: "cover",
                          display: "block",
                        }}
                        loading="lazy"
                      />
                    </Box>
                  ))
                )}
              </Box>
            </Box>
          )}
        </Box>

        {/* Attach file */}
        <Tooltip title="Attach file" placement="top">
          <IconButton
            size="sm"
            variant="plain"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
          >
            <AttachFileIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) uploadFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </Box>

      {/* ---- @ mention autocomplete dropdown ---- */}
      {mentionAnchor !== null &&
        (mentionOptions.length > 0 || mentionLoading) && (
          <Box
            sx={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              right: 0,
              zIndex: 1400,
              mb: 0.5,
              bgcolor: "background.surface",
              border: "1px solid",
              borderColor: "divider",
              borderRadius: "md",
              boxShadow: "lg",
              maxHeight: 240,
              overflowY: "auto",
            }}
          >
            {mentionLoading && mentionOptions.length === 0 ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                <CircularProgress size="sm" />
              </Box>
            ) : (
              <List
                ref={mentionListRef}
                size="sm"
                sx={{ "--List-padding": "4px", "--ListItem-minHeight": "36px" }}
              >
                {mentionOptions.map((m, i) => (
                  <ListItem key={m.id}>
                    <ListItemButton
                      selected={i === mentionIndex}
                      onMouseEnter={() => setMentionIndex(i)}
                      onMouseDown={(e) => {
                        // mousedown fires before textarea blur; prevent blur so
                        // we can still read selectionStart in selectMention.
                        e.preventDefault();
                        selectMention(m);
                        // If the user shift-clicks (or there's a DM affordance),
                        // also let the parent open a DM.
                        if (e.shiftKey && onMentionOpenDM) {
                          onMentionOpenDM(m);
                        }
                      }}
                      sx={{ borderRadius: "sm", gap: 1 }}
                    >
                      <ListItemDecorator>
                        <Avatar
                          size="sm"
                          sx={{ width: 24, height: 24, fontSize: "0.75rem" }}
                        >
                          {(m.name || m.email || "?").charAt(0).toUpperCase()}
                        </Avatar>
                      </ListItemDecorator>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          level="body-sm"
                          sx={{ fontWeight: 600, lineHeight: 1.3 }}
                        >
                          {m.name || m.email}
                        </Typography>
                        {m.email && m.name && (
                          <Typography
                            level="body-xs"
                            sx={{ opacity: 0.6, lineHeight: 1.2 }}
                          >
                            {m.email}
                          </Typography>
                        )}
                      </Box>
                      {onMentionOpenDM && (
                        <Tooltip
                          title="Open DM (Shift+click)"
                          placement="right"
                        >
                          <Box
                            component="span"
                            sx={{
                              ml: "auto",
                              opacity: 0.5,
                              fontSize: "0.7rem",
                              whiteSpace: "nowrap",
                              pr: 0.5,
                            }}
                          >
                            Shift+click → DM
                          </Box>
                        </Tooltip>
                      )}
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        )}

      {/* ---- Textarea ---- */}
      <Box sx={{ px: 1.25, pt: 0.75, pb: 0.5 }}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleTextareaChange}
          onKeyDown={handleTextareaKeyDown}
          onPaste={handlePaste}
          placeholder={
            dragOver
              ? "Drop files here…"
              : (placeholderProp ??
                "Message… (Markdown supported, @ to mention)")
          }
          rows={2}
          style={{
            width: "100%",
            resize: "none",
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: "inherit",
            fontSize: "0.875rem",
            lineHeight: 1.6,
            color: "inherit",
            padding: 0,
            minHeight: 40,
            maxHeight: 180,
            overflowY: "auto",
          }}
          aria-label="Message composer"
          aria-multiline
          aria-autocomplete="list"
          aria-expanded={mentionAnchor !== null && mentionOptions.length > 0}
        />
      </Box>

      {/* ---- Pending attachments ---- */}
      {pendingAtts.length > 0 && (
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            gap: 0.75,
            px: 1.25,
            pb: 0.75,
            pt: 0.25,
            borderTop: "1px solid",
            borderColor: "divider",
          }}
        >
          {pendingAtts.map((p) => (
            <Box
              key={p.localId}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                border: "1px solid",
                borderColor: p.error ? "danger.300" : "divider",
                borderRadius: "sm",
                px: 0.75,
                py: 0.5,
                bgcolor: p.error ? "danger.softBg" : "background.level1",
                maxWidth: 200,
              }}
            >
              {p.preview ? (
                <img
                  src={p.preview}
                  alt={p.file.name}
                  style={{
                    width: 32,
                    height: 32,
                    objectFit: "cover",
                    borderRadius: 4,
                    flexShrink: 0,
                  }}
                />
              ) : (
                <AttachFileIcon
                  sx={{ fontSize: 14, opacity: 0.5, flexShrink: 0 }}
                />
              )}
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  level="body-xs"
                  sx={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 100,
                  }}
                >
                  {p.file.name}
                </Typography>
                {p.error ? (
                  <Typography level="body-xs" color="danger">
                    {p.error}
                  </Typography>
                ) : p.uploading ? (
                  <CircularProgress
                    size="sm"
                    sx={{ "--CircularProgress-size": "12px" }}
                  />
                ) : (
                  <Typography level="body-xs" sx={{ opacity: 0.5 }}>
                    {fmtBytes(p.file.size)}
                  </Typography>
                )}
              </Box>
              <IconButton
                size="sm"
                variant="plain"
                onClick={() => removeAttachment(p.localId)}
                aria-label={`Remove ${p.file.name}`}
                sx={{ minWidth: 20, minHeight: 20, p: 0 }}
              >
                <CloseIcon sx={{ fontSize: 12 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      {/* ---- Bottom bar ---- */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.25,
          pb: 0.75,
          pt: pendingAtts.length ? 0.25 : 0,
        }}
      >
        <Typography
          level="body-xs"
          sx={{ opacity: 0.4, display: { xs: "none", sm: "block" } }}
        >
          Enter to send · Shift+Enter for newline · Markdown supported
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Send (Enter)">
          <span>
            <IconButton
              color="primary"
              variant="solid"
              size="sm"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              sx={{ minWidth: 36, minHeight: 36 }}
            >
              {sending ? (
                <CircularProgress
                  size="sm"
                  sx={{ "--CircularProgress-size": "16px" }}
                />
              ) : (
                <SendIcon sx={{ fontSize: 18 }} />
              )}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
