import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  ModalDialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  List,
  ListItem,
  CircularProgress,
  Chip,
  IconButton,
  Tooltip,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import {
  listFileVersions,
  restoreFileVersion,
  versionDownloadURL,
} from "./api";
import type { DriveFile, DriveFileVersion } from "./types";

interface VersionsDialogProps {
  file: DriveFile;
  onClose: () => void;
  /** Called after a restore so the caller can refresh the file list. */
  onRestored: () => void;
}

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(unixSecondsStr: string): string {
  const ts = Number(unixSecondsStr);
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

/**
 * "Manage versions" dialog. Lists all historical snapshots of a file's content
 * with options to download or restore each version. Mirrors Google Drive's
 * "Manage versions" panel.
 */
export function VersionsDialog({
  file,
  onClose,
  onRestored,
}: VersionsDialogProps) {
  const [versions, setVersions] = useState<DriveFileVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVersions(await listFileVersions(file.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [file.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRestore = useCallback(
    async (v: DriveFileVersion) => {
      if (
        !confirm(
          `Restore this version? The current content will be saved as a new version.`,
        )
      )
        return;
      setRestoringId(v.id);
      try {
        await restoreFileVersion(file.id, v.id);
        onRestored();
        onClose();
      } catch (e) {
        alert("Restore failed: " + (e as Error).message);
      } finally {
        setRestoringId(null);
      }
    },
    [file.id, onClose, onRestored],
  );

  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{ width: 560, maxWidth: "95vw" }}
        data-testid="versions-dialog"
      >
        <DialogTitle>
          <Icons.History />
          Manage versions — &ldquo;{file.name}&rdquo;
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Typography level="body-xs" sx={{ px: 0.5, pb: 1, opacity: 0.6 }}>
            Older versions are stored indefinitely. Restoring makes a version
            current and saves the previous content as a new version entry.
          </Typography>

          <Box
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: "sm",
              minHeight: 120,
              maxHeight: 400,
              overflow: "auto",
            }}
          >
            {loading ? (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  height: 120,
                }}
              >
                <CircularProgress size="sm" />
              </Box>
            ) : error ? (
              <Box sx={{ p: 2 }}>
                <Typography color="danger" level="body-sm">
                  {error}
                </Typography>
                <Button
                  size="sm"
                  variant="soft"
                  sx={{ mt: 1 }}
                  onClick={() => void load()}
                >
                  Retry
                </Button>
              </Box>
            ) : versions.length === 0 ? (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <Icons.HistoryToggleOff sx={{ fontSize: 36, opacity: 0.4 }} />
                <Typography level="body-sm" sx={{ opacity: 0.7, mt: 0.5 }}>
                  No previous versions — this is the original upload.
                </Typography>
              </Box>
            ) : (
              <List size="sm" sx={{ "--List-padding": "0" }}>
                {versions.map((v, i) => (
                  <ListItem
                    key={v.id}
                    sx={{
                      borderBottom:
                        i < versions.length - 1 ? "1px solid" : "none",
                      borderColor: "divider",
                      py: 1,
                      px: 1.5,
                      alignItems: "flex-start",
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          flexWrap: "wrap",
                        }}
                      >
                        <Typography level="body-sm" sx={{ fontWeight: 500 }}>
                          {formatDate(v.created_at)}
                        </Typography>
                        <Chip size="sm" variant="soft" color="neutral">
                          {formatBytes(Number(v.size_bytes))}
                        </Chip>
                        <Chip
                          size="sm"
                          variant="outlined"
                          color="neutral"
                          sx={{ fontFamily: "monospace", fontSize: "0.65rem" }}
                        >
                          {v.content_type || "—"}
                        </Chip>
                      </Box>
                    </Box>
                    <Box
                      sx={{ display: "flex", gap: 0.5, flexShrink: 0, ml: 1 }}
                    >
                      <Tooltip title="Download this version">
                        <IconButton
                          size="sm"
                          variant="plain"
                          color="neutral"
                          component="a"
                          href={versionDownloadURL(file.id, v.id)}
                          target="_blank"
                          rel="noopener"
                          aria-label="Download version"
                          data-testid={`version-download-${v.id}`}
                        >
                          <Icons.Download fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Restore this version">
                        <IconButton
                          size="sm"
                          variant="plain"
                          color="primary"
                          onClick={() => void handleRestore(v)}
                          loading={restoringId === v.id}
                          aria-label="Restore version"
                          data-testid={`version-restore-${v.id}`}
                        >
                          <Icons.RestoreFromTrash fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="plain" color="neutral" onClick={onClose}>
            Close
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
