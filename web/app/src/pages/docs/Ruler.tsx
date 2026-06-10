import { useRef } from "react";
import { Box } from "@mui/joy";

export interface Indents {
  left: number; // inches
  right: number; // inches
  firstLine: number; // inches (relative to left)
}

interface RulerProps {
  indents: Indents;
  onChange: (next: Indents) => void;
}

// US Letter content width at the editor's max width. The ruler maps inches to
// pixels across the page; markers drag to set page margins.
const PAGE_INCHES = 8.5;

/** Ruler renders a Google-Docs-style horizontal ruler with inch ticks and
 *  draggable first-line, left-indent, and right-indent markers. */
export function Ruler({ indents, onChange }: RulerProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const startDrag =
    (marker: "left" | "right" | "firstLine") => (e: React.PointerEvent) => {
      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const pxPerInch = rect.width / PAGE_INCHES;

      const move = (ev: PointerEvent) => {
        const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
        const inches = Math.round((x / pxPerInch) * 8) / 8; // snap to 1/8"
        if (marker === "left")
          onChange({
            ...indents,
            left: Math.min(inches, PAGE_INCHES - indents.right - 0.5),
          });
        else if (marker === "right")
          onChange({
            ...indents,
            right: Math.min(
              PAGE_INCHES - inches,
              PAGE_INCHES - indents.left - 0.5,
            ),
          });
        else
          onChange({
            ...indents,
            firstLine: Math.max(-indents.left, inches - indents.left),
          });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

  const pct = (inches: number) => `${(inches / PAGE_INCHES) * 100}%`;

  const ticks = [];
  for (let i = 1; i < PAGE_INCHES; i++) {
    ticks.push(
      <Box
        key={i}
        sx={{
          position: "absolute",
          left: pct(i),
          top: 0,
          bottom: 0,
          width: "1px",
          bgcolor: "neutral.outlinedBorder",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            left: 2,
            top: 1,
            fontSize: 9,
            color: "text.tertiary",
          }}
        >
          {i}
        </Box>
      </Box>,
    );
  }

  const marker = (
    left: string,
    onDown: (e: React.PointerEvent) => void,
    shape: React.ReactNode,
    top: number,
  ) => (
    <Box
      onPointerDown={onDown}
      sx={{
        position: "absolute",
        left,
        top,
        transform: "translateX(-50%)",
        cursor: "ew-resize",
        zIndex: 2,
        color: "primary.solidBg",
        "&:hover": { color: "primary.solidHoverBg" },
      }}
    >
      {shape}
    </Box>
  );

  return (
    <Box sx={{ display: "flex", justifyContent: "center", mb: 0.5 }}>
      <Box
        ref={trackRef}
        sx={{
          position: "relative",
          width: "100%",
          maxWidth: 816,
          height: 22,
          bgcolor: "background.level1",
          borderRadius: "4px",
          border: "1px solid",
          borderColor: "neutral.outlinedBorder",
        }}
      >
        {ticks}
        {/* first-line indent (downward triangle) */}
        {marker(
          pct(indents.left + indents.firstLine),
          startDrag("firstLine"),
          <Box
            sx={{
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "7px solid currentColor",
            }}
          />,
          0,
        )}
        {/* left indent (upward triangle) */}
        {marker(
          pct(indents.left),
          startDrag("left"),
          <Box
            sx={{
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderBottom: "7px solid currentColor",
            }}
          />,
          13,
        )}
        {/* right indent (upward triangle) */}
        {marker(
          pct(PAGE_INCHES - indents.right),
          startDrag("right"),
          <Box
            sx={{
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderBottom: "7px solid currentColor",
            }}
          />,
          13,
        )}
      </Box>
    </Box>
  );
}
