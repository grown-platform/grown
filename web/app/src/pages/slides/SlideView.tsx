import { useLayoutEffect, useRef } from "react";
import { Box } from "@mui/joy";
import {
  CANVAS_W,
  CANVAS_H,
  shapeClipPath,
  elementTransform,
  type AnimationType,
  type CellBorder,
  type Slide,
  type SlideElement,
} from "./model";
import { relativeTo } from "./groupOps";
import { connectorHitPath, dashArray, shapeLayers } from "./shapeRender";
import { cropShapePath, fullImageRect, imageStretched } from "./imageOps";
import { insetsOf } from "./textOps";
import { isRich, layoutParagraphs, markerCss, paraCss, runCss } from "./textLayout";
import { parseSlideLink } from "./links";
import { backgroundCss } from "./slideProps";
import {
  CELL_PAD,
  cellFormat,
  cellTextEl,
  colWidths,
  isCovered,
  rowHeights,
  spanOf,
  type CellRange,
} from "./tableOps";

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
  /** Follow a slide link (`#slide:…`) clicked in present mode. */
  onSlideLink?: (url: string) => void;
}

/** SlideView renders a slide read-only, scaled to fit `width` px (at the
 *  open deck's aspect ratio, CANVAS_W × CANVAS_H).
 *  Used for the thumbnail rail and present mode. */
export function SlideView({ slide, width, revealedIds, linkable, onSlideLink }: SlideViewProps) {
  const scale = width / CANVAS_W;
  const height = width * (CANVAS_H / CANVAS_W);
  return (
    <Box
      sx={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        background: backgroundCss(slide),
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
            onSlideLink={onSlideLink}
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
    const ins = insetsOf(el);
    return {
      ...base,
      fontSize: el.fontSize,
      fontFamily: el.fontFamily,
      color: el.color,
      fontWeight: el.bold ? 700 : 400,
      fontStyle: el.italic ? "italic" : "normal",
      // Rich text decorates each run itself (CSS can't undo a parent's line).
      textDecoration: isRich(el)
        ? "none"
        : [el.underline ? "underline" : "", el.strike ? "line-through" : ""]
            .filter(Boolean)
            .join(" ") || "none",
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
      lineHeight: el.lineSpacing || 1.2,
      padding: `${ins.t}px ${ins.r}px ${ins.b}px ${ins.l}px`,
      boxSizing: "border-box",
      overflow: "hidden",
      ...(el.rtl ? { direction: "rtl" as const } : {}),
      ...(el.vert ? { writingMode: "vertical-rl" as const } : {}),
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

/** ShapeSvg draws a "shape"/"connector" element's preset geometry in its box
 *  (overflow visible, so arrowheads and callout tails may leave the box).
 *  With `hit`, a connector gets a wide invisible stroke to click on. */
export function ShapeSvg({ el, hit }: { el: SlideElement; hit?: boolean }) {
  const layers = shapeLayers(el);
  const hitD = hit && el.type === "connector" ? connectorHitPath(el) : undefined;
  return (
    <svg
      width={Math.max(el.w, 1)}
      height={Math.max(el.h, 1)}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        overflow: "visible",
        pointerEvents: "none",
      }}
      data-preset={el.preset}
    >
      {layers.map((l, i) => (
        <g key={i}>
          {l.fill && <path d={l.d} fill={l.fill} fillRule="evenodd" />}
          {l.shade && <path d={l.d} fill={l.shade} fillRule="evenodd" />}
          {l.stroke && (
            <path
              d={l.d}
              fill="none"
              stroke={l.stroke}
              strokeWidth={l.strokeWidth}
              strokeDasharray={l.dash}
              strokeLinejoin={l.lineJoin}
            />
          )}
        </g>
      ))}
      {hitD && (
        <path
          data-testid="connector-hit"
          d={hitD}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(12, (el.strokeWidth || 1) + 8)}
          style={{ pointerEvents: "stroke" }}
        />
      )}
    </svg>
  );
}

function ElementView({
  el,
  revealedIds,
  linkable,
  onSlideLink,
}: {
  el: SlideElement;
  revealedIds?: ReadonlySet<string>;
  linkable?: boolean;
  onSlideLink?: (url: string) => void;
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
  const slideLink = !!parseSlideLink(el.url);
  const linkOverlay =
    linkable && el.url ? (
      <a
        href={slideLink ? undefined : el.url}
        target={slideLink ? undefined : "_blank"}
        rel="noopener noreferrer"
        title={el.url}
        data-link={el.url}
        onClick={(e) => {
          e.stopPropagation();
          if (slideLink) {
            e.preventDefault();
            onSlideLink?.(el.url!);
          }
        }}
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

  const inner =
    el.type === "group" ? (
      <div style={merged}>
        <GroupChildren el={el} />
      </div>
    ) : (
      renderElementBody(el, merged, linkable ? { onSlideLink } : undefined)
    );
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
  links?: TextLinkOpts,
): React.ReactElement {
  if (el.type === "image") {
    return (
      <div style={merged}>
        <ImageBody el={el} />
      </div>
    );
  }
  if (el.type === "text")
    return (
      <div style={merged}>
        <ShrinkFit on={el.autofit === "shrink"}>{renderSlideText(el, links)}</ShrinkFit>
      </div>
    );
  if (el.type === "table")
    return (
      <div style={merged}>
        <SlideTable el={el} />
      </div>
    );
  if (el.type === "shape" || el.type === "connector")
    return (
      <div style={merged}>
        <ShapeSvg el={el} />
      </div>
    );
  return <div style={merged} />;
}

/** ImageBody draws a picture inside its element box: crop (the whole
 *  picture positioned so the box shows the cropped part), crop to shape
 *  (clip-path from the preset), opacity, border and shadow. */
export function ImageBody({ el }: { el: SlideElement }) {
  if (!el.src)
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
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
  const clip = cropShapePath(el);
  const full = fullImageRect(el);
  const stroked = !!el.stroke && el.stroke !== "none" && (el.strokeWidth ?? 0) > 0;
  const dash = dashArray(el.dash, el.strokeWidth || 1);
  return (
    <div
      data-image=""
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity: el.opacity,
        filter: el.shadow ? "drop-shadow(3px 3px 4px rgba(0,0,0,0.45))" : undefined,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          clipPath: clip ? `path("${clip}")` : undefined,
        }}
      >
        <img
          src={el.src}
          alt={el.alt ?? ""}
          draggable={false}
          style={
            imageStretched(el)
              ? { position: "absolute", left: full.x, top: full.y, width: full.w, height: full.h, maxWidth: "none" }
              : { width: "100%", height: "100%", objectFit: "contain", display: "block" }
          }
        />
      </div>
      {stroked && (
        <svg
          width={Math.max(el.w, 1)}
          height={Math.max(el.h, 1)}
          style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
        >
          {clip ? (
            <path d={clip} fill="none" stroke={el.stroke} strokeWidth={el.strokeWidth} strokeDasharray={dash} />
          ) : (
            <rect x={0} y={0} width={el.w} height={el.h} fill="none" stroke={el.stroke} strokeWidth={el.strokeWidth} strokeDasharray={dash} />
          )}
        </svg>
      )}
    </div>
  );
}

/** GroupChildren renders a group's members inside the group's own box (the
 *  box carries the group's rotation/flip, so members turn with it). */
export function GroupChildren({ el }: { el: SlideElement }) {
  return (
    <>
      {(el.children || []).map((c) => (
        <ElementView key={c.id} el={relativeTo(c, el.x, el.y)} />
      ))}
    </>
  );
}

/** Link behaviour of rendered text runs (present mode). */
export interface TextLinkOpts {
  onSlideLink?: (url: string) => void;
}

/** renderSlideText returns a text element's body. A plain element is its
 *  text (pre-wrap); a rich one (runs, paragraph levels, lists, line breaks)
 *  is one block per paragraph with styled runs and list markers. With
 *  `links`, run links are clickable (present mode). */
export function renderSlideText(el: SlideElement, links?: TextLinkOpts): React.ReactNode {
  if (!isRich(el)) return el.text;
  const laid = layoutParagraphs(el);
  const body = laid.map((p, i) => {
    const last = p.runs[p.runs.length - 1];
    return (
      <div key={i} data-para="" style={paraCss(el, p.props, !!p.marker) as React.CSSProperties}>
        {p.marker && (
          <span data-marker="" style={markerCss(el, p) as React.CSSProperties}>
            {p.marker}
          </span>
        )}
        {p.runs.map((r, j) => {
          const parts = r.text.split("\v");
          const content = parts.map((t, k) => (
            <span key={k}>
              {k > 0 && <br />}
              {t}
            </span>
          ));
          const style = runCss(el, r) as React.CSSProperties;
          if (!r.url)
            return (
              <span key={j} style={style}>
                {content}
              </span>
            );
          const slide = !!parseSlideLink(r.url);
          return (
            <a
              key={j}
              data-link={r.url}
              href={links && !slide ? r.url : undefined}
              target={links && !slide ? "_blank" : undefined}
              rel="noopener noreferrer"
              title={r.url}
              style={{ ...style, cursor: links ? "pointer" : undefined, pointerEvents: "auto" }}
              onClick={
                links
                  ? (e) => {
                      e.stopPropagation();
                      if (slide) {
                        e.preventDefault();
                        links.onSlideLink?.(r.url!);
                      }
                    }
                  : undefined
              }
            >
              {content}
            </a>
          );
        })}
        {(!p.runs.length || /\v$/.test(last.text)) && <br />}
      </div>
    );
  });
  return el.vert === "vert270" ? <div style={{ transform: "rotate(180deg)" }}>{body}</div> : body;
}

/** ShrinkFit scales its content down (CSS zoom) until it fits the text box
 *  (Format ▸ Text fitting ▸ Shrink on overflow). */
export function ShrinkFit({ on, children }: { on: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const n = ref.current;
    const box = n?.parentElement;
    if (!n || !box) return;
    n.style.zoom = "";
    if (!on || box.scrollHeight <= box.clientHeight + 0.5) return;
    let lo = 0.1;
    let hi = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      n.style.zoom = String(mid);
      if (box.scrollHeight <= box.clientHeight + 0.5) lo = mid;
      else hi = mid;
    }
    n.style.zoom = String(lo);
  });
  if (!on) return <>{children}</>;
  return (
    <div ref={ref} data-shrink="" style={{ width: "100%" }}>
      {children}
    </div>
  );
}

/** CSS of one cell border side. */
export function borderCss(b: CellBorder | undefined): string {
  if (!b) return "none";
  const style = !b.dash || b.dash === "solid" ? "solid" : b.dash === "sysDot" ? "dotted" : "dashed";
  return `${b.width}px ${style} ${b.color}`;
}

/** The text block of a cell (its paragraphs/runs), styled like a text box. */
export function cellTextStyle(te: SlideElement): React.CSSProperties {
  const s = elementStyle(te);
  return {
    fontSize: s.fontSize,
    fontFamily: s.fontFamily,
    color: s.color,
    fontWeight: s.fontWeight,
    fontStyle: s.fontStyle,
    textDecoration: s.textDecoration,
    textAlign: s.textAlign,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    lineHeight: s.lineHeight,
    padding: CELL_PAD,
  };
}

/** Per-cell hooks of the editor (cell selection, in-place editing). */
export interface TableEditHooks {
  /** Selected cell range (drawn with a tint). */
  range?: CellRange | null;
  /** The cell being edited and its editor. */
  editing?: { r: number; c: number; node: React.ReactNode } | null;
  onCellPointerDown?: (e: React.PointerEvent, r: number, c: number) => void;
  onCellDoubleClick?: (e: React.MouseEvent, r: number, c: number) => void;
}

/** SlideTable renders an element's table: column widths, row heights,
 *  merged cells, style/explicit fills and borders, and rich cell text. */
export function SlideTable({ el, hooks }: { el: SlideElement; hooks?: TableEditHooks }) {
  const t = el.table;
  if (!t) return null;
  const widths = colWidths(el);
  const heights = rowHeights(el);
  const range = hooks?.range;
  return (
    <table
      data-table=""
      style={{
        width: "100%",
        height: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
      }}
    >
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <tbody>
        {t.cells.map((row, ri) => (
          <tr key={ri} style={{ height: heights[ri] }}>
            {row.map((_, ci) => {
              if (isCovered(t, ri, ci)) return null;
              const { rs, cs } = spanOf(t, ri, ci);
              const f = cellFormat(el, ri, ci);
              const te = cellTextEl(el, ri, ci);
              const inRange =
                !!range && ri >= range.r0 && ri <= range.r1 && ci >= range.c0 && ci <= range.c1;
              const editing = hooks?.editing && hooks.editing.r === ri && hooks.editing.c === ci;
              return (
                <td
                  key={ci}
                  data-cell={`${ri},${ci}`}
                  data-selected-cell={inRange ? "true" : undefined}
                  rowSpan={rs > 1 ? rs : undefined}
                  colSpan={cs > 1 ? cs : undefined}
                  style={{
                    borderTop: borderCss(f.borders.t),
                    borderRight: borderCss(f.borders.r),
                    borderBottom: borderCss(f.borders.b),
                    borderLeft: borderCss(f.borders.l),
                    padding: 0,
                    verticalAlign: te.valign === "middle" ? "middle" : te.valign === "bottom" ? "bottom" : "top",
                    background: f.fill,
                    boxShadow: inRange && !editing ? "inset 0 0 0 999px rgba(66,133,244,0.22)" : undefined,
                    overflow: "hidden",
                    cursor: hooks ? "text" : undefined,
                  }}
                  onPointerDown={hooks?.onCellPointerDown ? (e) => hooks.onCellPointerDown!(e, ri, ci) : undefined}
                  onDoubleClick={hooks?.onCellDoubleClick ? (e) => hooks.onCellDoubleClick!(e, ri, ci) : undefined}
                >
                  <div style={cellTextStyle(te)}>{editing ? hooks!.editing!.node : renderSlideText(te)}</div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
