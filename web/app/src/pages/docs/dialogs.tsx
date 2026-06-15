import { useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  List,
  ListItemButton,
  Box,
  Input,
  Button,
  Stack,
  CircularProgress,
} from "@mui/joy";
import type { Editor } from "@tiptap/react";
import { DOWNLOAD_FORMATS, downloadDoc, type DownloadFormat } from "./export";
import { replaceAll } from "./editorActions";
import type { Indents } from "./Ruler";
import type { VMargins } from "./editorStyles";

interface BaseDialog {
  open: boolean;
  onClose: () => void;
  editor: Editor | null;
}

export function DownloadDialog({
  open,
  onClose,
  editor,
  title,
}: BaseDialog & { title: string }) {
  const [busy, setBusy] = useState<DownloadFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(fmt: DownloadFormat) {
    if (!editor) return;
    setBusy(fmt);
    setError(null);
    try {
      await downloadDoc(editor, title, fmt);
      if (fmt !== "pdf") onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "calc(100vw - 32px)", sm: 480 },
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <ModalClose />
        <Typography level="h4">Download</Typography>
        {error && (
          <Typography color="danger" level="body-sm">
            {error}
          </Typography>
        )}
        <List sx={{ "--ListItem-radius": "8px" }}>
          {DOWNLOAD_FORMATS.map(({ fmt, label }) => (
            <ListItemButton
              key={fmt}
              onClick={() => pick(fmt)}
              disabled={busy !== null}
            >
              {label}
              {busy === fmt && (
                <CircularProgress size="sm" sx={{ ml: "auto" }} />
              )}
            </ListItemButton>
          ))}
        </List>
      </ModalDialog>
    </Modal>
  );
}

const EMOJIS =
  "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😍 😘 😜 🤔 🤗 🤩 😎 😢 😭 😡 👍 👎 👏 🙏 💪 🔥 ⭐ ✅ ❌ ❤️ 🎉 🚀 💡 📌 📎 📝 📄 📁 🔗 ⚠️ ✨ 👀 🎯".split(
    " ",
  );

export function EmojiDialog({ open, onClose, editor }: BaseDialog) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "calc(100vw - 32px)", sm: 480 },
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <ModalClose />
        <Typography level="h4">Insert emoji</Typography>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(8, 1fr)",
            gap: 0.5,
            mt: 1,
          }}
        >
          {EMOJIS.map((e) => (
            <Box
              key={e}
              onClick={() => {
                editor?.chain().focus().insertContent(e).run();
                onClose();
              }}
              sx={{
                fontSize: 22,
                textAlign: "center",
                cursor: "pointer",
                p: 0.5,
                borderRadius: "6px",
                "&:hover": { bgcolor: "background.level1" },
              }}
            >
              {e}
            </Box>
          ))}
        </Box>
      </ModalDialog>
    </Modal>
  );
}

const SPECIALS =
  "© ® ™ § ¶ † ‡ • – — … ‹ › « » “ ” ‘ ’ ° ± × ÷ ≈ ≠ ≤ ≥ ∞ µ π Σ √ ∂ ∫ € £ ¥ ¢ → ← ↑ ↓ ⇒ ⇐ ★ ☆ ✓ ✗ ♠ ♣ ♥ ♦".split(
    " ",
  );

export function SpecialCharsDialog({ open, onClose, editor }: BaseDialog) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "calc(100vw - 32px)", sm: 480 },
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <ModalClose />
        <Typography level="h4">Special characters</Typography>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(10, 1fr)",
            gap: 0.5,
            mt: 1,
          }}
        >
          {SPECIALS.map((c) => (
            <Box
              key={c}
              onClick={() => {
                editor?.chain().focus().insertContent(c).run();
                onClose();
              }}
              sx={{
                fontSize: 18,
                textAlign: "center",
                cursor: "pointer",
                p: 0.5,
                borderRadius: "6px",
                "&:hover": { bgcolor: "background.level1" },
              }}
            >
              {c}
            </Box>
          ))}
        </Box>
      </ModalDialog>
    </Modal>
  );
}

export function PageSetupDialog({
  open,
  onClose,
  orientation,
  onChange,
  vMargins,
  onVMarginsChange,
  indents,
  onIndentsChange,
}: {
  open: boolean;
  onClose: () => void;
  orientation: "portrait" | "landscape";
  onChange: (o: "portrait" | "landscape") => void;
  vMargins: VMargins;
  onVMarginsChange: (m: VMargins) => void;
  indents: Indents;
  onIndentsChange: (i: Indents) => void;
}) {
  // clamp to a sane page-margin range (inches)
  const clamp = (n: number) => Math.max(0, Math.min(3, n));
  const marginInput = (
    label: string,
    value: number,
    set: (n: number) => void,
  ) => (
    <Box sx={{ flex: 1 }}>
      <Typography level="body-xs" sx={{ mb: 0.25 }}>
        {label}
      </Typography>
      <Input
        type="number"
        size="sm"
        value={value}
        onChange={(e) => set(clamp(parseFloat(e.target.value) || 0))}
        slotProps={{
          input: { step: 0.1, min: 0, max: 3, "aria-label": `${label} margin` },
        }}
        endDecorator="in"
      />
    </Box>
  );
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "calc(100vw - 32px)", sm: 480 },
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <ModalClose />
        <Typography level="h4">Page setup</Typography>
        <Typography level="title-sm" sx={{ mt: 1 }}>
          Orientation
        </Typography>
        <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
          {(["portrait", "landscape"] as const).map((o) => (
            <Button
              key={o}
              variant={orientation === o ? "solid" : "outlined"}
              color={orientation === o ? "primary" : "neutral"}
              onClick={() => onChange(o)}
              sx={{ flex: 1, textTransform: "capitalize" }}
            >
              {o}
            </Button>
          ))}
        </Box>
        <Typography level="title-sm" sx={{ mt: 2 }}>
          Margins
        </Typography>
        <Stack spacing={1} sx={{ mt: 0.5 }}>
          <Box sx={{ display: "flex", gap: 1 }}>
            {marginInput("Top", vMargins.top, (n) =>
              onVMarginsChange({ ...vMargins, top: n }),
            )}
            {marginInput("Bottom", vMargins.bottom, (n) =>
              onVMarginsChange({ ...vMargins, bottom: n }),
            )}
          </Box>
          <Box sx={{ display: "flex", gap: 1 }}>
            {marginInput("Left", indents.left, (n) =>
              onIndentsChange({ ...indents, left: n }),
            )}
            {marginInput("Right", indents.right, (n) =>
              onIndentsChange({ ...indents, right: n }),
            )}
          </Box>
        </Stack>
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2 }}>
          <Button onClick={onClose}>OK</Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

export function FindReplaceDialog({ open, onClose, editor }: BaseDialog) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [result, setResult] = useState<string | null>(null);

  function doReplace() {
    if (!editor) return;
    const n = replaceAll(editor, find, replace);
    setResult(`${n} replacement${n === 1 ? "" : "s"}`);
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "calc(100vw - 32px)", sm: 480 },
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <ModalClose />
        <Typography level="h4">Find and replace</Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Input
            placeholder="Find"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            autoFocus
          />
          <Input
            placeholder="Replace with"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
          />
          {result && (
            <Typography level="body-sm" color="success">
              {result}
            </Typography>
          )}
          <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
            <Button variant="plain" onClick={onClose}>
              Close
            </Button>
            <Button onClick={doReplace} disabled={!find}>
              Replace all
            </Button>
          </Box>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
