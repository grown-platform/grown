import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Edit3, Save, Type, PenTool, Eye } from "lucide-react";
import { PDFEditor, Annotation, LoadingSpinner, CenterMessage } from "tibui";
import { apiClient } from "@/utils/apiClient";
import {
  PdfTextEditor,
  EditableTextItem,
  applyTextEdits,
} from "../components/PdfTextEditor";

interface DocumentResponse {
  document: {
    id: string;
    name: string;
    status: string;
    totalPages: number;
  };
  downloadUrl: string;
  signedDownloadUrl?: string;
}

function Button({
  children,
  variant = "primary",
  disabled = false,
  className = "",
  onClick,
}: {
  children: React.ReactNode;
  variant?: "primary" | "outline";
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  const variants = {
    primary: "bg-primary text-white hover:bg-primary/90",
    outline: "border border-border bg-transparent hover:bg-background",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

type Mode = "annotate" | "text" | "preview";

export function EditDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setModeState] = useState<Mode>("text");
  const [editorMode, setEditorMode] = useState<"view" | "edit">("edit");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Text-edit state — separate from annotations.
  const [textItems, setTextItems] = useState<EditableTextItem[]>([]);
  const [textDirty, setTextDirty] = useState(false);
  const [textSaving, setTextSaving] = useState(false);

  const { data, isLoading, error } = useQuery<DocumentResponse>({
    queryKey: ["document", id],
    queryFn: () => apiClient.get<DocumentResponse>(`/documents/${id}`),
    enabled: !!id,
  });

  // Load existing annotations on mount.
  const annotationsQuery = useQuery<{ annotations: Annotation[] }>({
    queryKey: ["document-annotations", id],
    queryFn: () =>
      apiClient.get<{ annotations: Annotation[] }>(
        `/documents/${id}/annotations`,
      ),
    enabled: !!id,
  });
  useEffect(() => {
    if (annotationsQuery.data?.annotations) {
      setAnnotations(annotationsQuery.data.annotations);
      setDirty(false);
    }
  }, [annotationsQuery.data]);

  // Save mutation.
  const saveAnnotations = useMutation({
    mutationFn: async (next: Annotation[]) => {
      await apiClient.put(`/documents/${id}/annotations`, {
        annotations: next,
      });
    },
    onSuccess: () => {
      setDirty(false);
      setSaveError(null);
    },
    onError: (err: Error) => {
      setSaveError(err.message || "Failed to save annotations");
    },
  });

  const handleAnnotationsChange = (next: Annotation[]) => {
    setAnnotations(next);
    setDirty(true);
  };

  const handleContinue = async () => {
    // Save any pending text edits first (also refetches the PDF).
    const textOk = await saveTextEditsIfDirty();
    if (!textOk) return;
    if (dirty) {
      try {
        await saveAnnotations.mutateAsync(annotations);
      } catch {
        // saveError already populated; bail
        return;
      }
    }
    navigate(`/documents/${id}/prepare`);
  };

  // Save text edits — regenerate the PDF client-side via pdf-lib and
  // re-upload to the doc's existing storage key. Returns true on success.
  const saveTextEditsIfDirty = async (): Promise<boolean> => {
    if (!textDirty || !data?.downloadUrl || !id) return true; // nothing to do
    setSaveError(null);
    setTextSaving(true);
    try {
      const newBlob = await applyTextEdits(data.downloadUrl, textItems);
      const urlResp = await apiClient.post<{ uploadUrl: string }>(
        `/documents/${id}/replace-url`,
        {},
      );
      const putResp = await fetch(urlResp.uploadUrl, {
        method: "PUT",
        body: newBlob,
        headers: { "Content-Type": "application/pdf" },
      });
      if (!putResp.ok) {
        throw new Error(`Upload failed: ${putResp.status}`);
      }
      // Force a refetch of the document so all tabs get a fresh presigned
      // URL pointing at the updated S3 object. Mark every item as synced
      // (matches what's in the saved PDF) instead of clearing the list —
      // we need to remember which extracted items the user deleted so a
      // re-extraction on the next mount doesn't resurrect them (the glyphs
      // are still in the PDF stream, just covered by a white rect).
      setTextItems((prev) => prev.map((it) => ({ ...it, synced: true })));
      setTextDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["document", id] });
      return true;
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save text edits",
      );
      return false;
    } finally {
      setTextSaving(false);
    }
  };

  // Mode-switch wrapper: auto-save text edits when leaving the text tab
  // so the new PDF is visible in annotate/preview tabs.
  const setMode = async (next: Mode) => {
    if (mode === "text" && next !== "text") {
      const ok = await saveTextEditsIfDirty();
      if (!ok) return; // stay on the text tab; saveError is shown
    }
    setSaveError(null);
    setModeState(next);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner />
      </div>
    );
  }
  if (error || !data) {
    return (
      <CenterMessage
        message="Failed to load document"
        subtext={(error as Error)?.message ?? "Document not found"}
        error
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-2 sm:p-4">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2 lg:gap-4 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-primary shrink-0" />
            <h1 className="text-lg sm:text-2xl font-bold truncate">
              Edit: {data.document.name}
            </h1>
          </div>
          {/* Helper text only on >=sm. Eats too much vertical space on
              phones where users already understand the mode they're in. */}
          <p className="hidden sm:block text-sm text-text-muted mt-1">
            {mode === "annotate" &&
              "Mark up the document with notes, highlights, or drawings before sending for signature. Annotations are saved and shown to signers."}
            {mode === "text" &&
              "Click any text to edit it in place. New text renders in Helvetica. Best on simple PDFs — scanned PDFs and complex layouts may not work."}
            {mode === "preview" &&
              "Read-only preview showing what signers will see. Annotations rendered as overlay; in-place text edits are baked into the PDF on save."}
          </p>
          {saveError && (
            <p className="text-sm text-red-600 mt-1">{saveError}</p>
          )}
          {mode === "annotate" && dirty && !saveError && (
            <p className="text-sm text-text-muted mt-1">Unsaved annotations</p>
          )}
          {mode === "text" && textDirty && !saveError && (
            <p className="text-sm text-text-muted mt-1">Unsaved text edits</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 lg:shrink-0">
          <Button variant="outline" onClick={() => navigate("/documents")}>
            <span className="hidden sm:inline">Back to documents</span>
            <span className="sm:hidden">Back</span>
          </Button>
          {mode === "annotate" && (
            <Button
              variant="outline"
              disabled={!dirty || saveAnnotations.isPending}
              onClick={() => saveAnnotations.mutate(annotations)}
            >
              <Save className="w-4 h-4 inline mr-1" />
              {saveAnnotations.isPending ? "Saving…" : "Save"}
            </Button>
          )}
          {mode === "text" && (
            <Button
              variant="outline"
              disabled={!textDirty || textSaving}
              onClick={() => saveTextEditsIfDirty()}
            >
              <Save className="w-4 h-4 inline mr-1" />
              {textSaving ? "Saving…" : "Save"}
            </Button>
          )}
          <Button onClick={handleContinue} disabled={saveAnnotations.isPending}>
            <span className="hidden sm:inline">Continue to add signers</span>
            <span className="sm:hidden">Continue</span>
            <ArrowRight className="w-4 h-4 inline ml-1" />
          </Button>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={() => setMode("text")}
          className={`px-3 py-2 rounded-lg border text-sm font-medium ${
            mode === "text"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-transparent text-text-muted hover:bg-background"
          }`}
        >
          <Type className="w-4 h-4 inline mr-1" />
          Edit page
        </button>
        <button
          type="button"
          onClick={() => setMode("annotate")}
          className={`px-3 py-2 rounded-lg border text-sm font-medium ${
            mode === "annotate"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-transparent text-text-muted hover:bg-background"
          }`}
        >
          <PenTool className="w-4 h-4 inline mr-1" />
          <span className="hidden sm:inline">Annotate (overlay)</span>
          <span className="sm:hidden">Annotate</span>
        </button>
        <button
          type="button"
          onClick={() => setMode("preview")}
          className={`px-3 py-2 rounded-lg border text-sm font-medium ${
            mode === "preview"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-transparent text-text-muted hover:bg-background"
          }`}
        >
          <Eye className="w-4 h-4 inline mr-1" />
          Preview
        </button>
      </div>

      {mode === "annotate" && (
        // Wrapper overrides tibui Canvas centering on <sm: tibui's inner
        // div uses `min-h-full flex items-center justify-center p-6` which
        // clips the PDF's left margin on phones (overflow-auto with
        // centered content has scroll-pos 0 at the leftmost — user can't
        // scroll further left). Force start-alignment + smaller padding
        // via arbitrary-variant. Restore centered on >=sm.
        <div className="[&_.justify-center]:max-sm:!justify-start [&_.items-center]:max-sm:!items-start [&_.p-6]:max-sm:!p-2">
          <PDFEditor
            key={data.downloadUrl}
            src={data.downloadUrl}
            mode={editorMode}
            onModeChange={setEditorMode}
            annotations={annotations}
            onAnnotationsChange={handleAnnotationsChange}
            showToolbar
            height="calc(100vh - 270px)"
            tools={[
              "select",
              "freehand",
              "rectangle",
              "circle",
              "arrow",
              "text",
              "highlight",
              "eraser",
            ]}
          />
        </div>
      )}
      {mode === "text" && (
        <div style={{ height: "calc(100vh - 270px)", overflow: "auto" }}>
          <PdfTextEditor
            src={data.downloadUrl}
            items={textItems}
            onItemsChange={(next) => {
              setTextItems(next);
              // Dirty if ANY editable property differs from the extracted
              // original. Covers content edits, new items, deletions,
              // styling flips, and position/size changes from drag/move.
              const anyDirty = next.some((it) => {
                // Items synced to the saved PDF aren't dirty even if they
                // still carry edit markers (e.g. deleted=true from a
                // previously-saved deletion).
                if (it.synced) return false;
                if (it.originalText === "") return true; // newly-added
                if (it.deleted) return true;
                if (it.originalText !== it.currentText) return true;
                if (it.bold || it.italic || it.underline || it.strike)
                  return true;
                const o = it.originalTransform;
                if (o) {
                  if (
                    o[3] !== it.transform[3] ||
                    o[4] !== it.transform[4] ||
                    o[5] !== it.transform[5]
                  )
                    return true;
                }
                return false;
              });
              setTextDirty(anyDirty);
            }}
          />
        </div>
      )}
      {mode === "preview" && (
        <div className="[&_.justify-center]:max-sm:!justify-start [&_.items-center]:max-sm:!items-start [&_.p-6]:max-sm:!p-2">
          <PDFEditor
            key={data.downloadUrl}
            src={data.downloadUrl}
            mode="view"
            annotations={annotations}
            onAnnotationsChange={() => {}}
            readOnly
            // showToolbar gives the user zoom in/out + page nav, which
            // is useful even in read-only preview.
            showToolbar
            height="calc(100vh - 270px)"
          />
        </div>
      )}
    </div>
  );
}
