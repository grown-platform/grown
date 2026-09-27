// Page chrome for the paginated view (Docs M9): the page sheets behind the
// text (size, orientation, page colour, borders, watermark, column lines,
// line numbers) and every page's header and footer in front of it.
//
// Headers and footers are the section's Yjs fragments (sections.ts
// hfFragment: own or linked to the previous section; default / first /
// even). The first page's header and the last page's footer are live
// MarginEditors (as before M9); any other page's header or footer becomes
// live on double-click. Static copies are rendered from the fragment with
// the margin schema. Page fields (PAGE / NUMPAGES / SECTIONPAGES) are CSS
// counters that each box sets, so one shared header shows each page's
// number.
import { useEffect, useMemo, useState } from "react";
import { Box } from "@mui/joy";
import type { Editor } from "@tiptap/react";
import type * as Y from "yjs";
import { DOMSerializer } from "@tiptap/pm/model";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import { MarginEditor } from "./MarginEditor";
import { marginSchema, MARGIN_FIELD_CSS } from "./margin";
import { hfFragment, pageHfKind, type HfWhich, type PageBorders } from "./sections";
import { lineNumbers, type DocLayout } from "./paginationModel";
import type { PageBox } from "./pagination";
import type { BaseGeom } from "./paginationPlugin";
import type { SuggestUser } from "./suggesting";
import { hfNavKey, hfNavigate } from "./hfNav";

// --- fragment HTML ---------------------------------------------------------------------------

/** useFragmentHtml renders named header/footer fragments to HTML and
 *  keeps them current. */
export function useFragmentHtml(ydoc: Y.Doc, names: string[]): Map<string, string> {
  const key = names.join("\n");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const frags = [...new Set(names)].map((n) => ydoc.getXmlFragment(n));
    const bump = () => setVersion((v) => v + 1);
    for (const f of frags) f.observeDeep(bump);
    return () => {
      for (const f of frags) f.unobserveDeep(bump);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, key]);
  return useMemo(() => {
    const out = new Map<string, string>();
    const ser = DOMSerializer.fromSchema(marginSchema());
    for (const name of new Set(names)) {
      try {
        const frag = ydoc.getXmlFragment(name);
        if (!frag.length) {
          out.set(name, "");
          continue;
        }
        const node = yXmlFragmentToProseMirrorRootNode(frag, marginSchema());
        const div = document.createElement("div");
        div.appendChild(ser.serializeFragment(node.content));
        out.set(name, node.textContent.trim() || div.querySelector(".hf-field") ? div.innerHTML : "");
      } catch {
        out.set(name, "");
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, key, version]);
}

// --- geometry --------------------------------------------------------------------------------

export interface PageGeomPx {
  x: number;
  y: number;
  w: number;
  h: number;
  textLeft: number;
  textWidth: number;
}

export function pageGeom(page: PageBox, base: BaseGeom): PageGeomPx {
  const s = page.spec;
  const x = (base.maxW - s.w) / 2;
  return { x, y: page.top, w: s.w, h: s.h, textLeft: page.textLeft, textWidth: s.w - s.left - s.right - s.gutter };
}

export interface PageHf {
  header: string;
  footer: string;
}

/** Which fragments each page shows. */
export function pageFragments(dl: DocLayout): PageHf[] {
  return dl.layout.pages.map((p) => {
    const sec = dl.sections[p.section];
    const kind = pageHfKind({
      firstOfSection: p.sectionPage === 1,
      titlePg: !!sec?.props.titlePg,
      pageNumber: p.number,
      evenOdd: dl.settings.evenOdd,
    });
    return {
      header: hfFragment(dl.sections, p.section, "header", kind),
      footer: hfFragment(dl.sections, p.section, "footer", kind),
    };
  });
}

function counterStyle(dl: DocLayout, page: PageBox): Record<string, string> {
  const total = dl.layout.pages.length;
  const secPages = dl.layout.pages.filter((p) => p.section === page.section).length;
  return { counterReset: `hfpage ${page.number} hfpages ${total} hfsecpages ${secPages}` };
}

const BORDER_CSS: Record<PageBorders["style"], string> = {
  single: "solid",
  double: "double",
  dotted: "dotted",
  dashed: "dashed",
  thick: "solid",
};

// --- page sheets ------------------------------------------------------------------------------

/** PageSheet: one page's background (colour, border, watermark). */
export function PageSheet({ dl, page, base, index }: { dl: DocLayout; page: PageBox; base: BaseGeom; index: number }) {
  const g = pageGeom(page, base);
  const s = dl.settings;
  const sec = dl.sections[page.section];
  const b = sec?.props.borders;
  const showBorder = b && (b.display === "all" || (b.display === "first" && page.sectionPage === 1) || (b.display === "notFirst" && page.sectionPage > 1));
  const wm = s.watermark;
  const spec = page.spec;
  const unit = dl.unit;
  return (
    <Box
      className="doc-page"
      data-page={index + 1}
      data-orient={spec.w > spec.h ? "landscape" : "portrait"}
      sx={{
        position: "absolute",
        left: g.x,
        top: g.y,
        width: g.w,
        height: g.h,
        bgcolor: s.pageColor || "#fff",
        boxShadow: "0 1px 3px rgba(60,64,67,.24), 0 1px 2px rgba(60,64,67,.18)",
        overflow: "hidden",
      }}
    >
      {showBorder && b && (
        <Box
          className="doc-page-border"
          sx={{
            position: "absolute",
            ...(b.offsetFrom === "page"
              ? { inset: `${b.space * unit}px` }
              : {
                  top: spec.top - b.space * unit,
                  bottom: spec.bottom - b.space * unit,
                  left: page.textLeft - b.space * unit,
                  right: spec.w - page.textLeft - (spec.w - spec.left - spec.right - spec.gutter) - b.space * unit,
                }),
            border: `${Math.max(0.75, b.width * (b.style === "thick" ? 2 : 1)) * unit}px ${BORDER_CSS[b.style]} ${b.color}`,
            ...(b.style === "double" ? { borderWidth: `${Math.max(3, b.width * 3) * unit}px` } : {}),
          }}
        />
      )}
      {wm && wm.type === "text" && wm.text && (
        <Box
          className="doc-watermark"
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          <Box
            component="span"
            sx={{
              fontFamily: wm.font || "Calibri, Arial, sans-serif",
              fontSize: wm.size === "auto" || !wm.size ? `${Math.min(g.w, g.h) / Math.max(4, wm.text.length) * 1.4}px` : `${(wm.size as number) * unit}px`,
              color: wm.color || "#c0c0c0",
              opacity: wm.semitransparent === false ? 1 : 0.5,
              transform: wm.layout === "horizontal" ? "none" : `rotate(${-Math.atan2(g.h, g.w) * (180 / Math.PI)}deg)`,
              whiteSpace: "nowrap",
              fontWeight: 600,
            }}
          >
            {wm.text}
          </Box>
        </Box>
      )}
      {wm && wm.type === "image" && wm.image && (
        <Box
          className="doc-watermark"
          aria-hidden
          sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}
        >
          <img
            src={wm.image}
            alt=""
            style={{
              maxWidth: wm.scale === "auto" || !wm.scale ? "70%" : undefined,
              width: typeof wm.scale === "number" ? `${wm.scale * 100}%` : undefined,
              opacity: wm.washout === false ? 1 : 0.3,
            }}
          />
        </Box>
      )}
    </Box>
  );
}

/** Column separator lines on a page (Word's "Line between"). */
function ColumnLines({ dl, page, base }: { dl: DocLayout; page: PageBox; base: BaseGeom }) {
  const sec = dl.sections[page.section];
  if (!sec || !sec.props.cols.sep || page.spec.cols.length < 2) return null;
  let top = Infinity;
  let bottom = -Infinity;
  dl.layout.blocks.forEach((pieces, i) => {
    if (i < sec.fromBlock || i >= sec.toBlock) return;
    for (const p of pieces)
      if (p.page === page.index) {
        top = Math.min(top, p.top);
        bottom = Math.max(bottom, p.bottom);
      }
  });
  if (!Number.isFinite(top)) return null;
  const g = pageGeom(page, base);
  const cols = page.spec.cols;
  return (
    <>
      {cols.slice(1).map((c, k) => {
        const prev = cols[k];
        const x = g.x + page.textLeft + (prev.x + prev.w + c.x) / 2;
        return <Box key={k} className="doc-col-line" sx={{ position: "absolute", left: x, top, height: bottom - top, width: 0, borderLeft: "1px solid #9aa0a6" }} />;
      })}
    </>
  );
}

// --- the layer ------------------------------------------------------------------------------

export interface PageLayerProps {
  editor: Editor;
  ydoc: Y.Doc;
  dl: DocLayout;
  base: BaseGeom;
  editable: boolean;
  showHeaderFooter: boolean;
  onShowHeaderFooter: () => void;
  showPageNumbers: boolean;
  suggesting: boolean;
  user: SuggestUser;
  onHeaderEditor?: (e: Editor | null) => void;
  onFooterEditor?: (e: Editor | null) => void;
}

/** The background layer (below the text). */
export function PageBackground({ dl, base }: { dl: DocLayout; base: BaseGeom }) {
  const marks = useMemo(() => lineNumbers(dl), [dl]);
  return (
    <Box className="doc-pages" aria-hidden sx={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
      {dl.layout.pages.map((p, i) => (
        <PageSheet key={i} dl={dl} page={p} base={base} index={i} />
      ))}
      {dl.layout.pages.map((p, i) => (
        <ColumnLines key={`c${i}`} dl={dl} page={p} base={base} />
      ))}
      {marks.map((m, i) => {
        const page = dl.layout.pages[m.page];
        const sec = dl.sections[page.section];
        const dist = (sec?.props.lnNum?.distance || 18) * dl.unit;
        const g = pageGeom(page, base);
        return (
          <Box
            key={i}
            className="doc-line-number"
            sx={{
              position: "absolute",
              top: m.y,
              height: m.h,
              left: g.x + page.textLeft - dist - 40,
              width: 40,
              textAlign: "right",
              fontSize: 11,
              lineHeight: `${m.h}px`,
              color: "#80868b",
            }}
          >
            {m.n}
          </Box>
        );
      })}
    </Box>
  );
}

/** The foreground layer: headers and footers (and page-number labels). */
export function PageHeadersFooters(props: PageLayerProps) {
  const { dl, base, ydoc } = props;
  const frags = useMemo(() => pageFragments(dl), [dl]);
  const names = useMemo(() => frags.flatMap((f) => [f.header, f.footer]), [frags]);
  const html = useFragmentHtml(ydoc, names);
  const [active, setActive] = useState<{ page: number; which: HfWhich } | null>(null);
  const last = dl.layout.pages.length - 1;
  // PageUp / PageDown / Alt+PageUp / Alt+PageDown / Escape inside a header
  // or footer (M13, hfNav.ts).
  const onHfKey = (e: React.KeyboardEvent, page: number, which: HfWhich) => {
    const act = hfNavKey(e);
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    if (act === "exit") {
      setActive(null);
      props.editor.commands.focus();
      return;
    }
    const to = hfNavigate({ page, which }, act, dl.layout.pages.length);
    if (!to) return;
    setActive(to);
    const sel = `.doc-hf--${to.which}[data-page="${to.page + 1}"] .ProseMirror`;
    const focus = (tries: number) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) {
        el.focus();
        el.scrollIntoView({ block: "nearest" });
      } else if (tries > 0) requestAnimationFrame(() => focus(tries - 1));
    };
    requestAnimationFrame(() => focus(10));
  };
  const box = (page: PageBox, i: number, which: HfWhich) => {
    const g = pageGeom(page, base);
    const name = frags[i][which];
    const live =
      (props.showHeaderFooter && ((which === "header" && i === 0) || (which === "footer" && i === last))) ||
      (active && active.page === i && active.which === which);
    const content = html.get(name) ?? "";
    if (!live && !content) {
      // An empty margin still takes a double-click to start editing.
      return (
        <Box
          key={`${which}${i}`}
          onDoubleClick={() => {
            setActive({ page: i, which });
            props.onShowHeaderFooter();
          }}
          sx={{
            position: "absolute",
            left: g.x,
            width: g.w,
            ...(which === "header" ? { top: g.y, height: page.spec.top } : { top: g.y + g.h - page.spec.bottom, height: page.spec.bottom }),
            pointerEvents: "auto",
            cursor: "text",
          }}
        />
      );
    }
    const pos =
      which === "header"
        ? { top: g.y + page.spec.header }
        : { top: g.y + g.h - page.spec.footer, transform: "translateY(-100%)" };
    const cls = live ? (which === "header" ? (i === 0 ? "doc-header-region" : "doc-hf-live") : i === last ? "doc-footer-region" : "doc-hf-live") : "doc-hf-static";
    return (
      <Box
        key={`${which}${i}`}
        className={`doc-hf doc-hf--${which} ${cls}`}
        data-page={i + 1}
        data-active={active && active.page === i && active.which === which ? "true" : undefined}
        onKeyDownCapture={live ? (e: React.KeyboardEvent) => onHfKey(e, i, which) : undefined}
        data-fragment={name}
        data-pgfmt={dl.sections[page.section]?.props.pgNum.fmt ?? "decimal"}
        onDoubleClick={() => {
          if (!live) {
            setActive({ page: i, which });
            props.onShowHeaderFooter();
          }
        }}
        // Inline, so the legacy .doc-header-region CSS can't move it.
        style={{ position: "absolute", left: g.x + page.textLeft, right: "auto", width: g.textWidth, bottom: "auto", ...pos, ...counterStyle(dl, page) }}
        sx={{
          pointerEvents: "auto",
          fontSize: "0.85rem",
          color: "#5f6368",
          ...MARGIN_FIELD_CSS,
          "& p": { margin: 0 },
          "&.doc-hf-static": { cursor: "text", opacity: live ? 1 : 0.85 },
        }}
      >
        {live ? (
          <MarginEditor
            key={name}
            ydoc={ydoc}
            field={name}
            kind={which}
            editable={props.editable}
            placeholder={which === "header" ? "Header" : "Footer"}
            suggesting={props.suggesting}
            user={props.user}
            onEditor={which === "header" && i === 0 ? props.onHeaderEditor : which === "footer" && i === last ? props.onFooterEditor : undefined}
          />
        ) : (
          <div className="margin-static" dangerouslySetInnerHTML={{ __html: content }} />
        )}
      </Box>
    );
  };
  return (
    <Box className="doc-page-chrome" sx={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
      {dl.layout.pages.map((p, i) => (
        <Box key={i} sx={{ display: "contents" }}>
          {box(p, i, "header")}
          {box(p, i, "footer")}
          {props.showPageNumbers && (
            <Box
              sx={{
                position: "absolute",
                left: pageGeom(p, base).x + p.spec.w - 48,
                top: p.top + p.spec.h - 30,
                fontSize: 11,
                color: "#80868b",
              }}
            >
              {p.number}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
