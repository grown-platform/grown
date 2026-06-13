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
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { downloadURL } from "../drive/api";
import type { DriveFile } from "../drive/types";
import { ModelViewer } from "./Viewer";
import { DrivePicker } from "./DrivePicker";
import { extOf } from "./formats";

export default function ThreeDApp({ user }: { user: User }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<ModelViewer | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The name of the currently-loaded model, or null for a blank "New model".
  const [modelName, setModelName] = useState<string | null>(null);

  // Spin up the three.js viewer once the mount node exists; tear it down on
  // unmount. The viewer starts on an empty grid (a fresh "New model" canvas).
  useEffect(() => {
    if (!mountRef.current) return;
    const viewer = new ModelViewer(mountRef.current);
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  function newModel() {
    setError(null);
    setModelName(null);
    viewerRef.current?.newScene();
  }

  async function openFromDrive(file: DriveFile) {
    setPickerOpen(false);
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
            {/* TODO(follow-ups): Save back to Drive + Export glTF/STL. */}
            <MenuItem disabled>Save (coming soon)</MenuItem>
            <MenuItem disabled>Export (coming soon)</MenuItem>
          </Menu>
        </Dropdown>

        <Button
          variant="plain"
          size="sm"
          startDecorator={<CenterFocusStrongIcon />}
          onClick={() => viewerRef.current?.fitToView()}
        >
          Fit to view
        </Button>

        <Box sx={{ flex: 1 }} />

        <Typography level="body-sm" sx={{ opacity: 0.7 }} noWrap>
          {modelName ?? "Untitled (new model)"}
        </Typography>
      </Sheet>

      {/* Viewport */}
      <Box sx={{ position: "relative", flex: 1, minHeight: 0 }}>
        <Box ref={mountRef} sx={{ position: "absolute", inset: 0 }} />

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

        {!modelName && !loading && !error && (
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
              Empty canvas — use File ▸ Open existing model to load one, or drag
              to orbit. Pan with right-drag, zoom with scroll.
            </Typography>
          </Box>
        )}
      </Box>

      <DrivePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={openFromDrive}
      />
    </Box>
  );
}
