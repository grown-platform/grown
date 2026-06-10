import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, ChevronDown, ChevronRight } from "lucide-react";
import { apiClient } from "@/utils/apiClient";

interface AdminDoc {
  id: string;
  name: string;
  status: string;
  createdBy: string;
  createdAt: string;
}

interface AdminDocumentsResponse {
  documents: AdminDoc[];
}

interface AuditEntry {
  id: string;
  action: string;
  signerId?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

interface AuditResponse {
  entries: AuditEntry[];
}

function AuditRow({ docId }: { docId: string }) {
  const { data, isLoading, error } = useQuery<AuditResponse>({
    queryKey: ["audit", docId],
    queryFn: () => apiClient.get<AuditResponse>(`/documents/${docId}/audit`),
  });
  if (isLoading)
    return (
      <div className="px-3 py-2 text-text-muted text-sm">Loading audit…</div>
    );
  if (error)
    return (
      <div className="px-3 py-2 text-red-500 text-sm">
        Failed to load audit: {(error as Error).message}
      </div>
    );
  const entries = data?.entries ?? [];
  if (entries.length === 0)
    return (
      <div className="px-3 py-2 text-text-muted text-sm">No audit entries.</div>
    );
  return (
    <table className="w-full text-xs ml-6 my-2">
      <thead className="text-text-muted">
        <tr>
          <th className="text-left px-2 py-1">When</th>
          <th className="text-left px-2 py-1">Action</th>
          <th className="text-left px-2 py-1">Signer</th>
          <th className="text-left px-2 py-1">IP</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="border-t border-border/30">
            <td className="px-2 py-1">
              {new Date(e.createdAt).toLocaleString()}
            </td>
            <td className="px-2 py-1">{e.action}</td>
            <td className="px-2 py-1">{e.signerId ?? "—"}</td>
            <td className="px-2 py-1">{e.ipAddress ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AdminDocumentsPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { data, isLoading, error } = useQuery<AdminDocumentsResponse>({
    queryKey: ["admin", "documents"],
    queryFn: () => apiClient.get<AdminDocumentsResponse>("/admin/documents"),
  });

  if (isLoading) return <div className="p-6">Loading…</div>;
  if (error)
    return (
      <div className="p-6 text-red-500">
        Failed to load documents: {(error as Error).message}
      </div>
    );

  const docs = data?.documents ?? [];

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-semibold">All Documents (Admin)</h1>
      </div>
      <p className="text-text-muted mb-4 text-sm">
        Metadata and audit history only. PDF contents are not shown in this
        view. {docs.length} document{docs.length === 1 ? "" : "s"} total.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border text-text-muted">
            <tr>
              <th className="px-3 py-2 w-6"></th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => {
              const isOpen = expanded.has(d.id);
              return (
                <>
                  <tr
                    key={d.id}
                    className="border-b border-border/50 cursor-pointer hover:bg-surface"
                    onClick={() => toggle(d.id)}
                  >
                    <td className="px-3 py-2">
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </td>
                    <td className="px-3 py-2">{d.name}</td>
                    <td className="px-3 py-2">{d.status}</td>
                    <td className="px-3 py-2">{d.createdBy}</td>
                    <td className="px-3 py-2">
                      {new Date(d.createdAt).toLocaleString()}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${d.id}-audit`} className="bg-background/40">
                      <td colSpan={5}>
                        <AuditRow docId={d.id} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
