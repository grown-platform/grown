import { Box } from "@mui/joy";
import {
  CANVAS_W,
  CANVAS_H,
  shapeClipPath,
  elementTransform,
  type AnimationType,
  type Slide,
  type SlideElement,
} from "./model";

// CSS keyframes for element entrance animations (injected globally once).
export const ELEMENT_ANIM_CSS = `
@keyframes elAppear    { from { opacity: 0; } to { opacity: 1; } }
@keyframes elFadeIn    { from { opacity: 0; } to { opacity: 1; } }
@keyframes elFlyInBot  { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes elFlyInLeft { from { transform: translateX(-40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
`;

function elementAnimation(type: AnimationType): string {
  switch (type) {
    case "appear":
      return "elAppear 60ms step-end";
    case "fade-in":
      return "elFadeIn 500ms ease";
    case "fly-in-bottom":
      return "elFlyInBot 450ms ease";
    case "fly-in-left":
      return "elFlyInLeft 450ms ease";
  }
}

interface SlideViewProps {
  slide: Slide;
  width: number;
  /**
   * Optional set of element IDs that have been "revealed" in present mode.
   * Elements with an animation but NOT in this set are hidden (opacity 0).
   * When added to the set they play their entrance animation.
   * If undefined, all elements are shown normally (editor / thumbnail mode).
   */
  revealedIds?: ReadonlySet<string>;
  /** When true, elements with a `url` become clickable links (present mode). */
  linkable?: boolean;
}

/** SlideView renders a slide read-only, scaled to fit `width` px (16:9).
 *  Used for the thumbnail rail and present mode. */
export function SlideView({ slide, width, revealedIds, linkable }: SlideViewProps) {
  const scale = width / CANVAS_W;
  const height = width * (CANVAS_H / CANVAS_W);
  return (
    <Box
      sx={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        bgcolor: slide.background,
      }}
    >
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {slide.elements.map((el) => (
          <ElementView
            key={el.id}
            el={el}
            revealedIds={revealedIds}
            linkable={linkable}
          />
        ))}
      </Box>
    </Box>
  );
}

export function elementStyle(el: SlideElement): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    left: el.x,
    top: el.y,
    width: el.w,
    height: el.h,
    transform: elementTransform(el),
    transformOrigin: "center",
  };
  if (el.type === "text") {
    return {
      ...base,
      fontSize: el.fontSize,
      fontFamily: el.fontFamily,
      color: el.color,
      fontWeight: el.bold ? 700 : 400,
      fontStyle: el.italic ? "italic" : "normal",
      textDecoration: el.underline ? "underline" : "none",
      textAlign: el.align,
      display: "flex",
      flexDirection: "column",
      justifyContent:
        el.valign === "middle"
          ? "center"
          : el.valign === "bottom"
            ? "flex-end"
            : "flex-start",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      lineHeight: 1.2,
      padding: 4,
      overflow: "hidden",
    };
  }
  const border =
    el.stroke && el.stroke !== "none"
      ? `${el.strokeWidth}px solid ${el.stroke}`
      : undefined;
  if (el.type === "rect")
    return { ...base, background: el.fill, border, boxSizing: "border-box" };
  if (el.type === "roundRect")
    return {
      ...base,
      background: el.fill,
      borderRadius: Math.min(el.w, el.h) * 0.18,
      border,
      boxSizing: "border-box",
    };
  if (el.type === "ellipse")
    return {
      ...base,
      background: el.fill,
      borderRadius: "50%",
      border,
      boxSizing: "border-box",
    };
  // triangle / diamond / rightArrow: clip-path can't render a border, so the
  // outline is approximated by a drop-shadow when a stroke is set.
  if (
    el.type === "triangle" ||
    el.type === "diamond" ||
    el.type === "rightArrow"
  ) {
    return {
      ...base,
      background: el.fill,
      clipPath: shapeClipPath(el.type),
      filter:
        el.stroke && el.stroke !== "none"
          ? `drop-shadow(0 0 ${el.strokeWidth || 1}px ${el.stroke})`
          : undefined,
    };
  }
  if (el.type === "line")
    return {
      ...base,
      height: Math.max(el.strokeWidth || 2, 1),
      background: el.stroke,
      top: el.y,
    };
  if (el.type === "image") return { ...base };
  return base;
}

function ElementView({
  el,
  revealedIds,
  linkable,
}: {
  el: SlideElement;
  revealedIds?: ReadonlySet<string>;
  linkable?: boolean;
}) {
  const style = elementStyle(el);

  // Determine visibility / entrance animation when revealedIds is provided (present mode).
  let animStyle: React.CSSProperties = {};
  if (revealedIds !== undefined && el.animation) {
    const revealed = revealedIds.has(el.id);
    if (!revealed) {
      animStyle = { opacity: 0, pointerEvents: "none" };
    } else {
      // Re-key via a data attribute so the animation replays on reveal.
      animStyle = { animation: elementAnimation(el.animation.type) };
    }
  }

  const merged: React.CSSProperties = { ...style, ...animStyle };

  // In present mode, an element with a url becomes a clickable overlay link.
  const linkOverlay =
    linkable && el.url ? (
      <a
        href={el.url}
        target="_blank"
        rel="noopener noreferrer"
        title={el.url}
        style={{
          position: "absolute",
          left: el.x,
          top: el.y,
          width: el.w,
          height: el.h,
          transform: style.transform,
          transformOrigin: "center",
          cursor: "pointer",
          zIndex: 5,
        }}
      />
    ) : null;

  const inner = renderElementBody(el, merged);
  return linkOverlay ? (
    <>
      {inner}
      {linkOverlay}
    </>
  ) : (
    inner
  );
}

function renderElementBody(
  el: SlideElement,
  merged: React.CSSProperties,
): React.ReactElement {
  if (el.type === "image") {
    return el.src ? (
      <img src={el.src} alt="" style={{ ...merged, objectFit: "contain" }} />
    ) : (
      <div
        style={{
          ...merged,
          background: "#f1f3f4",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#9aa0a6",
          fontSize: 12,
        }}
      >
        Image
      </div>
    );
  }
  if (el.type === "text") return <div style={merged}>{el.text}</div>;
  if (el.type === "table")
    return (
      <div style={merged}>
        <SlideTable el={el} />
      </div>
    );
  return <div style={merged} />;
}

/** SlideTable renders an element's table grid. When onCellChange is supplied the
 *  cells become contentEditable (editor); otherwise read-only (view/present). */
export function SlideTable({
  el,
  onCellChange,
}: {
  el: SlideElement;
  onCellChange?: (row: number, col: number, value: string) => void;
}) {
  const t = el.table;
  if (!t) return null;
  const border = `1px solid ${el.stroke && el.stroke !== "none" ? el.stroke : "#bbb"}`;
  const editable = !!onCellChange;
  return (
    <table
      style={{
        width: "100%",
        height: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
        fontSize: el.fontSize || 16,
        fontFamily: el.fontFamily || "Arial",
        color: el.color || "#202124",
      }}
    >
      <tbody>
        {t.cells.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td
                key={ci}
                style={{
                  border,
                  padding: 4,
                  verticalAlign: "top",
                  background: el.fill && el.fill !== "none" ? el.fill : undefined,
                  overflow: "hidden",
                  cursor: editable ? "text" : "default",
                }}
                contentEditable={editable}
                suppressContentEditableWarning
                onPointerDown={editable ? (e) => e.stopPropagation() : undefined}
                onBlur={
                  editable
                    ? (e) =>
                        onCellChange?.(
                          ri,
                          ci,
                          (e.target as HTMLElement).innerText,
                        )
                    : undefined
                }
                ref={
                  editable
                    ? (n) => {
                        if (n && n.innerText !== cell) n.innerText = cell;
                      }
                    : undefined
                }
              >
                {editable ? undefined : cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
