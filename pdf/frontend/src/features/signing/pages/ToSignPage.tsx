import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { apiClient } from "@/utils/apiClient";

interface Document {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
}

interface Signer {
  id: string;
  name: string;
  email: string;
  status: string;
}

interface DocumentToSign {
  document: Document;
  signer: Signer;
  signingUrl: string;
}

interface ToSignResponse {
  documents: DocumentToSign[];
  totalCount: number;
}

const signerStatusConfig: Record<string, { label: string; color: string }> = {
  SIGNER_STATUS_PENDING: {
    label: "Pending",
    color: "bg-yellow-100 text-yellow-700",
  },
  SIGNER_STATUS_VIEWED: { label: "Viewed", color: "bg-blue-100 text-blue-700" },
  SIGNER_STATUS_SIGNED: {
    label: "Signed",
    color: "bg-green-100 text-green-700",
  },
  SIGNER_STATUS_DECLINED: {
    label: "Declined",
    color: "bg-red-100 text-red-700",
  },
};

export function ToSignPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["documents-to-sign"],
    queryFn: () =>
      apiClient.get<ToSignResponse>(
        "/to-sign?email=lpick@pick.haus&page_size=100",
      ),
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
        <p>Failed to load documents to sign</p>
      </div>
    );
  }

  const documents = data?.documents ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Documents to Sign</h1>
        <p className="text-text-muted mt-1">
          Documents waiting for your signature
        </p>
      </div>

      {documents.length === 0 ? (
        <div className="bg-surface rounded-lg border border-border p-12 text-center">
          <FileText className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h2 className="text-lg font-medium mb-2">No documents waiting</h2>
          <p className="text-text-muted">
            When someone sends you a document to sign, it will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border shadow-sm">
          <ul className="divide-y divide-gray-100">
            {documents.map((item) => {
              const signerStatus =
                signerStatusConfig[item.signer.status] ??
                signerStatusConfig.SIGNER_STATUS_PENDING;
              return (
                <li key={item.document.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <FileText className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-medium">{item.document.name}</h3>
                        <p className="text-sm text-gray-500">
                          {item.document.description || "No description"}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${signerStatus.color}`}
                          >
                            {signerStatus.label}
                          </span>
                          <span className="text-xs text-gray-400">
                            Received{" "}
                            {new Date(
                              item.document.createdAt,
                            ).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div>
                      {item.signingUrl ? (
                        <a
                          href={item.signingUrl}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          Sign Now
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      ) : (
                        <span className="text-sm text-gray-400">
                          No signing link available
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
