import { useEffect, useState, useCallback, useRef } from "react";
import {
  useSearchParams,
  useNavigate,
  Link as RouterLink,
} from "react-router-dom";
import { useDropzone } from "react-dropzone";
import {
  Box,
  Typography,
  Button,
  IconButton,
  Sheet,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Divider,
  Input,
  Select,
  Option,
  Chip,
  Tooltip,
  Drawer,
  Modal,
  ModalDialog,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listFiles,
  getFile,
  createFolder,
  trashFile,
  uploadFile,
  renameFile,
  moveFile,
  copyFile,
  createShare,
  downloadURL,
  listSharedWithMe,
  starFile,
  unstarFile,
  listStarred,
  listRecent,
  listTrash,
  restoreFile,
  deleteForever,
} from "./api";
import { VersionsDialog } from "./VersionsDialog";
import type { DriveFile } from "./types";
import { isFolder } from "./types";
import { MoveDialog } from "./MoveDialog";

/** The advanced-search type categories, mapped to a predicate over a file's mime. */
type TypeFilter =
  | "all"
  | "folders"
  | "docs"
  | "sheets"
  | "images"
  | "pdfs"
  | "videos"
  | "audio";

const TYPE_FILTER_LABELS: Record<TypeFilter, string> = {
  all: "Any type",
  folders: "Folders",
  docs: "Documents",
  sheets: "Spreadsheets",
  images: "Images",
  pdfs: "PDFs",
  videos: "Videos",
  audio: "Audio",
};

/** matchesType returns true if a file belongs to the selected type category. */
function matchesType(f: DriveFile, t: TypeFilter): boolean {
  if (t === "all") return true;
  const m = f.mime_type || "";
  switch (t) {
    case "folders":
      return isFolder(f);
    case "docs":
      return (
        m.startsWith("text/") ||
        m.includes("json") ||
        m.includes("document") ||
        m.includes("msword") ||
        m.includes("wordprocessing")
      );
    case "sheets":
      return (
        m.includes("spreadsheet") || m.includes("csv") || m.includes("excel")
      );
    case "images":
      return m.startsWith("image/");
    case "pdfs":
      return m === "application/pdf";
    case "videos":
      return m.startsWith("video/");
    case "audio":
      return m.startsWith("audio/");
    default:
      return true;
  }
}

/** fileIcon returns a type-appropriate icon for a file's mime type. */
function fileIcon(f: DriveFile) {
  const m = f.mime_type || "";
  if (m.startsWith("image/")) return <Icons.Image sx={{ color: "#34a853" }} />;
  if (m.startsWith("video/")) return <Icons.Movie sx={{ color: "#ea4335" }} />;
  if (m.startsWith("audio/"))
    return <Icons.AudioFile sx={{ color: "#a142f4" }} />;
  if (m === "application/pdf")
    return <Icons.PictureAsPdf sx={{ color: "#ea4335" }} />;
  if (m.startsWith("text/") || m.includes("json"))
    return <Icons.Description sx={{ color: "#4285f4" }} />;
  if (m.includes("spreadsheet") || m.includes("csv"))
    return <Icons.TableChart sx={{ color: "#0f9d58" }} />;
  return <Icons.InsertDriveFile sx={{ color: "#5f6368" }} />;
}
import { FileDetailsPanel } from "./FileDetailsPanel";
import { openFileRoute } from "./editorRoutes";
import { RowMenuItems, type RowMenuHandlers } from "./RowMenuItems";

/** Returns true when window.innerWidth < 900. */
function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.innerWidth < 900);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 900);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile;
}

interface FileListProps {
  user: User;
}

export function FileList({ user }: FileListProps) {
  const [params] = useSearchParams();
  const parent = params.get("folder") ?? "";
  const viewParam = params.get("view") ?? "";
  // "Shared with me" view: cross-org files granted to the caller (object_grants).
  const sharedView = viewParam === "shared";
  const starredView = viewParam === "starred";
  const recentView = viewParam === "recent";
  const trashView = viewParam === "trash";
  const specialView = sharedView || starredView || recentView || trashView;
  const navigate = useNavigate();
  const isMobile = useMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The file currently selected for the details panel. null = panel closed.
  const [selected, setSelected] = useState<DriveFile | null>(null);
  // When the user clicks Share in the row menu, we open the panel with Manage
  // access already expanded. A counter forces the panel to remount + reinit
  // its internal manageOpen state each time Share is clicked.
  const [shareIntentTick, setShareIntentTick] = useState(0);
  // Right-click context menu position + target file. null = no menu showing.
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    file: DriveFile;
  } | null>(null);
  const ctxMenuRef = useRef<HTMLUListElement>(null);
  // grid|list view (persisted) + the file currently being dragged (for move).
  const [view, setView] = useState<"grid" | "list">(
    () => (localStorage.getItem("drive:view") as "grid" | "list") || "list",
  );
  const [dragId, setDragId] = useState<string | null>(null);
  useEffect(() => {
    localStorage.setItem("drive:view", view);
  }, [view]);
  // The file the user is moving via the "Move to" picker. null = dialog closed.
  const [moveTarget, setMoveTarget] = useState<DriveFile | null>(null);
  // The file whose version history is being managed. null = dialog closed.
  const [versionsTarget, setVersionsTarget] = useState<DriveFile | null>(null);
  // Name of the current folder (for breadcrumb + details "Location"). "" until resolved.
  const [folderName, setFolderName] = useState<string>("");
  // Advanced search / filter toolbar state.
  const [showFilters, setShowFilters] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all"); // "all" | "me" | "others"

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      let f: DriveFile[];
      if (sharedView) {
        f = await listSharedWithMe();
      } else if (starredView) {
        f = await listStarred();
      } else if (recentView) {
        f = await listRecent();
      } else if (trashView) {
        f = await listTrash();
      } else {
        f = await listFiles(parent);
      }
      setFiles(f);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [parent, sharedView, starredView, recentView, trashView]);

  // Drop a dragged file onto a folder to move it there.
  const onDropOnFolder = useCallback(
    async (folder: DriveFile) => {
      if (!dragId || dragId === folder.id) return;
      try {
        await moveFile(dragId, folder.id);
      } catch {
        /* surfaced on refresh */
      }
      setDragId(null);
      void refresh();
    },
    [dragId, refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Resolve the current folder's display name (for the breadcrumb + the
  // details-panel "Location" row). Root has no parent so reads "My Drive".
  useEffect(() => {
    if (!parent) {
      setFolderName("");
      return;
    }
    let cancelled = false;
    getFile(parent)
      .then((f) => {
        if (!cancelled) setFolderName(f.name);
      })
      .catch(() => {
        if (!cancelled) setFolderName("");
      });
    return () => {
      cancelled = true;
    };
  }, [parent]);

  // Apply the advanced-search filters (name query, type, owner) over the
  // current folder's files. All filtering is client-side over the already-
  // loaded list — Drive folders are small enough that this stays snappy.
  const q = query.trim().toLowerCase();
  const filtered = files.filter((f) => {
    if (q && !f.name.toLowerCase().includes(q)) return false;
    if (!matchesType(f, typeFilter)) return false;
    if (ownerFilter === "me" && f.owner_id !== user.id) return false;
    if (ownerFilter === "others" && f.owner_id === user.id) return false;
    return true;
  });
  const filtersActive =
    q !== "" || typeFilter !== "all" || ownerFilter !== "all";
  // True when there ARE files but the filters hid them all (distinct from an
  // empty folder, which gets the upload call-to-action instead).
  const filteredEmpty = !busy && files.length > 0 && filtered.length === 0;

  const locationName = sharedView
    ? "Shared with me"
    : starredView
      ? "Starred"
      : recentView
        ? "Recent"
        : trashView
          ? "Trash"
          : parent
            ? folderName || "Folder"
            : "My Drive";

  const clearFilters = () => {
    setQuery("");
    setTypeFilter("all");
    setOwnerFilter("all");
  };

  const onNewFolder = useCallback(async () => {
    const name = prompt("Folder name:");
    if (!name) return;
    try {
      await createFolder(name, parent);
      await refresh();
    } catch (e) {
      alert("Create failed: " + (e as Error).message);
    }
  }, [parent, refresh]);

  const onFilesAccepted = useCallback(
    (accepted: File[]) => {
      // Upload sequentially so the refresh at the end sees them all.
      // For many-files / large-files we'd batch + show progress in a future task.
      void Promise.all(accepted.map((file) => uploadFile(file, parent)))
        .then(() => refresh())
        .catch((e) => alert("Upload failed: " + (e as Error).message));
    },
    [parent, refresh],
  );

  // Page-level dropzone: the whole main content area is the drop target.
  // The hidden <input> rendered below also fires the same onDrop when the
  // user picks a file via the "File upload" menu item (which calls open()).
  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    onDrop: onFilesAccepted,
    noClick: true,
    noKeyboard: true,
  });

  const onTrash = useCallback(
    async (id: string) => {
      if (!confirm("Move to trash?")) return;
      try {
        await trashFile(id);
        if (selected?.id === id) setSelected(null);
        await refresh();
      } catch (e) {
        alert("Trash failed: " + (e as Error).message);
      }
    },
    [refresh, selected],
  );

  const onOpenRow = useCallback(
    (f: DriveFile) => {
      if (isFolder(f)) navigate(`/drive?folder=${f.id}`);
      else navigate(openFileRoute(f));
    },
    [navigate],
  );

  const onDownload = useCallback((f: DriveFile) => {
    // Force the browser to fetch with Content-Disposition: inline; the user's
    // browser settings decide whether to display or save. The anchor's
    // `download` attribute would force-save, which surprises users on PDFs.
    window.open(downloadURL(f.id), "_blank", "noopener");
  }, []);

  const onRename = useCallback(
    async (f: DriveFile) => {
      const next = prompt("Rename:", f.name);
      if (next == null || next.trim() === "" || next === f.name) return;
      try {
        await renameFile(f.id, next.trim());
        await refresh();
      } catch (e) {
        alert("Rename failed: " + (e as Error).message);
      }
    },
    [refresh],
  );

  /** "Share" menu item: opens the details panel with Manage access expanded. */
  const onShareOpenPanel = useCallback((f: DriveFile) => {
    setSelected(f);
    setShareIntentTick((t) => t + 1);
  }, []);

  /** "Preview" submenu item: forces the generic FileViewer regardless of mime,
   *  bypassing the per-type editor mapping. */
  const onPreview = useCallback(
    (f: DriveFile) => {
      navigate(`/drive/file/${f.id}`);
    },
    [navigate],
  );

  /** "Open in new tab" submenu item. */
  const onOpenInNewTab = useCallback((f: DriveFile) => {
    window.open(openFileRoute(f), "_blank", "noopener");
  }, []);

  /** "Details" item in File information submenu: open the panel without
   *  auto-expanding Manage access. */
  const onShowDetails = useCallback((f: DriveFile) => {
    setSelected(f);
    setShareIntentTick(0);
  }, []);

  /** "Copy link" menu item: creates a viewer share and copies the URL to the
   *  clipboard. Falls back to prompt() if the clipboard API isn't available. */
  const onCopyLink = useCallback(async (f: DriveFile) => {
    try {
      const share = await createShare(f.id, "viewer");
      const url = `${window.location.origin}/drive/share/${share.token}`;
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        alert(`Link copied to clipboard:\n${url}`);
      } else {
        // Non-HTTPS / older browser fallback.
        prompt("Share link (copy this):", url);
      }
    } catch (e) {
      alert("Copy link failed: " + (e as Error).message);
    }
  }, []);

  /** "Make a copy": duplicates the file in the same folder and refreshes. */
  const onMakeCopy = useCallback(
    async (f: DriveFile) => {
      try {
        await copyFile(f.id);
        await refresh();
      } catch (e) {
        alert("Make a copy failed: " + (e as Error).message);
      }
    },
    [refresh],
  );

  /** Toggle star on a file. Optimistically updates local state. */
  const onToggleStar = useCallback(
    async (f: DriveFile) => {
      const wasStarred = !!f.starred;
      // Optimistic update.
      setFiles((prev) =>
        prev.map((x) => (x.id === f.id ? { ...x, starred: !wasStarred } : x)),
      );
      try {
        if (wasStarred) {
          await unstarFile(f.id);
        } else {
          await starFile(f.id);
        }
        // If we're in the Starred view, remove the now-unstarred file.
        if (starredView && wasStarred) {
          setFiles((prev) => prev.filter((x) => x.id !== f.id));
        }
      } catch (e) {
        // Roll back optimistic update.
        setFiles((prev) =>
          prev.map((x) => (x.id === f.id ? { ...x, starred: wasStarred } : x)),
        );
        alert("Star failed: " + (e as Error).message);
      }
    },
    [starredView],
  );

  /** Restore a trashed file to its original location. */
  const onRestore = useCallback(async (id: string) => {
    try {
      await restoreFile(id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch (e) {
      alert("Restore failed: " + (e as Error).message);
    }
  }, []);

  /** Permanently delete a file from Trash. */
  const onDeleteForever = useCallback(
    async (id: string) => {
      if (!confirm("Delete forever? This cannot be undone.")) return;
      try {
        await deleteForever(id);
        setFiles((prev) => prev.filter((f) => f.id !== id));
        if (selected?.id === id) setSelected(null);
      } catch (e) {
        alert("Delete forever failed: " + (e as Error).message);
      }
    },
    [selected],
  );

  /** "Move to": opens the folder-picker dialog for the target file. */
  const onMove = useCallback((f: DriveFile) => {
    setMoveTarget(f);
  }, []);

  /** "Manage versions": opens the version history dialog for the target file. */
  const onManageVersions = useCallback((f: DriveFile) => {
    setVersionsTarget(f);
  }, []);

  /** Called by MoveDialog once the user confirms a destination folder. */
  const onMoveConfirm = useCallback(
    async (destParent: string) => {
      if (!moveTarget) return;
      const target = moveTarget;
      setMoveTarget(null);
      try {
        await moveFile(target.id, destParent);
        if (selected?.id === target.id) setSelected(null);
        await refresh();
      } catch (e) {
        alert("Move failed: " + (e as Error).message);
      }
    },
    [moveTarget, refresh, selected],
  );

  // Shared handlers object passed to RowMenuItems by both the triple-dot
  // menu and the right-click context menu.
  const rowHandlers: RowMenuHandlers = {
    onOpen: onOpenRow,
    onPreview,
    onOpenInNewTab,
    onDownload,
    onRename,
    onMakeCopy,
    onMove,
    onManageVersions,
    onShareOpenPanel,
    onCopyLink,
    onShowDetails,
    onToggleStar,
    onTrash,
  };

  // Right-click on a row: select the file, open the context menu at the
  // cursor. Selecting also opens the details panel — matches Google Drive.
  const onRowContextMenu = useCallback((e: React.MouseEvent, f: DriveFile) => {
    e.preventDefault();
    e.stopPropagation();
    // Clamp position so the menu stays on-screen (rough estimate of menu
    // size — refined by the browser if the menu would otherwise overflow).
    const x = Math.min(e.clientX, window.innerWidth - 240);
    const y = Math.min(e.clientY, window.innerHeight - 480);
    setSelected(f);
    setShareIntentTick(0);
    setCtxMenu({ x, y, file: f });
  }, []);

  // Close the context menu when the user clicks/right-clicks outside it.
  useEffect(() => {
    if (!ctxMenu) return;
    const isInsideMenu = (target: EventTarget | null): boolean => {
      if (!(target instanceof Node)) return false;
      // Menu itself
      if (ctxMenuRef.current?.contains(target)) return true;
      // Joy renders nested submenus into a portal under document.body. Detect
      // those by walking ancestors and checking for the popper class Joy emits.
      let el: HTMLElement | null =
        target instanceof HTMLElement
          ? target
          : (target.parentElement as HTMLElement | null);
      while (el) {
        if (
          el.classList &&
          (el.classList.contains("MuiMenu-root") ||
            el.dataset.muiPopperRoot === "true")
        ) {
          return true;
        }
        el = el.parentElement;
      }
      return false;
    };
    const close = (ev: MouseEvent) => {
      if (isInsideMenu(ev.target)) return;
      setCtxMenu(null);
    };
    const onEscape = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("contextmenu", close);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("contextmenu", close);
      document.removeEventListener("keydown", onEscape);
    };
  }, [ctxMenu]);

  return (
    <>
      <Header user={user} />
      <Box
        {...getRootProps()}
        sx={{
          display: "flex",
          minHeight: "calc(100vh - 64px)",
          position: "relative",
          outline: "none",
        }}
      >
        {/* Hidden input that react-dropzone manages — both the drop and the
            "File upload" menu item route through this. */}
        <input {...getInputProps()} data-testid="drive-upload-input" />

        {/* Drop overlay shown while a drag-and-drop is hovering anywhere on
            this page. Pointer-events:none so it doesn't intercept the drop. */}
        {isDragActive && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "rgba(63, 136, 197, 0.10)",
              border: "3px dashed",
              borderColor: "primary.500",
              borderRadius: "md",
              pointerEvents: "none",
            }}
          >
            <Sheet
              variant="solid"
              color="primary"
              sx={{ px: 4, py: 2, borderRadius: "md", boxShadow: "lg" }}
            >
              <Typography level="title-lg" sx={{ color: "primary.softColor" }}>
                Drop to upload
              </Typography>
            </Sheet>
          </Box>
        )}
        {/* Sidebar nav content shared between desktop + mobile drawer */}
        {(() => {
          const sidebarNav = (
            <>
              {!specialView && (
                <Dropdown>
                  <MenuButton
                    slots={{ root: Button }}
                    slotProps={{
                      root: {
                        variant: "soft",
                        color: "neutral",
                        size: "lg",
                        startDecorator: <Icons.Add />,
                        sx: {
                          borderRadius: "xl",
                          boxShadow: "sm",
                          mb: 2,
                          justifyContent: "flex-start",
                          width: "fit-content",
                          pl: 2.5,
                          pr: 3,
                        },
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      } as any,
                    }}
                  >
                    New
                  </MenuButton>
                  <Menu placement="bottom-start" sx={{ minWidth: 220 }}>
                    <MenuItem onClick={onNewFolder}>
                      <Icons.CreateNewFolder sx={{ mr: 1 }} />
                      New folder
                    </MenuItem>
                    <Divider />
                    <MenuItem onClick={open}>
                      <Icons.CloudUpload sx={{ mr: 1 }} />
                      File upload
                    </MenuItem>
                  </Menu>
                </Dropdown>
              )}
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.25,
                  mt: 1,
                }}
              >
                <NavItem
                  label="My Drive"
                  icon={<Icons.Folder fontSize="small" />}
                  active={parent === "" && !specialView}
                  to="/drive"
                />
                <NavItem
                  label="Shared with me"
                  icon={<Icons.People fontSize="small" />}
                  active={sharedView}
                  to="/drive?view=shared"
                />
                <NavItem
                  label="Starred"
                  icon={<Icons.Star fontSize="small" />}
                  active={starredView}
                  to="/drive?view=starred"
                />
                <NavItem
                  label="Recent"
                  icon={<Icons.Schedule fontSize="small" />}
                  active={recentView}
                  to="/drive?view=recent"
                />
                <NavItem
                  label="Trash"
                  icon={<Icons.Delete fontSize="small" />}
                  active={trashView}
                  to="/drive?view=trash"
                />
              </Box>
              <Box sx={{ mt: "auto", pt: 2 }}>
                <NavItem
                  label="Storage"
                  icon={<Icons.Storage fontSize="small" />}
                  disabled
                />
              </Box>
            </>
          );
          return (
            <>
              {/* Desktop sidebar */}
              <Sheet
                variant="plain"
                sx={{
                  width: 256,
                  flexShrink: 0,
                  borderRight: "1px solid",
                  borderColor: "divider",
                  display: { xs: "none", md: "flex" },
                  flexDirection: "column",
                  py: 2,
                  px: 1.5,
                  bgcolor: "background.surface",
                }}
              >
                {sidebarNav}
              </Sheet>
              {/* Mobile sidebar drawer */}
              <Drawer
                open={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                size="sm"
                sx={{ display: { xs: "flex", md: "none" } }}
              >
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    py: 2,
                    px: 1.5,
                    height: "100%",
                  }}
                >
                  {sidebarNav}
                </Box>
              </Drawer>
            </>
          );
        })()}

        {/* Main content */}
        <Box
          sx={{
            flex: 1,
            p: { xs: 1.5, sm: 3 },
            minWidth: 0,
            overflowX: "hidden",
          }}
        >
          {/* Breadcrumb */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mb: 2,
              flexWrap: "wrap",
            }}
          >
            {/* Mobile hamburger */}
            <IconButton
              size="sm"
              variant="plain"
              color="neutral"
              sx={{ display: { xs: "inline-flex", md: "none" } }}
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Icons.Menu />
            </IconButton>
            {specialView ? (
              <Typography level="h3" sx={{ fontWeight: 500 }}>
                {locationName}
              </Typography>
            ) : (
              <>
                <RouterLink
                  to="/drive"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <Typography level="h3" sx={{ fontWeight: 500 }}>
                    My Drive
                  </Typography>
                </RouterLink>
                {parent && (
                  <>
                    <Icons.ChevronRight sx={{ opacity: 0.5 }} />
                    <Typography
                      level="h3"
                      sx={{
                        fontWeight: 500,
                        opacity: 0.7,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 360,
                      }}
                    >
                      {folderName || "…"}
                    </Typography>
                  </>
                )}
              </>
            )}
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Search and filter">
              <IconButton
                variant={showFilters || filtersActive ? "solid" : "plain"}
                color={showFilters || filtersActive ? "primary" : "neutral"}
                size="sm"
                aria-label="Search and filter"
                onClick={() => setShowFilters((v) => !v)}
              >
                <Icons.FilterList />
              </IconButton>
            </Tooltip>
            <IconButton
              variant={view === "grid" ? "solid" : "plain"}
              color={view === "grid" ? "primary" : "neutral"}
              size="sm"
              aria-label="Grid view"
              onClick={() => setView("grid")}
            >
              <Icons.GridView />
            </IconButton>
            <IconButton
              variant={view === "list" ? "solid" : "plain"}
              color={view === "list" ? "primary" : "neutral"}
              size="sm"
              aria-label="List view"
              onClick={() => setView("list")}
            >
              <Icons.ViewList />
            </IconButton>
            <Tooltip title="View details">
              <IconButton
                variant={selected ? "solid" : "plain"}
                color={selected ? "primary" : "neutral"}
                size="sm"
                aria-label="View details"
                data-testid="toggle-details"
                disabled={!busy && files.length === 0}
                onClick={() => {
                  if (selected) {
                    setSelected(null);
                    setShareIntentTick(0);
                  } else {
                    // Open details for the first visible file/folder as a sensible default.
                    const first = filtered[0] ?? files[0];
                    if (first) {
                      setSelected(first);
                      setShareIntentTick(0);
                    }
                  }
                }}
              >
                <Icons.InfoOutlined />
              </IconButton>
            </Tooltip>
          </Box>

          {/* Advanced search / filter bar */}
          {showFilters && (
            <Sheet
              variant="soft"
              data-testid="drive-filter-bar"
              sx={{
                p: 1.5,
                mb: 2,
                borderRadius: "md",
                display: "flex",
                flexWrap: "wrap",
                gap: 1.5,
                alignItems: "center",
              }}
            >
              <Input
                size="sm"
                placeholder="Search in this folder"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                startDecorator={<Icons.Search fontSize="small" />}
                endDecorator={
                  query ? (
                    <IconButton
                      size="sm"
                      variant="plain"
                      onClick={() => setQuery("")}
                      aria-label="Clear search"
                    >
                      <Icons.Close fontSize="small" />
                    </IconButton>
                  ) : null
                }
                sx={{ flex: "1 1 220px", minWidth: 180 }}
                data-testid="drive-search-input"
              />
              <Select
                size="sm"
                value={typeFilter}
                onChange={(_, v) => v && setTypeFilter(v)}
                startDecorator={<Icons.Category fontSize="small" />}
                sx={{ minWidth: 160 }}
                data-testid="drive-type-filter"
                slotProps={{ button: { "aria-label": "Filter by type" } }}
              >
                {(Object.keys(TYPE_FILTER_LABELS) as TypeFilter[]).map((t) => (
                  <Option key={t} value={t}>
                    {TYPE_FILTER_LABELS[t]}
                  </Option>
                ))}
              </Select>
              <Select
                size="sm"
                value={ownerFilter}
                onChange={(_, v) => v && setOwnerFilter(v)}
                startDecorator={<Icons.Person fontSize="small" />}
                sx={{ minWidth: 150 }}
                data-testid="drive-owner-filter"
                slotProps={{ button: { "aria-label": "Filter by owner" } }}
              >
                <Option value="all">Any owner</Option>
                <Option value="me">Owned by me</Option>
                <Option value="others">Not owned by me</Option>
              </Select>
              {filtersActive && (
                <Button
                  size="sm"
                  variant="plain"
                  color="neutral"
                  startDecorator={<Icons.ClearAll />}
                  onClick={clearFilters}
                >
                  Clear
                </Button>
              )}
              <Box sx={{ flex: 1 }} />
              <Chip size="sm" variant="outlined" color="neutral">
                {filtered.length} of {files.length}
              </Chip>
            </Sheet>
          )}

          {error && (
            <Typography color="danger" sx={{ mb: 2 }}>
              {error}
            </Typography>
          )}

          {busy && <Typography sx={{ opacity: 0.6 }}>Loading…</Typography>}

          {!busy && files.length === 0 && (
            <Sheet
              variant="soft"
              sx={{ p: 5, textAlign: "center", borderRadius: "md", mt: 4 }}
            >
              <Icons.CloudUpload sx={{ fontSize: 48, opacity: 0.5, mb: 1 }} />
              <Typography level="body-md">
                Drop files here or use the &ldquo;+ New&rdquo; button
              </Typography>
              <Typography level="body-sm" sx={{ opacity: 0.7, mt: 0.5 }}>
                Everything you store in Drive can be opened in any other app.
              </Typography>
            </Sheet>
          )}

          {filteredEmpty && (
            <Sheet
              variant="soft"
              data-testid="drive-no-matches"
              sx={{ p: 5, textAlign: "center", borderRadius: "md", mt: 4 }}
            >
              <Icons.SearchOff sx={{ fontSize: 48, opacity: 0.5, mb: 1 }} />
              <Typography level="body-md">
                No items match your filters
              </Typography>
              <Button
                size="sm"
                variant="soft"
                startDecorator={<Icons.ClearAll />}
                onClick={clearFilters}
                sx={{ mt: 1.5 }}
              >
                Clear filters
              </Button>
            </Sheet>
          )}

          {!busy && filtered.length > 0 && (
            <Box sx={{ overflowX: "auto" }}>
              <Box
                sx={{
                  display: "grid",
                  gap: view === "grid" ? 1 : 0.5,
                  gridTemplateColumns:
                    view === "grid"
                      ? "repeat(auto-fill, minmax(160px, 1fr))"
                      : "1fr",
                  minWidth: 0,
                }}
              >
                {filtered.map((f) => (
                  <Sheet
                    key={f.id}
                    variant="outlined"
                    data-testid={`file-row-${f.id}`}
                    onContextMenu={(e) => onRowContextMenu(e, f)}
                    draggable={!isFolder(f)}
                    onDragStart={
                      !isFolder(f) ? () => setDragId(f.id) : undefined
                    }
                    onDragEnd={!isFolder(f) ? () => setDragId(null) : undefined}
                    onDragOver={
                      isFolder(f) && dragId
                        ? (e) => e.preventDefault()
                        : undefined
                    }
                    onDrop={isFolder(f) ? () => onDropOnFolder(f) : undefined}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      p: 1.5,
                      borderRadius: "sm",
                      bgcolor:
                        selected?.id === f.id
                          ? "primary.softBg"
                          : "transparent",
                      borderColor:
                        isFolder(f) && dragId && dragId !== f.id
                          ? "primary.500"
                          : selected?.id === f.id
                            ? "primary.300"
                            : "divider",
                      ...(isFolder(f) && dragId && dragId !== f.id
                        ? { outline: "2px dashed", outlineColor: "primary.400" }
                        : {}),
                      "&:hover": {
                        bgcolor:
                          selected?.id === f.id
                            ? "primary.softHoverBg"
                            : "background.level1",
                      },
                    }}
                  >
                    {isFolder(f) ? (
                      <RouterLink
                        to={`/drive?folder=${f.id}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          flex: 1,
                          color: "inherit",
                          textDecoration: "none",
                        }}
                      >
                        <Icons.Folder color="primary" />
                        <Typography sx={{ fontWeight: 500 }}>
                          {f.name}
                        </Typography>
                      </RouterLink>
                    ) : (
                      // File row: single-click selects + opens the details panel.
                      // Double-click opens the full viewer. Matches Google Drive's pattern.
                      <Box
                        onClick={() => {
                          setSelected(f);
                          // Reset share-intent so the panel doesn't auto-expand
                          // Manage access just because the user previously used Share.
                          setShareIntentTick(0);
                        }}
                        onDoubleClick={() => navigate(openFileRoute(f))}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1.5,
                          flex: 1,
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                      >
                        {fileIcon(f)}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 500 }}>
                            {f.name}
                          </Typography>
                          <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                            {formatBytes(Number(f.size_bytes))}
                          </Typography>
                        </Box>
                      </Box>
                    )}
                    {/* Star toggle — shown on hover or when already starred */}
                    {!trashView && (
                      <Tooltip title={f.starred ? "Unstar" : "Star"}>
                        <IconButton
                          variant="plain"
                          size="sm"
                          aria-label={f.starred ? "Unstar" : "Star"}
                          data-testid={`star-${f.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void onToggleStar(f);
                          }}
                          sx={{
                            color: f.starred ? "warning.400" : "neutral.400",
                            opacity: f.starred ? 1 : 0,
                            ".MuiSheet-root:hover &": { opacity: 1 },
                          }}
                        >
                          {f.starred ? (
                            <Icons.Star fontSize="small" />
                          ) : (
                            <Icons.StarBorder fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                    )}
                    {/* Trash view: Restore + Delete forever */}
                    {trashView && (
                      <>
                        <Tooltip title="Restore">
                          <IconButton
                            variant="plain"
                            size="sm"
                            color="neutral"
                            aria-label="Restore"
                            data-testid={`restore-${f.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onRestore(f.id);
                            }}
                          >
                            <Icons.RestoreFromTrash fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete forever">
                          <IconButton
                            variant="plain"
                            size="sm"
                            color="danger"
                            aria-label="Delete forever"
                            data-testid={`delete-forever-${f.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onDeleteForever(f.id);
                            }}
                          >
                            <Icons.DeleteForever fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    {!trashView && (
                      <Dropdown>
                        <MenuButton
                          slots={{ root: IconButton }}
                          slotProps={{
                            root: {
                              variant: "plain",
                              size: "sm",
                              "aria-label": "More actions",
                              title: "More actions",
                              "data-testid": `row-menu-${f.id}`,
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            } as any,
                          }}
                        >
                          <Icons.MoreVert />
                        </MenuButton>
                        <Menu placement="bottom-end" sx={{ minWidth: 240 }}>
                          <RowMenuItems file={f} handlers={rowHandlers} />
                        </Menu>
                      </Dropdown>
                    )}
                  </Sheet>
                ))}
              </Box>
            </Box>
          )}
        </Box>

        {/* Right-side details panel — desktop: side panel; mobile: modal */}
        {selected && !isMobile && (
          <FileDetailsPanel
            key={`${selected.id}-${shareIntentTick}`}
            file={selected}
            initialManageOpen={shareIntentTick > 0}
            currentUser={user}
            locationName={locationName}
            onClose={() => {
              setSelected(null);
              setShareIntentTick(0);
            }}
            onOpen={() => navigate(openFileRoute(selected))}
          />
        )}
        {selected && isMobile && (
          <Modal
            open
            onClose={() => {
              setSelected(null);
              setShareIntentTick(0);
            }}
          >
            <ModalDialog
              sx={{
                width: "100vw",
                maxWidth: "100vw",
                m: 0,
                p: 0,
                bottom: 0,
                top: "auto",
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
                maxHeight: "80vh",
                overflow: "auto",
              }}
            >
              <FileDetailsPanel
                key={`${selected.id}-${shareIntentTick}`}
                file={selected}
                initialManageOpen={shareIntentTick > 0}
                currentUser={user}
                locationName={locationName}
                onClose={() => {
                  setSelected(null);
                  setShareIntentTick(0);
                }}
                onOpen={() => navigate(openFileRoute(selected))}
              />
            </ModalDialog>
          </Modal>
        )}
      </Box>

      {/* Move-to folder picker. */}
      {moveTarget && (
        <MoveDialog
          file={moveTarget}
          onMove={onMoveConfirm}
          onClose={() => setMoveTarget(null)}
        />
      )}

      {/* Version history dialog. */}
      {versionsTarget && (
        <VersionsDialog
          file={versionsTarget}
          onClose={() => setVersionsTarget(null)}
          onRestored={() => {
            void refresh();
          }}
        />
      )}

      {/* Right-click context menu — fixed position at the cursor.
          A backdrop catches outside clicks; mousedown listener on document
          handles clicks that bubble past the menu. */}
      {ctxMenu && (
        <MenuList
          ref={ctxMenuRef}
          variant="outlined"
          data-testid="row-context-menu"
          sx={{
            position: "fixed",
            top: ctxMenu.y,
            left: ctxMenu.x,
            zIndex: 1300,
            minWidth: 240,
            boxShadow: "lg",
            bgcolor: "background.popup",
            borderRadius: "sm",
            py: 0.5,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <RowMenuItems
            file={ctxMenu.file}
            handlers={rowHandlers}
            onItemClicked={() => setCtxMenu(null)}
            flatShare
          />
        </MenuList>
      )}
    </>
  );
}

interface NavItemProps {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  to?: string;
}

function NavItem({ label, icon, active, disabled, to }: NavItemProps) {
  const inner = (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1,
        borderRadius: "xl",
        cursor: disabled ? "default" : "pointer",
        color: disabled ? "neutral.400" : "inherit",
        bgcolor: active ? "primary.softBg" : "transparent",
        fontWeight: active ? 600 : 400,
        "&:hover": disabled ? {} : { bgcolor: "background.level1" },
      }}
    >
      {icon}
      <Typography
        level="body-sm"
        sx={{ color: "inherit", fontWeight: "inherit" }}
      >
        {label}
      </Typography>
    </Box>
  );

  if (disabled || !to) return inner;

  return (
    <RouterLink to={to} style={{ textDecoration: "none", color: "inherit" }}>
      {inner}
    </RouterLink>
  );
}

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
