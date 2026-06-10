import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  User,
  Send,
  AlertCircle,
  Edit,
  Download,
  Eye,
  Clock,
  CheckCircle,
  Loader2,
  Shield,
  FileDown,
  Trash2,
  BookTemplate,
  ListOrdered,
  ExternalLink,
} from "lucide-react";
import { apiClient } from "@/utils/apiClient";

interface Document {
  id: string;
  name: string;
  description: string;
  status: string;
  totalPages: number;
  createdAt: string;
  signingOrder: boolean;
  signers: {
    id: string;
    name: string;
    email: string;
    status: string;
    signerType: string;
    signingOrder: number;
    viewedAt?: string;
    signedAt?: string;
  }[];
}

interface AuditEntry {
  id: string;
  action: string;
  createdAt: string;
  signerName?: string;
  ipAddress?: string;
  userAgent?: string;
  geoLocation?: string;
  // JSON-encoded extra context (e.g. {"reason": "..."} for declines).
  actionDetails?: string;
}

interface DocumentSignature {
  id: string;
  signerId: string;
  signerName: string;
  signerEmail: string;
  signatureAlgorithm: string;
  documentHash: string;
  hashAlgorithm: string;
  signingTimestamp: string;
  certificateIssuer?: string;
  certificateSerial?: string;
  certificateValidFrom?: string;
  certificateValidTo?: string;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  DOCUMENT_STATUS_DRAFT: { label: "Draft", color: "bg-gray-100 text-gray-700" },
  DOCUMENT_STATUS_PENDING: {
    label: "Pending",
    color: "bg-yellow-100 text-yellow-700",
  },
  DOCUMENT_STATUS_IN_PROGRESS: {
    label: "In Progress",
    color: "bg-blue-100 text-blue-700",
  },
  DOCUMENT_STATUS_COMPLETED: {
    label: "Completed",
    color: "bg-green-100 text-green-700",
  },
  DOCUMENT_STATUS_DECLINED: {
    label: "Declined",
    color: "bg-red-100 text-red-700",
  },
  DOCUMENT_STATUS_VOIDED: {
    label: "Voided",
    color: "bg-gray-100 text-gray-500",
  },
};

const signerStatusConfig: Record<string, { label: string; color: string }> = {
  SIGNER_STATUS_PENDING: {
    label: "Pending",
    color: "bg-gray-100 text-gray-600",
  },
  SIGNER_STATUS_SENT: {
    label: "Invited",
    color: "bg-blue-100 text-blue-700",
  },
  SIGNER_STATUS_VIEWED: {
    label: "Viewed",
    color: "bg-yellow-100 text-yellow-700",
  },
  SIGNER_STATUS_SIGNED: {
    label: "Signed",
    color: "bg-green-100 text-green-700",
  },
  SIGNER_STATUS_DECLINED: {
    label: "Declined",
    color: "bg-red-100 text-red-700",
  },
};

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");

  const saveAsTemplate = useMutation({
    mutationFn: () =>
      apiClient.post(`/documents/${id}/save-as-template`, {
        name: templateName,
        description: templateDesc,
      }),
    onSuccess: () => {
      setShowSaveTemplate(false);
      setTemplateName("");
      setTemplateDesc("");
      alert("Template saved successfully.");
    },
    onError: (err: Error) => {
      alert(`Failed to save template: ${err.message}`);
    },
  });

  const deleteDocument = useMutation({
    mutationFn: () => apiClient.delete(`/documents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      navigate("/documents");
    },
    onError: (err: Error) => {
      alert(`Failed to delete: ${err.message}`);
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["document", id],
    queryFn: () =>
      apiClient.get<{
        document: Document;
        downloadUrl: string;
        signedDownloadUrl?: string;
      }>(`/documents/${id}`),
  });

  const { data: auditData } = useQuery({
    queryKey: ["document-audit", id],
    queryFn: () =>
      apiClient.get<{ entries: AuditEntry[] }>(`/documents/${id}/audit`),
    enabled: !!id,
  });

  const { data: signaturesData } = useQuery({
    queryKey: ["document-signatures", id],
    queryFn: () =>
      apiClient.get<{ signatures: DocumentSignature[] }>(
        `/documents/${id}/signatures`,
      ),
    enabled: !!id && data?.document?.status === "DOCUMENT_STATUS_COMPLETED",
  });

  const handleDownloadSigned = async () => {
    // Try to use signedDownloadUrl from initial query first
    if (data?.signedDownloadUrl) {
      window.open(data.signedDownloadUrl, "_blank");
      return;
    }
    // Fall back to fetching from completed endpoint
    try {
      const response = await apiClient.get<{ downloadUrl: string }>(
        `/documents/${id}/completed`,
      );
      if (response.downloadUrl) {
        window.open(response.downloadUrl, "_blank");
      }
    } catch (err) {
      console.error("Failed to get download URL:", err);
      alert("Failed to download signed document. Please try again.");
    }
  };

  const handleDownloadOriginal = () => {
    if (data?.downloadUrl) {
      window.open(data.downloadUrl, "_blank");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <AlertCircle className="w-12 h-12 mb-4" />
        <h2 className="text-lg font-semibold">Error</h2>
        <p>Failed to load document</p>
      </div>
    );
  }

  const { document: doc, downloadUrl, signedDownloadUrl } = data;
  const status = statusConfig[doc.status] ?? statusConfig.DOCUMENT_STATUS_DRAFT;
  const isDraft = doc.status === "DOCUMENT_STATUS_DRAFT";
  const isCompleted = doc.status === "DOCUMENT_STATUS_COMPLETED";

  const auditEntries = auditData?.entries ?? [];
  const signatures = signaturesData?.signatures ?? [];

  // Use signed PDF for preview when completed, otherwise use original
  const previewUrl =
    isCompleted && signedDownloadUrl ? signedDownloadUrl : downloadUrl;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
      {/* Main content - PDF preview */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white sm:rounded-lg sm:border sm:shadow-sm">
          <div className="p-4 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="w-5 h-5 text-blue-600 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-lg font-semibold truncate">{doc.name}</h1>
                <span
                  className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}
                >
                  {status.label}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {isDraft && (
                <>
                  <button
                    onClick={() => navigate(`/documents/${id}/prepare`)}
                    className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-50 flex items-center"
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Prepare
                  </button>
                  <button
                    disabled={!doc.signers?.length}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send for Signing
                  </button>
                </>
              )}
              {isCompleted && (
                <>
                  <button
                    onClick={handleDownloadOriginal}
                    className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-50 flex items-center"
                  >
                    <FileDown className="w-4 h-4 mr-2" />
                    Original
                  </button>
                  <button
                    onClick={handleDownloadSigned}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Signed
                  </button>
                </>
              )}
              {!isCompleted && (
                <button
                  disabled={deleteDocument.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete "${doc.name}"? This cannot be undone.`,
                      )
                    ) {
                      deleteDocument.mutate();
                    }
                  }}
                  className="px-4 py-2 text-red-600 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50 flex items-center"
                  title="Delete document"
                >
                  <Trash2 className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">
                    {deleteDocument.isPending ? "Deleting…" : "Delete"}
                  </span>
                </button>
              )}
            </div>
          </div>
          <div className="aspect-[8.5/11] bg-gray-100 flex items-center justify-center">
            {previewUrl ? (
              <iframe
                src={previewUrl}
                className="w-full h-full"
                title="PDF Preview"
              />
            ) : (
              <div className="text-center text-gray-500">
                <Eye className="w-12 h-12 mx-auto mb-2" />
                <p>PDF preview not available</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="space-y-6">
        {/* Document info */}
        <div className="bg-white sm:rounded-lg sm:border sm:shadow-sm p-4">
          <h2 className="font-semibold mb-4">Document Info</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Pages</dt>
              <dd className="font-medium">{doc.totalPages}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Created</dt>
              <dd className="font-medium">
                {new Date(doc.createdAt).toLocaleDateString()}
              </dd>
            </div>
            {doc.description && (
              <div>
                <dt className="text-gray-500 mb-1">Description</dt>
                <dd className="text-gray-700">{doc.description}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Signers */}
        <div className="bg-white sm:rounded-lg sm:border sm:shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Signers</h2>
              {doc.signingOrder && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                  <ListOrdered className="w-3 h-3" />
                  Sequential
                </span>
              )}
            </div>
            {isDraft && (
              <button
                onClick={() => navigate(`/documents/${id}/prepare`)}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Manage
              </button>
            )}
          </div>

          {doc.signers?.length > 0 ? (
            <ul className="space-y-3">
              {doc.signers.map((signer) => {
                const signerStatus =
                  signerStatusConfig[signer.status] ??
                  signerStatusConfig.SIGNER_STATUS_PENDING;
                return (
                  <li
                    key={signer.id}
                    className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
                  >
                    {doc.signingOrder && (
                      <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-purple-700 mt-1">
                        {signer.signingOrder}
                      </div>
                    )}
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{signer.name}</p>
                      <p className="text-sm text-gray-500 truncate">
                        {signer.email}
                      </p>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${signerStatus.color}`}
                      >
                        {signerStatus.label}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-gray-500 text-sm">No signers added yet</p>
          )}
        </div>

        {/* Save as Template */}
        <div className="bg-white sm:rounded-lg sm:border sm:shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Templates</h2>
            <button
              onClick={() => navigate("/templates")}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              Browse <ExternalLink className="w-3 h-3" />
            </button>
          </div>
          {!showSaveTemplate ? (
            <button
              onClick={() => {
                setTemplateName(doc.name + " Template");
                setShowSaveTemplate(true);
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors"
            >
              <BookTemplate className="w-4 h-4" />
              Save field layout as template
            </button>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="Template name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="Description (optional)"
                value={templateDesc}
                onChange={(e) => setTemplateDesc(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSaveTemplate(false)}
                  className="flex-1 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  disabled={!templateName || saveAsTemplate.isPending}
                  onClick={() => saveAsTemplate.mutate()}
                  className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saveAsTemplate.isPending ? "Saving…" : "Save Template"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Cryptographic Signatures (only show for completed documents) */}
        {isCompleted && signatures.length > 0 && (
          <div className="bg-white sm:rounded-lg sm:border sm:shadow-sm p-4">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-green-600" />
              <h2 className="font-semibold">Digital Signatures</h2>
            </div>
            <ul className="space-y-4">
              {signatures.map((sig) => (
                <li key={sig.id} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{sig.signerName}</p>
                      <p className="text-sm text-gray-500">{sig.signerEmail}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Signed:{" "}
                        {new Date(sig.signingTimestamp).toLocaleString()}
                      </p>
                      {sig.certificateIssuer && (
                        <details className="mt-2">
                          <summary className="text-xs text-blue-600 cursor-pointer hover:text-blue-800">
                            Certificate Details
                          </summary>
                          <div className="mt-2 text-xs text-gray-500 space-y-1 bg-white p-2 rounded border">
                            <p>
                              <span className="font-medium">Issuer:</span>{" "}
                              {sig.certificateIssuer}
                            </p>
                            <p>
                              <span className="font-medium">Serial:</span>{" "}
                              {sig.certificateSerial}
                            </p>
                            <p>
                              <span className="font-medium">Algorithm:</span>{" "}
                              {sig.signatureAlgorithm}
                            </p>
                            <p>
                              <span className="font-medium">Hash:</span>{" "}
                              {sig.hashAlgorithm}
                            </p>
                            {sig.certificateValidFrom &&
                              sig.certificateValidTo && (
                                <p>
                                  <span className="font-medium">Valid:</span>{" "}
                                  {new Date(
                                    sig.certificateValidFrom,
                                  ).toLocaleDateString()}{" "}
                                  -{" "}
                                  {new Date(
                                    sig.certificateValidTo,
                                  ).toLocaleDateString()}
                                </p>
                              )}
                            <p className="truncate" title={sig.documentHash}>
                              <span className="font-medium">Doc Hash:</span>{" "}
                              {sig.documentHash.substring(0, 16)}...
                            </p>
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Activity / Audit Trail */}
        <div className="bg-white sm:rounded-lg sm:border sm:shadow-sm p-4">
          <h2 className="font-semibold mb-4">Activity</h2>
          {auditEntries.length > 0 ? (
            <ul className="space-y-4">
              {auditEntries.slice(0, 10).map((entry) => (
                <li
                  key={entry.id}
                  className="flex gap-3 pb-4 border-b border-gray-100 last:border-0"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
                      {entry.action.includes("COMPLETED") ||
                      entry.action.includes("completed") ? (
                        <CheckCircle className="w-3 h-3 text-green-600" />
                      ) : (
                        <Clock className="w-3 h-3 text-blue-600" />
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {formatAuditAction(entry.action)}
                    </p>
                    {entry.signerName && (
                      <p className="text-xs text-gray-500">
                        by {entry.signerName}
                      </p>
                    )}
                    <p className="text-xs text-gray-400">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                    {parseDeclineReason(entry) && (
                      <div className="mt-1 p-2 rounded-md bg-red-50 border-l-2 border-red-400 text-xs text-red-700">
                        <span className="font-medium">Reason:</span>{" "}
                        {parseDeclineReason(entry)}
                      </div>
                    )}
                    {(entry.ipAddress || entry.userAgent) && (
                      <div className="mt-1 text-xs text-gray-400 space-y-0.5">
                        {entry.ipAddress && <p>IP: {entry.ipAddress}</p>}
                        {entry.userAgent && (
                          <p className="truncate" title={entry.userAgent}>
                            Client: {parseUserAgent(entry.userAgent)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 text-sm">No activity yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatAuditAction(action: string): string {
  const actions: Record<string, string> = {
    AUDIT_ACTION_DOCUMENT_CREATED: "Document created",
    AUDIT_ACTION_DOCUMENT_SENT: "Sent for signing",
    AUDIT_ACTION_DOCUMENT_VIEWED: "Document viewed",
    AUDIT_ACTION_DOCUMENT_SIGNED: "Document signed",
    AUDIT_ACTION_DOCUMENT_DECLINED: "Signing declined",
    AUDIT_ACTION_DOCUMENT_COMPLETED: "Signing completed",
    AUDIT_ACTION_DOCUMENT_VOIDED: "Document voided",
    AUDIT_ACTION_SIGNER_ADDED: "Signer added",
    AUDIT_ACTION_SIGNATURE_CAPTURED: "Signature captured",
    document_created: "Document created",
    document_sent: "Sent for signing",
    document_viewed: "Document viewed",
    document_signed: "Document signed",
    document_declined: "Signing declined",
    document_completed: "Signing completed",
    document_voided: "Document voided",
    signer_added: "Signer added",
    signer_notified: "Signer notified",
    signature_captured: "Signature captured",
    AUDIT_ACTION_SIGNER_NOTIFIED: "Signer notified",
  };
  return (
    actions[action] ??
    action.replace("AUDIT_ACTION_", "").replace(/_/g, " ").toLowerCase()
  );
}

// Extract the decline reason from an audit entry's actionDetails JSON.
// Returns null for non-decline entries or malformed payloads.
function parseDeclineReason(entry: AuditEntry): string | null {
  if (!entry.actionDetails) return null;
  if (
    entry.action !== "document_declined" &&
    entry.action !== "AUDIT_ACTION_DOCUMENT_DECLINED"
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(entry.actionDetails) as { reason?: string };
    const r = parsed.reason?.trim();
    return r && r.length > 0 ? r : null;
  } catch {
    return null;
  }
}

function parseUserAgent(ua: string): string {
  // Extract browser and OS from user agent string
  if (ua.includes("Chrome") && !ua.includes("Edg")) {
    const match = ua.match(/Chrome\/(\d+)/);
    const version = match ? ` ${match[1]}` : "";
    if (ua.includes("Mac")) return `Chrome${version} on macOS`;
    if (ua.includes("Windows")) return `Chrome${version} on Windows`;
    if (ua.includes("Linux")) return `Chrome${version} on Linux`;
    return `Chrome${version}`;
  }
  if (ua.includes("Firefox")) {
    const match = ua.match(/Firefox\/(\d+)/);
    const version = match ? ` ${match[1]}` : "";
    if (ua.includes("Mac")) return `Firefox${version} on macOS`;
    if (ua.includes("Windows")) return `Firefox${version} on Windows`;
    if (ua.includes("Linux")) return `Firefox${version} on Linux`;
    return `Firefox${version}`;
  }
  if (ua.includes("Safari") && !ua.includes("Chrome")) {
    if (ua.includes("Mac")) return "Safari on macOS";
    if (ua.includes("iPhone")) return "Safari on iPhone";
    if (ua.includes("iPad")) return "Safari on iPad";
    return "Safari";
  }
  if (ua.includes("Edg")) {
    const match = ua.match(/Edg\/(\d+)/);
    const version = match ? ` ${match[1]}` : "";
    return `Edge${version} on Windows`;
  }
  // Return truncated version if can't parse
  return ua.length > 50 ? ua.substring(0, 47) + "..." : ua;
}
