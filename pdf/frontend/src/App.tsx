import { Routes, Route, Link, useLocation } from "react-router-dom";
import {
  FileText,
  PenTool,
  Menu,
  X,
  LogOut,
  User,
  Shield,
  ChevronLeft,
  ChevronRight,
  BookTemplate,
  FilePenLine,
  ArrowLeft,
} from "lucide-react";
import { useState } from "react";
import { DocumentsPage } from "./features/documents/pages/DocumentsPage";
import { CreateDocumentPage } from "./features/documents/pages/CreateDocumentPage";
import { DocumentDetailPage } from "./features/documents/pages/DocumentDetailPage";
import { PrepareDocumentPage } from "./features/documents/pages/PrepareDocumentPage";
import { EditDocumentPage } from "./features/documents/pages/EditDocumentPage";
import { TemplatesPage } from "./features/documents/pages/TemplatesPage";
import { EditorPage } from "./features/editor/pages/EditorPage";
import { SigningPage } from "./features/signing/pages/SigningPage";
import { SigningCompletePage } from "./features/signing/pages/SigningCompletePage";
import { ToSignPage } from "./features/signing/pages/ToSignPage";
import { AdminDocumentsPage } from "./features/admin/pages/AdminDocumentsPage";
import { useUser } from "./contexts/UserContext";

interface NavItemConfig {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const baseNavItems: NavItemConfig[] = [
  {
    label: "Documents",
    href: "/documents",
    icon: <FileText className="w-5 h-5" />,
  },
  {
    label: "To Sign",
    href: "/to-sign",
    icon: <PenTool className="w-5 h-5" />,
  },
  {
    label: "Templates",
    href: "/templates",
    icon: <BookTemplate className="w-5 h-5" />,
  },
  {
    label: "Editor",
    href: "/editor",
    icon: <FilePenLine className="w-5 h-5" />,
  },
];

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, isLoading, logout } = useUser();

  const navItems = user?.isSuperadmin
    ? [
        ...baseNavItems,
        {
          label: "All Documents",
          href: "/admin/documents",
          icon: <Shield className="w-5 h-5" />,
        },
      ]
    : baseNavItems;
  const location = useLocation();
  // Manual override: null = follow the route-based auto-collapse;
  // true/false = user clicked the toggle to explicitly set state.
  // Reset to null on route change so the auto-collapse kicks in again
  // when the user navigates somewhere new.
  const [manualCollapse, setManualCollapse] = useState<boolean | null>(null);
  const autoCollapsed =
    location.pathname.startsWith("/documents/") &&
    location.pathname !== "/documents";
  const isCollapsed = manualCollapse ?? autoCollapsed;

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-surface border-r border-border transform transition-all duration-200 ease-in-out lg:translate-x-0 flex flex-col ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${isCollapsed ? "lg:w-16" : "lg:w-64"}`}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-border">
          {/* Pdf logo doubles as the desktop sidebar toggle.
              Click → toggles the collapsed/expanded state. The chevron
              to the right of the wordmark indicates the direction the
              sidebar will move on click (left = will collapse, right =
              will expand). */}
          <button
            onClick={() => setManualCollapse(isCollapsed ? false : true)}
            className="flex items-center gap-2 text-xl font-semibold focus:outline-none"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <>
                <span className="hidden lg:flex items-center">
                  <span className="text-blue-600">PDF</span>
                  <ChevronRight className="w-4 h-4 ml-1 text-text-muted" />
                </span>
                <span className="lg:hidden flex items-center">
                  <span className="text-blue-600">PDF</span>
                </span>
              </>
            ) : (
              <span className="flex items-center">
                <span className="text-blue-600">PDF</span>
                <ChevronLeft className="w-4 h-4 ml-2 text-text-muted hidden lg:inline" />
              </span>
            )}
          </button>
          <button
            className="lg:hidden p-2 rounded-md hover:bg-background"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="p-2 space-y-1 flex-1">
          {navItems.map((item) => {
            const isActive =
              location.pathname === item.href ||
              location.pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                to={item.href}
                title={isCollapsed ? item.label : undefined}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? "bg-primary text-white"
                    : "text-text hover:bg-background"
                } ${isCollapsed ? "lg:justify-center lg:px-2" : ""}`}
                onClick={() => setSidebarOpen(false)}
              >
                {item.icon}
                <span className={isCollapsed ? "lg:hidden" : ""}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* User Profile Section */}
        {user && (
          <div className="p-2 border-t border-border">
            <div
              className={`flex items-center gap-3 mb-3 ${isCollapsed ? "lg:justify-center" : ""}`}
            >
              <div
                className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0"
                title={isCollapsed ? `${user.name} (${user.email})` : undefined}
              >
                <User className="w-5 h-5 text-blue-600" />
              </div>
              <div
                className={`flex-1 min-w-0 ${isCollapsed ? "lg:hidden" : ""}`}
              >
                <p className="text-sm font-medium text-text truncate">
                  {user.name}
                </p>
                <p className="text-xs text-text-muted truncate">{user.email}</p>
              </div>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors ${isCollapsed ? "lg:px-2" : ""}`}
            >
              <LogOut className="w-4 h-4" />
              <span className={isCollapsed ? "lg:hidden" : ""}>Sign out</span>
            </button>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div
        className={`transition-all duration-200 ${isCollapsed ? "lg:pl-16" : "lg:pl-64"}`}
      >
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center h-16 px-4 bg-surface border-b border-border lg:hidden">
          <button
            className="p-2 rounded-md hover:bg-background"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="ml-4 text-lg font-semibold">
            <span className="text-blue-600">PDF</span>
          </span>
        </header>

        {/* Page content. Use slim horizontal padding on mobile so tables
            and PDFs reach the edge of the screen; keep desktop padding. */}
        <main className="px-2 py-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

// FocusedEditorLayout is a minimal, signing-free shell for the PDF editor: a
// slim top bar (back to the workspace + a link into the signing app) and a
// full-width content area — no signing sidebar, so the editor stands on its own.
function FocusedEditorLayout({ children }: { children: React.ReactNode }) {
  const { isLoading } = useUser();
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center justify-between h-12 px-3 bg-surface border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {/* Absolute href leaves the PDF SPA back to the workspace root. */}
          <a
            href="/"
            className="flex items-center gap-1 text-sm text-text-muted hover:text-text"
            title="Back to workspace"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Workspace</span>
          </a>
          <span className="text-border">|</span>
          <span className="font-semibold flex items-center gap-1.5">
            <FilePenLine className="w-4 h-4 text-primary" />
            PDF Editor
          </span>
        </div>
        <Link
          to="/documents"
          className="text-sm text-text-muted hover:text-text whitespace-nowrap"
        >
          Documents &amp; signing →
        </Link>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}

function App() {
  return (
    <Routes>
      {/* Guest signing routes (no auth required) */}
      <Route path="/sign/:token" element={<SigningPage />} />
      <Route path="/sign/:token/complete" element={<SigningCompletePage />} />

      {/* Authenticated routes */}
      <Route
        path="/"
        element={
          <AuthenticatedLayout>
            <DocumentsPage />
          </AuthenticatedLayout>
        }
      />
      <Route
        path="/documents"
        element={
          <AuthenticatedLayout>
            <DocumentsPage />
          </AuthenticatedLayout>
        }
      />
      <Route
        path="/documents/new"
        element={
          <AuthenticatedLayout>
            <CreateDocumentPage />
          </AuthenticatedLayout>
        }
      />
      <Route
        path="/documents/:id"
        element={
          <AuthenticatedLayout>
            <DocumentDetailPage />
          </AuthenticatedLayout>
        }
      />
      <Route
        path="/documents/:id/edit"
        element={
          <AuthenticatedLayout>
            <EditDocumentPage />
          </AuthenticatedLayout>
        }
      />
      <Route
        path="/documents/:id/prepare"
        element={
          <AuthenticatedLayout>
            <PrepareDocumentPage />
          </AuthenticatedLayout>
        }
      />
      <Route
        path="/to-sign"
        element={
          <AuthenticatedLayout>
            <ToSignPage />
          </AuthenticatedLayout>
        }
      />
      <Route
        path="/templates"
        element={
          <AuthenticatedLayout>
            <TemplatesPage />
          </AuthenticatedLayout>
        }
      />
      <Route
        path="/editor"
        element={
          <FocusedEditorLayout>
            <EditorPage />
          </FocusedEditorLayout>
        }
      />
      <Route
        path="/admin/documents"
        element={
          <AuthenticatedLayout>
            <AdminDocumentsPage />
          </AuthenticatedLayout>
        }
      />
    </Routes>
  );
}

export default App;
