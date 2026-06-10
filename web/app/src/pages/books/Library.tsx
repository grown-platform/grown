import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Input,
  Sheet,
  IconButton,
  Chip,
  CircularProgress,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  Button,
  AspectRatio,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Divider,
  Drawer,
  ModalClose,
  Modal,
  ModalDialog,
} from "@mui/joy";
import SearchIcon from "@mui/icons-material/Search";
import MenuIcon from "@mui/icons-material/Menu";
import UploadIcon from "@mui/icons-material/UploadFile";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import AddIcon from "@mui/icons-material/Add";
import CollectionsBookmarkIcon from "@mui/icons-material/CollectionsBookmark";
import DeleteIcon from "@mui/icons-material/Delete";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listBooks,
  updateBook,
  deleteBook,
  coverURL,
  downloadURL,
  listShelves,
  createShelf,
  deleteShelf,
  addToShelf,
  removeFromShelf,
} from "./api";
import type { Book, BookFormat, Shelf } from "./types";
import { READABLE_FORMATS, formatLabel } from "./types";
import { UploadDialog } from "./UploadDialog";
import { EditDialog } from "./EditDialog";

const FORMAT_COLORS: Record<BookFormat, string> = {
  epub: "#5B9279",
  pdf: "#B5230D",
  mobi: "#C46B45",
  txt: "#3D5A80",
  cbz: "#D9A441",
};

/** Built-in filter tabs (not stored in DB). */
type BuiltinShelf = "all" | "starred" | "finished" | "reading";

interface LibraryProps {
  user: User;
}

export function Library({ user }: LibraryProps) {
  const navigate = useNavigate();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [builtinShelf, setBuiltinShelf] = useState<BuiltinShelf>("all");
  const [activeShelfId, setActiveShelfId] = useState<string | null>(null);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<Book | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // New-shelf dialog state.
  const [newShelfOpen, setNewShelfOpen] = useState(false);
  const [newShelfName, setNewShelfName] = useState("");

  // Add-to-shelf dialog state.
  const [shelfTargetBook, setShelfTargetBook] = useState<Book | null>(null);

  async function reload() {
    try {
      if (activeShelfId) {
        setBooks(await listBooks(activeShelfId));
      } else {
        setBooks(await listBooks());
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function reloadShelves() {
    try {
      setShelves(await listShelves());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    reload();
  }, [activeShelfId]);
  useEffect(() => {
    reloadShelves();
  }, []);

  // Switch to a built-in shelf filter.
  function selectBuiltin(s: BuiltinShelf) {
    setBuiltinShelf(s);
    setActiveShelfId(null);
  }
  // Switch to a custom shelf.
  function selectCustomShelf(id: string) {
    setActiveShelfId(id);
    setBuiltinShelf("all");
  }

  const shown = useMemo(() => {
    let list = books ?? [];
    if (!activeShelfId) {
      if (builtinShelf === "starred") list = list.filter((b) => b.starred);
      else if (builtinShelf === "finished")
        list = list.filter((b) => b.finished);
      else if (builtinShelf === "reading")
        list = list.filter((b) => b.progress_percent > 0 && !b.finished);
    }
    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter((b) =>
        [b.title, b.author, b.format].join(" ").toLowerCase().includes(q),
      );
    return list;
  }, [books, builtinShelf, activeShelfId, query]);

  async function toggleStar(b: Book) {
    setBooks((cur) =>
      (cur ?? []).map((x) =>
        x.id === b.id ? { ...x, starred: !x.starred } : x,
      ),
    );
    try {
      await updateBook(b.id, {
        title: b.title,
        author: b.author,
        description: b.description,
        starred: !b.starred,
      });
    } catch {
      reload();
    }
  }
  async function toggleFinished(b: Book) {
    const next = !b.finished;
    setBooks((cur) =>
      (cur ?? []).map((x) => (x.id === b.id ? { ...x, finished: next } : x)),
    );
    try {
      const { updateProgress } = await import("./api");
      await updateProgress(b.id, {
        last_location: b.last_location,
        progress_percent: next ? 100 : b.progress_percent,
        finished: next,
      });
    } catch {
      reload();
    }
  }
  async function onDelete(b: Book) {
    if (
      !window.confirm(
        `Remove "${b.title}" from your library? This deletes the file.`,
      )
    )
      return;
    setBooks((cur) => (cur ?? []).filter((x) => x.id !== b.id));
    try {
      await deleteBook(b.id);
    } catch {
      reload();
    }
  }
  function open(b: Book) {
    if (READABLE_FORMATS.includes(b.format)) navigate(`/books/${b.id}/read`);
    else navigate(`/books/${b.id}`);
  }

  async function handleCreateShelf() {
    const name = newShelfName.trim();
    if (!name) return;
    try {
      await createShelf(name);
      setNewShelfName("");
      setNewShelfOpen(false);
      await reloadShelves();
    } catch {
      /* ignore */
    }
  }

  async function handleDeleteShelf(id: string) {
    if (!window.confirm("Remove this shelf? Books will not be deleted."))
      return;
    try {
      await deleteShelf(id);
      if (activeShelfId === id) setActiveShelfId(null);
      await reloadShelves();
    } catch {
      /* ignore */
    }
  }

  async function handleAddToShelf(shelfId: string, bookId: string) {
    try {
      await addToShelf(shelfId, bookId);
      setShelfTargetBook(null);
    } catch {
      /* ignore */
    }
  }

  async function handleRemoveFromShelf(bookId: string) {
    if (!activeShelfId) return;
    setBooks((cur) => (cur ?? []).filter((b) => b.id !== bookId));
    try {
      await removeFromShelf(activeShelfId, bookId);
    } catch {
      reload();
    }
  }

  const shelfLabel = activeShelfId
    ? (shelves.find((s) => s.id === activeShelfId)?.name ?? "Shelf")
    : builtinShelf === "all"
      ? "Books"
      : builtinShelf === "reading"
        ? "Reading now"
        : builtinShelf === "starred"
          ? "Starred"
          : "Finished";

  function ShelfList({ onClose }: { onClose?: () => void }) {
    return (
      <List size="sm" sx={{ "--ListItem-radius": "8px", px: 1 }}>
        {/* Built-in filters */}
        <ListItem>
          <ListItemButton
            selected={!activeShelfId && builtinShelf === "all"}
            onClick={() => {
              selectBuiltin("all");
              onClose?.();
            }}
          >
            <ListItemDecorator>
              <LibraryBooksIcon />
            </ListItemDecorator>
            Books
          </ListItemButton>
        </ListItem>
        <ListItem>
          <ListItemButton
            selected={!activeShelfId && builtinShelf === "reading"}
            onClick={() => {
              selectBuiltin("reading");
              onClose?.();
            }}
          >
            <ListItemDecorator>
              <MenuBookIcon />
            </ListItemDecorator>
            Reading now
          </ListItemButton>
        </ListItem>
        <ListItem>
          <ListItemButton
            selected={!activeShelfId && builtinShelf === "starred"}
            onClick={() => {
              selectBuiltin("starred");
              onClose?.();
            }}
          >
            <ListItemDecorator>
              <StarIcon />
            </ListItemDecorator>
            Starred
          </ListItemButton>
        </ListItem>
        <ListItem>
          <ListItemButton
            selected={!activeShelfId && builtinShelf === "finished"}
            onClick={() => {
              selectBuiltin("finished");
              onClose?.();
            }}
          >
            <ListItemDecorator>
              <CheckCircleIcon />
            </ListItemDecorator>
            Finished
          </ListItemButton>
        </ListItem>

        {/* Custom shelves */}
        {shelves.length > 0 && <Divider sx={{ my: 1 }} />}
        {shelves.map((sh) => (
          <ListItem
            key={sh.id}
            endAction={
              <IconButton
                size="sm"
                variant="plain"
                color="neutral"
                aria-label="Delete shelf"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteShelf(sh.id);
                }}
              >
                <DeleteIcon sx={{ fontSize: 14 }} />
              </IconButton>
            }
          >
            <ListItemButton
              selected={activeShelfId === sh.id}
              onClick={() => {
                selectCustomShelf(sh.id);
                onClose?.();
              }}
            >
              <ListItemDecorator>
                <CollectionsBookmarkIcon />
              </ListItemDecorator>
              {sh.name}
            </ListItemButton>
          </ListItem>
        ))}

        <Divider sx={{ my: 1 }} />
        <ListItem>
          <ListItemButton
            onClick={() => {
              setNewShelfOpen(true);
              onClose?.();
            }}
          >
            <ListItemDecorator>
              <AddIcon />
            </ListItemDecorator>
            New shelf
          </ListItemButton>
        </ListItem>
      </List>
    );
  }

  return (
    <>
      <Header user={user} />
      <Container
        maxWidth="lg"
        sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1.5, sm: 3 } }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            mb: 3,
            flexWrap: "wrap",
          }}
        >
          <IconButton
            variant="plain"
            sx={{ display: { xs: "flex", sm: "none" } }}
            aria-label="Open shelves"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          <Typography
            level="h2"
            sx={{ flex: 1, fontSize: { xs: "xl", sm: "xl3" } }}
          >
            Books
          </Typography>
          {filterOpen ? (
            <Input
              size="sm"
              slotProps={{ input: { ref: searchRef } }}
              autoFocus
              startDecorator={<SearchIcon />}
              placeholder="Search this shelf"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => {
                if (!query) setFilterOpen(false);
              }}
              sx={{
                width: { xs: "100%", sm: 260 },
                order: { xs: 10, sm: "unset" },
              }}
            />
          ) : (
            <IconButton
              variant="plain"
              color="neutral"
              aria-label="Search this shelf"
              onClick={() => setFilterOpen(true)}
            >
              <SearchIcon />
            </IconButton>
          )}
          <Button
            variant="solid"
            color="primary"
            startDecorator={<UploadIcon />}
            onClick={() => setUploadOpen(true)}
            data-testid="upload-book"
            size="sm"
          >
            Upload
          </Button>
          <Dropdown>
            <MenuButton
              slots={{ root: IconButton }}
              slotProps={{
                root: {
                  variant: "plain",
                  color: "neutral",
                  "aria-label": "Help menu",
                },
              }}
            >
              <HelpOutlineIcon />
            </MenuButton>
            <Menu placement="bottom-end" size="sm">
              <MenuItem disabled>How to add books</MenuItem>
              <MenuItem disabled>Help</MenuItem>
              <MenuItem disabled>Send feedback</MenuItem>
            </Menu>
          </Dropdown>
        </Box>

        {/* Mobile shelf drawer */}
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          anchor="left"
          size="sm"
        >
          <ModalClose />
          <Typography level="title-lg" sx={{ p: 2, pb: 1 }}>
            Books
          </Typography>
          <ShelfList onClose={() => setDrawerOpen(false)} />
        </Drawer>

        <Box sx={{ display: "flex", gap: 3 }}>
          {/* Sidebar shelves — desktop only */}
          <Box
            sx={{
              width: 190,
              flexShrink: 0,
              display: { xs: "none", sm: "block" },
            }}
          >
            <ShelfList />
            <Typography level="body-xs" sx={{ px: 1, mt: 1, opacity: 0.6 }}>
              Supports EPUB, PDF, MOBI, TXT, CBZ.
            </Typography>
          </Box>

          {/* Main grid */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {error && (
              <Sheet
                color="danger"
                variant="soft"
                sx={{ p: 2, mb: 2, borderRadius: "md" }}
              >
                <Typography color="danger">
                  Couldn't load library: {error}
                </Typography>
              </Sheet>
            )}
            {books === null && !error && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress />
              </Box>
            )}
            {books !== null && shown.length === 0 && (
              <Sheet
                variant="soft"
                sx={{ p: 5, borderRadius: "md", textAlign: "center" }}
              >
                <MenuBookIcon sx={{ fontSize: 48, opacity: 0.4 }} />
                <Typography level="body-lg" sx={{ opacity: 0.7, mt: 1 }}>
                  {query || builtinShelf !== "all" || activeShelfId
                    ? "No matching books."
                    : "Your library is empty."}
                </Typography>
                {!query && builtinShelf === "all" && !activeShelfId && (
                  <Button
                    sx={{ mt: 2 }}
                    startDecorator={<UploadIcon />}
                    onClick={() => setUploadOpen(true)}
                  >
                    Upload your first book
                  </Button>
                )}
              </Sheet>
            )}
            {shown.length > 0 && (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                  gap: { xs: 1.5, sm: 2.5 },
                }}
              >
                {shown.map((b) => (
                  <BookTile
                    key={b.id}
                    book={b}
                    onOpen={() => open(b)}
                    onStar={() => toggleStar(b)}
                    onFinish={() => toggleFinished(b)}
                    onEdit={() => setEditing(b)}
                    onDelete={() => onDelete(b)}
                    onAddToShelf={() => setShelfTargetBook(b)}
                    onRemoveFromShelf={
                      activeShelfId
                        ? () => handleRemoveFromShelf(b.id)
                        : undefined
                    }
                  />
                ))}
              </Box>
            )}
            {books !== null && shown.length > 0 && (
              <Typography level="body-xs" sx={{ opacity: 0.6, mt: 2 }}>
                {shown.length} book{shown.length === 1 ? "" : "s"}
                {activeShelfId ? ` in ${shelfLabel}` : ""}
              </Typography>
            )}
          </Box>
        </Box>
      </Container>

      {uploadOpen && (
        <UploadDialog onClose={() => setUploadOpen(false)} onDone={reload} />
      )}
      {editing && (
        <EditDialog
          book={editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}

      {/* New shelf dialog */}
      <Modal open={newShelfOpen} onClose={() => setNewShelfOpen(false)}>
        <ModalDialog sx={{ width: 340, maxWidth: "95vw" }}>
          <ModalClose />
          <Typography level="h4">New shelf</Typography>
          <Input
            autoFocus
            sx={{ mt: 2 }}
            placeholder="Shelf name"
            value={newShelfName}
            onChange={(e) => setNewShelfName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateShelf();
            }}
          />
          <Box
            sx={{ display: "flex", gap: 1, mt: 2, justifyContent: "flex-end" }}
          >
            <Button
              variant="plain"
              color="neutral"
              onClick={() => setNewShelfOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={!newShelfName.trim()} onClick={handleCreateShelf}>
              Create
            </Button>
          </Box>
        </ModalDialog>
      </Modal>

      {/* Add to shelf dialog */}
      {shelfTargetBook && (
        <Modal open onClose={() => setShelfTargetBook(null)}>
          <ModalDialog sx={{ width: 340, maxWidth: "95vw" }}>
            <ModalClose />
            <Typography level="h4">Add to shelf</Typography>
            <Typography level="body-sm" sx={{ mt: 1, opacity: 0.7 }}>
              {shelfTargetBook.title}
            </Typography>
            {shelves.length === 0 ? (
              <Typography level="body-sm" sx={{ mt: 2, opacity: 0.6 }}>
                No shelves yet. Create one first.
              </Typography>
            ) : (
              <List size="sm" sx={{ mt: 1 }}>
                {shelves.map((sh) => (
                  <ListItem key={sh.id}>
                    <ListItemButton
                      onClick={() =>
                        handleAddToShelf(sh.id, shelfTargetBook.id)
                      }
                    >
                      <ListItemDecorator>
                        <CollectionsBookmarkIcon />
                      </ListItemDecorator>
                      {sh.name}
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
            <Button
              sx={{ mt: 2 }}
              variant="plain"
              color="neutral"
              startDecorator={<AddIcon />}
              onClick={() => {
                setShelfTargetBook(null);
                setNewShelfOpen(true);
              }}
            >
              New shelf
            </Button>
          </ModalDialog>
        </Modal>
      )}
    </>
  );

  function BookTile({
    book: b,
    onOpen,
    onStar,
    onFinish,
    onEdit,
    onDelete,
    onAddToShelf,
    onRemoveFromShelf,
  }: {
    book: Book;
    onOpen: () => void;
    onStar: () => void;
    onFinish: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onAddToShelf: () => void;
    onRemoveFromShelf?: () => void;
  }) {
    const readable = READABLE_FORMATS.includes(b.format);
    return (
      <Box
        data-testid={`book-${b.id}`}
        sx={{ "&:hover .tile-more": { opacity: 1 } }}
      >
        <Box sx={{ position: "relative", cursor: "pointer" }} onClick={onOpen}>
          <AspectRatio
            ratio="2/3"
            sx={{
              borderRadius: "md",
              boxShadow: "sm",
              overflow: "hidden",
              bgcolor: FORMAT_COLORS[b.format],
            }}
          >
            {b.has_cover ? (
              <img
                src={coverURL(b.id)}
                alt={`Cover of ${b.title}`}
                loading="lazy"
                style={{ objectFit: "cover" }}
              />
            ) : (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  p: 1.5,
                  color: "#fff",
                  textAlign: "center",
                }}
              >
                <MenuBookIcon sx={{ fontSize: 32, opacity: 0.9 }} />
                <Typography
                  level="body-xs"
                  sx={{ color: "#fff", mt: 1, fontWeight: 600 }}
                  noWrap
                >
                  {b.title}
                </Typography>
              </Box>
            )}
          </AspectRatio>
          {/* format badge */}
          <Chip
            size="sm"
            variant="solid"
            sx={{
              position: "absolute",
              top: 6,
              left: 6,
              bgcolor: "rgba(0,0,0,0.65)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            {formatLabel(b.format)}
          </Chip>
          {b.finished && (
            <Chip
              size="sm"
              variant="solid"
              color="success"
              startDecorator={<CheckCircleIcon sx={{ fontSize: 12 }} />}
              sx={{ position: "absolute", top: 6, right: 6, fontSize: 10 }}
            >
              Finished
            </Chip>
          )}
          {b.starred && !b.finished && (
            <StarIcon
              sx={{
                position: "absolute",
                top: 6,
                right: 6,
                color: "#f9ab00",
                filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.5))",
              }}
            />
          )}
          {/* tile more-menu */}
          <Box
            className="tile-more"
            sx={{
              position: "absolute",
              bottom: 6,
              right: 6,
              opacity: { xs: 1, md: 0 },
              transition: "opacity 120ms",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Dropdown>
              <MenuButton
                slots={{ root: IconButton }}
                slotProps={{
                  root: {
                    size: "sm",
                    variant: "soft",
                    "aria-label": "More options",
                    sx: { bgcolor: "rgba(255,255,255,0.9)" },
                  },
                }}
              >
                <MoreVertIcon />
              </MenuButton>
              <Menu placement="bottom-end" size="sm">
                <MenuItem onClick={() => navigate(`/books/${b.id}`)}>
                  About the book
                </MenuItem>
                <MenuItem onClick={onOpen} disabled={!readable}>
                  Read
                </MenuItem>
                <MenuItem onClick={onFinish}>
                  {b.finished ? "Mark not finished" : "Mark finished"}
                </MenuItem>
                <MenuItem onClick={onEdit}>Edit details</MenuItem>
                <MenuItem onClick={onAddToShelf}>Add to shelf</MenuItem>
                {onRemoveFromShelf && (
                  <MenuItem onClick={onRemoveFromShelf}>
                    Remove from this shelf
                  </MenuItem>
                )}
                <MenuItem component="a" href={downloadURL(b.id)} download>
                  Export
                </MenuItem>
                <ListDivider />
                <MenuItem color="danger" onClick={onDelete}>
                  Remove from library
                </MenuItem>
              </Menu>
            </Dropdown>
          </Box>
        </Box>
        <Box
          sx={{ mt: 1, display: "flex", alignItems: "flex-start", gap: 0.5 }}
        >
          <Box
            sx={{ flex: 1, minWidth: 0, cursor: "pointer" }}
            onClick={onOpen}
          >
            <Typography level="body-sm" sx={{ fontWeight: 600 }} noWrap>
              {b.title}
            </Typography>
            <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
              {b.author || "Unknown author"}
            </Typography>
          </Box>
          <IconButton
            size="sm"
            variant="plain"
            onClick={onStar}
            aria-label={b.starred ? "Unstar" : "Star"}
          >
            {b.starred ? (
              <StarIcon sx={{ color: "#f9ab00", fontSize: 18 }} />
            ) : (
              <StarBorderIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </Box>
        {b.progress_percent > 0 && !b.finished && (
          <LinearProgress
            determinate
            value={b.progress_percent}
            sx={{ mt: 0.5, "--LinearProgress-thickness": "4px" }}
          />
        )}
      </Box>
    );
  }
}
