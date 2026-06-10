import { useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Button,
  Input,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Divider,
  Sheet,
  CircularProgress,
} from "@mui/joy";
import PhotoAlbumIcon from "@mui/icons-material/PhotoAlbum";
import AddIcon from "@mui/icons-material/Add";
import type { Photo, Album } from "./types";

/** AddToAlbumDialog lets the user add the given photos to an existing album or
 *  create a new one. Mirrors Google Photos' "Add to album" picker. */
export function AddToAlbumDialog({
  photoIds,
  albums,
  onClose,
  onAddExisting,
  onCreateNew,
}: {
  photoIds: string[];
  albums: Album[];
  onClose: () => void;
  onAddExisting: (albumId: string) => Promise<void>;
  onCreateNew: (title: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(albumId: string) {
    setBusy(true);
    try {
      await onAddExisting(albumId);
      onClose();
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onCreateNew(title.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 420 },
          maxWidth: "100vw",
          borderRadius: { xs: 0, sm: "md" },
        }}
      >
        <ModalClose />
        <Typography level="h4">
          Add {photoIds.length} {photoIds.length === 1 ? "photo" : "photos"} to
          album
        </Typography>
        {!creating ? (
          <>
            <Button
              variant="soft"
              startDecorator={<AddIcon />}
              sx={{ mt: 1.5, justifyContent: "flex-start" }}
              onClick={() => setCreating(true)}
            >
              New album
            </Button>
            <Divider sx={{ my: 1 }} />
            {albums.length === 0 ? (
              <Typography level="body-sm" sx={{ opacity: 0.7, py: 1 }}>
                No albums yet.
              </Typography>
            ) : (
              <List size="sm" sx={{ maxHeight: 320, overflow: "auto" }}>
                {albums.map((a) => (
                  <ListItem key={a.id}>
                    <ListItemButton disabled={busy} onClick={() => add(a.id)}>
                      <ListItemDecorator>
                        <PhotoAlbumIcon />
                      </ListItemDecorator>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography level="body-sm" noWrap>
                          {a.title || "Untitled album"}
                        </Typography>
                        <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                          {a.photo_count} item{a.photo_count === 1 ? "" : "s"}
                        </Typography>
                      </Box>
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </>
        ) : (
          <Box sx={{ mt: 1.5 }}>
            <Input
              autoFocus
              placeholder="Album title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
            />
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 1,
                mt: 2,
              }}
            >
              <Button
                variant="plain"
                color="neutral"
                onClick={() => setCreating(false)}
              >
                Back
              </Button>
              <Button loading={busy} disabled={!title.trim()} onClick={create}>
                Create
              </Button>
            </Box>
          </Box>
        )}
      </ModalDialog>
    </Modal>
  );
}

/** InfoDialog shows photo metadata, mirroring the "Get info" panel. */
export function InfoDialog({
  photo,
  onClose,
  onSaveDescription,
}: {
  photo: Photo;
  onClose: () => void;
  onSaveDescription: (id: string, description: string) => Promise<void>;
}) {
  const [desc, setDesc] = useState(photo.description);
  const [busy, setBusy] = useState(false);
  const dt = photo.created_at ? new Date(photo.created_at) : null;

  async function save() {
    if (desc === photo.description) return;
    setBusy(true);
    try {
      await onSaveDescription(photo.id, desc);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 380 },
          maxWidth: "100vw",
          borderRadius: { xs: 0, sm: "md" },
        }}
      >
        <ModalClose />
        <Typography level="h4">Info</Typography>
        <Input
          placeholder="Add a description"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={save}
          endDecorator={busy ? <CircularProgress size="sm" /> : null}
          sx={{ mt: 1.5 }}
        />
        <Sheet variant="soft" sx={{ p: 1.5, mt: 1.5, borderRadius: "sm" }}>
          <Row label="Name" value={photo.filename || "—"} />
          {photo.width > 0 && photo.height > 0 && (
            <Row
              label="Dimensions"
              value={`${photo.width} × ${photo.height}`}
            />
          )}
          <Row label="Size" value={formatBytes(photo.size)} />
          <Row label="Type" value={photo.content_type || "—"} />
          {dt && <Row label="Added" value={dt.toLocaleString()} />}
        </Sheet>
      </ModalDialog>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "space-between",
        gap: 2,
        py: 0.25,
      }}
    >
      <Typography level="body-sm" sx={{ opacity: 0.6 }}>
        {label}
      </Typography>
      <Typography
        level="body-sm"
        sx={{ textAlign: "right", wordBreak: "break-word" }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function formatBytes(n: number): string {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n,
    i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
