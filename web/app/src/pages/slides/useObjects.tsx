// Editor glue for the M11 objects: dialog state and the insert/edit actions
// for charts, diagrams, video/audio and word art. DeckEditor wires the
// returned actions into its menus and renders `dialogs`.
import { useState } from "react";
import { uploadDeckAsset } from "./api";
import { newChartElement } from "./chartElement";
import { defaultDiagramBox, DIAGRAM_LAYOUTS, newDiagram, rebuildDiagram, type DiagramLayout } from "./diagrams";
import { mediaFileError, mediaKindOf, mimeFromName, newMediaElement, setPlayback } from "./media";
import { newElement, type SlideChart, type SlideElement, type SlideMedia, type WordArt } from "./model";
import { ChartDialog, DiagramDialog, MediaDialog, WordArtDialog, type MediaPick } from "./ObjectDialogs";
import { activeTheme } from "./theme";
import { newWordArt } from "./wordArt";
import type { ChartType } from "../sheets/chartData";

interface Opts {
  deckId: string;
  size: { w: number; h: number };
  selected: SlideElement[];
  upsert: (el: SlideElement) => void;
  upsertMany: (els: SlideElement[]) => void;
  select: (id: string) => void;
}

/** A frame of a video file as a JPEG, plus the clip's size (browser only;
 *  null when the browser can't decode it). */
export async function capturePoster(file: Blob): Promise<{ poster: Blob | null; w: number; h: number } | null> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  v.src = url;
  const once = (ev: string, ms: number) =>
    new Promise<boolean>((resolve) => {
      const t = window.setTimeout(() => resolve(false), ms);
      v.addEventListener(ev, () => (window.clearTimeout(t), resolve(true)), { once: true });
      v.addEventListener("error", () => (window.clearTimeout(t), resolve(false)), { once: true });
    });
  try {
    if (!(await once("loadeddata", 6000)) || !v.videoWidth) return null;
    const w = v.videoWidth;
    const h = v.videoHeight;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    if (d > 0.2) {
      v.currentTime = Math.min(1, d * 0.1);
      await once("seeked", 4000);
    }
    const c = document.createElement("canvas");
    const s = Math.min(1, 1280 / w);
    c.width = Math.round(w * s);
    c.height = Math.round(h * s);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    const poster = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/jpeg", 0.85));
    return { poster, w, h };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function useObjects({ deckId, size, selected, upsert, upsertMany, select }: Opts) {
  const [chartDlg, setChartDlg] = useState<{ el: SlideElement; inserting: boolean } | null>(null);
  const [diagramDlg, setDiagramDlg] = useState<{ el: SlideElement | null; layout: DiagramLayout; outline: string } | null>(null);
  const [mediaDlg, setMediaDlg] = useState<{ kind: SlideMedia["kind"]; el: SlideElement | null } | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaErr, setMediaErr] = useState<string | null>(null);
  const [wordArtFor, setWordArtFor] = useState<SlideElement[] | null>(null);

  const one = selected.length === 1 ? selected[0] : null;
  const texts = selected.filter((e) => e.type === "text");

  function insertChart(type: ChartType = "column") {
    const el = newChartElement(type, { x: Math.round((size.w - 480) / 2), y: Math.round((size.h - 300) / 2) });
    setChartDlg({ el, inserting: true });
  }
  function insertDiagram(layout: DiagramLayout = "process") {
    const l = DIAGRAM_LAYOUTS.find((x) => x.value === layout) ?? DIAGRAM_LAYOUTS[0];
    setDiagramDlg({ el: null, layout: l.value, outline: l.sample });
  }
  function insertMedia(kind: SlideMedia["kind"]) {
    setMediaErr(null);
    setMediaDlg({ kind, el: null });
  }
  function insertWordArt() {
    const el: SlideElement = { ...newElement("text"), ...newWordArt("gradient") };
    upsert(el);
    select(el.id);
  }
  /** Double-click / Format menu: edit the object's data, outline or playback. */
  function openObject(el: SlideElement) {
    if (el.type === "chart" && el.chart) setChartDlg({ el, inserting: false });
    else if (el.diagram) setDiagramDlg({ el, layout: el.diagram.layout, outline: el.diagram.outline });
    else if (el.type === "media" && el.media) {
      setMediaErr(null);
      setMediaDlg({ kind: el.media.kind, el });
    } else if (el.type === "text") setWordArtFor([el]);
  }

  async function pickMedia(p: MediaPick) {
    const dlg = mediaDlg;
    if (!dlg) return;
    const opts = { autoplay: p.autoplay, loop: p.loop, muted: p.muted };
    if (dlg.el) {
      upsert(setPlayback(dlg.el, opts));
      setMediaDlg(null);
      return;
    }
    setMediaErr(null);
    try {
      let media: SlideMedia;
      let natural: { w: number; h: number } | null = null;
      if (p.file) {
        const err = mediaFileError(p.file);
        if (err) throw new Error(err);
        setMediaBusy(true);
        const mime = p.file.type || mimeFromName(p.file.name) || "";
        const kind = mediaKindOf(mime) ?? dlg.kind;
        let src: string;
        try {
          src = await uploadDeckAsset(deckId, p.file);
        } catch (e) {
          const m = String((e as Error).message);
          throw new Error(
            m.includes("413") ? "The file is too large." : m.includes("415") ? "The server refused this media type." : "Upload failed (media needs the server's file store).",
          );
        }
        media = { kind, src, mime };
        if (kind === "video") {
          const shot = await capturePoster(p.file);
          if (shot) {
            natural = { w: shot.w, h: shot.h };
            if (shot.poster) {
              try {
                media.poster = await uploadDeckAsset(deckId, shot.poster);
              } catch {
                /* no poster */
              }
            }
          }
        }
      } else if (p.url) {
        media = { kind: p.url.kind, src: p.url.src, ...(p.url.embed ? { embed: p.url.embed } : {}), ...(p.url.mime ? { mime: p.url.mime } : {}) };
      } else return;
      for (const k of ["autoplay", "loop", "muted"] as const) if (opts[k]) media[k] = true;
      const el = newMediaElement(media, size, natural);
      upsert(el);
      select(el.id);
      setMediaDlg(null);
    } catch (e) {
      setMediaErr((e as Error).message);
    } finally {
      setMediaBusy(false);
    }
  }

  function applyChart(chart: SlideChart) {
    if (!chartDlg) return;
    const el = { ...chartDlg.el, chart };
    upsert(el);
    if (chartDlg.inserting) select(el.id);
    setChartDlg(null);
  }

  function applyDiagram(layout: DiagramLayout, outline: string) {
    if (!diagramDlg) return;
    const theme = activeTheme();
    if (diagramDlg.el) upsert(rebuildDiagram(diagramDlg.el, { layout, outline }, theme));
    else {
      const g = newDiagram(layout, outline, defaultDiagramBox(size), theme);
      upsert(g);
      select(g.id);
    }
    setDiagramDlg(null);
  }

  function applyWordArt(art: WordArt | undefined, color?: string) {
    if (!wordArtFor) return;
    upsertMany(
      wordArtFor.map((e) => {
        const n: SlideElement = { ...e, ...(color ? { color } : {}) };
        if (color && n.runs) n.runs = n.runs.map(({ color: _c, ...r }) => (void _c, r));
        if (art) n.wordArt = art;
        else delete n.wordArt;
        return n;
      }),
    );
    setWordArtFor(null);
  }

  const dialogs = (
    <>
      <ChartDialog
        open={!!chartDlg}
        initial={chartDlg?.el.chart ?? null}
        inserting={!!chartDlg?.inserting}
        onApply={applyChart}
        onClose={() => setChartDlg(null)}
      />
      <DiagramDialog
        open={!!diagramDlg}
        initial={diagramDlg ?? { layout: "process", outline: "" }}
        inserting={!diagramDlg?.el}
        onApply={applyDiagram}
        onClose={() => setDiagramDlg(null)}
      />
      <MediaDialog
        open={!!mediaDlg}
        kind={mediaDlg?.kind ?? "video"}
        editing={mediaDlg?.el?.media ?? null}
        busy={mediaBusy}
        error={mediaErr}
        onPick={(p) => void pickMedia(p)}
        onClose={() => setMediaDlg(null)}
      />
      <WordArtDialog
        open={!!wordArtFor}
        initial={wordArtFor?.[0]?.wordArt}
        color={wordArtFor?.[0]?.color ?? "#202124"}
        onApply={applyWordArt}
        onClose={() => setWordArtFor(null)}
      />
    </>
  );

  return {
    insertChart,
    insertDiagram,
    insertMedia,
    insertWordArt,
    openObject,
    /** Format ▸ Word art… for the selected text boxes (null = no text box). */
    editWordArt: texts.length ? () => setWordArtFor(texts) : null,
    editChart: one?.type === "chart" ? () => openObject(one) : null,
    editDiagram: one?.diagram ? () => openObject(one) : null,
    editPlayback: one?.type === "media" ? () => openObject(one) : null,
    dialogs,
  };
}
