import { useState, useRef, DragEvent, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  User,
  Plus,
  Trash2,
  Send,
  AlertCircle,
  PenTool,
  Type,
  Calendar,
  CheckSquare,
  GripVertical,
  AlignLeft,
  UserPlus,
  ArrowUp,
  ArrowDown,
  ListOrdered,
} from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
// @ts-ignore - CSS imports from react-pdf
import "react-pdf/dist/Page/AnnotationLayer.css";
// @ts-ignore - CSS imports from react-pdf
import "react-pdf/dist/Page/TextLayer.css";
import { Card, LoadingSpinner } from "tibui";
import { apiClient } from "@/utils/apiClient";
import { useUser } from "@/contexts/UserContext";

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Local Button component
function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  className = "",
  onClick,
}: {
  children: React.ReactNode;
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const sizeStyles = {
    sm: "px-2 py-1 text-sm",
    md: "px-4 py-2",
    lg: "px-6 py-3 text-lg",
  };
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    outline: "border border-gray-300 bg-transparent hover:bg-gray-50",
    ghost: "bg-transparent hover:bg-gray-100",
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${sizeStyles[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

interface DocumentData {
  id: string;
  name: string;
  status: string;
  totalPages: number;
  signingOrder: boolean;
  signers: Signer[];
}

interface Signer {
  id: string;
  name: string;
  email: string;
  signerType: string;
  signingOrder: number;
  fields: SignatureField[];
}

interface SignatureField {
  id: string;
  fieldType: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  fontSize?: number;
}

const signerColors = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

const fieldTypes = [
  {
    type: "signature",
    icon: PenTool,
    label: "Signature",
    width: 0.25,
    height: 0.06,
    fontSize: 0,
  },
  {
    type: "initials",
    icon: Type,
    label: "Initials",
    width: 0.1,
    height: 0.05,
    fontSize: 0,
  },
  {
    type: "date",
    icon: Calendar,
    label: "Date",
    width: 0.225,
    height: 0.04,
    fontSize: 12,
  },
  {
    type: "text",
    icon: AlignLeft,
    label: "Text",
    width: 0.2,
    height: 0.04,
    fontSize: 12,
  },
  {
    type: "checkbox",
    icon: CheckSquare,
    label: "Checkbox",
    width: 0.03,
    height: 0.03,
    fontSize: 0,
  },
];

export function PrepareDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const { user } = useUser();

  const [selectedSignerId, setSelectedSignerId] = useState<string | null>(null);
  const [showAddSigner, setShowAddSigner] = useState(false);
  const [newSignerName, setNewSignerName] = useState("");
  const [newSignerEmail, setNewSignerEmail] = useState("");
  const [numPages, setNumPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  // Tap-to-place: when a field type is "armed" via click (mobile-friendly
  // alternative to drag), the next click on the PDF places a field of that
  // type at the click position.
  const [pendingFieldType, setPendingFieldType] = useState<string | null>(null);
  const [isDraggingField, setIsDraggingField] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null); // 'se' for bottom-right corner
  const [dragStart, setDragStart] = useState<{
    x: number;
    y: number;
    fieldX: number;
    fieldY: number;
    fieldW: number;
    fieldH: number;
  } | null>(null);
  // Local state for field position during drag (to avoid API calls on every mouse move)
  const [dragPreview, setDragPreview] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const {
    data,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: ["document", id],
    queryFn: () =>
      apiClient.get<{ document: DocumentData; downloadUrl: string }>(
        `/documents/${id}`,
      ),
  });

  const addSigner = useMutation({
    mutationFn: async (data: { name: string; email: string }) => {
      const response = await apiClient.post(`/documents/${id}/signers`, {
        documentId: id,
        email: data.email,
        name: data.name,
        signerType: "SIGNER_TYPE_SIGNER",
        signingOrder: (doc?.signers?.length ?? 0) + 1,
      });
      return response;
    },
    onSuccess: () => {
      setMutationError(null);
      queryClient.invalidateQueries({ queryKey: ["document", id] });
      setShowAddSigner(false);
      setNewSignerName("");
      setNewSignerEmail("");
    },
    onError: (err: Error) => {
      setMutationError(`Failed to add signer: ${err.message}`);
    },
  });

  const removeSigner = useMutation({
    mutationFn: (signerId: string) =>
      apiClient.delete(`/documents/${id}/signers/${signerId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", id] });
      if (selectedSignerId) setSelectedSignerId(null);
    },
  });

  const addField = useMutation({
    mutationFn: (data: {
      signerId: string;
      fieldType: string;
      pageNumber: number;
      x: number;
      y: number;
      width: number;
      height: number;
      fontSize?: number;
    }) =>
      apiClient.post(`/documents/${id}/fields`, {
        signerId: data.signerId,
        fieldType: `FIELD_TYPE_${data.fieldType.toUpperCase()}`,
        pageNumber: data.pageNumber,
        x: data.x,
        y: data.y,
        width: data.width,
        height: data.height,
        required: true,
        fontSize: data.fontSize || 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", id] });
    },
    onError: (err: Error) => {
      setMutationError(`Failed to add field: ${err.message}`);
    },
  });

  const removeField = useMutation({
    mutationFn: (fieldId: string) =>
      apiClient.delete(`/documents/${id}/fields/${fieldId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", id] });
      setSelectedFieldId(null);
    },
  });

  const updateField = useMutation({
    mutationFn: (data: {
      fieldId: string;
      pageNumber: number;
      x: number;
      y: number;
      width: number;
      height: number;
      fontSize?: number;
    }) =>
      apiClient.patch(`/documents/${id}/fields/${data.fieldId}`, {
        pageNumber: data.pageNumber,
        x: data.x,
        y: data.y,
        width: data.width,
        height: data.height,
        fontSize: data.fontSize,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", id] });
    },
  });

  // Move a signer up or down in the signing order by swapping its
  // signing_order value with the adjacent signer.
  const updateSignerOrder = useMutation({
    mutationFn: async ({
      signerId,
      direction,
    }: {
      signerId: string;
      direction: "up" | "down";
    }) => {
      if (!doc) return;
      const sorted = [...(doc.signers ?? [])].sort(
        (a, b) => a.signingOrder - b.signingOrder,
      );
      const idx = sorted.findIndex((s) => s.id === signerId);
      if (idx < 0) return;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= sorted.length) return;

      const current = sorted[idx];
      const swap = sorted[swapIdx];

      // Swap signing_order values
      await apiClient.patch(`/documents/${id}/signers/${current.id}`, {
        name: current.name,
        email: current.email,
        signerType: current.signerType,
        signingOrder: swap.signingOrder,
      });
      await apiClient.patch(`/documents/${id}/signers/${swap.id}`, {
        name: swap.name,
        email: swap.email,
        signerType: swap.signerType,
        signingOrder: current.signingOrder,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", id] });
    },
    onError: (err: Error) => {
      setMutationError(`Failed to reorder: ${err.message}`);
    },
  });

  // Tracks the post-send "Sent ✓" confirmation. The button stays disabled
  // from this point onward (the document is already sent — re-sending is a
  // separate action on the detail page), so this also acts as a cooldown
  // preventing accidental double-sends from a fast double-click.
  const [sendSucceeded, setSendSucceeded] = useState(false);
  const sendDocument = useMutation({
    mutationFn: () => apiClient.post(`/documents/${id}/send`, { message: "" }),
    onSuccess: () => {
      setSendSucceeded(true);
      // Give the user a moment to register the "Sent ✓" state before
      // navigating to the detail page.
      setTimeout(() => navigate(`/documents/${id}`), 1500);
    },
    onError: (err: Error) => {
      // Silent failures cause "I clicked and nothing happened". Surface
      // the server error to the user.
      alert(`Failed to send for signing: ${err.message}`);
    },
  });

  const doc = data?.document;
  const downloadUrl = data?.downloadUrl;

  // Handle drag start for field types
  const handleDragStart = (e: DragEvent<HTMLDivElement>, fieldType: string) => {
    e.dataTransfer.setData("fieldType", fieldType);
    e.dataTransfer.effectAllowed = "copy";
  };

  // Handle drag over to allow drop
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  // Place a field of the given type at the given pointer coordinates
  // (relative to the overlay container's bounding rect). Used by both the
  // drag-drop flow and the tap-to-place flow.
  const placeFieldAt = (
    fieldType: string,
    clientX: number,
    clientY: number,
    rect: DOMRect,
  ) => {
    if (!selectedSignerId) return;
    const fieldConfig = fieldTypes.find((f) => f.type === fieldType);
    if (!fieldConfig) return;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    const fieldX = Math.max(
      0,
      Math.min(1 - fieldConfig.width, x - fieldConfig.width / 2),
    );
    const fieldY = Math.max(
      0,
      Math.min(1 - fieldConfig.height, y - fieldConfig.height / 2),
    );
    addField.mutate({
      signerId: selectedSignerId,
      fieldType,
      pageNumber: currentPage,
      x: fieldX,
      y: fieldY,
      width: fieldConfig.width,
      height: fieldConfig.height,
      fontSize: fieldConfig.fontSize,
    });
  };

  // Handle drop on PDF to place field
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!selectedSignerId) return;
    const fieldType = e.dataTransfer.getData("fieldType");
    if (!fieldType) return;
    placeFieldAt(
      fieldType,
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
    );
  };

  // Tap-to-place click handler on the PDF overlay. If a field type is
  // armed (selected by tapping in the sidebar), place it at the tap; else
  // clear the selection. Drag-drop continues to work alongside this on
  // desktop.
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (pendingFieldType && selectedSignerId) {
      placeFieldAt(
        pendingFieldType,
        e.clientX,
        e.clientY,
        e.currentTarget.getBoundingClientRect(),
      );
      setPendingFieldType(null);
      return;
    }
    setSelectedFieldId(null);
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  // Handle keyboard events for delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedFieldId) {
        e.preventDefault();
        removeField.mutate(selectedFieldId);
      }
      if (e.key === "Escape") {
        setSelectedFieldId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFieldId, removeField]);

  // Handle mouse move for dragging/resizing fields
  // Uses local state (dragPreview) during drag, only updates server on mouse up
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragStart || !containerRef.current || !selectedFieldId) return;

      const rect = containerRef.current.getBoundingClientRect();
      const currentX = (e.clientX - rect.left) / rect.width;
      const currentY = (e.clientY - rect.top) / rect.height;

      if (isResizing) {
        // Resizing from bottom-right corner
        const newWidth = Math.max(
          0.03,
          Math.min(
            1 - dragStart.fieldX,
            currentX - dragStart.fieldX + dragStart.fieldW,
          ),
        );
        const newHeight = Math.max(
          0.02,
          Math.min(
            1 - dragStart.fieldY,
            currentY - dragStart.fieldY + dragStart.fieldH,
          ),
        );

        setDragPreview({
          x: dragStart.fieldX,
          y: dragStart.fieldY,
          width: newWidth,
          height: newHeight,
        });
      } else if (isDraggingField) {
        // Moving the field
        const deltaX = currentX - dragStart.x;
        const deltaY = currentY - dragStart.y;

        const newX = Math.max(
          0,
          Math.min(1 - dragStart.fieldW, dragStart.fieldX + deltaX),
        );
        const newY = Math.max(
          0,
          Math.min(1 - dragStart.fieldH, dragStart.fieldY + deltaY),
        );

        setDragPreview({
          x: newX,
          y: newY,
          width: dragStart.fieldW,
          height: dragStart.fieldH,
        });
      }
    },
    [dragStart, selectedFieldId, isDraggingField, isResizing],
  );

  // Handle mouse up to stop dragging/resizing - commit changes to server
  const handleMouseUp = useCallback(() => {
    if (dragPreview && selectedFieldId) {
      // Find the field to preserve its fontSize
      const field = doc?.signers
        ?.flatMap((s) => s.fields || [])
        .find((f) => f.id === selectedFieldId);
      updateField.mutate({
        fieldId: selectedFieldId,
        pageNumber: currentPage,
        x: dragPreview.x,
        y: dragPreview.y,
        width: dragPreview.width,
        height: dragPreview.height,
        fontSize: field?.fontSize,
      });
    }
    setIsDraggingField(false);
    setIsResizing(null);
    setDragStart(null);
    setDragPreview(null);
  }, [dragPreview, selectedFieldId, currentPage, updateField, doc]);

  // Add/remove global mouse listeners for drag operations
  useEffect(() => {
    if (isDraggingField || isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDraggingField, isResizing, handleMouseMove, handleMouseUp]);

  // Start dragging a field
  const handleFieldMouseDown = (e: React.MouseEvent, field: SignatureField) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedFieldId(field.id);

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    setDragStart({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      fieldX: field.x,
      fieldY: field.y,
      fieldW: field.width,
      fieldH: field.height,
    });
    setIsDraggingField(true);
  };

  // Start resizing a field
  const handleResizeMouseDown = (
    e: React.MouseEvent,
    field: SignatureField,
    corner: string,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedFieldId(field.id);

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    setDragStart({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      fieldX: field.x,
      fieldY: field.y,
      fieldW: field.width,
      fieldH: field.height,
    });
    setIsResizing(corner);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (queryError || !doc) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <AlertCircle className="w-12 h-12 mb-4" />
        <h2 className="text-lg font-semibold">Error</h2>
        <p>Failed to load document</p>
      </div>
    );
  }

  const canSend =
    doc.signers?.length > 0 &&
    doc.signers.every((s) => (s.fields?.length ?? 0) > 0);
  // Reason the send button is disabled — shown as a hint so users know
  // what to do next instead of clicking a dead button.
  let sendDisabledReason: string | null = null;
  if (!canSend) {
    if (!doc.signers || doc.signers.length === 0) {
      sendDisabledReason = "Add at least one signer first.";
    } else {
      const missing = doc.signers.filter((s) => (s.fields?.length ?? 0) === 0);
      sendDisabledReason = `Place a signature field for ${missing
        .map((s) => s.name || s.email)
        .join(", ")}.`;
    }
  }
  const selectedSigner = doc.signers?.find((s) => s.id === selectedSignerId);
  const selectedSignerIndex =
    doc.signers?.findIndex((s) => s.id === selectedSignerId) ?? -1;

  // Get the selected field for editing
  const selectedField = selectedFieldId
    ? doc.signers
        ?.flatMap((s) => s.fields || [])
        .find((f) => f.id === selectedFieldId)
    : null;
  const isTextOrDateField =
    selectedField &&
    (selectedField.fieldType === "FIELD_TYPE_DATE" ||
      selectedField.fieldType === "FIELD_TYPE_TEXT");

  // Handle font size change for selected field
  const handleFontSizeChange = (newSize: number) => {
    if (!selectedField) return;
    updateField.mutate({
      fieldId: selectedField.id,
      pageNumber: selectedField.pageNumber,
      x: selectedField.x,
      y: selectedField.y,
      width: selectedField.width,
      height: selectedField.height,
      fontSize: newSize,
    });
  };

  return (
    <div className="flex flex-col lg:flex-row lg:h-[calc(100vh-8rem)] gap-4">
      {/* Left sidebar - Signers. Full-width stack on mobile so each
          control is reachable; fixed-width column on lg+. */}
      <div className="w-full lg:w-72 flex flex-col gap-4">
        <Card className="flex-1 overflow-auto">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Signers</h2>
                {doc?.signingOrder && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                    <ListOrdered className="w-3 h-3" />
                    Sequential
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {user && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      addSigner.mutate({ name: user.name, email: user.email })
                    }
                    disabled={addSigner.isPending}
                    className="text-xs"
                  >
                    <UserPlus className="w-4 h-4 mr-1" />
                    Add Myself
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddSigner(true)}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
            {mutationError && (
              <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                {mutationError}
              </div>
            )}
          </div>

          {showAddSigner && (
            <div className="p-4 border-b bg-gray-50 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  value={newSignerName}
                  onChange={(e) => setNewSignerName(e.target.value)}
                  placeholder="Signer name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  value={newSignerEmail}
                  onChange={(e) => setNewSignerEmail(e.target.value)}
                  placeholder="signer@example.com"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAddSigner(false);
                    setNewSignerName("");
                    setNewSignerEmail("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={
                    !newSignerName || !newSignerEmail || addSigner.isPending
                  }
                  onClick={() =>
                    addSigner.mutate({
                      name: newSignerName,
                      email: newSignerEmail,
                    })
                  }
                >
                  Add
                </Button>
              </div>
            </div>
          )}

          <div className="p-2">
            {doc.signers?.length > 0 ? (
              <ul className="space-y-2">
                {[...(doc.signers ?? [])]
                  .sort((a, b) => a.signingOrder - b.signingOrder)
                  .map((signer, index, arr) => (
                    <li
                      key={signer.id}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        selectedSignerId === signer.id
                          ? "bg-blue-50 border-2 border-blue-500"
                          : "bg-gray-50 hover:bg-gray-100 border-2 border-transparent"
                      }`}
                      onClick={() => setSelectedSignerId(signer.id)}
                    >
                      <div className="flex items-start gap-2">
                        {/* Order controls (only when sequential signing is on) */}
                        {doc.signingOrder && (
                          <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                            <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center text-xs font-bold text-purple-700">
                              {signer.signingOrder}
                            </div>
                            <button
                              className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30"
                              disabled={
                                index === 0 || updateSignerOrder.isPending
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                updateSignerOrder.mutate({
                                  signerId: signer.id,
                                  direction: "up",
                                });
                              }}
                              title="Move up in signing order"
                            >
                              <ArrowUp className="w-3 h-3 text-gray-500" />
                            </button>
                            <button
                              className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30"
                              disabled={
                                index === arr.length - 1 ||
                                updateSignerOrder.isPending
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                updateSignerOrder.mutate({
                                  signerId: signer.id,
                                  direction: "down",
                                });
                              }}
                              title="Move down in signing order"
                            >
                              <ArrowDown className="w-3 h-3 text-gray-500" />
                            </button>
                          </div>
                        )}
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{
                            backgroundColor:
                              signerColors[index % signerColors.length] + "20",
                          }}
                        >
                          <User
                            className="w-4 h-4"
                            style={{
                              color: signerColors[index % signerColors.length],
                            }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">
                            {signer.name}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {signer.email}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {signer.fields?.length ?? 0} fields
                          </p>
                        </div>
                        <button
                          className="p-1 hover:bg-gray-200 rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeSigner.mutate(signer.id);
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-gray-500 text-sm text-center py-4">
                Add signers to continue
              </p>
            )}
          </div>
        </Card>

        {/* Field types - draggable on desktop, tap-to-place anywhere */}
        {selectedSignerId && (
          <Card>
            <div className="p-4 border-b">
              <h2 className="font-semibold">Field Types</h2>
              <p className="text-xs text-gray-500 mt-1">
                {pendingFieldType
                  ? "Tap on the PDF to place the field"
                  : "Tap a field then tap on the PDF, or drag onto it"}
              </p>
            </div>
            <div className="p-2 space-y-2">
              {fieldTypes.map(({ type, icon: Icon, label }) => {
                const isArmed = pendingFieldType === type;
                return (
                  <div
                    key={type}
                    draggable
                    onDragStart={(e) => handleDragStart(e, type)}
                    onClick={() => setPendingFieldType(isArmed ? null : type)}
                    className={`p-3 rounded-lg flex items-center gap-3 transition-colors border-2 cursor-pointer ${
                      isArmed
                        ? "bg-blue-50 border-blue-500"
                        : "bg-gray-50 hover:bg-gray-100 border-transparent hover:border-blue-300 cursor-grab active:cursor-grabbing"
                    }`}
                  >
                    <GripVertical className="w-4 h-4 text-gray-400" />
                    <Icon
                      className="w-5 h-5"
                      style={{
                        color:
                          signerColors[
                            selectedSignerIndex % signerColors.length
                          ],
                      }}
                    />
                    <span className="text-sm font-medium">{label}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Field Properties - Font Size */}
        {isTextOrDateField && selectedField && (
          <Card>
            <div className="p-4 border-b">
              <h2 className="font-semibold">Field Properties</h2>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Font Size: {selectedField.fontSize || 12}pt
                </label>
                <input
                  type="range"
                  min="8"
                  max="48"
                  value={selectedField.fontSize || 12}
                  onChange={(e) =>
                    handleFontSizeChange(parseInt(e.target.value))
                  }
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>8pt</span>
                  <span>48pt</span>
                </div>
              </div>
              <div className="flex gap-2">
                {[10, 12, 14, 16, 18, 24].map((size) => (
                  <button
                    key={size}
                    onClick={() => handleFontSizeChange(size)}
                    className={`px-2 py-1 text-xs rounded ${
                      (selectedField.fontSize || 12) === size
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Main content - PDF Viewer */}
      <div className="flex-1">
        <Card className="h-full flex flex-col">
          <div className="p-4 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-semibold truncate">{doc.name}</h1>
              <p className="text-sm text-gray-500">
                {selectedSignerId
                  ? `Drag field types from the left sidebar onto the document for ${selectedSigner?.name}`
                  : "Select a signer to place fields"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-4">
              {numPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    Prev
                  </Button>
                  <span className="text-sm">
                    Page {currentPage} of {numPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage >= numPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
              <div className="flex flex-col items-end gap-1">
                <span
                  title={sendDisabledReason ?? "Send the document for signing"}
                >
                  <Button
                    disabled={
                      !canSend || sendDocument.isPending || sendSucceeded
                    }
                    onClick={() => sendDocument.mutate()}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    {sendSucceeded
                      ? "Sent ✓ — redirecting…"
                      : sendDocument.isPending
                        ? "Sending…"
                        : "Send for Signing"}
                  </Button>
                </span>
                {sendDisabledReason && !sendSucceeded && (
                  <p className="text-xs text-amber-600">{sendDisabledReason}</p>
                )}
                {sendSucceeded && (
                  <p className="text-xs text-green-600">
                    Invitations sent. Redirecting to the document…
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-gray-100 p-4">
            {downloadUrl ? (
              <div className="flex justify-start sm:justify-center">
                <div
                  className={`relative bg-white shadow-lg ${selectedSignerId ? "ring-2 ring-blue-300 ring-dashed" : ""}`}
                  style={{ width: 700 }}
                >
                  {/* PDF document - disable text selection layer to allow field interaction */}
                  <div className="[&_.react-pdf__Page__textContent]:pointer-events-none [&_.react-pdf__Page__annotations]:pointer-events-none">
                    <Document
                      file={downloadUrl}
                      onLoadSuccess={onDocumentLoadSuccess}
                    >
                      <Page pageNumber={currentPage} width={700} />
                    </Document>
                  </div>

                  {/* Overlay container for fields - positioned absolutely over the PDF */}
                  <div
                    ref={containerRef}
                    className="absolute inset-0"
                    style={{
                      zIndex: 5,
                      cursor: pendingFieldType ? "crosshair" : "default",
                    }}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={handleOverlayClick}
                  >
                    {/* Render existing fields as overlays */}
                    {doc.signers?.map((signer, signerIndex) =>
                      signer.fields
                        ?.filter((field) => field.pageNumber === currentPage)
                        .map((field) => {
                          const isSelected = selectedFieldId === field.id;
                          const isDragging = isSelected && dragPreview;
                          const color =
                            signerColors[signerIndex % signerColors.length];
                          // Use dragPreview position during drag, otherwise use field position
                          const displayX = isDragging ? dragPreview.x : field.x;
                          const displayY = isDragging ? dragPreview.y : field.y;
                          const displayW = isDragging
                            ? dragPreview.width
                            : field.width;
                          const displayH = isDragging
                            ? dragPreview.height
                            : field.height;
                          return (
                            <div
                              key={field.id}
                              className={`absolute rounded flex items-center justify-center text-xs font-medium select-none ${
                                isSelected
                                  ? "border-4 ring-2 ring-blue-500 ring-offset-1 cursor-move"
                                  : "border-2 cursor-pointer hover:ring-2 hover:ring-blue-300"
                              }`}
                              style={{
                                left: `${displayX * 100}%`,
                                top: `${displayY * 100}%`,
                                width: `${displayW * 100}%`,
                                height: `${displayH * 100}%`,
                                borderColor: isSelected ? "#2563eb" : color,
                                backgroundColor: color + "30",
                                color: color,
                                zIndex: isSelected ? 20 : 10,
                              }}
                              onMouseDown={(e) =>
                                handleFieldMouseDown(e, field)
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedFieldId(field.id);
                              }}
                            >
                              <span className="pointer-events-none truncate px-1 font-semibold">
                                {getFieldTypeIcon(field.fieldType)}{" "}
                                {signer.name.split(" ")[0]}
                              </span>
                              {/* Resize handle - bottom right corner */}
                              {isSelected && (
                                <>
                                  <div
                                    className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-blue-600 border-2 border-white rounded cursor-se-resize shadow"
                                    onMouseDown={(e) =>
                                      handleResizeMouseDown(e, field, "se")
                                    }
                                  />
                                  {/* Delete button - top right */}
                                  <button
                                    className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeField.mutate(field.id);
                                    }}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          );
                        }),
                    )}

                    {/* Instructions for selected field */}
                    {selectedFieldId && (
                      <div className="absolute top-2 left-2 bg-black/80 text-white text-xs px-3 py-2 rounded shadow-lg">
                        <strong>Editing field:</strong> Drag to move • Corner to
                        resize • Delete key to remove • Esc to deselect
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <p>Loading document...</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function getFieldTypeIcon(fieldType: string): string {
  const icons: Record<string, string> = {
    FIELD_TYPE_SIGNATURE: "✍️",
    FIELD_TYPE_INITIALS: "AB",
    FIELD_TYPE_DATE: "📅",
    FIELD_TYPE_TEXT: "📝",
    FIELD_TYPE_CHECKBOX: "☑️",
  };
  return icons[fieldType] ?? "📝";
}
