import { Box, Typography } from "@mui/joy";
import { PRESET_GALLERY } from "./presetDefs";
import { toolFromGalleryId } from "./drawTool";
import { shapeLayersMarkup } from "./shapeRender";
import { presetDefaultSize, type SlideElement } from "./model";

const TW = 26;
const TH = 20;

/** Thumbnail markup for a gallery entry (computed once per id). */
const thumbCache = new Map<string, string>();
function thumb(id: string): string {
  const hit = thumbCache.get(id);
  if (hit) return hit;
  const t = toolFromGalleryId(id);
  const line = t.kind === "connector";
  // Keep the preset's default proportions inside the thumbnail cell.
  const d = presetDefaultSize(t.preset);
  const k = line ? 1 : Math.min(TW / d.w, TH / d.h);
  const w = line ? TW : d.w * k;
  const h = line ? TH : d.h * k;
  const el: SlideElement = {
    id,
    type: line ? "connector" : "shape",
    preset: t.preset,
    x: 0,
    y: 0,
    w,
    h,
    fill: "#e8f0fe",
    stroke: "#5f6368",
    strokeWidth: line ? 1.2 : 1,
    ...(t.headEnd ? { headEnd: t.headEnd } : {}),
    ...(t.tailEnd ? { tailEnd: t.tailEnd } : {}),
  };
  const markup = `<g transform="translate(${(TW - w) / 2} ${(TH - h) / 2})">${shapeLayersMarkup(el)}</g>`;
  thumbCache.set(id, markup);
  return markup;
}

/** The shape gallery: preset thumbnails grouped like OnlyOffice/PowerPoint.
 *  `onPick` receives the gallery id ("star5", "bentConnector3:arrow"). */
export function ShapeGallery({ onPick, shapesOnly }: { onPick: (id: string) => void; shapesOnly?: boolean }) {
  return (
    <Box
      data-testid="shape-gallery"
      sx={{ p: 1, width: 300, maxHeight: "70vh", overflowY: "auto" }}
    >
      {PRESET_GALLERY.filter((g) => !shapesOnly || !g.items.every((it) => toolFromGalleryId(it.prst).kind === "connector")).map((g) => (
        <Box key={g.group} sx={{ mb: 1 }}>
          <Typography level="body-xs" sx={{ fontWeight: 600, mb: 0.5 }}>
            {g.group}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.25 }}>
            {g.items.map((it) => (
              <Box
                component="button"
                key={it.prst}
                type="button"
                title={it.label}
                aria-label={it.label}
                data-preset={it.prst}
                onClick={() => onPick(it.prst)}
                sx={{
                  width: 34,
                  height: 30,
                  p: 0,
                  border: "1px solid transparent",
                  borderRadius: "sm",
                  bgcolor: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  "&:hover": { bgcolor: "background.level2", borderColor: "divider" },
                }}
              >
                <svg
                  width={TW}
                  height={TH}
                  style={{ overflow: "visible" }}
                  dangerouslySetInnerHTML={{ __html: thumb(it.prst) }}
                />
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
