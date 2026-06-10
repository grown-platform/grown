import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, AlertCircle, Trash2 } from "lucide-react";
import {
  Button,
  DataTable,
  Badge,
  CenterMessage,
  LoadingSpinner,
  type Column,
} from "tibui";
import { apiClient } from "@/utils/apiClient";

interface Document {
  id: string;
  name: string;
  description?: string;
  status: string;
  createdAt: string;
  signers: { name: string; status: string }[];
}

const statusConfig: Record<
  string,
  {
    label: string;
    variant: "default" | "cyan" | "success" | "warning" | "danger";
  }
> = {
  DOCUMENT_STATUS_DRAFT: { label: "Draft", variant: "default" },
  DOCUMENT_STATUS_PENDING: { label: "Pending", variant: "warning" },
  DOCUMENT_STATUS_IN_PROGRESS: { label: "In Progress", variant: "cyan" },
  DOCUMENT_STATUS_COMPLETED: { label: "Completed", variant: "success" },
  DOCUMENT_STATUS_DECLINED: { label: "Declined", variant: "danger" },
  DOCUMENT_STATUS_VOIDED: { label: "Voided", variant: "default" },
};

export function DocumentsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["documents"],
    queryFn: () =>
      apiClient.get<{ documents: Document[]; totalCount: number }>(
        "/documents?page_size=100",
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/documents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const handleDelete = (e: React.MouseEvent, doc: Document) => {
    e.stopPropagation();
    if (confirm(`Are you sure you want to delete "${doc.name}"?`)) {
      deleteMutation.mutate(doc.id);
    }
  };

  const columns: Column<Document>[] = [
    {
      key: "name",
      header: "Name",
      // Name takes all remaining space on mobile — there's no useful
      // truncation here when the title is the main thing the user reads.
      width: "flex-1 min-w-0",
      render: (doc) => (
        <div className="min-w-0">
          <Link
            to={`/documents/${doc.id}`}
            className="font-medium text-primary hover:underline break-words"
          >
            {doc.name}
          </Link>
          {doc.description && (
            <p className="text-sm text-gray-500 truncate">{doc.description}</p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "w-20 shrink-0",
      render: (doc) => {
        const status =
          statusConfig[doc.status] ?? statusConfig.DOCUMENT_STATUS_DRAFT;
        return <Badge variant={status.variant}>{status.label}</Badge>;
      },
    },
    {
      key: "createdAt",
      header: "Created",
      width: "hidden sm:flex w-28 shrink-0",
      render: (doc) => new Date(doc.createdAt).toLocaleDateString(),
    },
    {
      key: "signers",
      header: "Signers",
      width: "w-14 shrink-0 justify-center text-center",
      // Just the count — phones don't have room for "0 signers".
      render: (doc) => doc.signers?.length ?? 0,
    },
    {
      key: "actions",
      header: "",
      // Delete moves to the detail page on mobile so name has the room.
      width: "hidden sm:flex w-12 shrink-0",
      render: (doc) =>
        doc.status !== "DOCUMENT_STATUS_COMPLETED" ? (
          <button
            onClick={(e) => handleDelete(e, doc)}
            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Delete document"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        ) : null,
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <CenterMessage
        icon={<AlertCircle className="w-12 h-12" />}
        message="Error"
        subtext="Failed to load documents"
        error
      />
    );
  }

  const documents = data?.documents ?? [];

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <CenterMessage
          icon={<FileText className="w-12 h-12" />}
          message="No documents yet"
          subtext="Upload your first document to get started"
        />
        <Button onClick={() => navigate("/documents/new")} className="mt-4">
          <Plus className="w-4 h-4 mr-2" />
          Create Document
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Documents</h1>
        <Button onClick={() => navigate("/documents/new")}>
          <Plus className="w-4 h-4 mr-2" />
          New Document
        </Button>
      </div>

      <DataTable<Document>
        data={documents}
        columns={columns}
        keyField="id"
        onRowClick={(doc) => navigate(`/documents/${doc.id}`)}
      />
    </div>
  );
}
