// File ▸ Print (Ctrl+P): print settings with a live preview (M12) — full
// slides, notes pages, handouts (1/2/3/4/6/9 per page) or the outline, a
// slide range, frames, hidden slides, grayscale and paper; then print
// (browser print dialog, vector pages) or download the same pages as PDF.

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  FormLabel,
  IconButton,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Radio,
  RadioGroup,
  Select,
  Typography,
} from "@mui/joy";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import type { DeckDoc } from "./model";
import { DEFAULT_PRINT, HANDOUT_COUNTS, parseRange, type HandoutCount, type PrintLayoutKind, type PrintOptions } from "./printLayout";

const LAYOUT_LABELS: Record<PrintLayoutKind, string> = {
  slides: "Full page slides",
  notes: "Notes pages",
  handouts: "Handouts",
  outline: "Outline",
};

function svgUrl(svg: string): string {
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

export function PrintDialog({
  open,
  onClose,
  deck,
  title,
  cur,
}: {
  open: boolean;
  onClose: () => void;
  deck: DeckDoc | null;
  title: string;
  cur: number;
}) {
  const [opts, setOpts] = useState<PrintOptions>(DEFAULT_PRINT);
  const [pages, setPages] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The inputs the preview currently shows. While they differ from the live
  // inputs a rebuild is pending (debounce + async render), and the preview
  // region reports aria-busy so assistive tech and tests don't read a stale page.
  const [shown, setShown] = useState<{ deck: DeckDoc; title: string; opts: PrintOptions; cur: number } | null>(null);
  const set = (p: Partial<PrintOptions>) => setOpts((o) => ({ ...o, ...p }));
  const count = deck?.slides.length ?? 0;
  const badRange = opts.range === "custom" && !parseRange(opts.custom, count);

  // Rebuild the preview when the options change (debounced for typing).
  useEffect(() => {
    if (!open || !deck) return;
    let live = true;
    const t = window.setTimeout(async () => {
      try {
        const { printJob } = await import("./pdfExport");
        const job = await printJob(deck, title, opts, cur);
        if (!live) return;
        setPages(job.rendered.map((r) => svgUrl(r.svg)));
        setPage((p) => Math.min(p, Math.max(0, job.rendered.length - 1)));
        setError("");
        setShown({ deck, title, opts, cur });
      } catch (e) {
        if (!live) return;
        setError((e as Error).message);
        setShown({ deck, title, opts, cur });
      }
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [open, deck, title, opts, cur]);

  const previewBusy = open && !!deck && (!shown || shown.deck !== deck || shown.title !== title || shown.opts !== opts || shown.cur !== cur);
  const summary = useMemo(() => (pages.length === 1 ? "1 page" : `${pages.length} pages`), [pages.length]);

  const doPrint = async () => {
    if (!deck) return;
    const win = window.open("", "_blank");
    if (!win) {
      setError("Allow pop-ups to print.");
      return;
    }
    setBusy(true);
    try {
      const { printDeck } = await import("./pdfExport");
      await printDeck(deck, title, opts, cur, win);
      onClose();
    } catch (e) {
      win.close();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doPdf = async () => {
    if (!deck) return;
    setBusy(true);
    try {
      const [{ deckToPdf }, { safeName, triggerDownload }] = await Promise.all([import("./pdfExport"), import("./export")]);
      const bytes = await deckToPdf(deck, title, opts, cur);
      const suffix = opts.layout === "slides" ? "" : ` (${LAYOUT_LABELS[opts.layout].toLowerCase()})`;
      triggerDownload(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${safeName(title)}${suffix}.pdf`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="print-title" sx={{ width: "min(920px, 96vw)", maxHeight: "94vh" }} data-testid="print-dialog">
        <ModalClose />
        <DialogTitle id="print-title">Print</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, overflow: "auto" }}>
          <Box sx={{ width: { md: 280 }, flexShrink: 0, display: "flex", flexDirection: "column", gap: 1.5 }}>
            <FormControl size="sm">
              <FormLabel id="print-layout-label">Print layout</FormLabel>
              <Select
                value={opts.layout}
                onChange={(_, v) => v && set({ layout: v })}
                slotProps={{ button: { "aria-labelledby": "print-layout-label", id: "print-layout" } }}
                data-testid="print-layout"
              >
                {(Object.keys(LAYOUT_LABELS) as PrintLayoutKind[]).map((k) => (
                  <Option key={k} value={k}>
                    {LAYOUT_LABELS[k]}
                  </Option>
                ))}
              </Select>
            </FormControl>
            {opts.layout === "handouts" && (
              <Box sx={{ display: "flex", gap: 1 }}>
                <FormControl size="sm" sx={{ flex: 1 }}>
                  <FormLabel id="print-per-page-label">Slides per page</FormLabel>
                  <Select
                    value={opts.perPage}
                    onChange={(_, v) => v && set({ perPage: v as HandoutCount })}
                    slotProps={{ button: { "aria-labelledby": "print-per-page-label" } }}
                    data-testid="print-per-page"
                  >
                    {HANDOUT_COUNTS.map((n) => (
                      <Option key={n} value={n}>
                        {n}
                      </Option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="sm" sx={{ flex: 1 }} disabled={opts.perPage < 4}>
                  <FormLabel id="print-order-label">Order</FormLabel>
                  <Select value={opts.order} onChange={(_, v) => v && set({ order: v })} slotProps={{ button: { "aria-labelledby": "print-order-label" } }}>
                    <Option value="horizontal">Horizontal</Option>
                    <Option value="vertical">Vertical</Option>
                  </Select>
                </FormControl>
              </Box>
            )}
            <FormControl size="sm">
              <FormLabel id="print-range-label">Slides</FormLabel>
              <RadioGroup aria-labelledby="print-range-label" value={opts.range} onChange={(e) => set({ range: e.target.value as PrintOptions["range"] })} size="sm" sx={{ gap: 0.75 }}>
                <Radio value="all" label="All slides" />
                <Radio value="current" label={`Current slide (${cur + 1})`} />
                <Radio value="custom" label="Custom range" />
              </RadioGroup>
              {opts.range === "custom" && (
                <>
                  <Input
                    size="sm"
                    autoFocus
                    placeholder="e.g. 1-3, 5, 8-"
                    value={opts.custom}
                    onChange={(e) => set({ custom: e.target.value })}
                    error={badRange}
                    slotProps={{ input: { "aria-label": "Custom slide range" } }}
                    sx={{ mt: 0.5 }}
                  />
                  <FormHelperText>{badRange ? `Enter slide numbers between 1 and ${count}.` : "Slide numbers and ranges, separated by commas."}</FormHelperText>
                </>
              )}
            </FormControl>
            <Checkbox size="sm" label="Frame slides" checked={opts.frame} disabled={opts.layout !== "slides"} onChange={(e) => set({ frame: e.target.checked })} />
            <Checkbox size="sm" label="Include hidden slides" checked={opts.includeHidden} onChange={(e) => set({ includeHidden: e.target.checked })} />
            <Checkbox size="sm" label="Grayscale" checked={opts.grayscale} onChange={(e) => set({ grayscale: e.target.checked })} />
            {opts.layout !== "slides" && (
              <FormControl size="sm">
                <FormLabel id="print-paper-label">Paper</FormLabel>
                <Select value={opts.paper} onChange={(_, v) => v && set({ paper: v })} slotProps={{ button: { "aria-labelledby": "print-paper-label" } }}>
                  <Option value="letter">Letter (8.5 × 11 in)</Option>
                  <Option value="a4">A4 (210 × 297 mm)</Option>
                </Select>
              </FormControl>
            )}
            {error && (
              <Typography level="body-sm" color="danger" role="alert">
                {error}
              </Typography>
            )}
          </Box>
          <Box
            sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", bgcolor: "background.level2", borderRadius: "sm", p: 1.5, minHeight: 360 }}
            role="region"
            aria-label="Print preview"
            aria-busy={previewBusy}
            data-testid="print-preview"
          >
            {pages.length ? (
              <Box
                component="img"
                src={pages[page]}
                alt={`Preview of page ${page + 1} of ${pages.length}`}
                data-testid="print-preview-page"
                sx={{ maxWidth: "100%", maxHeight: "62vh", bgcolor: "#fff", boxShadow: "sm", display: "block" }}
              />
            ) : (
              <Typography level="body-sm" sx={{ my: "auto" }}>
                {opts.range === "custom" && badRange ? "No slides in this range." : "Nothing to print."}
              </Typography>
            )}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
              <IconButton size="sm" aria-label="Previous page" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeftIcon />
              </IconButton>
              <Typography level="body-sm" aria-live="polite" data-testid="print-page-count">
                {pages.length ? `Page ${page + 1} of ${summary.replace(/ pages?$/, "")}` : summary}
              </Typography>
              <IconButton size="sm" aria-label="Next page" disabled={page >= pages.length - 1} onClick={() => setPage((p) => p + 1)}>
                <ChevronRightIcon />
              </IconButton>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={doPrint} loading={busy} disabled={!pages.length}>
            Print
          </Button>
          <Button variant="outlined" onClick={doPdf} disabled={busy || !pages.length} data-testid="print-download-pdf">
            Download PDF
          </Button>
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
