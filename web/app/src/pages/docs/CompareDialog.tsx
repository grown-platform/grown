// Tools ▸ Compare documents / Combine documents (Docs M12). Mounted once
// (<CompareDialog editor docId title/>) and opened with
// openCompareDialog("compare" | "combine"), like ReferenceDialogs.
//
// Compare: this document against another Grown doc, a saved version or an
// uploaded .docx; the result — a new document — is the revised text with
// the differences as tracked changes by the revised document's author
// (Word's Compare). Combine: up to two revised copies merged into this
// document (the original) as tracked changes, each under its own author;
// revisions the copies already carry are kept.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
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
import type { Editor } from "@tiptap/react";
import { listDocs, listVersions, type DocVersion } from "./api";
import type { Doc } from "./types";
import { combineDocs, compareDocs, type Granularity } from "./diff";
import { createDocFrom, loadDocxFile, loadGrownDoc, loadVersionDoc, type LoadedDoc } from "./diff/sources";

export type CompareMode = "compare" | "combine";

const EVENT = "grown-docs-compare-dialog";

/** openCompareDialog opens the mounted Compare / Combine dialog. */
export function openCompareDialog(mode: CompareMode): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}

type SourceKind = "doc" | "version" | "file";

interface Source {
  kind: SourceKind;
  id: string;
  file: File | null;
}

const emptySource = (): Source => ({ kind: "doc", id: "", file: null });

function SourcePicker({
  label,
  value,
  onChange,
  docs,
  versions,
  testid,
}: {
  label: string;
  value: Source;
  onChange: (s: Source) => void;
  docs: Doc[] | null;
  versions: DocVersion[] | null;
  testid: string;
}) {
  return (
    <FormControl>
      <FormLabel>{label}</FormLabel>
      <RadioGroup
        orientation="horizontal"
        value={value.kind}
        onChange={(e) => onChange({ ...emptySource(), kind: e.target.value as SourceKind })}
        sx={{ gap: 2, flexWrap: "wrap", mb: 1 }}
      >
        <Radio value="doc" label="Grown document" size="sm" data-testid={`${testid}-kind-doc`} />
        <Radio value="version" label="Version of this document" size="sm" data-testid={`${testid}-kind-version`} />
        <Radio value="file" label="Upload .docx" size="sm" data-testid={`${testid}-kind-file`} />
      </RadioGroup>
      {value.kind === "doc" && (
        <Select
          size="sm"
          placeholder={docs ? "Choose a document" : "Loading…"}
          value={value.id || null}
          onChange={(_, v) => onChange({ ...value, id: String(v ?? "") })}
          data-testid={`${testid}-doc`}
          slotProps={{ listbox: { sx: { maxHeight: 280, zIndex: 1400 } } }}
        >
          {(docs ?? []).map((d) => (
            <Option key={d.id} value={d.id}>
              {d.title || "Untitled document"}
            </Option>
          ))}
        </Select>
      )}
      {value.kind === "version" && (
        <Select
          size="sm"
          placeholder={versions ? (versions.length ? "Choose a version" : "No saved versions") : "Loading…"}
          value={value.id || null}
          onChange={(_, v) => onChange({ ...value, id: String(v ?? "") })}
          data-testid={`${testid}-version`}
          slotProps={{ listbox: { sx: { maxHeight: 280, zIndex: 1400 } } }}
        >
          {(versions ?? []).map((v) => (
            <Option key={v.id} value={v.id}>
              {(v.label || new Date(v.created_at).toLocaleString()) + (v.author_name ? ` · ${v.author_name}` : "")}
            </Option>
          ))}
        </Select>
      )}
      {value.kind === "file" && (
        <Input
          size="sm"
          type="file"
          slotProps={{ input: { accept: ".docx", "data-testid": `${testid}-file` } as Record<string, unknown> }}
          onChange={(e) => onChange({ ...value, file: (e.target as HTMLInputElement).files?.[0] ?? null })}
        />
      )}
    </FormControl>
  );
}

const ready = (s: Source) => (s.kind === "file" ? !!s.file : !!s.id);

export function CompareDialog({ editor, docId, title, userName }: { editor: Editor | null; docId: string; title: string; userName: string }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<CompareMode | null>(null);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [a, setA] = useState<Source>(emptySource);
  const [b, setB] = useState<Source>(emptySource);
  const [thisIs, setThisIs] = useState<"original" | "revised">("original");
  const [gran, setGran] = useState<Granularity>("word");
  const [authorA, setAuthorA] = useState("");
  const [authorB, setAuthorB] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const on = (e: Event) => {
      setMode((e as CustomEvent<CompareMode>).detail);
      setA(emptySource());
      setB(emptySource());
      setAuthorA("");
      setAuthorB("");
      setError("");
      setDocs(null);
      setVersions(null);
      listDocs()
        .then((l) => setDocs(l.filter((d) => d.id !== docId)))
        .catch(() => setDocs([]));
      listVersions(docId)
        .then(setVersions)
        .catch(() => setVersions([]));
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [docId]);

  if (!editor || !mode) return null;
  const close = () => {
    if (!busy) setMode(null);
  };

  const load = async (s: Source): Promise<LoadedDoc> => {
    if (s.kind === "file") return loadDocxFile(editor.schema, s.file!);
    if (s.kind === "version") return loadVersionDoc(editor.schema, docId, s.id);
    const d = docs?.find((x) => x.id === s.id);
    return loadGrownDoc(editor.schema, s.id, d?.title ?? "");
  };

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const self = editor.state.doc;
      if (mode === "compare") {
        const other = await load(a);
        const [orig, rev] = thisIs === "original" ? [self, other.doc] : [other.doc, self];
        const author = authorA.trim() || (thisIs === "original" ? other.author : userName || "This document");
        const result = compareDocs(orig, rev, { author, granularity: gran });
        const name = `Comparison of ${title || "Untitled document"} and ${other.label}`;
        const id = await createDocFrom(editor, name, result, other.model);
        setMode(null);
        navigate(`/docs/d/${id}`);
      } else {
        const ra = await load(a);
        const rb = ready(b) ? await load(b) : null;
        const result = combineDocs(self, ra.doc, rb?.doc ?? null, {
          authorA: authorA.trim() || ra.author,
          authorB: authorB.trim() || rb?.author || ra.author,
          granularity: gran,
        });
        const name = `Combined ${title || "Untitled document"}`;
        const id = await createDocFrom(editor, name, result, ra.model);
        setMode(null);
        navigate(`/docs/d/${id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const compare = mode === "compare";
  return (
    <Modal open onClose={close}>
      <ModalDialog
        data-testid="compare-dialog"
        sx={{ width: { xs: "calc(100vw - 32px)", sm: 520 }, maxWidth: "calc(100vw - 32px)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <ModalClose />
        <Typography level="title-lg">{compare ? "Compare documents" : "Combine documents"}</Typography>
        <Typography level="body-sm" sx={{ mb: 1 }}>
          {compare
            ? "Shows the differences between this document and another as tracked changes in a new document."
            : "Merges revised copies into this document (the original) as tracked changes, one author per copy, in a new document."}
        </Typography>
        <Stack spacing={2}>
          <SourcePicker
            label={compare ? "Compare with" : "Revised copy"}
            value={a}
            onChange={setA}
            docs={docs}
            versions={versions}
            testid="compare-a"
          />
          {compare ? (
            <FormControl>
              <FormLabel>This document is the</FormLabel>
              <RadioGroup orientation="horizontal" value={thisIs} onChange={(e) => setThisIs(e.target.value as "original" | "revised")} sx={{ gap: 2 }}>
                <Radio value="original" label="Original" size="sm" />
                <Radio value="revised" label="Revised document" size="sm" />
              </RadioGroup>
            </FormControl>
          ) : (
            <SourcePicker label="Second revised copy (optional)" value={b} onChange={setB} docs={docs} versions={versions} testid="compare-b" />
          )}
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            <FormControl sx={{ flex: 1, minWidth: 160 }}>
              <FormLabel>{compare ? "Label changes with" : "Author of the first copy"}</FormLabel>
              <Input size="sm" placeholder="The document's author" value={authorA} onChange={(e) => setAuthorA(e.target.value)} data-testid="compare-author" />
            </FormControl>
            {!compare && (
              <FormControl sx={{ flex: 1, minWidth: 160 }}>
                <FormLabel>Author of the second copy</FormLabel>
                <Input size="sm" placeholder="The document's author" value={authorB} onChange={(e) => setAuthorB(e.target.value)} />
              </FormControl>
            )}
          </Box>
          <FormControl>
            <FormLabel>Show changes at</FormLabel>
            <RadioGroup orientation="horizontal" value={gran} onChange={(e) => setGran(e.target.value as Granularity)} sx={{ gap: 2 }}>
              <Radio value="word" label="Word level" size="sm" />
              <Radio value="char" label="Character level" size="sm" />
            </RadioGroup>
          </FormControl>
          {error && (
            <Alert color="danger" variant="soft" size="sm">
              {error}
            </Alert>
          )}
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
            <Button variant="plain" color="neutral" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={run} loading={busy} disabled={!ready(a)} data-testid="compare-run">
              {compare ? "Compare" : "Combine"}
            </Button>
          </Box>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}
