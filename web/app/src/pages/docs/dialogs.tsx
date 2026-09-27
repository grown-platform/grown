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
import { selectedBlocks, spacingOf } from "./paragraphFormat";

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

/** CustomSpacingDialog sets numeric space before/after (points) on the
 *  selected paragraphs (Format > Line & paragraph spacing > Custom
 *  spacing…). It opens with the first selected paragraph's values. */
export function CustomSpacingDialog({ open, onClose, editor }: BaseDialog) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "calc(100vw - 32px)", sm: 360 },
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <ModalClose />
        <Typography level="h4">Custom spacing</Typography>
        {open && editor && <CustomSpacingForm editor={editor} onClose={onClose} />}
      </ModalDialog>
    </Modal>
  );
}

function CustomSpacingForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const first = selectedBlocks(editor.state)[0];
  const cur = first ? spacingOf(first.node) : { before: 0, after: 0 };
  const round = (n: number) => String(Math.round(n * 10) / 10);
  const [before, setBefore] = useState(round(cur.before));
  const [after, setAfter] = useState(round(cur.after));
  const parse = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 1584) : null;
  };
  const ok = parse(before) != null && parse(after) != null;
  function apply() {
    if (!ok) return;
    editor
      .chain()
      .focus()
      .setSpacingPt({ before: parse(before), after: parse(after) })
      .run();
    onClose();
  }
  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      <Typography level="body-sm">Paragraph spacing (pt)</Typography>
      <Stack direction="row" spacing={1}>
        <Input
          aria-label="Space before"
          startDecorator="Before"
          type="number"
          value={before}
          onChange={(e) => setBefore(e.target.value)}
          autoFocus
        />
        <Input
          aria-label="Space after"
          startDecorator="After"
          type="number"
          value={after}
          onChange={(e) => setAfter(e.target.value)}
        />
      </Stack>
      <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
        <Button variant="plain" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={apply} disabled={!ok}>
          Apply
        </Button>
      </Box>
    </Stack>
  );
}
