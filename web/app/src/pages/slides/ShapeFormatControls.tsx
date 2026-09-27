import {
  ARROW_HEADS,
  DASH_STYLES,
  isShape,
  type ArrowHead,
  type DashStyle,
  type SlideElement,
} from "./model";

/** Line weights offered for outlines (points, as PowerPoint). */
export const LINE_WEIGHTS = [0.5, 0.75, 1, 1.5, 2, 3, 4.5, 6, 8];

const selStyle: React.CSSProperties = { marginLeft: 4, maxWidth: 110, fontSize: 12 };

/** Outline colour / weight / dash and arrowheads for the selected shape,
 *  connector or line (toolbar). `onChange` applies a patch to the selection. */
export function ShapeFormatControls({
  el,
  onChange,
}: {
  el: SlideElement | null | undefined;
  onChange: (patch: Partial<SlideElement>) => void;
}) {
  if (!el) return null;
  const outline = isShape(el.type) || el.type === "connector" || el.type === "line";
  if (!outline) return null;
  const preset = el.type === "shape" || el.type === "connector";
  const hasLine = !!el.stroke && el.stroke !== "none" && (el.strokeWidth ?? 1) > 0;
  return (
    <>
      <input
        type="color"
        value={hasLine && /^#[0-9a-f]{6}/i.test(el.stroke!) ? el.stroke!.slice(0, 7) : "#202124"}
        onChange={(e) =>
          onChange({ stroke: e.target.value, ...(hasLine ? {} : { strokeWidth: el.strokeWidth || 1 }) })
        }
        title="Line color"
        aria-label="Line color"
        style={{ marginLeft: 4 }}
      />
      <select
        aria-label="Line weight"
        title="Line weight"
        value={hasLine ? String(el.strokeWidth ?? 1) : "none"}
        onChange={(e) =>
          e.target.value === "none"
            ? onChange({ stroke: "none", strokeWidth: 0 })
            : onChange({
                strokeWidth: Number(e.target.value),
                ...(hasLine ? {} : { stroke: "#202124" }),
              })
        }
        style={selStyle}
      >
        {el.type !== "line" && el.type !== "connector" && <option value="none">No line</option>}
        {[...new Set([...LINE_WEIGHTS, ...(hasLine ? [el.strokeWidth ?? 1] : [])])]
          .sort((a, b) => a - b)
          .map((w) => (
            <option key={w} value={String(w)}>
              {w} pt
            </option>
          ))}
      </select>
      {preset && (
        <select
          aria-label="Dash type"
          title="Dash type"
          value={el.dash ?? "solid"}
          onChange={(e) => {
            const v = e.target.value as DashStyle;
            onChange({ dash: v === "solid" ? undefined : v });
          }}
          style={selStyle}
        >
          {DASH_STYLES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      )}
      {el.type === "connector" &&
        (
          [
            ["headEnd", "Line start"],
            ["tailEnd", "Line end"],
          ] as const
        ).map(([k, label]) => (
          <select
            key={k}
            aria-label={label}
            title={label}
            value={el[k] ?? "none"}
            onChange={(e) => {
              const v = e.target.value as ArrowHead;
              onChange({ [k]: v === "none" ? undefined : v });
            }}
            style={selStyle}
          >
            {ARROW_HEADS.map((a) => (
              <option key={a.value} value={a.value}>
                {label.split(" ")[1]}: {a.label}
              </option>
            ))}
          </select>
        ))}
    </>
  );
}
