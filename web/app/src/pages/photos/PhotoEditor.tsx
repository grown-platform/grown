import { useEffect, useRef, useState, useCallback } from "react";
import {
  Box,
  IconButton,
  Sheet,
  Typography,
  Slider,
  Button,
  Tooltip,
  Stack,
  Divider,
  CircularProgress,
} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import RotateLeftIcon from "@mui/icons-material/RotateLeft";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import CropIcon from "@mui/icons-material/Crop";
import CheckIcon from "@mui/icons-material/Check";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import type { Photo } from "./types";
import { photoURL, uploadPhotos } from "./api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditResult {
  /** The newly created photo (save-as-copy). */
  photo: Photo;
}

interface Edits {
  rotation: number; // degrees: 0 | 90 | 180 | 270
  brightness: number; // CSS filter value, default 1
  contrast: number; // CSS filter value, default 1
  cropX: number; // fraction 0..1
  cropY: number;
  cropW: number;
  cropH: number;
}

const DEFAULT_EDITS: Edits = {
  rotation: 0,
  brightness: 1,
  contrast: 1,
  cropX: 0,
  cropY: 0,
  cropW: 1,
  cropH: 1,
};

type EditTab = "crop" | "adjust";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Draw the edited image onto a canvas and return a Blob. */
async function renderToBlob(
  img: HTMLImageElement,
  edits: Edits,
  mimeType: string,
): Promise<Blob> {
  const { rotation, brightness, contrast, cropX, cropY, cropW, cropH } = edits;

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  // The source crop rect in natural pixels.
  const sx = cropX * srcW;
  const sy = cropY * srcH;
  const sw = cropW * srcW;
  const sh = cropH * srcH;

  // After rotation, swap w/h for 90/270.
  const rotated = rotation === 90 || rotation === 270;
  const outW = rotated ? sh : sw;
  const outH = rotated ? sw : sh;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(outW);
  canvas.height = Math.round(outH);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas context unavailable");

  ctx.filter = `brightness(${brightness}) contrast(${contrast})`;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, sx, sy, sw, sh, -outW / 2, -outH / 2, outW, outH);
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob returned null"));
      },
      mimeType,
      0.92,
    );
  });
}

// ---------------------------------------------------------------------------
// CropOverlay — a simple drag-to-resize crop rect drawn over a preview.
// ---------------------------------------------------------------------------

interface CropOverlayProps {
  edits: Edits;
  onChange: (edits: Edits) => void;
}

function CropOverlay({ edits, onChange }: CropOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{
    handle: "tl" | "tr" | "bl" | "br" | "move";
    startX: number;
    startY: number;
    startCrop: Pick<Edits, "cropX" | "cropY" | "cropW" | "cropH">;
  } | null>(null);

  function pctToStyle(v: number) {
    return `${v * 100}%`;
  }

  function onMouseDown(
    e: React.MouseEvent,
    handle: "tl" | "tr" | "bl" | "br" | "move",
  ) {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: {
        cropX: edits.cropX,
        cropY: edits.cropY,
        cropW: edits.cropW,
        cropH: edits.cropH,
      },
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dx = (e.clientX - dragging.current.startX) / rect.width;
      const dy = (e.clientY - dragging.current.startY) / rect.height;
      const { handle, startCrop } = dragging.current;
      let { cropX, cropY, cropW, cropH } = startCrop;
      const minSize = 0.05;

      if (handle === "move") {
        cropX = Math.max(0, Math.min(1 - cropW, cropX + dx));
        cropY = Math.max(0, Math.min(1 - cropH, cropY + dy));
      } else {
        if (handle === "tl" || handle === "bl") {
          const newX = Math.max(
            0,
            Math.min(cropX + cropW - minSize, cropX + dx),
          );
          cropW = cropX + cropW - newX;
          cropX = newX;
        }
        if (handle === "tr" || handle === "br") {
          cropW = Math.max(minSize, Math.min(1 - cropX, cropW + dx));
        }
        if (handle === "tl" || handle === "tr") {
          const newY = Math.max(
            0,
            Math.min(cropY + cropH - minSize, cropY + dy),
          );
          cropH = cropY + cropH - newY;
          cropY = newY;
        }
        if (handle === "bl" || handle === "br") {
          cropH = Math.max(minSize, Math.min(1 - cropY, cropH + dy));
        }
      }
      onChange({ ...edits, cropX, cropY, cropW, cropH });
    },
    [edits, onChange],
  );

  const onMouseUp = useCallback(() => {
    dragging.current = null;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  }, [onMouseMove]);

  const handleStyle: React.CSSProperties = {
    position: "absolute",
    width: 16,
    height: 16,
    background: "#fff",
    border: "2px solid rgba(0,0,0,0.6)",
    borderRadius: 2,
  };

  return (
    <Box
      ref={containerRef}
      sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {/* Dark overlay outside crop rect */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          clipPath: `polygon(
            0% 0%, 100% 0%, 100% 100%, 0% 100%,
            0% ${pctToStyle(edits.cropY)},
            ${pctToStyle(edits.cropX)} ${pctToStyle(edits.cropY)},
            ${pctToStyle(edits.cropX)} ${pctToStyle(edits.cropY + edits.cropH)},
            ${pctToStyle(edits.cropX + edits.cropW)} ${pctToStyle(edits.cropY + edits.cropH)},
            ${pctToStyle(edits.cropX + edits.cropW)} ${pctToStyle(edits.cropY)},
            0% ${pctToStyle(edits.cropY)}
          )`,
        }}
      />
      {/* Crop rect border + drag handle */}
      <Box
        onMouseDown={(e) => onMouseDown(e, "move")}
        sx={{
          position: "absolute",
          left: pctToStyle(edits.cropX),
          top: pctToStyle(edits.cropY),
          width: pctToStyle(edits.cropW),
          height: pctToStyle(edits.cropH),
          border: "2px solid #fff",
          cursor: "move",
          pointerEvents: "all",
          boxSizing: "border-box",
        }}
      >
        {/* Corner handles */}
        {(
          [
            { handle: "tl", sx: { top: -8, left: -8, cursor: "nw-resize" } },
            { handle: "tr", sx: { top: -8, right: -8, cursor: "ne-resize" } },
            { handle: "bl", sx: { bottom: -8, left: -8, cursor: "sw-resize" } },
            {
              handle: "br",
              sx: { bottom: -8, right: -8, cursor: "se-resize" },
            },
          ] as const
        ).map(({ handle, sx }) => (
          <Box
            key={handle}
            onMouseDown={(e) => onMouseDown(e, handle)}
            style={{ ...handleStyle, ...sx } as React.CSSProperties}
          />
        ))}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// PhotoEditor
// ---------------------------------------------------------------------------

interface PhotoEditorProps {
  photo: Photo;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
}

export function PhotoEditor({ photo, onClose, onSaved }: PhotoEditorProps) {
  const [edits, setEdits] = useState<Edits>(DEFAULT_EDITS);
  const [tab, setTab] = useState<EditTab>("adjust");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Reset when photo changes.
  useEffect(() => {
    setEdits(DEFAULT_EDITS);
    setError(null);
  }, [photo.id]);

  function rotateLeft() {
    setEdits((e) => ({ ...e, rotation: (e.rotation - 90 + 360) % 360 }));
  }
  function rotateRight() {
    setEdits((e) => ({ ...e, rotation: (e.rotation + 90) % 360 }));
  }
  function reset() {
    setEdits(DEFAULT_EDITS);
  }

  async function saveAsCopy() {
    const img = imgRef.current;
    if (!img || !img.complete) {
      setError("Image not loaded yet, please wait.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const mime = photo.content_type.startsWith("image/")
        ? photo.content_type
        : "image/jpeg";
      const blob = await renderToBlob(img, edits, mime);
      const ext = mime.split("/")[1] ?? "jpg";
      const base = photo.filename.replace(/\.[^.]+$/, "");
      const filename = `${base}_edited.${ext}`;
      const file = new File([blob], filename, { type: mime });
      const created = await uploadPhotos([file]);
      if (!created.length) throw new Error("upload returned no photos");
      onSaved({ photo: created[0] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const rotated = edits.rotation === 90 || edits.rotation === 270;
  const previewFilter = `brightness(${edits.brightness}) contrast(${edits.contrast})`;

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label="Edit photo"
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1400,
        bgcolor: "rgba(0,0,0,0.96)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar */}
      <Sheet
        variant="plain"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 0.5,
          bgcolor: "transparent",
          color: "#fff",
          minHeight: 52,
          flexShrink: 0,
        }}
      >
        <IconButton
          variant="plain"
          onClick={onClose}
          aria-label="Close editor"
          sx={{ color: "#fff" }}
        >
          <CloseIcon />
        </IconButton>
        <Typography
          level="body-sm"
          sx={{ color: "#fff", flex: 1, opacity: 0.8 }}
          noWrap
        >
          Edit — {photo.filename}
        </Typography>
        <Button
          variant="plain"
          sx={{ color: "rgba(255,255,255,0.7)" }}
          onClick={reset}
          startDecorator={<RestartAltIcon />}
          size="sm"
        >
          Reset
        </Button>
        <Button
          variant="solid"
          color="primary"
          size="sm"
          loading={saving}
          startDecorator={<CheckIcon />}
          onClick={saveAsCopy}
        >
          Save as copy
        </Button>
      </Sheet>

      {error && (
        <Sheet
          color="danger"
          variant="soft"
          sx={{ mx: 2, mt: 1, px: 2, py: 1, borderRadius: "sm", flexShrink: 0 }}
        >
          <Typography color="danger" level="body-sm">
            {error}
          </Typography>
        </Sheet>
      )}

      {/* Main layout: preview + sidebar */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* Preview area */}
        <Box
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 0,
            p: 2,
            position: "relative",
          }}
        >
          <Box sx={{ position: "relative", display: "inline-flex" }}>
            <Box
              component="img"
              ref={imgRef}
              src={photoURL(photo.id)}
              alt={photo.description || photo.filename}
              crossOrigin="anonymous"
              sx={{
                maxWidth: { xs: "90vw", md: "65vw" },
                maxHeight: "70vh",
                objectFit: "contain",
                display: "block",
                transform: `rotate(${edits.rotation}deg)`,
                filter: previewFilter,
                transition: "transform 200ms",
                userSelect: "none",
                ...(rotated ? { maxWidth: "70vh", maxHeight: "65vw" } : {}),
              }}
            />
            {tab === "crop" && (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  transform: `rotate(${edits.rotation}deg)`,
                }}
              >
                <CropOverlay edits={edits} onChange={setEdits} />
              </Box>
            )}
          </Box>
        </Box>

        {/* Sidebar: tools */}
        <Sheet
          variant="plain"
          sx={{
            width: { xs: "100%", md: 260 },
            flexShrink: 0,
            bgcolor: "rgba(30,30,30,0.95)",
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            p: 2,
            gap: 2,
            overflowY: "auto",
          }}
        >
          {/* Tab switcher */}
          <Stack direction="row" spacing={0.5}>
            <Button
              variant={tab === "adjust" ? "solid" : "plain"}
              color={tab === "adjust" ? "primary" : "neutral"}
              size="sm"
              sx={{
                flex: 1,
                color: tab === "adjust" ? undefined : "rgba(255,255,255,0.7)",
              }}
              onClick={() => setTab("adjust")}
            >
              Adjust
            </Button>
            <Button
              variant={tab === "crop" ? "solid" : "plain"}
              color={tab === "crop" ? "primary" : "neutral"}
              size="sm"
              sx={{
                flex: 1,
                color: tab === "crop" ? undefined : "rgba(255,255,255,0.7)",
              }}
              startDecorator={<CropIcon sx={{ fontSize: 16 }} />}
              onClick={() => setTab("crop")}
            >
              Crop
            </Button>
          </Stack>

          <Divider sx={{ borderColor: "rgba(255,255,255,0.12)" }} />

          {tab === "adjust" && (
            <>
              {/* Rotate */}
              <Box>
                <Typography
                  level="body-xs"
                  sx={{
                    color: "rgba(255,255,255,0.6)",
                    mb: 1,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Rotate
                </Typography>
                <Stack direction="row" spacing={1} justifyContent="center">
                  <Tooltip title="Rotate left 90°">
                    <IconButton
                      variant="outlined"
                      size="sm"
                      onClick={rotateLeft}
                      aria-label="Rotate left"
                      sx={{
                        color: "#fff",
                        borderColor: "rgba(255,255,255,0.3)",
                      }}
                    >
                      <RotateLeftIcon />
                    </IconButton>
                  </Tooltip>
                  <Typography
                    level="body-sm"
                    sx={{
                      color: "rgba(255,255,255,0.7)",
                      alignSelf: "center",
                      minWidth: 36,
                      textAlign: "center",
                    }}
                  >
                    {edits.rotation}°
                  </Typography>
                  <Tooltip title="Rotate right 90°">
                    <IconButton
                      variant="outlined"
                      size="sm"
                      onClick={rotateRight}
                      aria-label="Rotate right"
                      sx={{
                        color: "#fff",
                        borderColor: "rgba(255,255,255,0.3)",
                      }}
                    >
                      <RotateRightIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Box>

              <Divider sx={{ borderColor: "rgba(255,255,255,0.12)" }} />

              {/* Brightness */}
              <Box>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  sx={{ mb: 0.5 }}
                >
                  <Typography
                    level="body-xs"
                    sx={{
                      color: "rgba(255,255,255,0.6)",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                    }}
                  >
                    Brightness
                  </Typography>
                  <Typography
                    level="body-xs"
                    sx={{ color: "rgba(255,255,255,0.7)" }}
                  >
                    {Math.round((edits.brightness - 1) * 100)}
                  </Typography>
                </Stack>
                <Slider
                  min={0.2}
                  max={2.5}
                  step={0.05}
                  value={edits.brightness}
                  onChange={(_e, v) =>
                    setEdits((s) => ({ ...s, brightness: v as number }))
                  }
                  sx={{ color: "primary.solidBg", "--Slider-trackSize": "4px" }}
                />
              </Box>

              {/* Contrast */}
              <Box>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  sx={{ mb: 0.5 }}
                >
                  <Typography
                    level="body-xs"
                    sx={{
                      color: "rgba(255,255,255,0.6)",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                    }}
                  >
                    Contrast
                  </Typography>
                  <Typography
                    level="body-xs"
                    sx={{ color: "rgba(255,255,255,0.7)" }}
                  >
                    {Math.round((edits.contrast - 1) * 100)}
                  </Typography>
                </Stack>
                <Slider
                  min={0.2}
                  max={3}
                  step={0.05}
                  value={edits.contrast}
                  onChange={(_e, v) =>
                    setEdits((s) => ({ ...s, contrast: v as number }))
                  }
                  sx={{ color: "primary.solidBg", "--Slider-trackSize": "4px" }}
                />
              </Box>
            </>
          )}

          {tab === "crop" && (
            <Box>
              <Typography
                level="body-sm"
                sx={{
                  color: "rgba(255,255,255,0.7)",
                  mb: 1.5,
                  lineHeight: 1.4,
                }}
              >
                Drag the corner handles to adjust the crop region. The cropped
                area will be used when saving.
              </Typography>
              <Button
                variant="outlined"
                size="sm"
                fullWidth
                sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }}
                onClick={() =>
                  setEdits((e) => ({
                    ...e,
                    cropX: 0,
                    cropY: 0,
                    cropW: 1,
                    cropH: 1,
                  }))
                }
              >
                Reset crop
              </Button>
            </Box>
          )}

          {saving && (
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1, mt: "auto" }}
            >
              <CircularProgress size="sm" />
              <Typography
                level="body-sm"
                sx={{ color: "rgba(255,255,255,0.7)" }}
              >
                Saving…
              </Typography>
            </Box>
          )}
        </Sheet>
      </Box>
    </Box>
  );
}
