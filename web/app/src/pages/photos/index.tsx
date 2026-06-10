import { useEffect, useRef, useState, useCallback } from "react";
import {
  Box,
  Container,
  Typography,
  Sheet,
  IconButton,
  CircularProgress,
  Button,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Divider,
  LinearProgress,
  Drawer,
  ModalClose,
} from "@mui/joy";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import PhotoAlbumIcon from "@mui/icons-material/PhotoAlbum";
import MenuIcon from "@mui/icons-material/Menu";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import LibraryAddIcon from "@mui/icons-material/LibraryAdd";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import type { Photo, Album } from "./types";
import {
  listPhotos,
  deletePhoto,
  updatePhoto,
  photoURL,
  downloadURL,
  listAlbums,
  getAlbum,
  createAlbum,
  deleteAlbum,
  addToAlbum,
  removeFromAlbum,
  uploadPhotos,
} from "./api";
import { Lightbox } from "./Lightbox";
import { AddToAlbumDialog, InfoDialog } from "./dialogs";
import { PhotoEditor } from "./PhotoEditor";

type View =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "albums" }
  | { kind: "album"; albumId: string };

interface ContextMenuState {
  x: number;
  y: number;
  photo: Photo;
}

interface PhotosAppProps {
  user: User;
}

export default function PhotosApp({ user }: PhotosAppProps) {
  const [view, setView] = useState<View>({ kind: "all" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [currentAlbum, setCurrentAlbum] = useState<Album | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [addToAlbumFor, setAddToAlbumFor] = useState<string[] | null>(null);
  const [infoFor, setInfoFor] = useState<Photo | null>(null);
  const [editFor, setEditFor] = useState<Photo | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const inAlbumView = view.kind === "album";

  const reloadAlbums = useCallback(async () => {
    try {
      setAlbums(await listAlbums());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const reloadPhotos = useCallback(async () => {
    try {
      if (view.kind === "album") {
        const a = await getAlbum(view.albumId);
        setCurrentAlbum(a);
        setPhotos(a.photos ?? []);
      } else {
        setCurrentAlbum(null);
        setPhotos(await listPhotos({ favorites: view.kind === "favorites" }));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [view]);

  useEffect(() => {
    reloadAlbums();
  }, [reloadAlbums]);
  useEffect(() => {
    setPhotos(null);
    setSelected(new Set());
    if (view.kind === "albums") {
      reloadAlbums();
      return;
    }
    reloadPhotos();
  }, [view, reloadPhotos, reloadAlbums]);

  // ---- selection ----
  const isSel = (id: string) => selected.has(id);
  function toggleSel(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function clearSel() {
    setSelected(new Set());
  }
  const selectedPhotos = (photos ?? []).filter((p) => selected.has(p.id));

  // ---- upload ----
  async function doUpload(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setUploading(true);
    setError(null);
    try {
      const created = await uploadPhotos(list);
      // If we're inside an album, add the new photos to it.
      if (view.kind === "album" && created.length) {
        await addToAlbum(
          view.albumId,
          created.map((p) => p.id),
        );
      }
      await reloadPhotos();
      if (view.kind !== "album") reloadAlbums();
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }
  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) doUpload(e.target.files);
    e.target.value = "";
  }

  // ---- drag & drop ----
  const [dragOver, setDragOver] = useState(false);
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) doUpload(e.dataTransfer.files);
  }

  // ---- photo ops ----
  async function toggleFavorite(p: Photo) {
    setPhotos((cur) =>
      (cur ?? []).map((x) =>
        x.id === p.id ? { ...x, favorite: !x.favorite } : x,
      ),
    );
    try {
      await updatePhoto(p.id, {
        description: p.description,
        favorite: !p.favorite,
      });
    } catch {
      reloadPhotos();
    }
  }
  async function removePhotos(ps: Photo[]) {
    if (!ps.length) return;
    if (
      !window.confirm(
        `Delete ${ps.length} ${ps.length === 1 ? "photo" : "photos"}? This can't be undone.`,
      )
    )
      return;
    const ids = new Set(ps.map((p) => p.id));
    setPhotos((cur) => (cur ?? []).filter((p) => !ids.has(p.id)));
    clearSel();
    setLightboxIndex(null);
    await Promise.all(ps.map((p) => deletePhoto(p.id).catch(() => {})));
    reloadAlbums();
    if (view.kind === "album") reloadPhotos();
  }
  async function removeFromCurrentAlbum(ps: Photo[]) {
    if (view.kind !== "album" || !ps.length) return;
    const ids = new Set(ps.map((p) => p.id));
    setPhotos((cur) => (cur ?? []).filter((p) => !ids.has(p.id)));
    clearSel();
    await Promise.all(
      ps.map((p) => removeFromAlbum(view.albumId, p.id).catch(() => {})),
    );
    reloadPhotos();
    reloadAlbums();
  }
  async function saveDescription(id: string, description: string) {
    const p = (photos ?? []).find((x) => x.id === id);
    await updatePhoto(id, { description, favorite: p?.favorite ?? false });
    setPhotos((cur) =>
      (cur ?? []).map((x) => (x.id === id ? { ...x, description } : x)),
    );
    setInfoFor((cur) => (cur && cur.id === id ? { ...cur, description } : cur));
  }

  // ---- album ops ----
  async function onAddExisting(albumId: string, photoIds: string[]) {
    await addToAlbum(albumId, photoIds);
    clearSel();
    reloadAlbums();
  }
  async function onCreateNewAlbum(title: string, photoIds: string[]) {
    await createAlbum(title, photoIds);
    clearSel();
    reloadAlbums();
  }
  async function removeAlbum(a: Album) {
    if (
      !window.confirm(
        `Delete album "${a.title || "Untitled album"}"? Photos are kept.`,
      )
    )
      return;
    setAlbums((cur) => (cur ?? []).filter((x) => x.id !== a.id));
    await deleteAlbum(a.id).catch(() => reloadAlbums());
    if (view.kind === "album" && view.albumId === a.id)
      setView({ kind: "albums" });
  }

  // ---- right-click context menu (per photos.md) ----
  function onPhotoContextMenu(e: React.MouseEvent, p: Photo) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, photo: p });
  }
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [ctxMenu]);

  const title = inAlbumView ? currentAlbum?.title || "Album" : viewTitle(view);

  return (
    <Box
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
      sx={{ minHeight: "100vh", position: "relative" }}
    >
      <Header user={user} />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onPickFiles}
        aria-hidden
      />

      <Container
        maxWidth="xl"
        sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1.5, sm: 3 } }}
      >
        {/* Header row */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          {/* Mobile hamburger — only when sidebar is hidden */}
          <IconButton
            variant="plain"
            sx={{ display: { xs: inAlbumView ? "none" : "flex", md: "none" } }}
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          {inAlbumView && (
            <IconButton
              variant="plain"
              onClick={() => setView({ kind: "albums" })}
              aria-label="Back to albums"
            >
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography
            level="h2"
            sx={{ flex: 1, fontSize: { xs: "xl", sm: "xl3" } }}
          >
            {title}
          </Typography>
          <Button
            variant="solid"
            color="primary"
            startDecorator={<AddPhotoAlternateIcon />}
            loading={uploading}
            onClick={() => fileInput.current?.click()}
            data-testid="upload-photos"
            size="sm"
          >
            Upload
          </Button>
          {!inAlbumView && (
            <Dropdown>
              <MenuButton
                slots={{ root: IconButton }}
                slotProps={{
                  root: {
                    variant: "plain",
                    color: "neutral",
                    "aria-label": "Create menu",
                  },
                }}
              >
                <AddIcon />
              </MenuButton>
              <Menu placement="bottom-end">
                <MenuItem onClick={() => fileInput.current?.click()}>
                  Import photos
                </MenuItem>
                <MenuItem onClick={() => setAddToAlbumFor([])}>Album</MenuItem>
                <ListDivider />
                <MenuItem disabled>Collage</MenuItem>
                <MenuItem disabled>Highlight video</MenuItem>
                <MenuItem disabled>Animation</MenuItem>
                <MenuItem disabled>Share with a partner</MenuItem>
              </Menu>
            </Dropdown>
          )}
        </Box>

        {/* Mobile sidebar drawer */}
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          anchor="left"
          size="sm"
        >
          <ModalClose />
          <Typography level="title-lg" sx={{ p: 2, pb: 1 }}>
            Photos
          </Typography>
          <List size="sm" sx={{ "--ListItem-radius": "8px", px: 1 }}>
            <ListItem>
              <ListItemButton
                selected={view.kind === "all"}
                onClick={() => {
                  setView({ kind: "all" });
                  setDrawerOpen(false);
                }}
              >
                <ListItemDecorator>
                  <PhotoLibraryIcon />
                </ListItemDecorator>
                Photos
              </ListItemButton>
            </ListItem>
            <ListItem>
              <ListItemButton
                selected={view.kind === "favorites"}
                onClick={() => {
                  setView({ kind: "favorites" });
                  setDrawerOpen(false);
                }}
              >
                <ListItemDecorator>
                  <StarIcon />
                </ListItemDecorator>
                Favorites
              </ListItemButton>
            </ListItem>
            <ListItem>
              <ListItemButton
                selected={view.kind === "albums" || view.kind === "album"}
                onClick={() => {
                  setView({ kind: "albums" });
                  setDrawerOpen(false);
                }}
              >
                <ListItemDecorator>
                  <PhotoAlbumIcon />
                </ListItemDecorator>
                Albums
              </ListItemButton>
            </ListItem>
          </List>
        </Drawer>

        <Box sx={{ display: "flex", gap: 3 }}>
          {/* Sidebar — desktop only */}
          <Box
            sx={{
              width: 200,
              flexShrink: 0,
              display: { xs: "none", md: "block" },
            }}
          >
            <List size="sm" sx={{ "--ListItem-radius": "8px" }}>
              <ListItem>
                <ListItemButton
                  selected={view.kind === "all"}
                  onClick={() => setView({ kind: "all" })}
                >
                  <ListItemDecorator>
                    <PhotoLibraryIcon />
                  </ListItemDecorator>
                  Photos
                </ListItemButton>
              </ListItem>
              <ListItem>
                <ListItemButton
                  selected={view.kind === "favorites"}
                  onClick={() => setView({ kind: "favorites" })}
                >
                  <ListItemDecorator>
                    <StarIcon />
                  </ListItemDecorator>
                  Favorites
                </ListItemButton>
              </ListItem>
              <ListItem>
                <ListItemButton
                  selected={view.kind === "albums" || view.kind === "album"}
                  onClick={() => setView({ kind: "albums" })}
                >
                  <ListItemDecorator>
                    <PhotoAlbumIcon />
                  </ListItemDecorator>
                  Albums
                </ListItemButton>
              </ListItem>
            </List>
          </Box>

          {/* Main */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Selection toolbar */}
            {selected.size > 0 && (
              <Sheet
                variant="soft"
                color="primary"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  mb: 1.5,
                  borderRadius: "md",
                }}
              >
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={clearSel}
                  aria-label="Clear selection"
                >
                  <CloseIcon />
                </IconButton>
                <Typography level="body-sm" sx={{ flex: 1, minWidth: 60 }}>
                  {selected.size} selected
                </Typography>
                <Button
                  size="sm"
                  variant="plain"
                  startDecorator={<LibraryAddIcon />}
                  onClick={() => setAddToAlbumFor([...selected])}
                >
                  Add to album
                </Button>
                {inAlbumView && (
                  <Button
                    size="sm"
                    variant="plain"
                    onClick={() => removeFromCurrentAlbum(selectedPhotos)}
                  >
                    Remove
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="plain"
                  color="danger"
                  startDecorator={<DeleteOutlineIcon />}
                  onClick={() => removePhotos(selectedPhotos)}
                >
                  Delete
                </Button>
              </Sheet>
            )}

            {error && (
              <Sheet
                color="danger"
                variant="soft"
                sx={{ p: 2, mb: 2, borderRadius: "md" }}
              >
                <Typography color="danger">{error}</Typography>
              </Sheet>
            )}

            {/* Albums grid */}
            {view.kind === "albums" ? (
              <AlbumsGrid
                albums={albums}
                onOpen={(a) => setView({ kind: "album", albumId: a.id })}
                onCreate={() => setAddToAlbumFor([])}
                onDelete={removeAlbum}
              />
            ) : (
              <>
                {photos === null && !error && (
                  <Box
                    sx={{ display: "flex", justifyContent: "center", py: 8 }}
                  >
                    <CircularProgress />
                  </Box>
                )}
                {photos !== null && photos.length === 0 && (
                  <EmptyState
                    inAlbum={inAlbumView}
                    favorites={view.kind === "favorites"}
                    onUpload={() => fileInput.current?.click()}
                  />
                )}
                {photos !== null && photos.length > 0 && (
                  <PhotoGrid
                    photos={photos}
                    isSel={isSel}
                    anySelected={selected.size > 0}
                    onToggleSel={toggleSel}
                    onOpen={(i) => setLightboxIndex(i)}
                    onToggleFavorite={toggleFavorite}
                    onContextMenu={onPhotoContextMenu}
                  />
                )}
              </>
            )}
          </Box>
        </Box>
      </Container>

      {uploading && (
        <LinearProgress
          sx={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1400 }}
        />
      )}

      {/* Drag overlay */}
      {dragOver && (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: 1350,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "rgba(61,90,128,0.16)",
            border: "3px dashed",
            borderColor: "primary.solidBg",
            pointerEvents: "none",
          }}
        >
          <Sheet
            variant="solid"
            color="primary"
            sx={{ px: 4, py: 2, borderRadius: "lg" }}
          >
            <Typography level="h4" sx={{ color: "#fff" }}>
              Drop photos to upload
            </Typography>
          </Sheet>
        </Box>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && photos && photos[lightboxIndex] && (
        <Lightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          onToggleFavorite={toggleFavorite}
          onDelete={(p) => removePhotos([p])}
          onAddToAlbum={(p) => setAddToAlbumFor([p.id])}
          onInfo={(p) => setInfoFor(p)}
          onEdit={(p) => {
            setEditFor(p);
            setLightboxIndex(null);
          }}
        />
      )}

      {/* Right-click context menu */}
      {ctxMenu && (
        <PhotoContextMenu
          state={ctxMenu}
          inAlbum={inAlbumView}
          onOpen={() => {
            const i = (photos ?? []).findIndex(
              (p) => p.id === ctxMenu.photo.id,
            );
            if (i >= 0) setLightboxIndex(i);
            setCtxMenu(null);
          }}
          onAddToAlbum={() => {
            setAddToAlbumFor([ctxMenu.photo.id]);
            setCtxMenu(null);
          }}
          onToggleFavorite={() => {
            toggleFavorite(ctxMenu.photo);
            setCtxMenu(null);
          }}
          onInfo={() => {
            setInfoFor(ctxMenu.photo);
            setCtxMenu(null);
          }}
          onEdit={() => {
            setEditFor(ctxMenu.photo);
            setCtxMenu(null);
          }}
          onRemoveFromAlbum={() => {
            removeFromCurrentAlbum([ctxMenu.photo]);
            setCtxMenu(null);
          }}
          onDelete={() => {
            removePhotos([ctxMenu.photo]);
            setCtxMenu(null);
          }}
        />
      )}

      {/* Add-to-album / new-album dialog */}
      {addToAlbumFor !== null && (
        <AddToAlbumDialog
          photoIds={addToAlbumFor}
          albums={albums ?? []}
          onClose={() => setAddToAlbumFor(null)}
          onAddExisting={(albumId) => onAddExisting(albumId, addToAlbumFor)}
          onCreateNew={(t) => onCreateNewAlbum(t, addToAlbumFor)}
        />
      )}

      {/* Info dialog */}
      {infoFor && (
        <InfoDialog
          photo={infoFor}
          onClose={() => setInfoFor(null)}
          onSaveDescription={saveDescription}
        />
      )}

      {/* Photo editor */}
      {editFor && (
        <PhotoEditor
          photo={editFor}
          onClose={() => setEditFor(null)}
          onSaved={({ photo: created }) => {
            setEditFor(null);
            // Add the newly created copy to the current view and reload.
            setPhotos((cur) => (cur ? [created, ...cur] : [created]));
            reloadAlbums();
          }}
        />
      )}
    </Box>
  );
}

function viewTitle(v: View): string {
  switch (v.kind) {
    case "favorites":
      return "Favorites";
    case "albums":
      return "Albums";
    default:
      return "Photos";
  }
}

// ---------------------------------------------------------------------------

function PhotoGrid({
  photos,
  isSel,
  anySelected,
  onToggleSel,
  onOpen,
  onToggleFavorite,
  onContextMenu,
}: {
  photos: Photo[];
  isSel: (id: string) => boolean;
  anySelected: boolean;
  onToggleSel: (id: string) => void;
  onOpen: (index: number) => void;
  onToggleFavorite: (p: Photo) => void;
  onContextMenu: (e: React.MouseEvent, p: Photo) => void;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 0.75,
      }}
    >
      {photos.map((p, i) => {
        const selected = isSel(p.id);
        return (
          <Box
            key={p.id}
            data-testid={`photo-${p.id}`}
            onClick={() => (anySelected ? onToggleSel(p.id) : onOpen(i))}
            onContextMenu={(e) => onContextMenu(e, p)}
            sx={{
              position: "relative",
              aspectRatio: "1 / 1",
              borderRadius: "sm",
              overflow: "hidden",
              cursor: "pointer",
              bgcolor: "background.level2",
              outline: selected ? "3px solid" : "none",
              outlineColor: "primary.solidBg",
              outlineOffset: -3,
              "&:hover .photo-overlay": { opacity: 1 },
            }}
          >
            <Box
              component="img"
              src={photoURL(p.id)}
              alt={p.description || p.filename}
              loading="lazy"
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                transform: selected ? "scale(0.86)" : "none",
                transition: "transform 120ms",
              }}
            />
            {/* Top gradient with select + favorite */}
            <Box
              className="photo-overlay"
              onClick={(e) => e.stopPropagation()}
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                p: 0.5,
                opacity: { xs: 1, md: selected ? 1 : 0 },
                transition: "opacity 120ms",
                background:
                  "linear-gradient(to bottom, rgba(0,0,0,0.4), transparent)",
              }}
            >
              <IconButton
                size="sm"
                variant="plain"
                onClick={() => onToggleSel(p.id)}
                aria-label={selected ? "Deselect photo" : "Select photo"}
                sx={{ color: "#fff", "--IconButton-size": "28px" }}
              >
                {selected ? (
                  <CheckCircleIcon sx={{ color: "primary.solidBg" }} />
                ) : (
                  <RadioButtonUncheckedIcon />
                )}
              </IconButton>
              <IconButton
                size="sm"
                variant="plain"
                onClick={() => onToggleFavorite(p)}
                aria-label={p.favorite ? "Unfavorite" : "Favorite"}
                sx={{ color: "#fff", "--IconButton-size": "28px" }}
              >
                {p.favorite ? (
                  <StarIcon sx={{ color: "#f9ab00" }} />
                ) : (
                  <StarBorderIcon />
                )}
              </IconButton>
            </Box>
            {p.favorite && (
              <StarIcon
                sx={{
                  position: "absolute",
                  bottom: 6,
                  right: 6,
                  color: "#f9ab00",
                  fontSize: 18,
                  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))",
                }}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function AlbumsGrid({
  albums,
  onOpen,
  onCreate,
  onDelete,
}: {
  albums: Album[] | null;
  onOpen: (a: Album) => void;
  onCreate: () => void;
  onDelete: (a: Album) => void;
}) {
  if (albums === null) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 2,
      }}
    >
      <Box
        onClick={onCreate}
        data-testid="create-album"
        sx={{
          aspectRatio: "1 / 1",
          borderRadius: "md",
          border: "2px dashed",
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          cursor: "pointer",
          color: "text.tertiary",
          "&:hover": {
            bgcolor: "background.level1",
            borderColor: "primary.solidBg",
          },
        }}
      >
        <AddIcon sx={{ fontSize: 36 }} />
        <Typography level="body-sm">New album</Typography>
      </Box>
      {albums.map((a) => (
        <Box
          key={a.id}
          sx={{
            position: "relative",
            "&:hover .album-actions": { opacity: 1 },
          }}
        >
          <Box
            onClick={() => onOpen(a)}
            data-testid={`album-${a.id}`}
            sx={{ cursor: "pointer" }}
          >
            <Box
              sx={{
                aspectRatio: "1 / 1",
                borderRadius: "md",
                overflow: "hidden",
                bgcolor: "background.level2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {a.cover_url ? (
                <Box
                  component="img"
                  src={photoURL(a.cover_photo_id)}
                  alt={a.title}
                  loading="lazy"
                  sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <PhotoAlbumIcon sx={{ fontSize: 48, opacity: 0.4 }} />
              )}
            </Box>
            <Typography
              level="body-sm"
              sx={{ fontWeight: 500, mt: 0.75 }}
              noWrap
            >
              {a.title || "Untitled album"}
            </Typography>
            <Typography level="body-xs" sx={{ opacity: 0.6 }}>
              {a.photo_count} item{a.photo_count === 1 ? "" : "s"}
            </Typography>
          </Box>
          <Dropdown>
            <MenuButton
              className="album-actions"
              slots={{ root: IconButton }}
              slotProps={{
                root: {
                  size: "sm",
                  variant: "soft",
                  "aria-label": `Options for ${a.title || "album"}`,
                  sx: {
                    position: "absolute",
                    top: 6,
                    right: 6,
                    opacity: { xs: 1, md: 0 },
                    transition: "opacity 120ms",
                  },
                },
              }}
            >
              <MoreVertIcon />
            </MenuButton>
            <Menu size="sm" placement="bottom-end">
              <MenuItem onClick={() => onOpen(a)}>Open album</MenuItem>
              <ListDivider />
              <MenuItem color="danger" onClick={() => onDelete(a)}>
                Delete album
              </MenuItem>
            </Menu>
          </Dropdown>
        </Box>
      ))}
    </Box>
  );
}

function EmptyState({
  inAlbum,
  favorites,
  onUpload,
}: {
  inAlbum: boolean;
  favorites: boolean;
  onUpload: () => void;
}) {
  let message: string;
  if (favorites)
    message = "No favorites yet. Tap the star on a photo to add it here.";
  else if (inAlbum)
    message = "This album is empty. Upload or add photos to it.";
  else message = "No photos yet. Upload your first photos to get started.";
  return (
    <Sheet
      variant="soft"
      sx={{ p: 6, borderRadius: "md", textAlign: "center" }}
    >
      <PhotoLibraryIcon sx={{ fontSize: 56, opacity: 0.3, mb: 1 }} />
      <Typography level="body-lg" sx={{ opacity: 0.7, mb: 2 }}>
        {message}
      </Typography>
      {!favorites && (
        <Button startDecorator={<AddPhotoAlternateIcon />} onClick={onUpload}>
          Upload photos
        </Button>
      )}
    </Sheet>
  );
}

// A native-positioned context menu (Google Photos opens a custom menu on
// right-click). Mirrors the items documented in photos.md.
function PhotoContextMenu({
  state,
  inAlbum,
  onOpen,
  onAddToAlbum,
  onToggleFavorite,
  onInfo,
  onEdit,
  onRemoveFromAlbum,
  onDelete,
}: {
  state: ContextMenuState;
  inAlbum: boolean;
  onOpen: () => void;
  onAddToAlbum: () => void;
  onToggleFavorite: () => void;
  onInfo: () => void;
  onEdit: () => void;
  onRemoveFromAlbum: () => void;
  onDelete: () => void;
}) {
  // Keep the menu within the viewport.
  const x = Math.min(state.x, window.innerWidth - 220);
  const y = Math.min(state.y, window.innerHeight - 280);
  return (
    <Box
      sx={{ position: "fixed", top: y, left: x, zIndex: 1500 }}
      onClick={(e) => e.stopPropagation()}
    >
      <Sheet
        variant="outlined"
        sx={{ borderRadius: "sm", boxShadow: "lg", minWidth: 200, py: 0.5 }}
      >
        <List size="sm" sx={{ "--ListItemDecorator-size": "32px" }}>
          <CtxItem onClick={onOpen} label="Open" />
          <CtxItem
            onClick={onToggleFavorite}
            icon={state.photo.favorite ? <StarIcon /> : <StarBorderIcon />}
            label={state.photo.favorite ? "Remove favorite" : "Favorite"}
          />
          <CtxItem
            onClick={onAddToAlbum}
            icon={<LibraryAddIcon />}
            label="Add to album"
          />
          {inAlbum && (
            <CtxItem onClick={onRemoveFromAlbum} label="Remove from album" />
          )}
          <CtxItem onClick={onEdit} label="Edit photo" />
          <CtxItem onClick={onInfo} label="Get info" />
          <ListItem>
            <ListItemButton component="a" href={downloadURL(state.photo.id)}>
              <ListItemDecorator>
                <DownloadIcon />
              </ListItemDecorator>
              Download
            </ListItemButton>
          </ListItem>
          <Divider />
          <CtxItem
            onClick={onDelete}
            icon={<DeleteOutlineIcon />}
            label="Delete"
            danger
          />
        </List>
      </Sheet>
    </Box>
  );
}

function CtxItem({
  onClick,
  icon,
  label,
  danger,
}: {
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <ListItem>
      <ListItemButton onClick={onClick} color={danger ? "danger" : undefined}>
        {icon && <ListItemDecorator>{icon}</ListItemDecorator>}
        {!icon && <ListItemDecorator />}
        {label}
      </ListItemButton>
    </ListItem>
  );
}
