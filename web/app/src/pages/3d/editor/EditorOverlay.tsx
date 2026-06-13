/**
 * EditorOverlay — the React chrome for the 3D editor that sits on top of the
 * three.js viewport: a left vertical tool palette (icon buttons + tooltips),
 * a primitives row, a paint swatch row, a bottom status/hint line, and a
 * right-hand properties strip for the selected object.
 *
 * All modeling logic lives in Editor.ts; this component only renders the
 * Editor's reactive state and forwards user intent (tool changes, primitive
 * adds, paint, undo/redo). Keyboard shortcuts are bound here too.
 */
import { useEffect, useState } from "react";
import {
  Box,
  Sheet,
  Stack,
  IconButton,
  Tooltip,
  Typography,
  Divider,
  ToggleButtonGroup,
  Button,
  Input,
  Select,
  Option,
} from "@mui/joy";
import NearMeIcon from "@mui/icons-material/NearMe";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import AspectRatioIcon from "@mui/icons-material/AspectRatio";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import FormatColorFillIcon from "@mui/icons-material/FormatColorFill";
import DeleteIcon from "@mui/icons-material/Delete";
import StraightenIcon from "@mui/icons-material/Straighten";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import GridGoldenratioIcon from "@mui/icons-material/GridGoldenratio";
import Crop32Icon from "@mui/icons-material/Crop32";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import HexagonOutlinedIcon from "@mui/icons-material/HexagonOutlined";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import FlipIcon from "@mui/icons-material/Flip";
import type { Editor, EditorState, Tool } from "./Editor";
import type { PrimitiveKind } from "./primitives";
import { MATERIAL_PRESETS, type MaterialPreset } from "./materials";

interface ToolDef {
  tool: Tool;
  label: string;
  key: string;
  icon: React.ReactNode;
}

const TOOLS: ToolDef[] = [
  { tool: "select", label: "Select (V / Esc)", key: "V", icon: <NearMeIcon /> },
  { tool: "move", label: "Move (M)", key: "M", icon: <OpenWithIcon /> },
  // Rotate moves to Q (SketchUp's binding) so R/C can drive the draw tools.
  { tool: "rotate", label: "Rotate (Q)", key: "Q", icon: <RotateRightIcon /> },
  { tool: "scale", label: "Scale (S)", key: "S", icon: <AspectRatioIcon /> },
  {
    tool: "pushpull",
    label: "Push/Pull (P)",
    key: "P",
    icon: <UnfoldMoreIcon />,
  },
  {
    tool: "paint",
    label: "Paint (B)",
    key: "B",
    icon: <FormatColorFillIcon />,
  },
  { tool: "erase", label: "Erase (E / Del)", key: "E", icon: <DeleteIcon /> },
  {
    tool: "measure",
    label: "Tape Measure (T)",
    key: "T",
    icon: <StraightenIcon />,
  },
];

/** On-plane drawing tools — sketch flat faces on the ground (y=0). */
const DRAW_TOOLS: ToolDef[] = [
  { tool: "rect", label: "Rectangle (R)", key: "R", icon: <Crop32Icon /> },
  { tool: "circle", label: "Circle (C)", key: "C", icon: <CircleOutlinedIcon /> },
  {
    tool: "polygon",
    label: "Polygon (G)",
    key: "G",
    icon: <HexagonOutlinedIcon />,
  },
];

const PRIMITIVES: { kind: PrimitiveKind; label: string }[] = [
  { kind: "box", label: "Box" },
  { kind: "plane", label: "Plane" },
  { kind: "cylinder", label: "Cylinder" },
  { kind: "sphere", label: "Sphere" },
];

export function EditorOverlay({ editor }: { editor: Editor }) {
  const [state, setState] = useState<EditorState | null>(null);
  const [paintColor, setPaintColor] = useState(editor.getPaint().color);
  const [paintPreset, setPaintPreset] = useState<MaterialPreset>(
    editor.getPaint().preset,
  );

  useEffect(() => editor.subscribe(setState), [editor]);

  // Keyboard shortcuts: tool keys, delete, undo/redo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      // Don't hijack typing in inputs.
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (meta && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        editor.redo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        editor.deleteSelected();
        return;
      }
      if (e.key === "Escape") {
        editor.setTool("select");
        return;
      }
      const def = [...TOOLS, ...DRAW_TOOLS].find(
        (d) => d.key.toLowerCase() === e.key.toLowerCase(),
      );
      if (def && !meta) {
        editor.setTool(def.tool);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  if (!state) return null;

  function applyPaint(preset: MaterialPreset, color: string) {
    setPaintPreset(preset);
    setPaintColor(color);
    editor.setPaint(preset, color);
  }

  const sel = state.selection;

  return (
    <>
      {/* Left tool palette */}
      <Sheet
        variant="outlined"
        sx={{
          position: "absolute",
          top: 12,
          left: 12,
          borderRadius: "md",
          p: 0.5,
          zIndex: 5,
          boxShadow: "sm",
        }}
      >
        <Stack spacing={0.25}>
          {TOOLS.map((d) => (
            <Tooltip key={d.tool} title={d.label} placement="right" size="sm">
              <IconButton
                size="sm"
                variant={state.tool === d.tool ? "solid" : "plain"}
                color={state.tool === d.tool ? "primary" : "neutral"}
                onClick={() => editor.setTool(d.tool)}
              >
                {d.icon}
              </IconButton>
            </Tooltip>
          ))}
          <Divider sx={{ my: 0.25 }} />
          {/* On-plane drawing tools (Rectangle / Circle / Polygon). */}
          {DRAW_TOOLS.map((d) => (
            <Tooltip key={d.tool} title={d.label} placement="right" size="sm">
              <IconButton
                size="sm"
                variant={state.tool === d.tool ? "solid" : "plain"}
                color={state.tool === d.tool ? "primary" : "neutral"}
                onClick={() => editor.setTool(d.tool)}
              >
                {d.icon}
              </IconButton>
            </Tooltip>
          ))}
          <Divider sx={{ my: 0.25 }} />
          {/* Section plane (clipping) toggle + reverse. */}
          <Tooltip
            title={`Section plane: ${state.sectionActive ? "on (drag to position)" : "off"}`}
            placement="right"
            size="sm"
          >
            <IconButton
              size="sm"
              variant={state.sectionActive ? "solid" : "plain"}
              color={state.sectionActive ? "primary" : "neutral"}
              onClick={() => editor.toggleSection()}
            >
              <ContentCutIcon />
            </IconButton>
          </Tooltip>
          {state.sectionActive && (
            <Tooltip title="Reverse section side" placement="right" size="sm">
              <IconButton
                size="sm"
                variant="plain"
                onClick={() => editor.reverseSection()}
              >
                <FlipIcon />
              </IconButton>
            </Tooltip>
          )}
          <Divider sx={{ my: 0.25 }} />
          <Tooltip
            title={`Snap to grid: ${state.snap ? "on" : "off"}`}
            placement="right"
            size="sm"
          >
            <IconButton
              size="sm"
              variant={state.snap ? "solid" : "plain"}
              color={state.snap ? "success" : "neutral"}
              onClick={() => editor.setSnap(!state.snap)}
            >
              <GridGoldenratioIcon />
            </IconButton>
          </Tooltip>
          <Divider sx={{ my: 0.25 }} />
          <Tooltip title="Undo (Cmd/Ctrl+Z)" placement="right" size="sm">
            <span>
              <IconButton
                size="sm"
                variant="plain"
                disabled={!state.canUndo}
                onClick={() => editor.undo()}
              >
                <UndoIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Redo (Shift+Cmd/Ctrl+Z)" placement="right" size="sm">
            <span>
              <IconButton
                size="sm"
                variant="plain"
                disabled={!state.canRedo}
                onClick={() => editor.redo()}
              >
                <RedoIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Sheet>

      {/* Primitives row (top center) */}
      <Sheet
        variant="outlined"
        sx={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          borderRadius: "md",
          px: 1,
          py: 0.5,
          zIndex: 5,
          boxShadow: "sm",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography level="body-xs" sx={{ opacity: 0.7 }}>
          Add
        </Typography>
        <ToggleButtonGroup variant="plain" size="sm" value={null}>
          {PRIMITIVES.map((p) => (
            <Button
              key={p.kind}
              onClick={() => editor.addPrimitive(p.kind)}
              value={p.kind}
            >
              {p.label}
            </Button>
          ))}
        </ToggleButtonGroup>
      </Sheet>

      {/* Paint controls (shown when the paint tool is active) */}
      {state.tool === "paint" && (
        <Sheet
          variant="outlined"
          sx={{
            position: "absolute",
            top: 64,
            left: 72,
            borderRadius: "md",
            px: 1.5,
            py: 1,
            zIndex: 6,
            boxShadow: "sm",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
          }}
        >
          <Typography level="body-sm">Material</Typography>
          <Select
            size="sm"
            value={paintPreset}
            onChange={(_, v) => v && applyPaint(v, paintColor)}
            sx={{ minWidth: 110 }}
          >
            {MATERIAL_PRESETS.map((m) => (
              <Option key={m.id} value={m.id}>
                {m.label}
              </Option>
            ))}
          </Select>
          <input
            type="color"
            value={paintColor}
            onChange={(e) => applyPaint(paintPreset, e.target.value)}
            style={{
              width: 36,
              height: 28,
              border: "none",
              background: "none",
              cursor: "pointer",
            }}
          />
          <Button
            size="sm"
            variant="soft"
            disabled={!sel}
            onClick={() => editor.paintSelected()}
          >
            Apply to selected
          </Button>
        </Sheet>
      )}

      {/* Properties strip (right) */}
      {sel && (
        <Sheet
          variant="outlined"
          sx={{
            position: "absolute",
            top: 12,
            right: 12,
            width: 240,
            borderRadius: "md",
            p: 1.5,
            zIndex: 5,
            boxShadow: "sm",
          }}
        >
          <Typography level="title-sm" noWrap title={sel.name}>
            {sel.name}
          </Typography>
          <Divider sx={{ my: 1 }} />
          <PropRow label="Position" v={sel.position} />
          <PropRow label="Rotation°" v={sel.rotationDeg} />
          <PropRow label="Scale" v={sel.scale} />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
            <Typography level="body-xs" sx={{ width: 56, opacity: 0.7 }}>
              Color
            </Typography>
            <Box
              sx={{
                width: 18,
                height: 18,
                borderRadius: "sm",
                border: "1px solid rgba(0,0,0,0.2)",
                bgcolor: sel.colorHex,
              }}
            />
            <Typography level="body-xs">{sel.colorHex}</Typography>
          </Box>
          <Button
            size="sm"
            color="danger"
            variant="soft"
            startDecorator={<DeleteIcon />}
            sx={{ mt: 1.5 }}
            onClick={() => editor.deleteSelected()}
            fullWidth
          >
            Delete
          </Button>
        </Sheet>
      )}

      {/* Status / hint line (bottom) */}
      <Sheet
        variant="soft"
        sx={{
          position: "absolute",
          bottom: 12,
          left: "50%",
          transform: "translateX(-50%)",
          borderRadius: "xl",
          px: 2,
          py: 0.5,
          zIndex: 5,
          maxWidth: "90%",
        }}
      >
        <Typography level="body-xs" sx={{ opacity: 0.85 }} noWrap>
          {state.measureDistance != null
            ? `Distance: ${state.measureDistance.toFixed(3)} units`
            : state.hint}
        </Typography>
      </Sheet>
    </>
  );
}

function PropRow({
  label,
  v,
}: {
  label: string;
  v: { x: number; y: number; z: number };
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
      <Typography level="body-xs" sx={{ width: 56, opacity: 0.7 }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={0.5}>
        {(["x", "y", "z"] as const).map((k) => (
          <Input
            key={k}
            size="sm"
            readOnly
            value={v[k].toFixed(2)}
            sx={{ width: 52, "--Input-paddingInline": "4px" }}
          />
        ))}
      </Stack>
    </Box>
  );
}
