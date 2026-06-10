import { Box, Dropdown, Menu, MenuButton, MenuItem, Divider } from "@mui/joy";
import * as Icons from "@mui/icons-material";
import type { DriveFile } from "./types";
import { isFolder } from "./types";
import { editorAppFor } from "./editorRoutes";
import { apps } from "../../catalog/apps";

export interface RowMenuHandlers {
  onOpen: (f: DriveFile) => void; // opens in the file's mapped editor (CSV→Sheets, etc.) or FileViewer
  onPreview: (f: DriveFile) => void; // forces the generic FileViewer regardless of mime
  onOpenInNewTab: (f: DriveFile) => void;
  onDownload: (f: DriveFile) => void;
  onRename: (f: DriveFile) => void;
  onMakeCopy: (f: DriveFile) => void; // duplicates a file in the same folder
  onMove: (f: DriveFile) => void; // opens the move-to folder picker
  onManageVersions: (f: DriveFile) => void; // opens the version history dialog (files only)
  onShareOpenPanel: (f: DriveFile) => void;
  onCopyLink: (f: DriveFile) => void;
  onShowDetails: (f: DriveFile) => void; // open the side panel on Details tab
  onToggleStar: (f: DriveFile) => void; // star or unstar a file
  onTrash: (id: string) => void;
}

interface RowMenuItemsProps {
  file: DriveFile;
  handlers: RowMenuHandlers;
  /** Called after any *terminal* item is clicked so callers (e.g. the right-click
   *  context menu) can close their popover. The standard Dropdown auto-closes,
   *  so the triple-dot menu can pass undefined. */
  onItemClicked?: () => void;
  /** When true, Share + Copy link render as flat top-level items instead of a
   *  hover-submenu. The right-click context menu sets this because nested
   *  hover-submenus are unreliable inside a hand-rolled fixed-position MenuList
   *  (they live outside a real Joy <Menu> context), so a single click on Share
   *  would do nothing. The triple-dot menu keeps the nested submenu. */
  flatShare?: boolean;
}

/**
 * Shared menu items for the file-row triple-dot menu and the right-click
 * context menu. Layout mirrors Google Drive's row context menu — see the
 * design captures in research/. Disabled items are placeholders for features
 * not yet built (Make a copy, Ask Gemini, Organize, Labels).
 */
export function RowMenuItems({
  file: f,
  handlers,
  onItemClicked,
  flatShare,
}: RowMenuItemsProps) {
  const wrap = (fn: () => void) => () => {
    fn();
    onItemClicked?.();
  };

  const editorAppId = editorAppFor(f);
  const editor = editorAppId ? apps.find((a) => a.id === editorAppId) : null;
  const EditorIcon = editor
    ? (
        Icons as Record<
          string,
          React.ComponentType<{ sx?: object; fontSize?: "small" | "inherit" }>
        >
      )[editor.iconName]
    : null;

  return (
    <>
      {/* Open / Open with — submenu for files (with editor), plain Open for folders. */}
      {isFolder(f) ? (
        <MenuItem onClick={wrap(() => handlers.onOpen(f))}>
          <Icons.FolderOpen sx={{ mr: 1 }} fontSize="small" />
          Open
        </MenuItem>
      ) : (
        <Dropdown>
          <MenuButton
            slots={{ root: MenuItem }}
            slotProps={{
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              root: { "data-testid": `open-with-${f.id}` } as any,
            }}
          >
            <Icons.OpenWith sx={{ mr: 1 }} fontSize="small" />
            <Box sx={{ flex: 1 }}>Open with</Box>
            <Icons.ChevronRight fontSize="small" sx={{ opacity: 0.6 }} />
          </MenuButton>
          <Menu placement="right-start" sx={{ minWidth: 220 }}>
            <MenuItem onClick={wrap(() => handlers.onPreview(f))}>
              <Icons.Visibility sx={{ mr: 1 }} fontSize="small" />
              Preview
            </MenuItem>
            <MenuItem onClick={wrap(() => handlers.onOpenInNewTab(f))}>
              <Icons.OpenInNew sx={{ mr: 1 }} fontSize="small" />
              Open in new tab
            </MenuItem>
            {editor && EditorIcon && (
              <MenuItem onClick={wrap(() => handlers.onOpen(f))}>
                <Box
                  sx={{
                    mr: 1,
                    width: 20,
                    height: 20,
                    borderRadius: "4px",
                    bgcolor: editor.accentColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                  }}
                >
                  <EditorIcon sx={{ fontSize: 14 }} />
                </Box>
                {editor.name}
              </MenuItem>
            )}
          </Menu>
        </Dropdown>
      )}

      {!isFolder(f) && (
        <MenuItem onClick={wrap(() => handlers.onDownload(f))}>
          <Icons.Download sx={{ mr: 1 }} fontSize="small" />
          Download
        </MenuItem>
      )}

      <MenuItem onClick={wrap(() => handlers.onRename(f))}>
        <Icons.DriveFileRenameOutline sx={{ mr: 1 }} fontSize="small" />
        Rename
      </MenuItem>

      {/* Make a copy — files only (folder copy not supported in V1). */}
      {!isFolder(f) && (
        <MenuItem
          onClick={wrap(() => handlers.onMakeCopy(f))}
          data-testid={`make-copy-${f.id}`}
        >
          <Icons.ContentCopy sx={{ mr: 1 }} fontSize="small" />
          Make a copy
        </MenuItem>
      )}

      <MenuItem disabled>
        <Icons.AutoAwesome sx={{ mr: 1 }} fontSize="small" />
        Ask Gemini
      </MenuItem>

      <Divider />

      {/* Share — Share + Copy link work; eSign + Approvals placeholder. The
          right-click context menu (flatShare) renders these as direct one-click
          items; the triple-dot menu nests them in a hover-submenu. */}
      {flatShare ? (
        <>
          <MenuItem
            onClick={wrap(() => handlers.onShareOpenPanel(f))}
            data-testid={`share-item-${f.id}`}
          >
            <Icons.PersonAdd sx={{ mr: 1 }} fontSize="small" />
            Share
          </MenuItem>
          <MenuItem
            onClick={wrap(() => handlers.onCopyLink(f))}
            data-testid={`copy-link-${f.id}`}
          >
            <Icons.Link sx={{ mr: 1 }} fontSize="small" />
            Copy link
          </MenuItem>
        </>
      ) : (
        <Dropdown>
          <MenuButton
            slots={{ root: MenuItem }}
            slotProps={{
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              root: { "data-testid": `share-submenu-${f.id}` } as any,
            }}
          >
            <Icons.PersonAdd sx={{ mr: 1 }} fontSize="small" />
            <Box sx={{ flex: 1 }}>Share</Box>
            <Icons.ChevronRight fontSize="small" sx={{ opacity: 0.6 }} />
          </MenuButton>
          <Menu placement="right-start" sx={{ minWidth: 220 }}>
            <MenuItem
              onClick={wrap(() => handlers.onShareOpenPanel(f))}
              data-testid={`share-item-${f.id}`}
            >
              <Icons.PersonAdd sx={{ mr: 1 }} fontSize="small" />
              Share
            </MenuItem>
            <MenuItem
              onClick={wrap(() => handlers.onCopyLink(f))}
              data-testid={`copy-link-${f.id}`}
            >
              <Icons.Link sx={{ mr: 1 }} fontSize="small" />
              Copy link
            </MenuItem>
            <MenuItem disabled>
              <Icons.HistoryEdu sx={{ mr: 1 }} fontSize="small" />
              Request eSignature
            </MenuItem>
            <MenuItem disabled>
              <Icons.AssignmentTurnedIn sx={{ mr: 1 }} fontSize="small" />
              Approvals
            </MenuItem>
          </Menu>
        </Dropdown>
      )}

      {/* Organize submenu — all disabled placeholders for now. */}
      <Dropdown>
        <MenuButton slots={{ root: MenuItem }}>
          <Icons.DriveFileMove sx={{ mr: 1 }} fontSize="small" />
          <Box sx={{ flex: 1 }}>Organize</Box>
          <Icons.ChevronRight fontSize="small" sx={{ opacity: 0.6 }} />
        </MenuButton>
        <Menu placement="right-start" sx={{ minWidth: 220 }}>
          <MenuItem
            onClick={wrap(() => handlers.onMove(f))}
            data-testid={`move-to-${f.id}`}
          >
            <Icons.DriveFileMove sx={{ mr: 1 }} fontSize="small" />
            Move to
          </MenuItem>
          <MenuItem disabled>
            <Icons.AddLink sx={{ mr: 1 }} fontSize="small" />
            Add shortcut
          </MenuItem>
          <MenuItem
            onClick={wrap(() => handlers.onToggleStar(f))}
            data-testid={`toggle-star-${f.id}`}
          >
            {f.starred ? (
              <Icons.Star
                sx={{ mr: 1, color: "warning.400" }}
                fontSize="small"
              />
            ) : (
              <Icons.StarBorder sx={{ mr: 1 }} fontSize="small" />
            )}
            {f.starred ? "Remove from starred" : "Add to starred"}
          </MenuItem>
        </Menu>
      </Dropdown>

      {/* File information submenu — Details opens the side panel; versions for files. */}
      <Dropdown>
        <MenuButton slots={{ root: MenuItem }}>
          <Icons.InfoOutlined sx={{ mr: 1 }} fontSize="small" />
          <Box sx={{ flex: 1 }}>File information</Box>
          <Icons.ChevronRight fontSize="small" sx={{ opacity: 0.6 }} />
        </MenuButton>
        <Menu placement="right-start" sx={{ minWidth: 220 }}>
          <MenuItem onClick={wrap(() => handlers.onShowDetails(f))}>
            <Icons.InfoOutlined sx={{ mr: 1 }} fontSize="small" />
            Details
          </MenuItem>
          {!isFolder(f) && (
            <MenuItem
              onClick={wrap(() => handlers.onManageVersions(f))}
              data-testid={`manage-versions-${f.id}`}
            >
              <Icons.History sx={{ mr: 1 }} fontSize="small" />
              Manage versions
            </MenuItem>
          )}
          <MenuItem disabled>
            <Icons.QueryStats sx={{ mr: 1 }} fontSize="small" />
            Activity
          </MenuItem>
        </Menu>
      </Dropdown>

      {/* Labels — disabled placeholder. */}
      <MenuItem disabled>
        <Icons.Label sx={{ mr: 1 }} fontSize="small" />
        <Box sx={{ flex: 1 }}>Labels</Box>
        <Icons.ChevronRight fontSize="small" sx={{ opacity: 0.4 }} />
      </MenuItem>

      <Divider />

      <MenuItem
        color="danger"
        onClick={wrap(() => handlers.onTrash(f.id))}
        data-testid={`trash-${f.id}`}
      >
        <Icons.Delete sx={{ mr: 1 }} fontSize="small" />
        Move to trash
      </MenuItem>
    </>
  );
}
