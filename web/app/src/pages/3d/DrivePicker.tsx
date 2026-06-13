/**
 * DrivePicker — a modal that browses the user's Drive folders and lets them
 * pick a 3D model file. Folders are navigable; non-model files are hidden so
 * only candidate models (and their companion assets) are shown.
 *
 * Reuses the Drive listing API (listFiles) and download URL (downloadURL) from
 * the Drive app, with the same-origin/credentials fetch convention.
 */
import { useEffect, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Breadcrumbs,
  Link,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  ListItemContent,
  Chip,
} from "@mui/joy";
import FolderIcon from "@mui/icons-material/Folder";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import { listFiles } from "../drive/api";
import { isFolder, type DriveFile } from "../drive/types";
import { isModelFile, isRenderable } from "./formats";

interface Crumb {
  id: string;
  name: string;
}

export interface DrivePickerProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen model file when the user selects one. */
  onPick: (file: DriveFile) => void;
}

export function DrivePicker({ open, onClose, onPick }: DrivePickerProps) {
  // Breadcrumb trail; the last entry is the folder we're currently listing.
  // The root is represented by an empty-string id.
  const [trail, setTrail] = useState<Crumb[]>([{ id: "", name: "My Drive" }]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentParent = trail[trail.length - 1].id;

  // Reset to root each time the picker is opened.
  useEffect(() => {
    if (open) setTrail([{ id: "", name: "My Drive" }]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    listFiles(currentParent)
      .then((f) => {
        if (alive) setFiles(f);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, currentParent]);

  function enterFolder(f: DriveFile) {
    setTrail((t) => [...t, { id: f.id, name: f.name }]);
  }

  function jumpTo(index: number) {
    setTrail((t) => t.slice(0, index + 1));
  }

  // Show folders + model files only; sort folders first, then by name.
  const visible = files
    .filter((f) => isFolder(f) || isModelFile(f.name))
    .sort((a, b) => {
      const fa = isFolder(a) ? 0 : 1;
      const fb = isFolder(b) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return a.name.localeCompare(b.name);
    });

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ width: 560, maxWidth: "95vw", maxHeight: "85vh" }}>
        <ModalClose />
        <Typography level="title-lg" sx={{ mb: 0.5 }}>
          Open a 3D model from Drive
        </Typography>
        <Breadcrumbs size="sm" sx={{ px: 0, mb: 1 }}>
          {trail.map((c, i) =>
            i === trail.length - 1 ? (
              <Typography key={c.id || "root"} level="body-sm">
                {c.name}
              </Typography>
            ) : (
              <Link
                key={c.id || "root"}
                level="body-sm"
                onClick={() => jumpTo(i)}
              >
                {c.name}
              </Link>
            ),
          )}
        </Breadcrumbs>

        <Box sx={{ overflow: "auto", flex: 1 }}>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : error ? (
            <Typography color="danger" level="body-sm" sx={{ py: 2 }}>
              {error}
            </Typography>
          ) : visible.length === 0 ? (
            <Typography level="body-sm" sx={{ opacity: 0.6, py: 4 }}>
              No 3D models or folders here. Supported model types include glb,
              gltf, obj, stl, and ply.
            </Typography>
          ) : (
            <List size="sm">
              {visible.map((f) => {
                const folder = isFolder(f);
                const renderable = !folder && isRenderable(f.name);
                return (
                  <ListItem key={f.id}>
                    <ListItemButton
                      onClick={() =>
                        folder ? enterFolder(f) : onPick(f)
                      }
                    >
                      <ListItemDecorator>
                        {folder ? (
                          <FolderIcon sx={{ color: "primary.400" }} />
                        ) : (
                          <ViewInArIcon sx={{ opacity: 0.7 }} />
                        )}
                      </ListItemDecorator>
                      <ListItemContent>
                        <Typography level="body-sm" noWrap>
                          {f.name}
                        </Typography>
                      </ListItemContent>
                      {!folder && !renderable && (
                        <Chip size="sm" variant="soft" color="neutral">
                          preview soon
                        </Chip>
                      )}
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
        </Box>
      </ModalDialog>
    </Modal>
  );
}
