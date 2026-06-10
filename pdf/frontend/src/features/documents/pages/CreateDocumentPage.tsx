import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Upload, FileText, X, FilePlus } from "lucide-react";
import { TextField, TextArea, Card } from "tibui";
import { jsPDF } from "jspdf";
import { apiClient } from "@/utils/apiClient";

// Local Button component to avoid tibui issues
function Button({
  children,
  type = "button",
  variant = "primary",
  disabled = false,
  className = "",
  onClick,
  asChild,
}: {
  children: React.ReactNode;
  type?: "button" | "submit";
  variant?: "primary" | "outline" | "secondary" | "ghost";
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  asChild?: boolean;
}) {
  const baseStyles =
    "px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-primary text-white hover:bg-primary/90",
    outline: "border border-border bg-transparent hover:bg-background",
    secondary: "bg-secondary text-text hover:bg-secondary/90",
    ghost: "bg-transparent hover:bg-background",
  };

  if (asChild) {
    return <>{children}</>;
  }

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${baseStyles} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

type Mode = "upload" | "create";

// generateBlankPdf produces a one-page Letter-size PDF Blob, optionally
// with a title rendered at the top. Body content is added later by the
// user via the in-place text editor on the edit page.
function generateBlankPdf(title: string): Blob {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  if (title.trim()) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 72; // 1 inch
    const contentWidth = pageWidth - margin * 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    const titleLines = doc.splitTextToSize(title.trim(), contentWidth);
    doc.text(titleLines, margin, margin);
  }
  return doc.output("blob");
}

export function CreateDocumentPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("upload");

  // Upload-mode state
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Shared metadata
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Create-mode state — only an optional Title. Body content is added
  // via the in-place text editor on the edit page after creation.
  const [title, setTitle] = useState("");

  const [error, setError] = useState<string | null>(null);

  const createDocument = useMutation({
    mutationFn: async (data: {
      name: string;
      description: string;
      filename: string;
      blob: Blob;
    }) => {
      const response = await apiClient.post<{
        document: { id: string };
        uploadUrl: string;
      }>("/documents", {
        name: data.name,
        description: data.description,
        filename: data.filename,
      });
      // Upload the blob to the presigned URL.
      if (response.uploadUrl) {
        const uploadResponse = await fetch(response.uploadUrl, {
          method: "PUT",
          body: data.blob,
          headers: { "Content-Type": "application/pdf" },
        });
        if (!uploadResponse.ok) {
          throw new Error(`Upload failed: ${uploadResponse.status}`);
        }
      }
      return response;
    },
    onSuccess: (response) => {
      // Go straight to the edit page. From there the user can edit the
      // document and then click "Continue to add signers", or skip
      // straight to signers if there's nothing to edit. No need for an
      // intermediate "what's next?" chooser.
      navigate(`/documents/${response.document.id}/edit`);
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to create document");
    },
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const isPDF = (file: File) =>
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      setError(null);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile && isPDF(droppedFile)) {
        setFile(droppedFile);
        if (!name) setName(droppedFile.name.replace(/\.pdf$/i, ""));
      } else if (droppedFile) {
        setError("Please select a PDF file");
      }
    },
    [name],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      const selectedFile = e.target.files?.[0];
      if (selectedFile && isPDF(selectedFile)) {
        setFile(selectedFile);
        if (!name) setName(selectedFile.name.replace(/\.pdf$/i, ""));
      } else if (selectedFile) {
        setError("Please select a PDF file");
      }
    },
    [name],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "upload") {
      if (!file || !name) return;
      createDocument.mutate({
        name,
        description,
        filename: file.name,
        blob: file,
      });
      return;
    }

    // Create-from-scratch
    if (!name) {
      setError("Document name is required");
      return;
    }
    try {
      const blob = generateBlankPdf(title || name);
      createDocument.mutate({
        name,
        description,
        filename: `${name}.pdf`,
        blob,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate PDF");
    }
  };

  const canSubmit =
    mode === "upload"
      ? Boolean(file && name) && !createDocument.isPending
      : Boolean(name) && !createDocument.isPending;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create Document</h1>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => {
            setMode("upload");
            setError(null);
          }}
          className={`flex-1 px-4 py-3 rounded-lg border font-medium transition-colors ${
            mode === "upload"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-transparent text-text-muted hover:bg-background"
          }`}
        >
          <Upload className="w-4 h-4 inline mr-2" />
          Upload existing PDF
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("create");
            setError(null);
          }}
          className={`flex-1 px-4 py-3 rounded-lg border font-medium transition-colors ${
            mode === "create"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-transparent text-text-muted hover:bg-background"
          }`}
        >
          <FilePlus className="w-4 h-4 inline mr-2" />
          Create from scratch
        </button>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          {mode === "upload" && (
            <div>
              <label className="block text-sm font-medium mb-2">
                PDF Document
              </label>
              {file ? (
                <div className="flex items-center gap-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <FileText className="w-8 h-8 text-blue-600" />
                  <div className="flex-1">
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-gray-500">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => setFile(null)}>
                    <X className="w-5 h-5" />
                  </Button>
                </div>
              ) : (
                <div
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    dragActive
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-300 hover:border-blue-400"
                  }`}
                >
                  <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="mb-2">Drag and drop your PDF here, or</p>
                  <label className="cursor-pointer inline-block px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors">
                    Browse Files
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Document name (both modes) */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Document Name <span className="text-red-600">*</span>
            </label>
            <TextField
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter document name"
              required
            />
          </div>

          {/* Description (both modes) */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Description (optional)
            </label>
            <TextArea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter document description"
              rows={2}
            />
          </div>

          {mode === "create" && (
            <div>
              <label className="block text-sm font-medium mb-1">
                Title <span className="text-text-muted">(Optional)</span>
              </label>
              <p className="text-xs text-text-muted mb-2">
                Rendered at the top of the PDF. Body content is added via the
                in-place text editor on the next page.
              </p>
              <TextField
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Leave blank to use document name"
              />
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {/* Submit */}
          <div className="flex gap-4 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/documents")}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} className="flex-1">
              {createDocument.isPending
                ? "Creating…"
                : mode === "create"
                  ? "Continue to Edit and Add Signers"
                  : "Continue to Add Signers"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
