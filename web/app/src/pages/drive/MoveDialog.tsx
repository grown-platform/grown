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
  ListItemButton,
  CircularProgress,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import { listFiles } from "./api";
import type { DriveFile } from "./types";
import { isFolder } from "./types";

interface MoveDialogProps {
  /** The file being moved. Used to exclude it (and prevent moving a folder into itself). */
  file: DriveFile;
  /** Called with the chosen destination folder id ("" = My Drive root). */
  onMove: (destParent: string) => void;
  onClose: () => void;
}

interface Crumb {
  id: string; // "" = root
  name: string;
}

/**
 * Folder picker for "Move to". Navigates the folder tree (folders only) and
 * lets the user pick a destination. Mirrors Google Drive's move dialog: a
 * breadcrumb header, a folder list, and a "Move here" action targeting the
 * currently-open folder.
 */
export function MoveDialog({ file, onMove, onClose }: MoveDialogProps) {
  // Breadcrumb stack — last entry is the currently-open folder.
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: "", name: "My Drive" }]);
  const [folders, setFolders] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const current = crumbs[crumbs.length - 1];
  // Source's current parent ("" = root). Moving into the same folder is a no-op.
  const sourceParent = file.parent_id || "";

  const loadFolders = useCallback(
    async (parentId: string) => {
      setLoading(true);
      setError(null);
      try {
        const all = await listFiles(parentId);
        // Only folders are valid destinations; never list the item being moved
        // (you can't move a folder into itself).
        setFolders(all.filter((f) => isFolder(f) && f.id !== file.id));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [file.id],
  );

  useEffect(() => {
    void loadFolders(current.id);
  }, [current.id, loadFolders]);

  const enterFolder = (f: DriveFile) => {
    setCrumbs((c) => [...c, { id: f.id, name: f.name }]);
  };

  const goToCrumb = (index: number) => {
    setCrumbs((c) => c.slice(0, index + 1));
  };

  const handleMove = async () => {
    setMoving(true);
    try {
      onMove(current.id);
    } finally {
      setMoving(false);
    }
  };

  const sameAsSource = current.id === sourceParent;

  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{ width: 460, maxWidth: "90vw" }}
        data-testid="move-dialog"
      >
        <DialogTitle>
          <Icons.DriveFileMove />
          Move &ldquo;{file.name}&rdquo;
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {/* Breadcrumb */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 0.5,
              mb: 1,
              px: 0.5,
            }}
          >
            {crumbs.map((c, i) => (
              <Box
                key={c.id || "root"}
                sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
              >
                {i > 0 && (
                  <Icons.ChevronRight fontSize="small" sx={{ opacity: 0.5 }} />
                )}
                <Button
                  variant="plain"
                  size="sm"
                  color="neutral"
                  disabled={i === crumbs.length - 1}
                  onClick={() => goToCrumb(i)}
                  sx={{
                    minHeight: 0,
                    py: 0.25,
                    px: 0.75,
                    fontWeight: i === crumbs.length - 1 ? 600 : 400,
                  }}
                >
                  {c.name}
                </Button>
              </Box>
            ))}
          </Box>

          <Box
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: "sm",
              minHeight: 200,
              maxHeight: 320,
              overflow: "auto",
            }}
          >
            {loading ? (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  height: 200,
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
                  onClick={() => void loadFolders(current.id)}
                >
                  Retry
                </Button>
              </Box>
            ) : folders.length === 0 ? (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <Icons.FolderOff sx={{ fontSize: 36, opacity: 0.4 }} />
                <Typography level="body-sm" sx={{ opacity: 0.7, mt: 0.5 }}>
                  No subfolders here
                </Typography>
              </Box>
            ) : (
              <List size="sm">
                {folders.map((f) => (
                  <ListItem key={f.id}>
                    <ListItemButton
                      onClick={() => enterFolder(f)}
                      data-testid={`move-folder-${f.id}`}
                    >
                      <Icons.Folder color="primary" fontSize="small" />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          level="body-sm"
                          sx={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {f.name}
                        </Typography>
                      </Box>
                      <Icons.ChevronRight
                        fontSize="small"
                        sx={{ opacity: 0.5 }}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleMove}
            loading={moving}
            disabled={sameAsSource}
            startDecorator={<Icons.DriveFileMove />}
            data-testid="move-confirm"
          >
            {sameAsSource ? "Already here" : `Move to ${current.name}`}
          </Button>
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
