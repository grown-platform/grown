import { useSearchParams, useParams } from "react-router-dom";
import { CheckCircle, XCircle, Download } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/utils/apiClient";

interface SigningSession {
  documentId: string;
  documentName: string;
  documentDownloadUrl: string;
}

export function SigningCompletePage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const declined = searchParams.get("declined") === "true";

  // Fetch session to get download URL
  const { data } = useQuery({
    queryKey: ["signing-session", token],
    queryFn: () => apiClient.get<{ session: SigningSession }>(`/sign/${token}`),
    enabled: !declined && !!token,
    retry: false,
  });

  const handleDownload = () => {
    if (data?.session?.documentDownloadUrl) {
      window.open(data.session.documentDownloadUrl, "_blank");
    }
  };

  if (declined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-surface rounded-lg shadow-lg max-w-md w-full p-8 text-center">
          <XCircle className="w-16 h-16 text-danger mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Signing Declined</h1>
          <p className="text-text-muted mb-6">
            You have declined to sign this document. The document owner has been
            notified.
          </p>
          <p className="text-sm text-text-muted">You can close this window.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-surface rounded-lg shadow-lg max-w-md w-full p-8 text-center">
        <CheckCircle className="w-16 h-16 text-success mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Document Signed!</h1>
        <p className="text-text-muted mb-6">
          Thank you for signing. You will receive a copy of the signed document
          via email once all parties have signed.
        </p>
        <div className="space-y-3">
          <button
            onClick={handleDownload}
            className="w-full px-4 py-2 border border-border rounded-lg text-text hover:bg-background transition-colors flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download Copy
          </button>
          <p className="text-sm text-text-muted">You can close this window.</p>
        </div>
      </div>
    </div>
  );
}
