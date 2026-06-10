import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Sheet,
  Typography,
  IconButton,
  CircularProgress,
  Tooltip,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  Drawer,
  ModalClose,
  List,
  ListItem,
  ListItemButton,
  Modal,
  ModalDialog,
  Switch,
  Select,
  Option,
  Button,
  Input,
  LinearProgress,
  Tab,
  TabList,
  Tabs,
} from "@mui/joy";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import SearchIcon from "@mui/icons-material/Search";
import TextFormatIcon from "@mui/icons-material/TextFormat";
import TocIcon from "@mui/icons-material/Toc";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import HighlightIcon from "@mui/icons-material/Highlight";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import { PdfPreview } from "../drive/PdfPreview";
import { EpubReader } from "./EpubReader";
import { CbzReader } from "./CbzReader";
import { TxtReader } from "./TxtReader";
import { BookmarksPanel } from "./BookmarksPanel";
import { HighlightsPanel } from "./HighlightsPanel";
import {
  getBook,
  fileURL,
  downloadURL,
  updateProgress,
  setProgress as setUserProgress,
  getProgress as getUserProgress,
  addBookmark,
  addHighlight,
} from "./api";
import type { Book } from "./types";
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_HEX } from "./types";
import type { HighlightColor } from "./types";

interface DisplaySettings {
  dark: boolean;
  fontScale: number;
  lineHeight: number;
  justify: boolean;
}

const DEFAULT_SETTINGS: DisplaySettings = {
  dark: false,
  fontScale: 1,
  lineHeight: 1.6,
  justify: false,
};

const SETTINGS_KEY = "books.reader.settings";
function loadSettings(): DisplaySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

type SidePanelTab = "toc" | "bookmarks" | "highlights";

/** Reader is the in-book reading view: a toolbar over a format-specific renderer.
 *  Reading position is checkpointed via both the shared book record and the
 *  per-user progress endpoint. */
export function Reader() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<DisplaySettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<SidePanelTab>("toc");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Position state used by epub (chapter index) and cbz (page index).
  const [position, setPosition] = useState(0);
  const [count, setCount] = useState(1);
  const [toc, setToc] = useState<{ label: string; index: number }[]>([]);

  // Highlight creation state.
  const [highlightMenuOpen, setHighlightMenuOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState("");
  const [highlightNote, setHighlightNote] = useState("");
  const [highlightColor, setHighlightColor] =
    useState<HighlightColor>("yellow");
  // Bump this to force HighlightsPanel to reload.
  const [highlightReloadKey, setHighlightReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getBook(id), getUserProgress(id).catch(() => null)])
      .then(([b, prog]) => {
        if (cancelled) return;
        setBook(b);
        // Resume from per-user progress first; fall back to shared last_location.
        const locator = prog?.locator || b.last_location;
        const parsed = parseInt(locator, 10);
        if (!Number.isNaN(parsed) && parsed > 0) setPosition(parsed);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // Track real fullscreen state (Esc, F11-like exits).
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const isPaged = book?.format === "epub" || book?.format === "cbz";

  // Checkpoint reading position (debounced) when it changes.
  const checkpoint = useCallback(
    (pos: number, total: number, finished = false) => {
      if (!book) return;
      const pct =
        total > 1 ? Math.round((pos / (total - 1)) * 100) : finished ? 100 : 0;
      // Update shared book record (legacy) + per-user progress.
      updateProgress(book.id, {
        last_location: String(pos),
        progress_percent: pct,
        finished,
      }).catch(() => {});
      setUserProgress(book.id, String(pos), pct).catch(() => {});
    },
    [book],
  );

  useEffect(() => {
    if (!book || !isPaged) return;
    const t = setTimeout(
      () => checkpoint(position, count, position >= count - 1),
      600,
    );
    return () => clearTimeout(t);
  }, [position, count, book, isPaged, checkpoint]);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!document.fullscreenElement && el) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  const goPrev = useCallback(() => setPosition((p) => Math.max(0, p - 1)), []);
  const goNext = useCallback(
    () => setPosition((p) => Math.min(count - 1, p + 1)),
    [count],
  );

  // Keyboard navigation for paged formats.
  useEffect(() => {
    if (!isPaged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPaged, goPrev, goNext]);

  const markFinished = () => {
    if (!book) return;
    checkpoint(count - 1, count, true);
    setBook({ ...book, finished: true });
  };

  // Add a bookmark at the current position.
  const handleAddBookmark = useCallback(async () => {
    if (!book) return;
    try {
      await addBookmark(book.id, String(position), `Position ${position + 1}`);
      setSidePanelTab("bookmarks");
      setSidePanelOpen(true);
    } catch {
      /* ignore */
    }
  }, [book, position]);

  // Capture text selection for highlight creation.
  const handleHighlightCapture = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text) return;
    setPendingSelection(text);
    setHighlightNote("");
    setHighlightColor("yellow");
    setHighlightMenuOpen(true);
  }, []);

  async function confirmHighlight() {
    if (!book || !pendingSelection) return;
    try {
      await addHighlight(
        book.id,
        String(position),
        pendingSelection,
        highlightNote,
        highlightColor,
      );
      setHighlightReloadKey((k) => k + 1);
    } catch {
      /* ignore */
    } finally {
      setHighlightMenuOpen(false);
      setPendingSelection("");
    }
  }

  const body = useMemo(() => {
    if (!book) return null;
    const url = fileURL(book.id);
    if (!book.file_name && book.size_bytes === 0) {
      return <EmptyFile />;
    }
    switch (book.format) {
      case "pdf":
        return <PdfPreview url={url} />;
      case "txt":
        return (
          <TxtReader
            url={url}
            fontScale={settings.fontScale}
            lineHeight={settings.lineHeight}
            dark={settings.dark}
            justify={!!settings.justify}
          />
        );
      case "epub":
        return (
          <EpubReader
            url={url}
            chapter={position}
            fontScale={settings.fontScale}
            lineHeight={settings.lineHeight}
            dark={settings.dark}
            justify={!!settings.justify}
            onChapterCount={setCount}
            onToc={setToc}
          />
        );
      case "cbz":
        return <CbzReader url={url} page={position} onPageCount={setCount} />;
      default:
        return <DownloadOnly book={book} />;
    }
  }, [book, settings, position]);

  if (error) {
    return (
      <Box sx={{ p: 4 }} role="alert">
        <Typography color="danger">Couldn't open book: {error}</Typography>
        <Button
          sx={{ mt: 2 }}
          variant="soft"
          onClick={() => navigate("/books")}
        >
          Back to library
        </Button>
      </Box>
    );
  }
  if (!book) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        bgcolor: settings.dark ? "#1a1a1a" : "background.body",
      }}
    >
      {/* Reader toolbar */}
      <Sheet
        variant="outlined"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1.5,
          py: 0.5,
          borderRadius: 0,
          flexShrink: 0,
          bgcolor: settings.dark ? "#222" : undefined,
        }}
      >
        <Tooltip title="Back to library">
          <IconButton
            variant="plain"
            color="neutral"
            aria-label="Back to library"
            onClick={() => navigate("/books")}
          >
            <ArrowBackIcon />
          </IconButton>
        </Tooltip>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            level="title-sm"
            noWrap
            sx={{ color: settings.dark ? "#eee" : undefined }}
          >
            {book.title}
          </Typography>
          <Typography
            level="body-xs"
            noWrap
            sx={{ opacity: 0.7, color: settings.dark ? "#bbb" : undefined }}
          >
            {book.author}
          </Typography>
        </Box>

        <Tooltip title="Toggle fullscreen">
          <IconButton
            variant="plain"
            color="neutral"
            aria-label="Toggle fullscreen"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Search">
          <IconButton
            variant="plain"
            color="neutral"
            aria-label="Search"
            onClick={() => setSearchOpen((s) => !s)}
          >
            <SearchIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Display settings">
          <IconButton
            variant="plain"
            color="neutral"
            aria-label="Display settings"
            onClick={() => setSettingsOpen(true)}
          >
            <TextFormatIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Table of contents, bookmarks and highlights">
          <IconButton
            variant="plain"
            color="neutral"
            aria-label="Open side panel"
            onClick={() => setSidePanelOpen((o) => !o)}
          >
            <TocIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Add bookmark at current position">
          <IconButton
            variant="plain"
            color="neutral"
            aria-label="Add bookmark"
            onClick={handleAddBookmark}
          >
            <BookmarkBorderIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Highlight selected text">
          <IconButton
            variant="plain"
            color="neutral"
            aria-label="Highlight selection"
            onClick={handleHighlightCapture}
          >
            <HighlightIcon />
          </IconButton>
        </Tooltip>

        <Dropdown>
          <MenuButton
            slots={{ root: IconButton }}
            slotProps={{
              root: {
                variant: "plain",
                color: "neutral",
                "aria-label": "Help and Feedback",
              },
            }}
          >
            <HelpOutlineIcon />
          </MenuButton>
          <Menu placement="bottom-end" size="sm">
            <MenuItem disabled>Get help using Books</MenuItem>
            <MenuItem disabled>Send feedback to Books</MenuItem>
            <MenuItem disabled>Report a problem with ebook</MenuItem>
          </Menu>
        </Dropdown>

        <Dropdown>
          <MenuButton
            slots={{ root: IconButton }}
            slotProps={{
              root: {
                variant: "plain",
                color: "neutral",
                "aria-label": "More options",
              },
            }}
          >
            <MoreVertIcon />
          </MenuButton>
          <Menu placement="bottom-end" size="sm">
            <MenuItem onClick={() => navigate(`/books/${book.id}`)}>
              About this book
            </MenuItem>
            <MenuItem component="a" href={downloadURL(book.id)} download>
              <DownloadIcon /> Download
            </MenuItem>
            <ListDivider />
            <MenuItem onClick={markFinished} disabled={book.finished}>
              {book.finished ? "Marked finished" : "Mark finished"}
            </MenuItem>
          </Menu>
        </Dropdown>
      </Sheet>

      {/* In-book search */}
      {searchOpen && (
        <Sheet
          variant="soft"
          sx={{
            display: "flex",
            gap: 1,
            alignItems: "center",
            px: 2,
            py: 1,
            flexShrink: 0,
          }}
        >
          <Input
            size="sm"
            autoFocus
            startDecorator={<SearchIcon />}
            placeholder="Search in book"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchText) {
                (window as unknown as { find?: (s: string) => boolean }).find?.(
                  searchText,
                );
              }
            }}
            sx={{ flex: 1, maxWidth: 360 }}
          />
          <IconButton
            size="sm"
            variant="plain"
            aria-label="Close search"
            onClick={() => setSearchOpen(false)}
          >
            <ChevronLeftIcon />
          </IconButton>
        </Sheet>
      )}

      {isPaged && count > 1 && (
        <LinearProgress
          determinate
          value={count > 1 ? (position / (count - 1)) * 100 : 0}
          sx={{ "--LinearProgress-thickness": "3px" }}
        />
      )}

      {/* Content area */}
      <Box sx={{ flex: 1, overflow: "auto", position: "relative" }}>{body}</Box>

      {/* Paged navigation footer (epub/cbz). */}
      {isPaged && (
        <Sheet
          variant="outlined"
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            py: 0.5,
            flexShrink: 0,
            borderRadius: 0,
            bgcolor: settings.dark ? "#222" : undefined,
          }}
        >
          <IconButton
            variant="plain"
            aria-label="Previous Page"
            disabled={position <= 0}
            onClick={goPrev}
          >
            <ChevronLeftIcon />
          </IconButton>
          <Typography
            level="body-sm"
            sx={{ color: settings.dark ? "#ccc" : undefined }}
          >
            {book.format === "cbz" ? "Page" : "Chapter"} {position + 1} /{" "}
            {count}
          </Typography>
          <IconButton
            variant="plain"
            aria-label="Next Page"
            disabled={position >= count - 1}
            onClick={goNext}
          >
            <ChevronRightIcon />
          </IconButton>
        </Sheet>
      )}

      {/* Display settings dialog */}
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <ModalDialog sx={{ width: 360, maxWidth: "95vw" }}>
          <ModalClose aria-label="Close display options" />
          <Typography level="h4">Display options</Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mt: 2,
            }}
          >
            <Typography>Dark theme</Typography>
            <Switch
              checked={settings.dark}
              onChange={(e) =>
                setSettings((s) => ({ ...s, dark: e.target.checked }))
              }
            />
          </Box>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mt: 2,
            }}
          >
            <Typography>Font size</Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <IconButton
                size="sm"
                variant="outlined"
                aria-label="Decrease font size"
                onClick={() =>
                  setSettings((s) => ({
                    ...s,
                    fontScale: Math.max(0.7, +(s.fontScale - 0.1).toFixed(2)),
                  }))
                }
              >
                −
              </IconButton>
              <Typography
                level="body-sm"
                sx={{ width: 48, textAlign: "center" }}
              >
                {Math.round(settings.fontScale * 100)}%
              </Typography>
              <IconButton
                size="sm"
                variant="outlined"
                aria-label="Increase font size"
                onClick={() =>
                  setSettings((s) => ({
                    ...s,
                    fontScale: Math.min(2, +(s.fontScale + 0.1).toFixed(2)),
                  }))
                }
              >
                +
              </IconButton>
            </Box>
          </Box>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mt: 2,
            }}
          >
            <Typography>Line height</Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <IconButton
                size="sm"
                variant="outlined"
                aria-label="Decrease line height"
                onClick={() =>
                  setSettings((s) => ({
                    ...s,
                    lineHeight: Math.max(1, +(s.lineHeight - 0.1).toFixed(2)),
                  }))
                }
              >
                −
              </IconButton>
              <Typography
                level="body-sm"
                sx={{ width: 48, textAlign: "center" }}
              >
                {settings.lineHeight.toFixed(1)}
              </Typography>
              <IconButton
                size="sm"
                variant="outlined"
                aria-label="Increase line height"
                onClick={() =>
                  setSettings((s) => ({
                    ...s,
                    lineHeight: Math.min(2.4, +(s.lineHeight + 0.1).toFixed(2)),
                  }))
                }
              >
                +
              </IconButton>
            </Box>
          </Box>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mt: 2,
            }}
          >
            <Typography>Justify</Typography>
            <Select
              size="sm"
              value={settings.justify ? "justify" : "none"}
              onChange={(_, v) =>
                setSettings((s) => ({ ...s, justify: v === "justify" }))
              }
              sx={{ width: 180 }}
            >
              <Option value="none">No justification</Option>
              <Option value="justify">Justify text</Option>
            </Select>
          </Box>
          <Typography level="body-xs" sx={{ mt: 2, opacity: 0.6 }}>
            Display options apply to reflowed formats (EPUB, TXT). PDF and CBZ
            render at fixed layout.
          </Typography>
        </ModalDialog>
      </Modal>

      {/* Highlight creation dialog */}
      <Modal
        open={highlightMenuOpen}
        onClose={() => setHighlightMenuOpen(false)}
      >
        <ModalDialog sx={{ width: 380, maxWidth: "95vw" }}>
          <ModalClose aria-label="Close" />
          <Typography level="h4">Add highlight</Typography>
          <Typography
            level="body-sm"
            sx={{ mt: 1, fontStyle: "italic", opacity: 0.8 }}
          >
            "
            {pendingSelection.length > 100
              ? pendingSelection.slice(0, 100) + "…"
              : pendingSelection}
            "
          </Typography>
          <Typography level="body-sm" sx={{ mt: 2, mb: 0.5 }}>
            Color
          </Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            {HIGHLIGHT_COLORS.map((c) => (
              <Box
                key={c}
                onClick={() => setHighlightColor(c)}
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  bgcolor: HIGHLIGHT_COLOR_HEX[c],
                  cursor: "pointer",
                  outline:
                    highlightColor === c
                      ? "2px solid var(--joy-palette-primary-500)"
                      : "none",
                  outlineOffset: 2,
                }}
                role="button"
                aria-label={`Color ${c}`}
                aria-pressed={highlightColor === c}
              />
            ))}
          </Box>
          <Typography level="body-sm" sx={{ mt: 2, mb: 0.5 }}>
            Note (optional)
          </Typography>
          <Input
            size="sm"
            placeholder="Add a note…"
            value={highlightNote}
            onChange={(e) => setHighlightNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmHighlight();
            }}
          />
          <Box
            sx={{ display: "flex", gap: 1, mt: 2, justifyContent: "flex-end" }}
          >
            <Button
              variant="plain"
              color="neutral"
              size="sm"
              onClick={() => setHighlightMenuOpen(false)}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={confirmHighlight}>
              Save highlight
            </Button>
          </Box>
        </ModalDialog>
      </Modal>

      {/* Side panel: TOC + Bookmarks + Highlights */}
      <Drawer
        open={sidePanelOpen}
        onClose={() => setSidePanelOpen(false)}
        anchor="left"
        size="sm"
      >
        <ModalClose />
        <Typography level="title-lg" sx={{ p: 2, pb: 1 }}>
          {book.title}
        </Typography>
        <Tabs
          value={sidePanelTab}
          onChange={(_, v) => setSidePanelTab(v as SidePanelTab)}
          size="sm"
          sx={{ px: 1 }}
        >
          <TabList>
            <Tab value="toc">Contents</Tab>
            <Tab value="bookmarks">
              <BookmarkIcon sx={{ fontSize: 14, mr: 0.5 }} />
              Bookmarks
            </Tab>
            <Tab value="highlights">
              <HighlightIcon sx={{ fontSize: 14, mr: 0.5 }} />
              Highlights
            </Tab>
          </TabList>
        </Tabs>
        {sidePanelTab === "toc" && (
          <List sx={{ overflow: "auto" }}>
            {toc.length === 0 && (
              <ListItem>
                <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                  No chapters available.
                </Typography>
              </ListItem>
            )}
            {toc.map((t) => (
              <ListItem key={t.index}>
                <ListItemButton
                  selected={t.index === position}
                  onClick={() => {
                    setPosition(t.index);
                    setSidePanelOpen(false);
                  }}
                >
                  {t.label}
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
        {sidePanelTab === "bookmarks" && (
          <BookmarksPanel
            bookId={book.id}
            currentLocator={String(position)}
            onJump={(loc) => {
              const parsed = parseInt(loc, 10);
              if (!Number.isNaN(parsed)) {
                setPosition(parsed);
                setSidePanelOpen(false);
              }
            }}
          />
        )}
        {sidePanelTab === "highlights" && (
          <HighlightsPanel
            bookId={book.id}
            reloadKey={highlightReloadKey}
            onJump={(loc) => {
              const parsed = parseInt(loc, 10);
              if (!Number.isNaN(parsed)) {
                setPosition(parsed);
                setSidePanelOpen(false);
              }
            }}
          />
        )}
      </Drawer>
    </Box>
  );
}

function EmptyFile() {
  return (
    <Box sx={{ p: 6, textAlign: "center" }}>
      <Typography level="body-lg" sx={{ opacity: 0.7 }}>
        This book has no file uploaded yet.
      </Typography>
    </Box>
  );
}

function DownloadOnly({ book }: { book: Book }) {
  return (
    <Box sx={{ p: 6, textAlign: "center" }}>
      <Typography level="body-lg" sx={{ opacity: 0.8 }}>
        {book.format.toUpperCase()} files can't be previewed in the browser.
      </Typography>
      <Button
        sx={{ mt: 2 }}
        startDecorator={<DownloadIcon />}
        component="a"
        href={downloadURL(book.id)}
        download
      >
        Download {book.file_name || book.title}
      </Button>
    </Box>
  );
}
