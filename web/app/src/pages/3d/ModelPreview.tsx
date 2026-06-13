/**
 * ModelPreview — an inline, interactive 3D viewer for a single Drive model file.
 *
 * Used by Drive's FilePreview so opening a 3D model (glb/gltf/obj/stl/ply) shows
 * a live, orbitable preview right in the file viewer, plus an "Open in 3D"
 * button that hands off to the full 3D app (/3d?file=<id>) for fit-to-view,
 * editing, etc. Formats the embedded viewer can't render yet (fbx/3ds/dae/…)
 * skip the live canvas and just offer the open/download affordances.
 *
 * The viewer spins up its own three.js ModelViewer scoped to a mount div and is
 * torn down on unmount, so it doesn't leak WebGL contexts as users browse Drive.
 */
import { useEffect, useRef, useState } from "react";
import { Box, Button, CircularProgress, Typography } from "@mui/joy";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Link as RouterLink } from "react-router-dom";
import type { DriveFile } from "../drive/types";
import { downloadURL } from "../drive/api";
import { ModelViewer } from "./Viewer";
import { extOf, isRenderable } from "./formats";

export function ModelPreview({ file }: { file: DriveFile }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const renderable = isRenderable(file.name);

  useEffect(() => {
    if (!renderable || !mountRef.current) {
      setLoading(false);
      return;
    }
    const viewer = new ModelViewer(mountRef.current);
    let alive = true;
    (async () => {
      try {
        const res = await fetch(downloadURL(file.id), {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`download ${res.status}`);
        const bytes = await res.arrayBuffer();
        if (!alive) return;
        await viewer.loadModel(bytes, extOf(file.name), file.name);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      viewer.dispose();
    };
  }, [file.id, file.name, renderable]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <ViewInArIcon sx={{ color: "#6750A4" }} />
        <Typography level="title-sm" sx={{ flex: 1 }} noWrap>
          {file.name}
        </Typography>
        <Button
          component={RouterLink}
          to={`/3d?file=${file.id}`}
          size="sm"
          startDecorator={<OpenInNewIcon />}
        >
          Open in 3D
        </Button>
      </Box>

      {renderable ? (
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height: "70vh",
            borderRadius: "md",
            overflow: "hidden",
            bgcolor: "#0e1116",
          }}
        >
          <Box ref={mountRef} sx={{ position: "absolute", inset: 0 }} />
          {loading && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CircularProgress />
            </Box>
          )}
          {error && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "common.white",
                gap: 1,
                px: 2,
                textAlign: "center",
              }}
            >
              <Typography level="body-sm" sx={{ color: "inherit" }}>
                Couldn't render this model ({error}).
              </Typography>
              <Button
                component="a"
                href={downloadURL(file.id)}
                download={file.name}
                size="sm"
                variant="outlined"
              >
                Download instead
              </Button>
            </Box>
          )}
        </Box>
      ) : (
        <Box
          sx={{
            py: 6,
            px: 2,
            textAlign: "center",
            borderRadius: "md",
            bgcolor: "background.level1",
          }}
        >
          <Typography level="body-md" sx={{ mb: 1 }}>
            {extOf(file.name).toUpperCase()} models aren't rendered inline yet —
            open them in the 3D app or download the file.
          </Typography>
          <Button
            component="a"
            href={downloadURL(file.id)}
            download={file.name}
            variant="outlined"
          >
            Download {file.name}
          </Button>
        </Box>
      )}

      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
        Drag to orbit · right-drag to pan · scroll to zoom
      </Typography>
    </Box>
  );
}
