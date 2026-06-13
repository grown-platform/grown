/**
 * CameraControls — a small floating viewport control for camera projection:
 * a Perspective ↔ Parallel (orthographic) toggle and, in perspective mode, a
 * field-of-view slider. It drives the imperative ModelViewer (which owns both
 * cameras and re-wires OrbitControls on swap); this component only mirrors and
 * forwards the projection/FOV state.
 *
 * Lives in the viewport (bottom-right) so it's available in both view and edit
 * modes; it doesn't depend on the Editor.
 */
import { useState } from "react";
import { Sheet, ToggleButtonGroup, Button, Slider, Box, Typography } from "@mui/joy";
import VideocamIcon from "@mui/icons-material/Videocam";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import type { ModelViewer, Projection } from "./Viewer";

export function CameraControls({ viewer }: { viewer: ModelViewer }) {
  const [projection, setProjection] = useState<Projection>(
    viewer.getProjection(),
  );
  const [fov, setFov] = useState<number>(viewer.getFov());

  function changeProjection(p: Projection) {
    viewer.setProjection(p);
    setProjection(p);
  }

  function changeFov(v: number) {
    viewer.setFov(v);
    setFov(v);
  }

  return (
    <Sheet
      variant="outlined"
      sx={{
        position: "absolute",
        bottom: 12,
        right: 12,
        borderRadius: "md",
        px: 1,
        py: 0.75,
        zIndex: 5,
        boxShadow: "sm",
        display: "flex",
        alignItems: "center",
        gap: 1,
      }}
    >
      <ToggleButtonGroup
        size="sm"
        value={projection}
        onChange={(_, v) => v && changeProjection(v as Projection)}
      >
        <Button value="perspective" startDecorator={<VideocamIcon />}>
          Perspective
        </Button>
        <Button value="orthographic" startDecorator={<ViewInArIcon />}>
          Parallel
        </Button>
      </ToggleButtonGroup>

      {projection === "perspective" && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, pl: 0.5 }}>
          <Typography level="body-xs" sx={{ opacity: 0.7, whiteSpace: "nowrap" }}>
            FOV {Math.round(fov)}°
          </Typography>
          <Slider
            size="sm"
            min={10}
            max={120}
            value={fov}
            onChange={(_, v) => changeFov(v as number)}
            sx={{ width: 120 }}
          />
        </Box>
      )}
    </Sheet>
  );
}
