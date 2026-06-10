import { useRef, useState } from "react";
import {
  Box,
  Sheet,
  Typography,
  Input,
  Textarea,
  IconButton,
  Button,
  Tooltip,
  Chip,
  CircularProgress,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import RemoveIcon from "@mui/icons-material/Remove";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import TextFormatIcon from "@mui/icons-material/TextFormat";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import InsertLinkIcon from "@mui/icons-material/InsertLink";
import EmojiEmotionsIcon from "@mui/icons-material/EmojiEmotions";
import AddToDriveIcon from "@mui/icons-material/AddToDrive";
import ImageIcon from "@mui/icons-material/Image";
import BorderColorIcon from "@mui/icons-material/BorderColor";
import { sendMessage, uploadAttachments } from "./api";
import type { SendInput, MailAttachment } from "./types";
import { RecipientField, parseRecipients, type Recipient } from "./RecipientField";

export interface ComposeInit {
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
}

const SIG_KEY = "grown.mail.signature";
const EMOJI = [
  "😀",
  "😁",
  "😂",
  "🙂",
  "😉",
  "😍",
  "😎",
  "👍",
  "🙏",
  "🎉",
  "🔥",
  "✅",
  "❤️",
  "👏",
  "🚀",
  "💡",
  "📎",
  "📅",
  "✉️",
  "⭐",
];

function loadSig(): string {
  try {
    return localStorage.getItem(SIG_KEY) || "";
  } catch {
    return "";
  }
}
function sigBlock(sig: string): string {
  return sig ? `\n\n-- \n${sig}` : "";
}

/** Compose is the Gmail-style compose window: pops out (minimize / maximize /
 *  close), a bottom toolbar (signature, link, emoji + attach/drive/photo stubs),
 *  and a ⋮ menu. Recipients To/Cc/Bcc; Bcc delivered like Cc internally. */
export function Compose({
  init,
  onClose,
  onSent,
  sendFn,
}: {
  init?: ComposeInit;
  onClose: () => void;
  onSent: () => void;
  /** Optional override for delivery (used for undo-send): resolves once the
   *  message is actually sent. Defaults to sending immediately via the API. */
  sendFn?: (input: SendInput) => Promise<void>;
}) {
  const [to, setTo] = useState<Recipient[]>(parseRecipients(init?.to ?? ""));
  const [showCc, setShowCc] = useState(!!init?.cc);
  const [cc, setCc] = useState<Recipient[]>(parseRecipients(init?.cc ?? ""));
  const [showBcc, setShowBcc] = useState(false);
  const [bcc, setBcc] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState(init?.subject ?? "");
  const [sig] = useState(loadSig);
  const [body, setBody] = useState((init?.body ?? "") + sigBlock(loadSig()));
  const [busy, setBusy] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [attachments, setAttachments] = useState<MailAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fs = e.target.files;
    e.target.value = "";
    if (!fs || !fs.length) return;
    setUploading(true);
    try {
      const added = await uploadAttachments(fs);
      setAttachments((a) => [...a, ...added]);
    } catch (err) {
      window.alert(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  async function send(draft = false) {
    const input: SendInput = {
      to_addrs: to.map((r) => r.email),
      cc_addrs: [...cc, ...bcc].map((r) => r.email),
      subject,
      body,
      draft,
      attachment_ids: attachments.map((a) => a.id),
    };
    if (!draft && input.to_addrs.length === 0) {
      window.alert("Add at least one recipient.");
      return;
    }
    // For a real send with an undo-capable sendFn: close the window immediately so
    // the Undo toast is the only surface, then let the parent handle delivery.
    if (!draft && sendFn) {
      onSent();
      onClose();
      sendFn(input).catch((e) => {
        // "undo" rejection is expected when the user cancels; ignore it.
        if ((e as Error).message !== "undo")
          window.alert(`Couldn’t send: ${(e as Error).message}`);
      });
      return;
    }
    setBusy(true);
    const deliver =
      sendFn ?? ((i: SendInput) => sendMessage(i).then(() => undefined));
    try {
      await deliver(input);
      onSent();
      onClose();
    } catch (e) {
      window.alert(
        `Couldn’t ${draft ? "save draft" : "send"}: ${(e as Error).message}`,
      );
      setBusy(false);
    }
  }

  function insertSignature() {
    let s = sig;
    if (!s) {
      s =
        window.prompt("Create a signature (used at the bottom of messages):") ||
        "";
      if (!s) return;
      try {
        localStorage.setItem(SIG_KEY, s);
      } catch {
        /* ignore */
      }
    }
    setBody((b) => b + sigBlock(s));
  }
  function editSignature() {
    const next = window.prompt("Edit your signature:", sig);
    if (next !== null) {
      try {
        localStorage.setItem(SIG_KEY, next);
      } catch {
        /* ignore */
      }
    }
  }
  function insertLink() {
    const url = window.prompt("Link URL:");
    if (!url) return;
    const text = window.prompt("Link text:", url) || url;
    setBody((b) => `${b}${text} (${url})`);
  }

  // Window geometry: minimized → header only; maximized → centered large; else
  // the standard bottom-right docked window.
  // On phones (< 600px) the compose window is always full-width / full-height
  // so the user can type comfortably without horizontal overflow.
  const geom = maximized
    ? {
        top: 24,
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(900px, 92vw)" as const,
      }
    : {
        bottom: 0,
        right: { xs: 0, sm: 24 },
        width: { xs: "100vw", sm: 500 },
        maxWidth: "100vw" as const,
      };

  return (
    <>
      {maximized && (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            bgcolor: "rgba(0,0,0,0.4)",
            zIndex: 1290,
          }}
          onClick={() => setMaximized(false)}
        />
      )}
      <Sheet
        variant="outlined"
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: "fixed",
          zIndex: 1300,
          borderTopLeftRadius: "md",
          borderTopRightRadius: "md",
          ...(maximized ? { borderRadius: "md" } : {}),
          boxShadow: "lg",
          display: "flex",
          flexDirection: "column",
          ...geom,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            px: 1.5,
            py: 1,
            bgcolor: "neutral.softBg",
            borderTopLeftRadius: "md",
            borderTopRightRadius: "md",
            cursor: "pointer",
          }}
          onClick={() => {
            if (!maximized) setMinimized((m) => !m);
          }}
        >
          <Typography level="title-sm" sx={{ flex: 1 }} noWrap>
            {subject || "New message"}
          </Typography>
          <IconButton
            size="sm"
            variant="plain"
            onClick={(e) => {
              e.stopPropagation();
              setMinimized((m) => !m);
              setMaximized(false);
            }}
            aria-label="Minimize"
          >
            <RemoveIcon />
          </IconButton>
          <IconButton
            size="sm"
            variant="plain"
            onClick={(e) => {
              e.stopPropagation();
              setMaximized((m) => !m);
              setMinimized(false);
            }}
            aria-label={maximized ? "Restore" : "Full screen"}
          >
            {maximized ? <CloseFullscreenIcon /> : <OpenInFullIcon />}
          </IconButton>
          <IconButton
            size="sm"
            variant="plain"
            onClick={(e) => {
              e.stopPropagation();
              send(true);
            }}
            aria-label="Save & close"
          >
            <CloseIcon />
          </IconButton>
        </Box>

        {!minimized && (
          <>
            <Box
              sx={{
                p: 1.5,
                display: "flex",
                flexDirection: "column",
                gap: 0.5,
                flex: maximized ? 1 : "none",
                minHeight: 0,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  borderBottom: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <RecipientField placeholder="To" value={to} onChange={setTo} />
                </Box>
                {!showCc && (
                  <Button
                    size="sm"
                    variant="plain"
                    color="neutral"
                    onClick={() => setShowCc(true)}
                  >
                    Cc
                  </Button>
                )}
                {!showBcc && (
                  <Button
                    size="sm"
                    variant="plain"
                    color="neutral"
                    onClick={() => setShowBcc(true)}
                  >
                    Bcc
                  </Button>
                )}
              </Box>
              {showCc && (
                <Box sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
                  <RecipientField placeholder="Cc" value={cc} onChange={setCc} />
                </Box>
              )}
              {showBcc && (
                <Box sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
                  <RecipientField placeholder="Bcc" value={bcc} onChange={setBcc} />
                </Box>
              )}
              <Input
                variant="plain"
                placeholder="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                sx={{
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  "--Input-focusedThickness": "0",
                }}
              />
              <Textarea
                variant="plain"
                minRows={maximized ? 16 : 10}
                placeholder="Compose your message…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                sx={{
                  flex: maximized ? 1 : "none",
                  "--Textarea-focusedThickness": "0",
                }}
              />
              {(attachments.length > 0 || uploading) && (
                <Box
                  sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, pt: 0.5 }}
                >
                  {attachments.map((a) => (
                    <Chip
                      key={a.id}
                      variant="soft"
                      endDecorator={<CloseIcon sx={{ fontSize: 14 }} />}
                      onClick={() =>
                        setAttachments((cur) =>
                          cur.filter((x) => x.id !== a.id),
                        )
                      }
                    >
                      {a.filename} ({Math.max(1, Math.round(a.size / 1024))} KB)
                    </Chip>
                  ))}
                  {uploading && (
                    <Chip
                      variant="soft"
                      startDecorator={<CircularProgress size="sm" />}
                    >
                      Uploading…
                    </Chip>
                  )}
                </Box>
              )}
            </Box>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={onPickFiles}
            />

            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.25,
                px: 1.5,
                py: 1,
                borderTop: "1px solid",
                borderColor: "divider",
                flexWrap: "wrap",
              }}
            >
              <Button
                loading={busy}
                onClick={() => send(false)}
                sx={{ borderRadius: "xl", px: 3, mr: 0.5 }}
              >
                Send
              </Button>
              <Tooltip title="Formatting">
                <span>
                  <IconButton
                    size="sm"
                    variant="plain"
                    disabled
                    aria-label="Formatting"
                  >
                    <TextFormatIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Attach files">
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={() => fileRef.current?.click()}
                  aria-label="Attach"
                >
                  <AttachFileIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Insert link">
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={insertLink}
                  aria-label="Insert link"
                >
                  <InsertLinkIcon />
                </IconButton>
              </Tooltip>
              <Dropdown>
                <MenuButton
                  slots={{ root: IconButton }}
                  slotProps={{
                    root: {
                      size: "sm",
                      variant: "plain",
                      "aria-label": "Insert emoji",
                    },
                  }}
                >
                  <EmojiEmotionsIcon />
                </MenuButton>
                <Menu
                  placement="top-start"
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(5, 1fr)",
                    gap: 0.25,
                    p: 0.5,
                    maxWidth: 200,
                  }}
                >
                  {EMOJI.map((e) => (
                    <MenuItem
                      key={e}
                      onClick={() => setBody((b) => b + e)}
                      sx={{
                        justifyContent: "center",
                        fontSize: 18,
                        minHeight: 32,
                      }}
                    >
                      {e}
                    </MenuItem>
                  ))}
                </Menu>
              </Dropdown>
              <Tooltip title="Insert from Drive (coming soon)">
                <span>
                  <IconButton
                    size="sm"
                    variant="plain"
                    disabled
                    aria-label="Drive"
                  >
                    <AddToDriveIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Insert photo (coming soon)">
                <span>
                  <IconButton
                    size="sm"
                    variant="plain"
                    disabled
                    aria-label="Photo"
                  >
                    <ImageIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Insert signature">
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={insertSignature}
                  aria-label="Insert signature"
                >
                  <BorderColorIcon />
                </IconButton>
              </Tooltip>
              <Dropdown>
                <MenuButton
                  slots={{ root: IconButton }}
                  slotProps={{
                    root: {
                      size: "sm",
                      variant: "plain",
                      "aria-label": "More options",
                    },
                  }}
                >
                  <MoreVertIcon />
                </MenuButton>
                <Menu size="sm" placement="top-start">
                  <MenuItem onClick={() => send(true)}>Save draft</MenuItem>
                  <MenuItem onClick={editSignature}>Edit signature</MenuItem>
                  <ListDivider />
                  <MenuItem disabled>Schedule send</MenuItem>
                  <MenuItem disabled>Plain text mode</MenuItem>
                  <MenuItem disabled>Print</MenuItem>
                </Menu>
              </Dropdown>
              <Box sx={{ flex: 1 }} />
              <IconButton
                size="sm"
                variant="plain"
                color="danger"
                onClick={onClose}
                aria-label="Discard draft"
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Box>
          </>
        )}
      </Sheet>
    </>
  );
}
