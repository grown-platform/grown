import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
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
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { joinAccept, legacyAccept, useOfficeConvertCaps } from "../../lib/officeConvert";
import { IMPORT_ACCEPT, IMPORT_MODES, describeImport, importKind, importSpreadsheetFile, type ImportMode, type ImportedWorkbook } from "./sheetImport";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** Applies the import; may reject with a message. */
  onImport: (imp: ImportedWorkbook, mode: ImportMode, fileName: string) => Promise<void>;
}

const DELIMITERS: { value: string; label: string }[] = [
  { value: "auto", label: "Detect automatically" },
  { value: ",", label: "Comma" },
  { value: "\t", label: "Tab" },
  { value: ";", label: "Semicolon" },
  { value: "|", label: "Pipe" },
  { value: "custom", label: "Custom" },
];

/** File ▸ Import: pick an .xlsx/.xls/.ods/.csv/.tsv file and where it goes. */
export function ImportDialog({ open, onClose, userId, onImport }: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const officeCaps = useOfficeConvertCaps();
  const [mode, setMode] = useState<ImportMode>("insertSheets");
  const [delim, setDelim] = useState("auto");
  const [custom, setCustom] = useState("");
  const [convert, setConvert] = useState(true);
  const [parsed, setParsed] = useState<ImportedWorkbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) return;
    setFile(null);
    setParsed(null);
    setError(null);
    setBusy(false);
  }, [open]);

  const isCsv = !!file && importKind(file.name) === "csv";
  const delimiter = delim === "auto" ? undefined : delim === "custom" ? custom || undefined : delim;

  // Parse on pick (and when CSV options change) so the dialog can show what will be imported.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setError(null);
    setParsed(null);
    importSpreadsheetFile(file, file.name, { userId, delimiter, convert })
      .then((imp) => !cancelled && setParsed(imp))
      .catch((e) => !cancelled && setError((e as Error).message || "The file could not be read."));
    return () => {
      cancelled = true;
    };
  }, [file, delimiter, convert, userId]);

  const oneSheetOnly = mode === "replaceSheet" || mode === "appendRows" || mode === "replaceAtCell";

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog aria-labelledby="import-dialog-title" sx={{ width: "min(560px, calc(100vw - 32px))" }}>
        <ModalClose />
        <Typography id="import-dialog-title" level="title-lg">
          Import file
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Button variant="outlined" startDecorator={<UploadFileIcon />} onClick={() => inputRef.current?.click()}>
              Choose file
            </Button>
            <Typography level="body-sm" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="import-file-name">
              {file ? file.name : "Excel (.xlsx, .xls), OpenDocument (.ods), CSV or TSV"}
            </Typography>
            <input
              ref={inputRef}
              type="file"
              accept={joinAccept(IMPORT_ACCEPT, legacyAccept(officeCaps, "xlsx"))}
              hidden
              data-testid="import-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                e.target.value = "";
              }}
            />
          </Box>
          {parsed && (
            <Typography level="body-sm" data-testid="import-summary">
              {describeImport(parsed)}
            </Typography>
          )}
          {error && (
            <Alert color="danger" variant="soft">
              {error}
            </Alert>
          )}
          {parsed?.warnings.map((w) => (
            <Alert key={w} color="warning" variant="soft" size="sm">
              {w}
            </Alert>
          ))}
          <FormControl>
            <FormLabel>Import location</FormLabel>
            <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as ImportMode)}>
              {IMPORT_MODES.map((m) => (
                <Radio key={m.mode} value={m.mode} label={m.label} size="sm" />
              ))}
            </RadioGroup>
          </FormControl>
          {oneSheetOnly && parsed && parsed.sheets.length > 1 && (
            <Typography level="body-xs" sx={{ opacity: 0.7 }}>
              Only the first sheet of the file is used for this option.
            </Typography>
          )}
          {isCsv && (
            <Stack direction="row" spacing={1} alignItems="flex-end" flexWrap="wrap" useFlexGap>
              <FormControl size="sm" sx={{ minWidth: 200 }}>
                <FormLabel>Separator type</FormLabel>
                <Select value={delim} onChange={(_, v) => v && setDelim(v)} slotProps={{ button: { "aria-label": "Separator type" } }}>
                  {DELIMITERS.map((d) => (
                    <Option key={d.value} value={d.value}>
                      {d.label}
                    </Option>
                  ))}
                </Select>
              </FormControl>
              {delim === "custom" && (
                <FormControl size="sm" sx={{ width: 100 }}>
                  <FormLabel>Custom</FormLabel>
                  <Input value={custom} onChange={(e) => setCustom(e.target.value)} />
                </FormControl>
              )}
              <Checkbox size="sm" label="Convert text to numbers, dates and formulas" checked={convert} onChange={(e) => setConvert(e.target.checked)} />
            </Stack>
          )}
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
            <Button variant="plain" color="neutral" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!parsed}
              onClick={async () => {
                if (!parsed || !file) return;
                setBusy(true);
                try {
                  await onImport(parsed, mode, file.name);
                  onClose();
                } catch (e) {
                  setError((e as Error).message || "Import failed.");
                  setBusy(false);
                }
              }}
            >
              Import data
            </Button>
          </Box>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
