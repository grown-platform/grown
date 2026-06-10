import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  X,
  PenTool,
  Loader2,
  Calendar,
  Type,
  ShieldCheck,
  CreditCard,
  RefreshCw,
  Edit3,
  Eye,
} from "lucide-react";
import { PDFEditor, Annotation } from "tibui";
import { apiClient } from "@/utils/apiClient";
import { SignatureCanvas } from "@/components/SignatureCanvas";
import { usePdfSigner } from "@/hooks/usePdfSigner";

// Simple Button component
function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "outline";
  className?: string;
}) {
  const baseStyles =
    "px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center";
  const variantStyles =
    variant === "outline"
      ? "border border-gray-300 text-gray-700 hover:bg-gray-50"
      : "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyles} ${variantStyles} ${className}`}
    >
      {children}
    </button>
  );
}

interface SigningSession {
  signerId: string;
  signerName: string;
  signerEmail: string;
  documentId: string;
  documentName: string;
  documentDownloadUrl: string;
  totalPages: number;
  fields: SigningField[];
  expiresAt: string;
  isSigned: boolean;
  senderName?: string;
  message?: string;
}

interface SigningField {
  id: string;
  fieldType: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  label?: string;
  value?: string;
  isFilled: boolean;
}

interface SigningMethod {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  requiresRedirect: boolean;
  redirectUrl: string;
}

interface SigningOptions {
  methods: SigningMethod[];
  defaultMethod: string;
  cacDetected: boolean;
  cacSubject: string;
}

export function SigningPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // State
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [activeFieldType, setActiveFieldType] = useState<string | null>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [showSigningMethodModal, setShowSigningMethodModal] = useState(false);
  const [selectedSigningMethod, setSelectedSigningMethod] =
    useState<string>("typed");
  const [textInputValue, setTextInputValue] = useState("");

  // PDF Editor state
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [editorMode, setEditorMode] = useState<"view" | "edit">("view");

  // Check if we returned from mTLS signing
  const mtlsReturn = searchParams.get("mtls_return");
  const mtlsSuccess = searchParams.get("success");

  // Browser extension for hardware signing
  const signer = usePdfSigner();
  const [isExtensionSigning, setIsExtensionSigning] = useState(false);
  const [showCertificateSelector, setShowCertificateSelector] = useState(false);
  const [extensionSigningError, setExtensionSigningError] = useState<
    string | null
  >(null);

  const [authoredAnnotationsLoaded, setAuthoredAnnotationsLoaded] =
    useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["signing-session", token],
    queryFn: () => apiClient.get<{ session: SigningSession }>(`/sign/${token}`),
    retry: false,
  });

  // Fetch available signing options
  const { data: signingOptionsData } = useQuery({
    queryKey: ["signing-options", token],
    queryFn: () => apiClient.get<SigningOptions>(`/sign/${token}/options`),
    enabled: !!data?.session && !data.session.isSigned,
    retry: false,
  });

  // Record view when session loads
  useQuery({
    queryKey: ["record-view", token],
    queryFn: () => apiClient.post(`/sign/${token}/view`, {}),
    enabled: !!data?.session && !data.session.isSigned,
    retry: false,
  });

  // Set default signing method when options load
  useEffect(() => {
    if (signingOptionsData?.defaultMethod) {
      setSelectedSigningMethod(signingOptionsData.defaultMethod);
    }
  }, [signingOptionsData]);

  // Handle mTLS return
  useEffect(() => {
    if (mtlsReturn === "true" && mtlsSuccess === "true") {
      navigate(`/sign/${token}/complete`);
    }
  }, [mtlsReturn, mtlsSuccess, navigate, token]);

  // Load author-saved annotations so signers see the marked-up document.
  // The author's annotations seed the editor; the signer can still add
  // their own markup which gets submitted as part of their signature.
  const authoredAnnotations = useQuery<{ annotations: Annotation[] }>({
    queryKey: ["signing-annotations", token],
    queryFn: () =>
      apiClient.get<{ annotations: Annotation[] }>(
        `/sign/${token}/annotations`,
      ),
    enabled: !!token,
    retry: false,
  });
  useEffect(() => {
    if (
      !authoredAnnotationsLoaded &&
      authoredAnnotations.data?.annotations &&
      authoredAnnotations.data.annotations.length > 0
    ) {
      setAnnotations(authoredAnnotations.data.annotations);
      setAuthoredAnnotationsLoaded(true);
    }
  }, [authoredAnnotations.data, authoredAnnotationsLoaded]);

  const submitSignature = useMutation({
    mutationFn: (submitData: {
      fieldValues: { fieldId: string; value: string }[];
      consentText: string;
      annotations?: Annotation[];
    }) =>
      apiClient.post(`/sign/${token}/submit`, {
        fieldValues: submitData.fieldValues,
        consentGiven: true,
        consentText: submitData.consentText,
        annotations: submitData.annotations,
      }),
    onSuccess: () => {
      navigate(`/sign/${token}/complete`);
    },
  });

  const declineSigning = useMutation({
    mutationFn: (reason: string) =>
      apiClient.post(`/sign/${token}/decline`, { reason }),
    onSuccess: () => {
      navigate(`/sign/${token}/complete?declined=true`);
    },
  });

  // Prepare signature for extension-based signing
  const prepareSignature = useMutation({
    mutationFn: (data: { fieldValues: { fieldId: string; value: string }[] }) =>
      apiClient.post<{
        signatureId: string;
        hash: string;
        hashAlgorithm: string;
        expiresAt: number;
      }>(`/sign/${token}/prepare`, { fieldValues: data.fieldValues }),
  });

  // Complete signature with client-provided signature
  const completeSignature = useMutation({
    mutationFn: (data: {
      signatureId: string;
      signature: string;
      certificate: string;
      certificateChain: string[];
      consentGiven: boolean;
      consentText: string;
    }) => apiClient.post(`/sign/${token}/complete`, data),
    onSuccess: () => {
      navigate(`/sign/${token}/complete`);
    },
  });

  const handleFieldClick = useCallback(
    (fieldId: string, fieldType: string) => {
      if (editorMode === "edit") return; // Don't handle field clicks in edit mode

      if (fieldType === "date") {
        const today = new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        setFieldValues((prev) => ({ ...prev, [fieldId]: today }));
      } else if (fieldType === "text") {
        setActiveFieldId(fieldId);
        setActiveFieldType("text");
        setTextInputValue("");
      } else {
        setActiveFieldId(fieldId);
        setActiveFieldType(fieldType);
      }
    },
    [editorMode],
  );

  const handleSignatureCapture = useCallback(
    (signatureData: string) => {
      if (activeFieldId) {
        setFieldValues((prev) => ({ ...prev, [activeFieldId]: signatureData }));
        setActiveFieldId(null);
        setActiveFieldType(null);
      }
    },
    [activeFieldId],
  );

  const handleTextSubmit = useCallback(() => {
    if (activeFieldId && textInputValue.trim()) {
      setFieldValues((prev) => ({
        ...prev,
        [activeFieldId]: textInputValue.trim(),
      }));
      setActiveFieldId(null);
      setActiveFieldType(null);
      setTextInputValue("");
    }
  }, [activeFieldId, textInputValue]);

  const handleSubmit = () => {
    const enabledMethods =
      signingOptionsData?.methods?.filter((m) => m.enabled) || [];
    const hasCACOptions = enabledMethods.some((m) => m.id.startsWith("cac_"));

    if (hasCACOptions && enabledMethods.length > 1) {
      setShowSigningMethodModal(true);
    } else {
      setShowConsentModal(true);
    }
  };

  const handleSigningMethodSelect = async (methodId: string) => {
    setSelectedSigningMethod(methodId);
    setShowSigningMethodModal(false);
    setExtensionSigningError(null);

    const method = signingOptionsData?.methods?.find((m) => m.id === methodId);

    if (methodId === "cac_extension") {
      if (!signer.selectedCertificate && signer.certificates.length > 0) {
        setShowCertificateSelector(true);
        return;
      } else if (signer.certificates.length === 0) {
        setExtensionSigningError(
          "No certificates found. Please insert your smart card and click refresh.",
        );
        setShowCertificateSelector(true);
        return;
      }
      await handleExtensionSigning();
    } else if (method?.requiresRedirect && method.redirectUrl) {
      const values = Object.entries(fieldValues).map(([fieldId, value]) => ({
        fieldId,
        value,
      }));
      sessionStorage.setItem(`signing_fields_${token}`, JSON.stringify(values));
      const returnUrl = encodeURIComponent(
        `${window.location.origin}/sign/${token}?mtls_return=true`,
      );
      const redirectUrl = `${method.redirectUrl}/api/sign/${token}/submit?return_url=${returnUrl}`;
      window.location.href = redirectUrl;
    } else {
      setShowConsentModal(true);
    }
  };

  const handleExtensionSigning = async () => {
    if (!signer.selectedCertificate) {
      setExtensionSigningError("Please select a certificate");
      return;
    }

    setIsExtensionSigning(true);
    setExtensionSigningError(null);
    setShowCertificateSelector(false);

    try {
      const values = Object.entries(fieldValues).map(([fieldId, value]) => ({
        fieldId,
        value,
      }));

      const prepareResult = await prepareSignature.mutateAsync({
        fieldValues: values,
      });
      const signResult = await signer.signHash(
        prepareResult.hash,
        prepareResult.hashAlgorithm,
      );

      if (!signResult) {
        throw new Error(signer.error || "Failed to sign with smart card");
      }

      await completeSignature.mutateAsync({
        signatureId: prepareResult.signatureId,
        signature: signResult.signature,
        certificate: signResult.certificate,
        certificateChain: signResult.chain,
        consentGiven: true,
        consentText:
          "I agree to sign this document electronically with my CAC/PIV certificate.",
      });
    } catch (err) {
      setExtensionSigningError(
        err instanceof Error ? err.message : "Signing failed",
      );
      setIsExtensionSigning(false);
    }
  };

  const handleCertificateSelect = async () => {
    setShowCertificateSelector(false);
    await handleExtensionSigning();
  };

  const handleConsentConfirm = () => {
    const values = Object.entries(fieldValues).map(([fieldId, value]) => ({
      fieldId,
      value,
    }));

    submitSignature.mutate({
      fieldValues: values,
      consentText: "I agree to sign this document electronically.",
      annotations: annotations.length > 0 ? annotations : undefined,
    });
  };

  // Early returns
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !data?.session) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">
            Invalid or Expired Link
          </h2>
          <p className="text-gray-500">
            This signing link is no longer valid. Please contact the sender for
            a new link.
          </p>
        </div>
      </div>
    );
  }

  const { session } = data;

  if (session.isSigned) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="text-center">
          <Check className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Already Signed</h2>
          <p className="text-gray-500">
            You have already signed this document.
          </p>
        </div>
      </div>
    );
  }

  const requiredFields = session.fields.filter((f) => f.required);
  const filledCount = requiredFields.filter(
    (f) => fieldValues[f.id] || f.isFilled,
  ).length;
  const progress =
    requiredFields.length > 0 ? (filledCount / requiredFields.length) * 100 : 0;
  const canSubmit = filledCount === requiredFields.length;

  // Find pages with unfilled required fields
  const pagesWithUnfilledFields = [
    ...new Set(
      session.fields
        .filter((f) => f.required && !fieldValues[f.id] && !f.isFilled)
        .map((f) => f.pageNumber),
    ),
  ].sort((a, b) => a - b);

  const goToNextUnfilledField = () => {
    if (pagesWithUnfilledFields.length > 0) {
      setCurrentPage(pagesWithUnfilledFields[0]);
    }
  };

  const getFieldIcon = (fieldType: string) => {
    switch (fieldType) {
      case "date":
        return <Calendar className="w-4 h-4 mr-1" />;
      case "text":
        return <Type className="w-4 h-4 mr-1" />;
      default:
        return <PenTool className="w-4 h-4 mr-1" />;
    }
  };

  const getFieldLabel = (fieldType: string) => {
    switch (fieldType) {
      case "date":
        return "Click to add date";
      case "text":
        return "Click to enter text";
      case "initials":
        return "Initials";
      default:
        return "Sign here";
    }
  };

  const isImageField = (fieldType: string) => {
    return fieldType === "signature" || fieldType === "initials";
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">
              <span className="text-blue-600">PDF</span>
              <span className="text-black">Sign</span>
            </h1>
            <p className="text-sm text-gray-500">Secure Document Signing</p>
          </div>
          <div className="text-right">
            <p className="font-medium">{session.signerName}</p>
            <p className="text-sm text-gray-500">{session.signerEmail}</p>
          </div>
        </div>
      </header>

      {/* Document info and mode toggle */}
      <div className="bg-white border-b px-2 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-semibold truncate">{session.documentName}</h2>
            {session.senderName && (
              <p className="text-sm text-gray-500">
                Sent by {session.senderName}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            {/* Mode toggle */}
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setEditorMode("view")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  editorMode === "view"
                    ? "bg-white shadow text-blue-600"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <Eye className="w-4 h-4" />
                Sign
              </button>
              <button
                onClick={() => setEditorMode("edit")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  editorMode === "edit"
                    ? "bg-white shadow text-blue-600"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <Edit3 className="w-4 h-4" />
                Annotate
              </button>
            </div>

            {/* Progress */}
            <div className="flex items-center gap-2">
              <div className="text-sm text-gray-500">
                {filledCount} of {requiredFields.length} fields
              </div>
              <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            {pagesWithUnfilledFields.length > 0 && editorMode === "view" && (
              <button
                onClick={goToNextUnfilledField}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Next field →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main content - PDF Editor with signing field overlay */}
      <main className="flex-1 relative">
        <div className="h-full">
          {session.documentDownloadUrl && (
            <PDFEditor
              src={session.documentDownloadUrl}
              mode={editorMode}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              annotations={annotations}
              onAnnotationsChange={setAnnotations}
              showToolbar={editorMode === "edit"}
              height="calc(100vh - 220px)"
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
              renderOverlay={({
                pageNumber,
                pageWidth,
                pageHeight,
              }: {
                pageNumber: number;
                pageWidth: number;
                pageHeight: number;
              }) => {
                // Only show signing fields in view mode
                if (editorMode !== "view") return null;

                // Filter fields for this page
                const pageFields = session.fields.filter(
                  (f) => f.pageNumber === pageNumber,
                );
                if (pageFields.length === 0) return null;

                return (
                  <>
                    {pageFields.map((field) => {
                      const isFilled =
                        !!fieldValues[field.id] || field.isFilled;
                      const value = fieldValues[field.id];
                      return (
                        <div
                          key={field.id}
                          className={`absolute pointer-events-auto cursor-pointer border-2 rounded transition-all ${
                            isFilled
                              ? "border-green-500 bg-green-50/80"
                              : "border-blue-500 bg-blue-50/80 hover:bg-blue-100/80 animate-pulse"
                          }`}
                          style={{
                            left: field.x * pageWidth,
                            top: field.y * pageHeight,
                            width: field.width * pageWidth,
                            height: field.height * pageHeight,
                          }}
                          onClick={() =>
                            !isFilled &&
                            handleFieldClick(field.id, field.fieldType)
                          }
                        >
                          {isFilled && value ? (
                            isImageField(field.fieldType) ? (
                              <img
                                src={value}
                                alt="Signature"
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-sm text-gray-800 font-medium px-2">
                                {value}
                              </div>
                            )
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-blue-600 font-medium">
                              {getFieldIcon(field.fieldType)}
                              {getFieldLabel(field.fieldType)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                );
              }}
            />
          )}
        </div>
      </main>

      {/* Signature capture modal */}
      {activeFieldId &&
        activeFieldType &&
        (activeFieldType === "signature" || activeFieldType === "initials") && (
          <SignatureCanvas
            onSave={handleSignatureCapture}
            onCancel={() => {
              setActiveFieldId(null);
              setActiveFieldType(null);
            }}
          />
        )}

      {/* Text input modal */}
      {activeFieldId && activeFieldType === "text" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-4">Enter Text</h3>
            <input
              type="text"
              value={textInputValue}
              onChange={(e) => setTextInputValue(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
              placeholder="Enter your text here..."
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleTextSubmit()}
            />
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setActiveFieldId(null);
                  setActiveFieldType(null);
                  setTextInputValue("");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleTextSubmit}
                disabled={!textInputValue.trim()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => {
              const reason = window.prompt(
                "Please provide a reason for declining:",
              );
              if (reason) {
                declineSigning.mutate(reason);
              }
            }}
          >
            <X className="w-4 h-4 mr-2" />
            Decline to Sign
          </Button>
          <div className="flex items-center gap-3">
            {annotations.length > 0 && (
              <span className="text-sm text-gray-500">
                {annotations.length} annotation
                {annotations.length !== 1 ? "s" : ""} will be included
              </span>
            )}
            <Button
              variant="outline"
              onClick={() => {
                // Cancel = leave without declining. The signing link in
                // the email stays valid, so the user can resume later.
                // Prefer history.back when there's somewhere to go;
                // otherwise close the tab if scripts opened it, or fall
                // back to home.
                if (window.history.length > 1) {
                  window.history.back();
                } else {
                  window.close();
                  // window.close() is a no-op for tabs the user opened
                  // themselves; route to home as a last resort.
                  window.location.href = "/";
                }
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!canSubmit || submitSignature.isPending}
              onClick={handleSubmit}
            >
              <Check className="w-4 h-4 mr-2" />
              {submitSignature.isPending ? "Submitting..." : "Finish Signing"}
            </Button>
          </div>
        </div>
      </footer>

      {/* Signing Method Selection Modal */}
      {showSigningMethodModal && signingOptionsData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-2">
              Choose Signing Method
            </h3>
            <p className="text-gray-600 text-sm mb-4">
              Select how you would like to sign this document:
            </p>

            <div className="space-y-3 mb-6">
              {signingOptionsData.methods
                .filter((m) => m.enabled)
                .map((method) => {
                  const isExtensionMethod = method.id === "cac_extension";
                  const extensionAvailable =
                    signer.extensionReady && signer.nativeConnected;

                  return (
                    <button
                      key={method.id}
                      onClick={() => handleSigningMethodSelect(method.id)}
                      disabled={isExtensionMethod && !signer.extensionReady}
                      className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                        selectedSigningMethod === method.id
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-gray-300"
                      } ${isExtensionMethod && !signer.extensionReady ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        {method.id.startsWith("cac_") ? (
                          <CreditCard className="w-6 h-6 text-blue-600 mt-0.5" />
                        ) : (
                          <PenTool className="w-6 h-6 text-gray-600 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{method.name}</span>
                            {method.id.startsWith("cac_") && (
                              <ShieldCheck className="w-4 h-4 text-green-600" />
                            )}
                          </div>
                          <p className="text-sm text-gray-500 mt-1">
                            {method.description}
                          </p>
                          {method.requiresRedirect && (
                            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              You will be redirected to a secure signing page
                            </p>
                          )}
                          {isExtensionMethod && (
                            <div className="mt-2">
                              {signer.isChecking ? (
                                <p className="text-xs text-gray-400 flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Checking for extension...
                                </p>
                              ) : extensionAvailable ? (
                                <p className="text-xs text-green-600 flex items-center gap-1">
                                  <Check className="w-3 h-3" />
                                  Extension ready
                                  {signer.certificates.length > 0 &&
                                    ` (${signer.certificates.length} certificate${signer.certificates.length > 1 ? "s" : ""} found)`}
                                </p>
                              ) : !signer.extensionReady ? (
                                <p className="text-xs text-amber-600 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  Extension not installed
                                </p>
                              ) : (
                                <p className="text-xs text-amber-600 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  Native helper not connected
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>

            {signingOptionsData.cacDetected && (
              <div className="mb-4 p-3 bg-green-50 rounded-lg text-sm">
                <div className="flex items-center gap-2 text-green-700">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="font-medium">
                    CAC/PIV Certificate Detected
                  </span>
                </div>
                <p className="text-green-600 mt-1 text-xs">
                  {signingOptionsData.cacSubject}
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowSigningMethodModal(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Consent Modal */}
      {showConsentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-4">
              Confirm Your Signature
            </h3>
            <p className="text-gray-600 mb-6">
              By clicking "I Agree", you consent to signing this document
              electronically. Your signature will be legally binding.
            </p>
            {annotations.length > 0 && (
              <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">
                <p className="text-blue-700">
                  {annotations.length} annotation
                  {annotations.length !== 1 ? "s" : ""} will be included in the
                  signed document.
                </p>
              </div>
            )}
            {selectedSigningMethod.startsWith("cac_") &&
              signingOptionsData?.cacDetected && (
                <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm">
                  <div className="flex items-center gap-2 text-blue-700">
                    <ShieldCheck className="w-4 h-4" />
                    <span className="font-medium">
                      Signing with CAC/PIV Certificate
                    </span>
                  </div>
                  <p className="text-blue-600 mt-1 text-xs">
                    {signingOptionsData.cacSubject}
                  </p>
                </div>
              )}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowConsentModal(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={submitSignature.isPending}
                onClick={handleConsentConfirm}
              >
                {submitSignature.isPending
                  ? "Submitting..."
                  : "I Agree - Sign Document"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Certificate Selector Modal */}
      {showCertificateSelector && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-2">
              Select Signing Certificate
            </h3>
            <p className="text-gray-600 text-sm mb-4">
              Choose the certificate from your smart card to sign this document:
            </p>

            {extensionSigningError && (
              <div className="mb-4 p-3 bg-red-50 rounded-lg text-sm text-red-700">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {extensionSigningError}
                </div>
              </div>
            )}

            {signer.isChecking ? (
              <div className="py-8 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500 mx-auto mb-2" />
                <p className="text-sm text-gray-500">
                  Checking for smart card...
                </p>
              </div>
            ) : !signer.extensionReady ? (
              <div className="py-6 text-center">
                <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
                <p className="font-medium mb-2">Signing Extension Not Found</p>
                <p className="text-sm text-gray-500 mb-4">
                  Please install the Pdf Signing Agent browser extension.
                </p>
              </div>
            ) : !signer.nativeConnected ? (
              <div className="py-6 text-center">
                <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
                <p className="font-medium mb-2">Native Helper Not Connected</p>
                <p className="text-sm text-gray-500">
                  Please make sure the signing helper is installed and your
                  smart card is inserted.
                </p>
              </div>
            ) : signer.certificates.length === 0 ? (
              <div className="py-6 text-center">
                <CreditCard className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <p className="font-medium mb-2">No Certificates Found</p>
                <p className="text-sm text-gray-500 mb-4">
                  Please insert your CAC/PIV smart card and click refresh.
                </p>
                <button
                  onClick={() => signer.refreshCertificates()}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1 mx-auto"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
              </div>
            ) : (
              <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
                {signer.certificates.map((cert) => (
                  <button
                    key={cert.id}
                    onClick={() => signer.setSelectedCertificate(cert)}
                    className={`w-full p-3 rounded-lg border-2 text-left transition-all ${
                      signer.selectedCertificate?.id === cert.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="font-medium text-sm">{cert.subject}</div>
                    {cert.email && (
                      <div className="text-xs text-gray-500 mt-1">
                        {cert.email}
                      </div>
                    )}
                    <div className="text-xs text-gray-400 mt-1">
                      Expires: {new Date(cert.notAfter).toLocaleDateString()}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-3 mt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCertificateSelector(false);
                  setExtensionSigningError(null);
                }}
              >
                Cancel
              </Button>
              {signer.certificates.length > 0 && (
                <Button
                  className="flex-1"
                  disabled={!signer.selectedCertificate || isExtensionSigning}
                  onClick={handleCertificateSelect}
                >
                  {isExtensionSigning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Signing...
                    </>
                  ) : (
                    "Sign with Selected Certificate"
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Extension Signing Progress Modal */}
      {isExtensionSigning && !showCertificateSelector && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Signing Document</h3>
            <p className="text-gray-600 text-sm">
              Please enter your PIN when prompted by your smart card...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
