import { useEffect, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Input,
  Button,
  Box,
  Stack,
  Select,
  Option,
  List,
  ListItem,
  IconButton,
  Chip,
  Divider,
  CircularProgress,
} from "@mui/joy";
import LinkIcon from "@mui/icons-material/Link";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import {
  createShare,
  listShares,
  revokeShare,
  type Share,
  listDocGrants,
  grantDocAccess,
  revokeDocAccess,
} from "./api";
import { PeopleGrants } from "../../components/PeopleGrants";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  docId: string;
}

function shareUrl(token: string): string {
  return `${location.origin}/docs/share/${token}`;
}

/** ShareDialog manages "anyone with the link" share tokens: create a link at a
 *  role (viewer/editor), copy it, and revoke existing links. */
export function ShareDialog({ open, onClose, docId }: ShareDialogProps) {
  const [role, setRole] = useState("editor");
  const [invite, setInvite] = useState("");
  const [shares, setShares] = useState<Share[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setShares(null);
    setError(null);
    listShares(docId)
      .then(setShares)
      .catch((e) => setError((e as Error).message));
  }, [open, docId]);

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      const s = await createShare(docId, role);
      setShares((cur) => [s, ...(cur ?? [])]);
      await copy(s.token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  async function onInvite() {
    const email = invite.trim();
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      const s = await createShare(docId, role, email);
      setShares((cur) => [s, ...(cur ?? [])]);
      setInvite("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(token: string) {
    await revokeShare(token);
    setShares((cur) => (cur ?? []).filter((s) => s.token !== token));
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "calc(100vw - 32px)", sm: 520 },
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <ModalClose />
        <Typography level="h4">Share document</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7 }}>
          Share with specific people, or create a link anyone can open.
        </Typography>

        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {/* Per-user ACL grants (works cross-org, including personal accounts). */}
          <PeopleGrants
            listGrants={() => listDocGrants(docId)}
            grantAccess={async (uid, r) =>
              (await grantDocAccess(docId, uid, r)).grant
            }
            revokeAccess={(uid) => revokeDocAccess(docId, uid)}
          />

          <Divider />
          <Typography level="title-sm">Invite by email (link)</Typography>
          {/* Invite specific people by email. */}
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Input
              placeholder="Add people by email"
              type="email"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onInvite();
              }}
              sx={{ flex: 1 }}
            />
            <Button
              onClick={onInvite}
              loading={busy}
              disabled={!invite.trim()}
              startDecorator={<PersonAddIcon />}
            >
              Invite
            </Button>
          </Box>

          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Select
              value={role}
              onChange={(_, v) => v && setRole(v)}
              sx={{ minWidth: 130 }}
            >
              <Option value="editor">Can edit</Option>
              <Option value="viewer">Can view</Option>
            </Select>
            <Button
              onClick={onCreate}
              loading={busy}
              startDecorator={<LinkIcon />}
              variant="outlined"
            >
              Create link
            </Button>
          </Box>

          {error && (
            <Typography color="danger" level="body-sm">
              {error}
            </Typography>
          )}

          <Divider />
          <Typography level="title-sm">Active links</Typography>
          {shares === null && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
              <CircularProgress size="sm" />
            </Box>
          )}
          {shares?.length === 0 && (
            <Typography level="body-sm" sx={{ opacity: 0.6 }}>
              No links yet.
            </Typography>
          )}
          <List sx={{ "--ListItem-paddingY": "6px" }}>
            {shares?.map((s) => (
              <ListItem
                key={s.token}
                endAction={
                  <Box sx={{ display: "flex", gap: 0.5 }}>
                    <IconButton
                      size="sm"
                      variant="plain"
                      aria-label="Copy link"
                      color={copied === s.token ? "success" : "neutral"}
                      onClick={() => copy(s.token)}
                    >
                      <ContentCopyIcon />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="danger"
                      aria-label="Revoke"
                      onClick={() => onRevoke(s.token)}
                    >
                      <DeleteOutlineIcon />
                    </IconButton>
                  </Box>
                }
              >
                <Chip
                  size="sm"
                  variant="soft"
                  color={s.role === "editor" ? "primary" : "neutral"}
                >
                  {s.role === "editor" ? "Editor" : "Viewer"}
                </Chip>
                {s.audience ? (
                  <Typography level="body-sm" sx={{ flex: 1, ml: 1 }} noWrap>
                    Invited: <strong>{s.audience}</strong>
                  </Typography>
                ) : (
                  <Input
                    readOnly
                    size="sm"
                    value={shareUrl(s.token)}
                    sx={{ flex: 1, ml: 1 }}
                  />
                )}
              </ListItem>
            ))}
          </List>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
