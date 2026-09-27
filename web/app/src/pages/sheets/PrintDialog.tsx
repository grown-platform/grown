/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet sheets are loosely typed. */
import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Typography,
} from "@mui/joy";
import type { CellRect } from "./cellRange";
import { colToLetters, lettersToCol } from "./cellValue";
import { MARGIN_PRESETS, PAPER, sheetPrintSettings, type Margins, type PaperSize, type PrintSettings } from "./printSettings";
import { printHtml, renderPrintHtml } from "./printRender";
import { parseRef, rectRef } from "./xlsx/ooxml";

type ScaleMode = "normal" | "width" | "height" | "page" | "custom";
type Scope = "sheet" | "selection" | "area";

interface PrintDialogProps {
  open: boolean;
  onClose: () => void;
  /** The active sheet (live FortuneSheet object) when the dialog opened. */
  sheet: any;
  /** The selection when the dialog opened (for "Selected cells"). */
  selection: CellRect | null;
  title: string;
  showFormulas: boolean;
  /** Stores the settings on the sheet (grownPrint). */
  onSave: (s: PrintSettings) => void;
}

function scaleMode(s: PrintSettings): ScaleMode {
  if (!s.fitToPage) return s.scale === 100 ? "normal" : "custom";
  if (s.fitToWidth === 1 && s.fitToHeight === 1) return "page";
  if (s.fitToWidth === 1 && s.fitToHeight === 0) return "width";
  if (s.fitToWidth === 0 && s.fitToHeight === 1) return "height";
  return "page";
}

function marginPreset(m: Margins): string {
  for (const [k, v] of Object.entries(MARGIN_PRESETS)) {
    if (v.top === m.top && v.bottom === m.bottom && v.left === m.left && v.right === m.right) return k;
  }
  return "custom";
}

const spanText = (pair: [number, number] | null, cols: boolean) =>
  !pair ? "" : cols ? `${colToLetters(pair[0])}:${colToLetters(pair[1])}` : `${pair[0] + 1}:${pair[1] + 1}`;

function parseSpan(text: string, cols: boolean): [number, number] | null | undefined {
  const t = text.trim().replace(/\$/g, "");
  if (!t) return null;
  const m = cols ? /^([A-Za-z]{1,3})(?::([A-Za-z]{1,3}))?$/.exec(t) : /^(\d+)(?::(\d+))?$/.exec(t);
  if (!m) return undefined;
  const a = cols ? lettersToCol(m[1]) : Number(m[1]) - 1;
  const b = m[2] ? (cols ? lettersToCol(m[2]) : Number(m[2]) - 1) : a;
  if (a < 0 || b < 0) return undefined;
  return [Math.min(a, b), Math.max(a, b)];
}

/** File ▸ Print: page setup with a live preview of the printed pages. */
export function PrintDialog({ open, onClose, sheet, selection, title, showFormulas, onSave }: PrintDialogProps) {
  const [s, setS] = useState<PrintSettings>(() => sheetPrintSettings(sheet));
  const [scope, setScope] = useState<Scope>("sheet");
  const [areaText, setAreaText] = useState("");
  const [rowsText, setRowsText] = useState("");
  const [colsText, setColsText] = useState("");
  const [formulas, setFormulas] = useState(showFormulas);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const init = sheetPrintSettings(sheet);
    setS(init);
    setScope(init.printArea ? "area" : "sheet");
    setAreaText(init.printArea ? rectRef(init.printArea) : selection ? rectRef(selection) : "");
    setRowsText(spanText(init.titleRows, false));
    setColsText(spanText(init.titleCols, true));
    setFormulas(showFormulas);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const areaRect = scope === "area" ? parseRef(areaText) : null;
  const titleRows = parseSpan(rowsText, false);
  const titleCols = parseSpan(colsText, true);
  const invalid = (scope === "area" && !areaRect) || titleRows === undefined || titleCols === undefined;

  /** Settings as they will be stored (the print scope "Selected cells" is not stored). */
  const effective = useMemo<PrintSettings>(
    () => ({
      ...s,
      printArea: scope === "area" ? areaRect : scope === "selection" ? selection : null,
      titleRows: titleRows ?? null,
      titleCols: titleCols ?? null,
    }),
    [s, scope, areaRect?.r1, areaRect?.r2, areaRect?.c1, areaRect?.c2, selection, titleRows?.[0], titleRows?.[1], titleCols?.[0], titleCols?.[1]], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const stored = useMemo<PrintSettings>(() => ({ ...effective, printArea: scope === "area" ? areaRect : null }), [effective, scope, areaRect]);

  const preview = useMemo(() => {
    if (!open || invalid) return { html: "", pages: 0 };
    try {
      return renderPrintHtml(sheet, effective, { title, showFormulas: formulas });
    } catch {
      return { html: "", pages: 0 };
    }
  }, [open, invalid, sheet, effective, title, formulas]);

  const set = (patch: Partial<PrintSettings>) => setS((x) => ({ ...x, ...patch }));
  const mode = scaleMode(s);
  const setMode = (m: ScaleMode) => {
    if (m === "normal") set({ fitToPage: false, scale: 100 });
    else if (m === "custom") set({ fitToPage: false, scale: s.scale === 100 ? 90 : s.scale });
    else if (m === "page") set({ fitToPage: true, fitToWidth: 1, fitToHeight: 1 });
    else if (m === "width") set({ fitToPage: true, fitToWidth: 1, fitToHeight: 0 });
    else set({ fitToPage: true, fitToWidth: 0, fitToHeight: 1 });
  };
  const preset = marginPreset(s.margins);

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        aria-labelledby="print-dialog-title"
        sx={{ width: "min(1180px, calc(100vw - 32px))", height: "min(860px, calc(100vh - 32px))", p: 0, overflow: "hidden" }}
      >
        <ModalClose />
        <Box sx={{ display: "flex", height: "100%", minHeight: 0, flexDirection: { xs: "column", md: "row" } }}>
          <Box
            data-testid="print-settings"
            sx={{ width: { xs: "100%", md: 330 }, flexShrink: 0, p: 2, overflowY: "auto", borderRight: { md: "1px solid" }, borderColor: "divider" }}
          >
            <Typography id="print-dialog-title" level="title-lg" sx={{ mb: 1.5 }}>
              Print settings
            </Typography>
            <Stack spacing={1.5}>
              <FormControl size="sm">
                <FormLabel>Print</FormLabel>
                <Select value={scope} onChange={(_, v) => v && setScope(v as Scope)} slotProps={{ button: { "aria-label": "Print scope" } }}>
                  <Option value="sheet">Current sheet</Option>
                  <Option value="selection" disabled={!selection}>
                    Selected cells
                  </Option>
                  <Option value="area">Print area</Option>
                </Select>
              </FormControl>
              {scope === "area" && (
                <FormControl size="sm" error={!areaRect}>
                  <FormLabel>Print area</FormLabel>
                  <Input value={areaText} onChange={(e) => setAreaText(e.target.value)} placeholder="A1:F40" slotProps={{ input: { "aria-label": "Print area" } }} />
                </FormControl>
              )}
              <FormControl size="sm">
                <FormLabel>Paper size</FormLabel>
                <Select value={s.paper} onChange={(_, v) => v && set({ paper: v as PaperSize })} slotProps={{ button: { "aria-label": "Paper size" } }}>
                  {Object.entries(PAPER).map(([k, p]) => (
                    <Option key={k} value={k}>
                      {p.label}
                    </Option>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="sm">
                <FormLabel>Page orientation</FormLabel>
                <RadioGroup orientation="horizontal" value={s.orientation} onChange={(e) => set({ orientation: e.target.value as PrintSettings["orientation"] })}>
                  <Radio value="portrait" label="Portrait" />
                  <Radio value="landscape" label="Landscape" />
                </RadioGroup>
              </FormControl>
              <FormControl size="sm">
                <FormLabel>Scale</FormLabel>
                <Select value={mode} onChange={(_, v) => v && setMode(v as ScaleMode)} slotProps={{ button: { "aria-label": "Scale" } }}>
                  <Option value="normal">Normal (100%)</Option>
                  <Option value="width">Fit to width</Option>
                  <Option value="height">Fit to height</Option>
                  <Option value="page">Fit to page</Option>
                  <Option value="custom">Custom number</Option>
                </Select>
              </FormControl>
              {mode === "custom" && (
                <FormControl size="sm">
                  <FormLabel>Custom scale (%)</FormLabel>
                  <Input
                    type="number"
                    value={s.scale}
                    onChange={(e) => set({ scale: Math.max(10, Math.min(400, Number(e.target.value) || 100)) })}
                    slotProps={{ input: { min: 10, max: 400, "aria-label": "Custom scale" } }}
                  />
                </FormControl>
              )}
              <FormControl size="sm">
                <FormLabel>Margins</FormLabel>
                <Select
                  value={preset}
                  onChange={(_, v) => v && v !== "custom" && set({ margins: { ...MARGIN_PRESETS[v as keyof typeof MARGIN_PRESETS] } })}
                  slotProps={{ button: { "aria-label": "Margins" } }}
                >
                  <Option value="normal">Normal</Option>
                  <Option value="narrow">Narrow</Option>
                  <Option value="wide">Wide</Option>
                  <Option value="custom">Custom</Option>
                </Select>
              </FormControl>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                {(["top", "bottom", "left", "right"] as const).map((k) => (
                  <FormControl size="sm" key={k}>
                    <FormLabel sx={{ textTransform: "capitalize" }}>{k} (in)</FormLabel>
                    <Input
                      type="number"
                      value={s.margins[k]}
                      onChange={(e) => set({ margins: { ...s.margins, [k]: Math.max(0, Number(e.target.value) || 0) } })}
                      slotProps={{ input: { step: 0.05, min: 0, "aria-label": `${k} margin` } }}
                    />
                  </FormControl>
                ))}
              </Box>
              <Divider />
              <Typography level="title-sm">Formatting</Typography>
              <Checkbox size="sm" label="Show gridlines" checked={s.gridLines} onChange={(e) => set({ gridLines: e.target.checked })} />
              <Checkbox size="sm" label="Show row and column headings" checked={s.headings} onChange={(e) => set({ headings: e.target.checked })} />
              <Checkbox size="sm" label="Show formulas" checked={formulas} onChange={(e) => setFormulas(e.target.checked)} />
              <Checkbox size="sm" label="Center horizontally" checked={s.hCenter} onChange={(e) => set({ hCenter: e.target.checked })} />
              <Checkbox size="sm" label="Center vertically" checked={s.vCenter} onChange={(e) => set({ vCenter: e.target.checked })} />
              <FormControl size="sm">
                <FormLabel>Page order</FormLabel>
                <RadioGroup orientation="horizontal" value={s.pageOrder} onChange={(e) => set({ pageOrder: e.target.value as PrintSettings["pageOrder"] })}>
                  <Radio value="downThenOver" label="Down, then over" />
                  <Radio value="overThenDown" label="Over, then down" />
                </RadioGroup>
              </FormControl>
              <Divider />
              <Typography level="title-sm">Repeat on every page</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                <FormControl size="sm" error={titleRows === undefined}>
                  <FormLabel>Rows</FormLabel>
                  <Input value={rowsText} onChange={(e) => setRowsText(e.target.value)} placeholder="1:1" slotProps={{ input: { "aria-label": "Rows to repeat" } }} />
                </FormControl>
                <FormControl size="sm" error={titleCols === undefined}>
                  <FormLabel>Columns</FormLabel>
                  <Input value={colsText} onChange={(e) => setColsText(e.target.value)} placeholder="A:A" slotProps={{ input: { "aria-label": "Columns to repeat" } }} />
                </FormControl>
              </Box>
              <Divider />
              <Typography level="title-sm">Headers and footers</Typography>
              <Input size="sm" value={s.header} onChange={(e) => set({ header: e.target.value })} placeholder="Header" slotProps={{ input: { "aria-label": "Header" } }} />
              <Input size="sm" value={s.footer} onChange={(e) => set({ footer: e.target.value })} placeholder="Footer, e.g. Page &P of &N" slotProps={{ input: { "aria-label": "Footer" } }} />
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                &amp;P page, &amp;N pages, &amp;D date, &amp;A sheet name, &amp;F title; &amp;L / &amp;C / &amp;R align.
              </Typography>
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                Manual page breaks: Insert ▸ Page break. {s.rowBreaks.length + s.colBreaks.length} set
                {s.fitToPage && s.rowBreaks.length + s.colBreaks.length ? " (ignored while fitting to a page)" : ""}.
              </Typography>
            </Stack>
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", bgcolor: "#e8eaed" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 1.25, pr: 6, bgcolor: "background.surface", borderBottom: "1px solid", borderColor: "divider" }}>
              <Typography level="body-sm" data-testid="print-page-count">
                {invalid ? "Check the highlighted settings" : `${preview.pages} page${preview.pages === 1 ? "" : "s"}`}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button
                size="sm"
                variant="plain"
                onClick={() => {
                  onSave(stored);
                  onClose();
                }}
                disabled={invalid}
              >
                Save settings
              </Button>
              <Button
                size="sm"
                variant="outlined"
                data-testid="print-download-pdf"
                loading={pdfBusy}
                onClick={async () => {
                  // These pages, as a PDF file (Sheets ▸ Download ▸ PDF uses
                  // each sheet's stored settings instead).
                  setPdfBusy(true);
                  try {
                    const { sheetsToPdf } = await import("./pdfExport");
                    const bytes = await sheetsToPdf([{ sheet, settings: effective }], title, { showFormulas: formulas });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
                    a.download = `${(title || "sheet").replace(/[/\\?%*:|"<>]/g, "-")}.pdf`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  } catch (e) {
                    window.alert(`PDF export failed: ${(e as Error).message}`);
                  } finally {
                    setPdfBusy(false);
                  }
                }}
                disabled={invalid || preview.pages === 0}
              >
                Download PDF
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  onSave(stored);
                  const html = renderPrintHtml(sheet, effective, { title, showFormulas: formulas }).html;
                  onClose();
                  await printHtml(html);
                }}
                disabled={invalid || preview.pages === 0}
              >
                Print
              </Button>
            </Box>
            {preview.html ? (
              <iframe title="Print preview" data-testid="print-preview" srcDoc={preview.html} style={{ flex: 1, border: 0, width: "100%", background: "#e8eaed" }} />
            ) : (
              <Typography level="body-sm" sx={{ p: 3 }}>
                Nothing to print.
              </Typography>
            )}
          </Box>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
