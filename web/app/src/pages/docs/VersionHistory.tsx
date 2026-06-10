import { useEffect, useState, useCallback } from "react";
import {
  Sheet,
  Box,
  Typography,
  IconButton,
  List,
  ListItemButton,
  ListItemContent,
  Button,
  CircularProgress,
  Divider,
  Chip,
  Tooltip,
} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import HistoryIcon from "@mui/icons-material/History";
import RestoreIcon from "@mui/icons-material/Restore";
import type { Editor } from "@tiptap/react";
import {
  listVersions,
  getVersion,
  restoreVersion,
  type DocVersion,
} from "./api";

interface VersionHistoryProps {
  docId: string;
  editor: Editor | null;
  onClose: () => void;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** VersionHistory is the File → Version history sidebar: it lists saved
 *  versions, previews a selected version's content, and restores it into the
 *  live document. */
export function VersionHistory({
  docId,
  editor,
  onClose,
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<DocVersion | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError("");
    setVersions(null);
    listVersions(docId)
      .then(setVersions)
      .catch(() => setError("Could not load version history."));
  }, [docId]);

  useEffect(() => {
    load();
  }, [load]);

  async function selectVersion(v: DocVersion) {
    setSelected(v);
    setPreview(null);
    try {
      const full = await getVersion(docId, v.id);
      setPreview(full.content_html);
    } catch {
      setPreview("");
      setError("Could not load this version.");
    }
  }

  async function doRestore() {
    if (!selected || !editor) return;
    setBusy(true);
    setError("");
    try {
      const restored = await restoreVersion(docId, selected.id);
      // Load the restored content into the live document so collaborators see it.
      editor.commands.setContent(restored.content_html || preview || "");
      setSelected(null);
      setPreview(null);
      load();
    } catch {
      setError("Restore failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      variant="outlined"
      sx={{
        width: 320,
        flexShrink: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderTop: 0,
        borderBottom: 0,
        borderRight: 0,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.5 }}>
        <HistoryIcon />
        <Typography level="title-md" sx={{ flex: 1 }}>
          Version history
        </Typography>
        <IconButton
          size="sm"
          variant="plain"
          aria-label="Close version history"
          onClick={onClose}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider />

      {selected ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          <Box sx={{ p: 1.5 }}>
            <Button
              size="sm"
              variant="plain"
              onClick={() => {
                setSelected(null);
                setPreview(null);
              }}
            >
              ← Back to all versions
            </Button>
            <Typography level="body-sm" sx={{ mt: 0.5 }}>
              {selected.label || fmtTime(selected.created_at)}
            </Typography>
            <Typography level="body-xs" sx={{ opacity: 0.7 }}>
              {selected.author_name} · {fmtTime(selected.created_at)}
            </Typography>
          </Box>
          <Divider />
          <Box
            sx={{
              flex: 1,
              overflow: "auto",
              p: 1.5,
              bgcolor: "#fff",
              color: "#202124",
            }}
          >
            {preview === null ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress size="sm" />
              </Box>
            ) : preview === "" ? (
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                This version is empty.
              </Typography>
            ) : (
              <Box
                sx={{ fontSize: 14, "& *": { maxWidth: "100%" } }}
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            )}
          </Box>
          <Divider />
          <Box sx={{ p: 1.5 }}>
            {error && (
              <Typography level="body-xs" color="danger" sx={{ mb: 1 }}>
                {error}
              </Typography>
            )}
            <Button
              fullWidth
              startDecorator={<RestoreIcon />}
              loading={busy}
              disabled={!editor || preview === null}
              onClick={doRestore}
            >
              Restore this version
            </Button>
          </Box>
        </Box>
      ) : (
        <Box sx={{ flex: 1, overflow: "auto" }}>
          {error && (
            <Box sx={{ p: 2 }}>
              <Typography level="body-sm" color="danger">
                {error}
              </Typography>
              <Button size="sm" variant="soft" sx={{ mt: 1 }} onClick={load}>
                Retry
              </Button>
            </Box>
          )}
          {!error && versions === null && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size="sm" />
            </Box>
          )}
          {!error && versions !== null && versions.length === 0 && (
            <Typography level="body-sm" sx={{ p: 2, opacity: 0.6 }}>
              No saved versions yet. Versions are saved automatically as you
              edit, or use “Name current version”.
            </Typography>
          )}
          {versions && versions.length > 0 && (
            <List sx={{ "--ListItem-radius": "8px", p: 1 }}>
              {versions.map((v) => (
                <ListItemButton key={v.id} onClick={() => selectVersion(v)}>
                  <ListItemContent>
                    <Typography
                      level="body-sm"
                      sx={{ fontWeight: v.label ? 600 : 400 }}
                    >
                      {v.label || fmtTime(v.created_at)}
                    </Typography>
                    <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                      {v.author_name}
                      {v.label ? ` · ${fmtTime(v.created_at)}` : ""}
                    </Typography>
                  </ListItemContent>
                  {v.is_auto && (
                    <Tooltip title="Automatic snapshot">
                      <Chip size="sm" variant="soft" color="neutral">
                        auto
                      </Chip>
                    </Tooltip>
                  )}
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      )}
    </Sheet>
  );
}
