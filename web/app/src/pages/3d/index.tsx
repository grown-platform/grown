/**
 * 3D — a browser 3D model viewer, and the first step toward a SketchUp-style
 * modeler. This pass delivers:
 *   - a File menu (Open existing model / New model, plus stubbed Save/Export)
 *   - "Open existing model": a Drive picker filtered to 3D formats; the chosen
 *     file's bytes are fetched and loaded into the viewport
 *   - "New model": a blank scene with a ground grid (the editor seed)
 *   - orbit/pan/zoom, fit-to-view, grid/ground, graceful load errors
 *
 * Viewer engine: three.js (see Viewer.ts for the rationale).
 *
 * Formats: glb, gltf, obj, stl, ply render today; fbx/3ds/dae/off/3mf/wrl are
 * recognized by the picker and surface a clear "not yet supported" message.
 *
 * TODO(follow-ups):
 *   - Per-file "public" toggle + a public gallery (serve public models with no
 *     auth). Structure: add a `public` flag on the model's Drive metadata and a
 *     `/3d/p/:id` unauthenticated route + a gallery list.
 *   - Actual editing / SketchUp-style modeling: grow `newScene()` in Viewer.ts
 *     into an edit mode (selection, transform gizmos, push/pull, save back to
 *     Drive as glTF).
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Box,
  Sheet,
  Typography,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  Button,
  CircularProgress,
} from "@mui/joy";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import GridViewIcon from "@mui/icons-material/GridView";
import EditIcon from "@mui/icons-material/Edit";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { downloadURL, getFile } from "../drive/api";
import type { DriveFile } from "../drive/types";
import { ModelViewer } from "./Viewer";
import { CameraControls } from "./CameraControls";
import { DrivePicker } from "./DrivePicker";
import { ModelLibrary } from "./ModelLibrary";
import { extOf } from "./formats";
import { Editor } from "./editor/Editor";
import { EditorOverlay } from "./editor/EditorOverlay";
import { saveGlbToDrive, downloadGlb } from "./editor/save";

export default function ThreeDApp({ user }: { user: User }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<ModelViewer | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // Viewer mirrored to state so viewport chrome (e.g. CameraControls) mounts
  // once the viewer exists.
  const [viewer, setViewer] = useState<ModelViewer | null>(null);

  // The app lands on the Model Library (a gallery of the user's /models). The
  // viewer takes over the viewport once the user opens a model or starts a new
  // one; "Library" returns to the gallery.
  const [view, setView] = useState<"library" | "viewer">("library");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The name of the currently-loaded model, or null for a blank "New model".
  const [modelName, setModelName] = useState<string | null>(null);
  // Whether the modeling toolset (Editor.ts) is active over the viewport.
  const [editing, setEditing] = useState(false);
  // Editor instance, mirrored to state so the overlay re-mounts when it changes.
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // A model queued to load once the viewer mounts (e.g. clicked from library).
  const pendingFileRef = useRef<DriveFile | null>(null);
  // Deep-link support: /3d?file=<driveId> opens that model directly (e.g. from
  // Drive's "Open" on a 3D file, or a 3D-preview "Open in 3D" button).
  const [searchParams] = useSearchParams();

  // Spin up the three.js viewer once the viewport's mount node exists (i.e. in
  // viewer mode); tear it down when we leave viewer mode. The viewer starts on
  // an empty grid, then loads any model queued before the mount existed.
  useEffect(() => {
    if (view !== "viewer" || !mountRef.current) return;
    const viewer = new ModelViewer(mountRef.current);
    viewerRef.current = viewer;
    setViewer(viewer);
    const pending = pendingFileRef.current;
    pendingFileRef.current = null;
    if (pending) void loadIntoViewer(pending);
    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
      setEditor(null);
      setEditing(false);
      viewer.dispose();
      viewerRef.current = null;
      setViewer(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Create/tear down the modeling Editor (layered on the viewer's scene) as the
  // user toggles edit mode. The Editor borrows the viewer's scene/camera/etc.
  useEffect(() => {
    if (editing && viewerRef.current && !editorRef.current) {
      const ed = new Editor(viewerRef.current);
      editorRef.current = ed;
      setEditor(ed);
    } else if (!editing && editorRef.current) {
      editorRef.current.dispose();
      editorRef.current = null;
      setEditor(null);
    }
  }, [editing]);

  // On mount, honor a ?file=<driveId> deep-link by fetching that file's
  // metadata and opening it in the viewer (switching out of the library view).
  useEffect(() => {
    const fileId = searchParams.get("file");
    if (!fileId) return;
    let alive = true;
    getFile(fileId)
      .then((f) => {
        if (alive) openModel(f);
      })
      .catch((e) => {
        if (alive) setError(`Couldn't open that model: ${(e as Error).message}`);
      });
    return () => {
      alive = false;
    };
    // Run once on mount for the initial deep-link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function newModel() {
    setError(null);
    setModelName(null);
    pendingFileRef.current = null;
    if (view !== "viewer") {
      setView("viewer");
    } else {
      viewerRef.current?.newScene();
    }
  }

  async function handleSave(download: boolean) {
    const ed = editorRef.current;
    if (!ed) {
      setStatus("Enter Edit mode to save a model.");
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const bytes = await ed.exportGLB();
      const name = modelName ?? "Untitled";
      if (download) {
        downloadGlb(bytes, name);
        setStatus("Downloaded .glb");
      } else {
        const file = await saveGlbToDrive(bytes, name);
        setModelName(file.name);
        setStatus(`Saved to Drive ▸ models ▸ ${file.name}`);
      }
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function loadIntoViewer(file: DriveFile) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(downloadURL(file.id), {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(`Couldn't download file (${res.status}).`);
      }
      const bytes = await res.arrayBuffer();
      await viewerRef.current?.loadModel(bytes, extOf(file.name), file.name);
      setModelName(file.name);
    } catch (e) {
      setError((e as Error).message);
      setModelName(null);
    } finally {
      setLoading(false);
    }
  }

  /** Open a model in the viewer. If the viewer isn't mounted yet, queue it so
   *  the mount effect loads it once the viewport exists. */
  function openModel(file: DriveFile) {
    if (view !== "viewer" || !viewerRef.current) {
      pendingFileRef.current = file;
      setView("viewer");
      return;
    }
    void loadIntoViewer(file);
  }

  function openFromDrive(file: DriveFile) {
    setPickerOpen(false);
    openModel(file);
  }

  return (
    <Box
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.body",
      }}
    >
      <Header user={user} />

      {/* Menu bar */}
      <Sheet
        variant="outlined"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 0.75,
          borderLeft: 0,
          borderRight: 0,
          flexWrap: "wrap",
        }}
      >
        <ViewInArIcon sx={{ color: "#6750A4" }} />
        <Typography level="title-sm" sx={{ mr: 1 }}>
          3D
        </Typography>

        <Dropdown>
          <MenuButton variant="plain" size="sm">
            File
          </MenuButton>
          <Menu size="sm" placement="bottom-start">
            <MenuItem onClick={() => setPickerOpen(true)}>
              Open existing model…
            </MenuItem>
            <MenuItem onClick={newModel}>New model</MenuItem>
            <ListDivider />
            <MenuItem
              disabled={!editing || saving}
              onClick={() => void handleSave(false)}
            >
              Save to Drive (.glb)
            </MenuItem>
            <MenuItem
              disabled={!editing || saving}
              onClick={() => void handleSave(true)}
            >
              Export / Download (.glb)
            </MenuItem>
          </Menu>
        </Dropdown>

        <Button
          variant={view === "library" ? "soft" : "plain"}
          size="sm"
          startDecorator={<GridViewIcon />}
          onClick={() => setView("library")}
        >
          Library
        </Button>

        {view === "viewer" && (
          <Button
            variant="plain"
            size="sm"
            startDecorator={<CenterFocusStrongIcon />}
            onClick={() => viewerRef.current?.fitToView()}
          >
            Fit to view
          </Button>
        )}

        {view === "viewer" && (
          <Button
            variant={editing ? "soft" : "plain"}
            color={editing ? "primary" : "neutral"}
            size="sm"
            startDecorator={<EditIcon />}
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? "Editing" : "Edit"}
          </Button>
        )}

        <Box sx={{ flex: 1 }} />

        {saving && <CircularProgress size="sm" />}
        {status && (
          <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
            {status}
          </Typography>
        )}

        <Typography level="body-sm" sx={{ opacity: 0.7 }} noWrap>
          {view === "library"
            ? "Model Library"
            : (modelName ?? "Untitled (new model)")}
        </Typography>
      </Sheet>

      {/* Library is the landing view; the viewport mounts only in viewer mode
          (its ref drives viewer setup). We keep both branches in one return so
          mountRef stays stable across renders within viewer mode. */}
      {view === "library" ? (
        <ModelLibrary onOpen={openModel} />
      ) : (
        <Box sx={{ position: "relative", flex: 1, minHeight: 0 }}>
          <Box ref={mountRef} sx={{ position: "absolute", inset: 0 }} />

          {editing && editor && <EditorOverlay editor={editor} />}

          {viewer && <CameraControls viewer={viewer} />}

          {loading && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "rgba(255,255,255,0.4)",
              }}
            >
              <CircularProgress />
            </Box>
          )}

          {error && (
            <Sheet
              variant="soft"
              color="danger"
              sx={{
                position: "absolute",
                top: 12,
                left: "50%",
                transform: "translateX(-50%)",
                px: 2,
                py: 1,
                borderRadius: "md",
                maxWidth: "90%",
              }}
            >
              <Typography level="body-sm" color="danger">
                {error}
              </Typography>
            </Sheet>
          )}

          {!modelName && !loading && !error && !editing && (
            <Box
              sx={{
                position: "absolute",
                bottom: 16,
                left: 0,
                right: 0,
                textAlign: "center",
                pointerEvents: "none",
              }}
            >
              <Typography level="body-sm" sx={{ opacity: 0.55 }}>
                Empty canvas — use File ▸ Open existing model to load one, or
                drag to orbit. Pan with right-drag, zoom with scroll.
              </Typography>
            </Box>
          )}
        </Box>
      )}

      <DrivePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={openFromDrive}
      />
    </Box>
  );
}
