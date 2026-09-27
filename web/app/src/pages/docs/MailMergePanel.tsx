// Tools ▸ Mail merge (Docs M12): a panel (non-modal, so the document stays
// editable underneath) with the four steps of Word's / OnlyOffice's mail
// merge — data source, merge fields, preview, finish. Mounted once
// (<MailMerge editor title/>) and opened with openMailMerge().
//
// The data source (a Grown Sheet range or an uploaded CSV) is remembered in
// the document's `mailMerge` Yjs map, so collaborators and a reload see
// the same source. Merging produces a new Grown doc, a .docx, a PDF, or
// e-mails through the Mail service: one message per record after a
// confirmation step, at most MAIL_MERGE_LIMIT per run, as the signed-in
// user (the Mail API enforces its own auth; a refusal stops the run).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  FormLabel,
  IconButton,
  Input,
  LinearProgress,
  Option,
  Radio,
  RadioGroup,
  Select,
  Sheet,
  Stack,
  Switch,
  Typography,
} from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { DOMSerializer } from "@tiptap/pm/model";
import * as Y from "yjs";
import { getSheet, listSheets } from "../sheets/api";
import type { Sheet as GrownSheet } from "../sheets/types";
import { sendMessage } from "../mail/api";
import {
  csvRows,
  emailField,
  fillTemplate,
  insertMergeField,
  isEmail,
  mergeAll,
  mergeText,
  parseA1Range,
  placeholder,
  previewRecord,
  recordsFromRows,
  sheetRows,
  sheetTabs,
  usedFields,
  type MergeData,
} from "./mailmerge";
import { createDocFrom } from "./diff/sources";
import { collectDocxInput, modelDoc } from "./docx/apply";

/** Most e-mails one run sends. */
export const MAIL_MERGE_LIMIT = 50;

const EVENT = "grown-docs-mail-merge";

/** openMailMerge opens the mounted mail merge panel. */
export function openMailMerge(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}

type Stored =
  | { kind: "sheet"; sheetId: string; title: string; tab: string; range: string }
  | { kind: "csv"; name: string; rows: string[][] };

function storedSource(editor: Editor): Stored | null {
  const y = modelDoc(editor);
  const v = y?.getMap("mailMerge").get("source");
  return v && typeof v === "object" ? (v as Stored) : null;
}

function storeSource(editor: Editor, s: Stored | null): void {
  const y = modelDoc(editor) as Y.Doc | null;
  if (!y) return;
  const m = y.getMap("mailMerge");
  if (s) m.set("source", JSON.parse(JSON.stringify(s)));
  else m.delete("source");
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function docHtml(doc: PMNode, title: string): string {
  const holder = document.createElement("div");
  holder.appendChild(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content));
  const css = "table{border-collapse:collapse} td,th{border:1px solid #999;padding:4px} div[data-page-break]{break-after:page;page-break-after:always}";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${holder.innerHTML}</body></html>`;
}

type Range = "all" | "current" | "some";

export function MailMerge({ editor, title }: { editor: Editor | null; title: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"sheet" | "csv">("sheet");
  const [sheets, setSheets] = useState<GrownSheet[] | null>(null);
  const [sheetId, setSheetId] = useState("");
  const [workbook, setWorkbook] = useState<string>("");
  const [tab, setTab] = useState("");
  const [range, setRange] = useState("");
  const [csvName, setCsvName] = useState("");
  const [data, setData] = useState<MergeData | null>(null);
  const [preview, setPreview] = useState(false);
  const [index, setIndex] = useState(0);
  const [which, setWhich] = useState<Range>("all");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  // E-mail.
  const [mailOpen, setMailOpen] = useState(false);
  const [toField, setToField] = useState("");
  const [subject, setSubject] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState<{ ok: number; failed: string[] } | null>(null);
  const [progress, setProgress] = useState(0);

  const tabs = useMemo(() => sheetTabs(workbook), [workbook]);

  const applyRows = useCallback((rows: string[][]) => {
    const d = recordsFromRows(rows);
    setData(d);
    setIndex(0);
    setFrom(1);
    setTo(Math.max(1, d.records.length));
    setToField(emailField(d) ?? "");
    return d;
  }, []);

  const loadSheet = useCallback(
    async (id: string, t: string, r: string, remember: boolean) => {
      if (!editor) return;
      setError("");
      setBusy("Loading sheet…");
      try {
        const s = await getSheet(id);
        const wb = s.data ?? "[]";
        setWorkbook(wb);
        const tabName = t || sheetTabs(wb)[0] || "";
        setTab(tabName);
        const parsed = r.trim() ? parseA1Range(r) : null;
        if (r.trim() && !parsed) throw new Error(`"${r}" isn't a range like A1:D20.`);
        const d = applyRows(sheetRows(wb, tabName, parsed));
        if (!d.fields.length) throw new Error("That range is empty. The first row should hold the field names.");
        if (remember) storeSource(editor, { kind: "sheet", sheetId: id, title: s.title, tab: tabName, range: r.trim() });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the sheet.");
      } finally {
        setBusy("");
      }
    },
    [editor, applyRows],
  );

  useEffect(() => {
    const on = () => {
      setOpen(true);
      setError("");
      setNote("");
      setSent(null);
      listSheets()
        .then(setSheets)
        .catch(() => setSheets([]));
      if (editor && !data) {
        const st = storedSource(editor);
        if (st?.kind === "sheet") {
          setKind("sheet");
          setSheetId(st.sheetId);
          setRange(st.range);
          void loadSheet(st.sheetId, st.tab, st.range, false);
        } else if (st?.kind === "csv") {
          setKind("csv");
          setCsvName(st.name);
          applyRows(st.rows);
        }
      }
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [editor, data, loadSheet, applyRows]);

  const records = data?.records ?? [];
  const current = records[Math.min(index, records.length - 1)] ?? null;

  // Keep the preview in step with the record shown.
  useEffect(() => {
    if (!editor || !open) return;
    previewRecord(editor, preview && current ? current : null);
  }, [editor, open, preview, current]);

  if (!editor || !open) return null;

  const close = () => {
    previewRecord(editor, null);
    setPreview(false);
    setOpen(false);
  };

  const onCsv = async (file: File | null) => {
    if (!file) return;
    setError("");
    try {
      const rows = csvRows(await file.text());
      const d = applyRows(rows);
      if (!d.fields.length) throw new Error("The file is empty.");
      setCsvName(file.name);
      storeSource(editor, { kind: "csv", name: file.name, rows: rows.slice(0, 2001) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    }
  };

  const chosen = (): Record<string, string>[] => {
    if (which === "current") return current ? [current] : [];
    if (which === "some") return records.slice(Math.max(0, from - 1), Math.max(0, to));
    return records;
  };

  // Merging reads each field's instruction, not its (preview) result.
  const templateDoc = () => editor.state.doc;

  // The merged document plus the template's page setup and headers/footers
  // re-keyed for its sections (each record is its own section).
  const mergeWithLayout = () => {
    const input = collectDocxInput(editor, { title });
    const m = mergeAll(templateDoc(), chosen(), input.settings?.section);
    const margins: Record<string, PMNode> = {};
    for (const [name, src] of Object.entries(m.fragments)) {
      const n = input.margins?.[src];
      if (n) margins[name] = n;
    }
    return { input, merged: m.doc, section: m.section, margins };
  };

  const toNewDoc = async () => {
    setBusy("Merging…");
    setError("");
    try {
      const { input, merged, section, margins } = mergeWithLayout();
      const id = await createDocFrom(editor, `${title || "Untitled document"} (merged)`, merged, {
        margins: Object.fromEntries(Object.entries(margins).map(([k, n]) => [k, n.toJSON()])),
        section,
        settings: input.settings,
      });
      close();
      navigate(`/docs/d/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed.");
    } finally {
      setBusy("");
    }
  };

  const toDocx = async () => {
    setBusy("Building .docx…");
    setError("");
    try {
      const { input, merged, section, margins } = mergeWithLayout();
      const { writeDocx } = await import("./docx/write");
      input.doc = merged;
      input.margins = margins;
      input.header = margins.header ?? null;
      input.footer = margins.footer ?? null;
      if (input.settings) input.settings = { ...input.settings, section };
      input.comments = [];
      const bytes = await writeDocx(input);
      download(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), `${title || "merged"}.docx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy("");
    }
  };

  const toPdf = async () => {
    setBusy("Building PDF…");
    setError("");
    try {
      const merged = mergeAll(templateDoc(), chosen()).doc;
      const name = `${title || "merged"}`;
      const resp = await fetch(`/api/v1/docs/convert?to=pdf&name=${encodeURIComponent(name)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "text/html" },
        body: docHtml(merged, name),
      });
      if (!resp.ok) throw new Error(`PDF export failed: HTTP ${resp.status}`);
      download(await resp.blob(), `${name}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy("");
    }
  };

  const mailList = () => chosen().filter((r) => isEmail(r[toField] ?? ""));
  const sendAll = async () => {
    const list = mailList().slice(0, MAIL_MERGE_LIMIT);
    const tpl = templateDoc();
    setBusy("Sending…");
    setError("");
    setProgress(0);
    const failed: string[] = [];
    let ok = 0;
    for (const [i, rec] of list.entries()) {
      const addr = rec[toField].trim();
      try {
        await sendMessage({ to_addrs: [addr], cc_addrs: [], subject: fillTemplate(subject, rec), body: mergeText(tpl, rec) });
        ok++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        failed.push(addr);
        if (/HTTP 40[13]/.test(msg)) {
          setError("The mail service refused the request (not signed in to Mail, or no permission). Nothing more was sent.");
          break;
        }
      }
      setProgress(Math.round(((i + 1) / list.length) * 100));
    }
    setSent({ ok, failed });
    setConfirming(false);
    setBusy("");
  };

  const fieldsInDoc = usedFields(editor.state.doc);
  const missing = data ? fieldsInDoc.filter((f) => !data.fields.some((x) => x.toLowerCase() === f.toLowerCase())) : [];
  const toSend = data && toField ? mailList() : [];

  return (
    <Sheet
      variant="outlined"
      data-testid="mail-merge"
      sx={{
        position: "fixed",
        right: 16,
        top: 120,
        bottom: 16,
        width: "min(360px, calc(100vw - 32px))",
        zIndex: 1100,
        borderRadius: "md",
        boxShadow: "lg",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", p: 1.5, gap: 1 }}>
        <Typography level="title-md" sx={{ flex: 1 }}>
          Mail merge
        </Typography>
        <IconButton size="sm" variant="plain" aria-label="Close mail merge" onClick={close}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider />
      <Stack spacing={2} sx={{ p: 1.5, overflowY: "auto", flex: 1 }}>
        <Box>
          <Typography level="title-sm">1. Data source</Typography>
          <RadioGroup orientation="horizontal" value={kind} onChange={(e) => setKind(e.target.value as "sheet" | "csv")} sx={{ gap: 2, my: 1 }}>
            <Radio value="sheet" label="Grown Sheet" size="sm" />
            <Radio value="csv" label="CSV file" size="sm" data-testid="mm-kind-csv" />
          </RadioGroup>
          {kind === "sheet" ? (
            <Stack spacing={1}>
              <Select
                size="sm"
                placeholder={sheets ? (sheets.length ? "Choose a sheet" : "No sheets") : "Loading…"}
                value={sheetId || null}
                onChange={(_, v) => {
                  setSheetId(String(v ?? ""));
                  setTab("");
                }}
                data-testid="mm-sheet"
                slotProps={{ listbox: { sx: { zIndex: 1400, maxHeight: 280 } } }}
              >
                {(sheets ?? []).map((s) => (
                  <Option key={s.id} value={s.id}>
                    {s.title || "Untitled spreadsheet"}
                  </Option>
                ))}
              </Select>
              <Box sx={{ display: "flex", gap: 1 }}>
                <Select
                  size="sm"
                  placeholder="Sheet tab"
                  value={tab || null}
                  onChange={(_, v) => setTab(String(v ?? ""))}
                  sx={{ flex: 1 }}
                  disabled={!tabs.length}
                  slotProps={{ listbox: { sx: { zIndex: 1400 } } }}
                >
                  {tabs.map((t) => (
                    <Option key={t} value={t}>
                      {t}
                    </Option>
                  ))}
                </Select>
                <Input size="sm" placeholder="Range (all)" value={range} onChange={(e) => setRange(e.target.value)} sx={{ width: 110 }} slotProps={{ input: { "data-testid": "mm-range" } as Record<string, unknown> }} />
              </Box>
              <Button size="sm" variant="soft" disabled={!sheetId || !!busy} onClick={() => loadSheet(sheetId, tab, range, true)} data-testid="mm-load">
                Use this data
              </Button>
            </Stack>
          ) : (
            <Input size="sm" type="file" slotProps={{ input: { accept: ".csv,text/csv,.txt", "data-testid": "mm-csv" } as Record<string, unknown> }} onChange={(e) => onCsv((e.target as HTMLInputElement).files?.[0] ?? null)} />
          )}
          {data && (
            <Typography level="body-xs" sx={{ mt: 1 }} data-testid="mm-summary">
              {records.length} record{records.length === 1 ? "" : "s"} · {data.fields.length} field{data.fields.length === 1 ? "" : "s"}
              {kind === "csv" && csvName ? ` · ${csvName}` : ""}
            </Typography>
          )}
        </Box>

        <Box>
          <Typography level="title-sm">2. Insert merge fields</Typography>
          {data ? (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1 }}>
              {data.fields.map((f) => (
                <Chip
                  key={f}
                  size="sm"
                  variant="outlined"
                  data-testid={`mm-field-${f}`}
                  onClick={() => {
                    insertMergeField(editor, f);
                    editor.view.focus();
                  }}
                >
                  {placeholder(f)}
                </Chip>
              ))}
            </Box>
          ) : (
            <Typography level="body-xs" sx={{ opacity: 0.7 }}>
              Choose a data source first. The first row names the fields.
            </Typography>
          )}
          {missing.length > 0 && (
            <Typography level="body-xs" color="warning" sx={{ mt: 0.5 }}>
              Not in the data: {missing.map(placeholder).join(", ")} (merged as empty).
            </Typography>
          )}
        </Box>

        <Box>
          <Typography level="title-sm">3. Preview results</Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
            <Switch size="sm" checked={preview} disabled={!records.length} onChange={(e) => setPreview(e.target.checked)} slotProps={{ input: { "data-testid": "mm-preview" } as Record<string, unknown> }} />
            <Typography level="body-sm" sx={{ flex: 1 }}>
              Preview
            </Typography>
            <IconButton size="sm" variant="plain" aria-label="Previous record" disabled={index <= 0} onClick={() => setIndex(index - 1)}>
              <ChevronLeftIcon />
            </IconButton>
            <Typography level="body-sm" data-testid="mm-record">
              {records.length ? `${index + 1} of ${records.length}` : "0 of 0"}
            </Typography>
            <IconButton size="sm" variant="plain" aria-label="Next record" disabled={index >= records.length - 1} onClick={() => setIndex(index + 1)} data-testid="mm-next">
              <ChevronRightIcon />
            </IconButton>
          </Box>
        </Box>

        <Box>
          <Typography level="title-sm">4. Finish & merge</Typography>
          <RadioGroup orientation="horizontal" value={which} onChange={(e) => setWhich(e.target.value as Range)} sx={{ gap: 1.5, my: 1, flexWrap: "wrap" }}>
            <Radio value="all" label="All" size="sm" />
            <Radio value="current" label="Current" size="sm" />
            <Radio value="some" label="From" size="sm" />
          </RadioGroup>
          {which === "some" && (
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1 }}>
              <Input size="sm" type="number" value={from} onChange={(e) => setFrom(Math.max(1, +e.target.value || 1))} sx={{ width: 80 }} />
              <Typography level="body-sm">to</Typography>
              <Input size="sm" type="number" value={to} onChange={(e) => setTo(Math.max(1, +e.target.value || 1))} sx={{ width: 80 }} />
            </Box>
          )}
          <Stack spacing={1}>
            <Button size="sm" disabled={!records.length || !!busy} onClick={toNewDoc} data-testid="mm-merge-doc">
              Merge to new document
            </Button>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button size="sm" variant="outlined" sx={{ flex: 1 }} disabled={!records.length || !!busy} onClick={toDocx}>
                Download .docx
              </Button>
              <Button size="sm" variant="outlined" sx={{ flex: 1 }} disabled={!records.length || !!busy} onClick={toPdf}>
                Download PDF
              </Button>
            </Box>
            <Button size="sm" variant="outlined" disabled={!records.length || !!busy} onClick={() => setMailOpen(!mailOpen)} data-testid="mm-email">
              Send as e-mail…
            </Button>
          </Stack>
          {mailOpen && data && (
            <Stack spacing={1} sx={{ mt: 1.5, p: 1, borderRadius: "sm", bgcolor: "background.level1" }}>
              <FormControl size="sm">
                <FormLabel>To (field with the address)</FormLabel>
                <Select size="sm" value={toField || null} onChange={(_, v) => setToField(String(v ?? ""))} slotProps={{ listbox: { sx: { zIndex: 1400 } } }}>
                  {data.fields.map((f) => (
                    <Option key={f} value={f}>
                      {f}
                    </Option>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="sm">
                <FormLabel>Subject («Field» is filled in)</FormLabel>
                <Input size="sm" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Hello «First name»" />
              </FormControl>
              <Typography level="body-xs" sx={{ opacity: 0.8 }}>
                The message is the document as plain text. At most {MAIL_MERGE_LIMIT} e-mails are sent per run.
              </Typography>
              {!confirming ? (
                <Button size="sm" disabled={!toSend.length || !subject.trim() || !!busy} onClick={() => setConfirming(true)}>
                  Review {Math.min(toSend.length, MAIL_MERGE_LIMIT)} e-mail{toSend.length === 1 ? "" : "s"}…
                </Button>
              ) : (
                <Alert color="warning" variant="soft" size="sm" sx={{ flexDirection: "column", alignItems: "stretch" }}>
                  <Typography level="body-sm">
                    Send {Math.min(toSend.length, MAIL_MERGE_LIMIT)} e-mail{toSend.length === 1 ? "" : "s"} from your account to{" "}
                    {toSend
                      .slice(0, 3)
                      .map((r) => r[toField])
                      .join(", ")}
                    {toSend.length > 3 ? ` and ${Math.min(toSend.length, MAIL_MERGE_LIMIT) - 3} more` : ""}?
                    {toSend.length > MAIL_MERGE_LIMIT ? ` ${toSend.length - MAIL_MERGE_LIMIT} records are over the limit and won't be sent.` : ""}
                  </Typography>
                  <Typography level="body-xs" sx={{ mt: 0.5 }}>
                    First subject: “{fillTemplate(subject, toSend[0])}”
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, mt: 1, justifyContent: "flex-end" }}>
                    <Button size="sm" variant="plain" color="neutral" onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" color="warning" onClick={sendAll} loading={busy === "Sending…"}>
                      Send
                    </Button>
                  </Box>
                </Alert>
              )}
              {busy === "Sending…" && <LinearProgress determinate value={progress} />}
              {sent && (
                <Typography level="body-xs" color={sent.failed.length ? "warning" : "success"}>
                  Sent {sent.ok}.{sent.failed.length ? ` Failed: ${sent.failed.join(", ")}.` : ""}
                </Typography>
              )}
            </Stack>
          )}
        </Box>
        {busy && busy !== "Sending…" && <LinearProgress />}
        {error && (
          <Alert color="danger" variant="soft" size="sm">
            {error}
          </Alert>
        )}
        {note && <Typography level="body-xs">{note}</Typography>}
      </Stack>
    </Sheet>
  );
}
