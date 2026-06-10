import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BookTemplate,
  Plus,
  Trash2,
  FileText,
  AlertCircle,
  Loader2,
  ListOrdered,
} from "lucide-react";
import { apiClient } from "@/utils/apiClient";

interface TemplateField {
  id: string;
  signerSlot: number;
  fieldType: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Template {
  id: string;
  name: string;
  description?: string;
  signerSlots: number;
  signingOrder: boolean;
  createdBy: string;
  createdAt: string;
  fields: TemplateField[];
}

const fieldTypeLabels: Record<string, string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
  text: "Text",
  checkbox: "Checkbox",
};

export function TemplatesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["templates"],
    queryFn: () =>
      apiClient.get<{ templates: Template[]; totalCount: number }>(
        "/templates",
      ),
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      if (selectedTemplate) setSelectedTemplate(null);
    },
    onError: (err: Error) => {
      alert(`Failed to delete template: ${err.message}`);
    },
  });

  const createFromTemplate = useMutation({
    mutationFn: (templateId: string) =>
      apiClient.post<{ document: { id: string }; uploadUrl: string }>(
        `/templates/${templateId}/create-document`,
        { name: createName, description: createDesc },
      ),
    onSuccess: (data) => {
      setShowCreate(false);
      setCreateName("");
      setCreateDesc("");
      navigate(`/documents/${data.document.id}/prepare`);
    },
    onError: (err: Error) => {
      alert(`Failed to create document: ${err.message}`);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <AlertCircle className="w-12 h-12 mb-4" />
        <h2 className="text-lg font-semibold">Error</h2>
        <p>Failed to load templates</p>
      </div>
    );
  }

  const templates = data?.templates ?? [];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Templates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Reusable field layouts for common document types
          </p>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="bg-white rounded-lg border shadow-sm p-12 text-center text-gray-500">
          <BookTemplate className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h2 className="text-lg font-semibold mb-2">No templates yet</h2>
          <p className="text-sm mb-6">
            Save a document's field layout as a template to reuse it later. Open
            any document and click{" "}
            <strong>Save field layout as template</strong>.
          </p>
          <button
            onClick={() => navigate("/documents")}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            Go to Documents
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className={`bg-white rounded-lg border shadow-sm p-4 cursor-pointer transition-colors ${
                selectedTemplate?.id === tmpl.id
                  ? "border-blue-500 ring-2 ring-blue-200"
                  : "hover:border-gray-400"
              }`}
              onClick={() =>
                setSelectedTemplate(
                  selectedTemplate?.id === tmpl.id ? null : tmpl,
                )
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <BookTemplate className="w-5 h-5 text-blue-600 flex-shrink-0" />
                  <h3 className="font-semibold truncate">{tmpl.name}</h3>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      window.confirm(
                        `Delete template "${tmpl.name}"? This cannot be undone.`,
                      )
                    ) {
                      deleteTemplate.mutate(tmpl.id);
                    }
                  }}
                  className="p-1 hover:bg-red-50 rounded text-red-400 hover:text-red-600 flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {tmpl.description && (
                <p className="text-sm text-gray-500 mt-1 truncate">
                  {tmpl.description}
                </p>
              )}

              <div className="flex flex-wrap gap-2 mt-3">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                  <FileText className="w-3 h-3" />
                  {tmpl.signerSlots} signer slot
                  {tmpl.signerSlots !== 1 ? "s" : ""}
                </span>
                {tmpl.signingOrder && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                    <ListOrdered className="w-3 h-3" />
                    Sequential
                  </span>
                )}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full">
                  {tmpl.fields.length} field
                  {tmpl.fields.length !== 1 ? "s" : ""}
                </span>
              </div>

              <p className="text-xs text-gray-400 mt-2">
                Created {new Date(tmpl.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Selected template detail + create-from-template */}
      {selectedTemplate && (
        <div className="bg-white rounded-lg border shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{selectedTemplate.name}</h2>
            <button
              onClick={() => setSelectedTemplate(null)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Close
            </button>
          </div>

          {/* Field layout summary */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              Field Layout
            </h3>
            {selectedTemplate.signerSlots > 0 ? (
              <div className="space-y-2">
                {Array.from(
                  { length: selectedTemplate.signerSlots },
                  (_, i) => i + 1,
                ).map((slot) => {
                  const slotFields = selectedTemplate.fields.filter(
                    (f) => f.signerSlot === slot,
                  );
                  return (
                    <div key={slot} className="flex items-start gap-2">
                      <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center text-xs font-bold text-purple-700 flex-shrink-0">
                        {slot}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-gray-600">
                          Signer slot {slot}
                        </p>
                        {slotFields.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {slotFields.map((f) => (
                              <span
                                key={f.id}
                                className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded"
                              >
                                {fieldTypeLabels[f.fieldType] ?? f.fieldType} p
                                {f.pageNumber}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400 mt-0.5">
                            No fields
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No fields defined</p>
            )}
          </div>

          {/* Create document from template */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Create document from this template
            </h3>
            {!showCreate ? (
              <button
                onClick={() => {
                  setCreateName("");
                  setShowCreate(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                <Plus className="w-4 h-4" />
                New document from template
              </button>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Document name
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder="e.g. Service Agreement — Acme Corp"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder="Brief description"
                    value={createDesc}
                    onChange={(e) => setCreateDesc(e.target.value)}
                  />
                </div>
                <p className="text-xs text-gray-500">
                  A new draft document will be created. You'll then upload the
                  PDF and assign signers to the {selectedTemplate.signerSlots}{" "}
                  slot{selectedTemplate.signerSlots !== 1 ? "s" : ""} in the
                  Prepare view.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowCreate(false)}
                    className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!createName || createFromTemplate.isPending}
                    onClick={() =>
                      createFromTemplate.mutate(selectedTemplate.id)
                    }
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                  >
                    {createFromTemplate.isPending ? "Creating…" : "Create"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
