// Drawn over the slide canvas (M10): collaborators' selections (an outline
// in their colour with their name: "being edited by") and comment markers.
// Only the markers take pointer events.

import { Box } from "@mui/joy";
import ChatBubbleIcon from "@mui/icons-material/ChatBubble";
import type { Slide } from "./model";
import { canvasScale, elementBounds } from "./geometry";
import { markerPosition, type SlideComment } from "./comments";
import type { CollabPeer } from "./useDeckCollab";

export function CanvasOverlay({
  slide,
  width,
  peers,
  comments,
  activeComment,
  onMarker,
}: {
  slide: Slide;
  width: number;
  peers: CollabPeer[];
  /** Open threads on this slide. */
  comments: SlideComment[];
  activeComment: string | null;
  onMarker: (id: string) => void;
}) {
  const k = canvasScale(width);
  const outlines = peers.flatMap((p) =>
    p.slideId === slide.id
      ? (p.sel ?? []).flatMap((id) => {
          const el = slide.elements.find((e) => e.id === id);
          return el ? [{ p, el }] : [];
        })
      : [],
  );
  return (
    <Box sx={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }} data-testid="canvas-overlay">
      {outlines.map(({ p, el }) => {
        const b = elementBounds(el);
        return (
          <Box
            key={`${p.userId}:${el.id}`}
            data-testid="peer-selection"
            data-user={p.username}
            data-el={el.id}
            sx={{
              position: "absolute",
              left: b.x * k - 2,
              top: b.y * k - 2,
              width: b.w * k + 4,
              height: b.h * k + 4,
              border: `2px solid ${p.color}`,
              borderRadius: "2px",
            }}
          >
            <Box
              sx={{
                position: "absolute",
                left: -2,
                top: -18,
                px: 0.5,
                fontSize: 11,
                lineHeight: "16px",
                color: "#fff",
                bgcolor: p.color,
                borderRadius: "3px 3px 3px 0",
                whiteSpace: "nowrap",
              }}
            >
              {p.username}
              {p.editingText ? " (editing)" : ""}
            </Box>
          </Box>
        );
      })}
      {comments.map((c, i) => {
        const pos = markerPosition(c, slide.elements);
        const active = c.id === activeComment;
        return (
          <Box
            key={c.id}
            role="button"
            tabIndex={0}
            aria-label={`Comment by ${c.authorName}`}
            data-testid="comment-marker"
            data-comment={c.id}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onMarker(c.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onMarker(c.id);
              }
            }}
            sx={{
              position: "absolute",
              left: Math.min(Math.max(pos.x * k - 4, 0), width - 30),
              top: Math.max(pos.y * k - 30, 0) + (i % 3) * 3,
              minWidth: 28,
              height: 24,
              px: 0.75,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 0.25,
              pointerEvents: "auto",
              cursor: "pointer",
              borderRadius: "12px 12px 12px 2px",
              bgcolor: active ? "#e37400" : "#fbbc04",
              color: active ? "#fff" : "#3c2a00",
              border: "1.5px solid #fff",
              boxShadow: "0 1px 3px rgba(0,0,0,.35)",
              fontSize: 11,
              fontWeight: 700,
              opacity: pos.orphan ? 0.7 : 1,
              "& svg": { fontSize: 13, color: "inherit" },
            }}
          >
            <ChatBubbleIcon />
            {c.replies.length + 1}
          </Box>
        );
      })}
    </Box>
  );
}
