import { useEffect, useState, lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { CssVarsProvider, CssBaseline, CircularProgress, Box } from "@mui/joy";

import { grownTheme } from "./theme";
import { BrandProvider } from "./brand/Brand";
import { whoami } from "./api/client";
import type { User } from "./api/types";
import { Dashboard } from "./pages/Dashboard";
import { SignIn } from "./pages/SignIn";
import { ComingSoon } from "./pages/ComingSoon";
import { NotFound } from "./pages/NotFound";
import { FileList } from "./pages/drive/FileList";
import { FileViewer } from "./pages/drive/FileViewer";
import { EditorPlaceholder } from "./pages/EditorPlaceholder";

// Docs ships as its own code-split chunk (TipTap + Yjs) loaded on demand.
const DocsApp = lazy(() => import("./pages/docs"));
// Public share route: openable without an account, in any auth state.
const SharedDoc = lazy(() => import("./pages/docs/SharedDoc"));
// Public video watch route: openable without an account.
const VideoWatch = lazy(() => import("./pages/video/VideoWatch"));
// Sheets ships as its own chunk (FortuneSheet).
const SheetsApp = lazy(() => import("./pages/sheets"));
const SlidesApp = lazy(() => import("./pages/slides"));
const ContactsApp = lazy(() => import("./pages/contacts"));
const WhiteboardApp = lazy(() => import("./pages/whiteboard"));
const CalendarApp = lazy(() => import("./pages/calendar"));
const MailApp = lazy(() => import("./pages/mail"));
const ChatApp = lazy(() => import("./pages/chat"));
const MeetApp = lazy(() => import("./pages/meet"));
const TelephonyApp = lazy(() => import("./pages/telephony"));
const OrgSyncApp = lazy(() => import("./pages/orgsync"));
const FormsApp = lazy(() => import("./pages/forms"));
const PhotosApp = lazy(() => import("./pages/photos"));
const BooksApp = lazy(() => import("./pages/books"));
const VideoApp = lazy(() => import("./pages/video"));
const LiveApp = lazy(() => import("./pages/live"));
const LiveWatchPublic = lazy(() => import("./pages/live/WatchStream"));
const GamesApp = lazy(() => import("./pages/games"));
const MusicApp = lazy(() => import("./pages/music"));
const ProjectsApp = lazy(() => import("./pages/projects"));
const AdminApp = lazy(() => import("./pages/admin"));
const KeepApp = lazy(() => import("./pages/keep"));
const TasksApp = lazy(() => import("./pages/tasks"));
const SitesApp = lazy(() => import("./pages/sites"));
const SiteView = lazy(() => import("./pages/sites/SiteView"));
const GroupsApp = lazy(() => import("./pages/groups"));
const SettingsPage = lazy(() => import("./pages/settings"));
const CloudImportApp = lazy(() => import("./pages/cloudimport"));
const VPNApp = lazy(() => import("./pages/vpn"));
const AccessPage = lazy(() => import("./pages/access"));
const TicketsApp = lazy(() => import("./pages/tickets"));
// 3D model viewer (three.js) — code-split so its loaders load on demand.
const ThreeDApp = lazy(() => import("./pages/3d"));
// Translate ships as its own chunk; the ML libs (transformers.js,
// onnxruntime-web) are dynamically imported inside the page on first use.
const TranslateApp = lazy(() => import("./pages/translate"));
// Maps ships as its own chunk (Leaflet + its CSS live in this lazy route).
const MapsApp = lazy(() => import("./pages/maps"));
// Podcasts (early preview) — its own chunk.
const PodcastsApp = lazy(() => import("./pages/podcasts"));
// Public ticket intake: file a request without an account.
const TicketSubmitPublic = lazy(() => import("./pages/tickets/Submit"));

function ChunkFallback() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress />
    </Box>
  );
}

type AuthState =
  | { kind: "loading" }
  | { kind: "authenticated"; user: User; isPersonalOrg: boolean }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    whoami().then((r) => {
      if (cancelled) return;
      switch (r.status) {
        case "ok":
          setAuth({
            kind: "authenticated",
            user: r.data.user,
            isPersonalOrg: !!r.data.org.is_personal,
          });
          break;
        case "unauthenticated":
          setAuth({ kind: "unauthenticated" });
          break;
        case "error":
          setAuth({ kind: "error", message: r.message });
          break;
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Update avatar_url on the in-memory user when the Settings page uploads one.
  useEffect(() => {
    const handler = (e: Event) => {
      const { avatar_url } = (e as CustomEvent<{ avatar_url: string | null }>)
        .detail;
      setAuth((prev) => {
        if (prev.kind !== "authenticated") return prev;
        return {
          ...prev,
          user: { ...prev.user, avatar_url: avatar_url ?? undefined },
        };
      });
    };
    window.addEventListener("avatar-changed", handler);
    return () => window.removeEventListener("avatar-changed", handler);
  }, []);

  const shareRoute = (
    <Route
      path="/docs/share/:token"
      element={
        <Suspense fallback={<ChunkFallback />}>
          <SharedDoc />
        </Suspense>
      }
    />
  );

  // Published Sites pages are public — viewable without an account.
  const sitesViewRoute = (
    <Route
      path="/sites/view/:siteId"
      element={
        <Suspense fallback={<ChunkFallback />}>
          <SiteView />
        </Suspense>
      }
    />
  );

  // Public video share-link watch route.
  const videoWatchRoute = (
    <Route
      path="/video/watch/:token"
      element={
        <Suspense fallback={<ChunkFallback />}>
          <VideoWatch />
        </Suspense>
      }
    />
  );

  // Public live-stream watch — available signed-out for `public` streams.
  const liveWatchPublicRoute = (
    <Route
      path="/live/p/:id"
      element={
        <Suspense fallback={<ChunkFallback />}>
          <LiveWatchPublic user={null} publicRoute />
        </Suspense>
      }
    />
  );

  // Public ticket intake — anyone with a project's public link can file a
  // request, no account needed.
  const ticketSubmitRoute = (
    <Route
      path="/tickets/submit/:token"
      element={
        <Suspense fallback={<ChunkFallback />}>
          <TicketSubmitPublic />
        </Suspense>
      }
    />
  );

  // Games are public — playable without an account, sign-in optional. The
  // page adapts to a null user when signed out.
  const gamesRoute = (
    <Route
      path="/games/*"
      element={
        <Suspense fallback={<ChunkFallback />}>
          <GamesApp user={auth.kind === "authenticated" ? auth.user : null} />
        </Suspense>
      }
    />
  );

  return (
    <CssVarsProvider theme={grownTheme} defaultMode="light">
      <CssBaseline />
      <BrandProvider>
        {auth.kind === "loading" && null}
        {auth.kind !== "loading" && (
          <Routes>
            {/* Public — available even when signed out. More specific than
                /docs/*, so react-router ranks it ahead. */}
            {shareRoute}
            {sitesViewRoute}
            {videoWatchRoute}
            {liveWatchPublicRoute}
            {ticketSubmitRoute}
            {gamesRoute}
            {auth.kind === "authenticated" ? (
              <>
                <Route path="/" element={<Dashboard user={auth.user} />} />
                <Route
                  path="/docs/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <DocsApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/sheets/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <SheetsApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/slides/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <SlidesApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/contacts/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <ContactsApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/whiteboard/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <WhiteboardApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/calendar/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <CalendarApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/mail/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <MailApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/chat/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <ChatApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/meet/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <MeetApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/telephony/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <TelephonyApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/orgsync"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <OrgSyncApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/forms/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <FormsApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/photos/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <PhotosApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/books/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <BooksApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/video/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <VideoApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/live/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <LiveApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/music/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <MusicApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/projects/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <ProjectsApp user={auth.user} />
                    </Suspense>
                  }
                />
                {/* Admin is unreachable in a single-user (personal) org — redirect
                    to the dashboard. Team orgs render it (admin-gated server-side). */}
                <Route
                  path="/admin"
                  element={
                    auth.isPersonalOrg ? (
                      <Navigate to="/" replace />
                    ) : (
                      <Suspense fallback={<ChunkFallback />}>
                        <AdminApp user={auth.user} />
                      </Suspense>
                    )
                  }
                />
                <Route
                  path="/admin/:section"
                  element={
                    auth.isPersonalOrg ? (
                      <Navigate to="/" replace />
                    ) : (
                      <Suspense fallback={<ChunkFallback />}>
                        <AdminApp user={auth.user} />
                      </Suspense>
                    )
                  }
                />
                <Route
                  path="/keep/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <KeepApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/tasks/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <TasksApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/sites/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <SitesApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/groups/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <GroupsApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <SettingsPage user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/cloudimport/*"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <CloudImportApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/vpn"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <VPNApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/access"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <AccessPage user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/tickets"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <TicketsApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/coming-soon/:appId"
                  element={<ComingSoon user={auth.user} />}
                />
                <Route
                  path="/3d"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <ThreeDApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/translate"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <TranslateApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/maps"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <MapsApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route
                  path="/podcasts"
                  element={
                    <Suspense fallback={<ChunkFallback />}>
                      <PodcastsApp user={auth.user} />
                    </Suspense>
                  }
                />
                <Route path="/drive" element={<FileList user={auth.user} />} />
                <Route
                  path="/drive/file/:id"
                  element={<FileViewer user={auth.user} />}
                />
                {/* Per-type editor placeholders from Drive's file-open flow. The
                    full Sheets/Slides/PDF editors aren't built yet; the doc-type
                    placeholder coexists with the real Docs app at /docs/*. */}
                <Route
                  path="/sheets/:id"
                  element={
                    <EditorPlaceholder user={auth.user} appId="sheets" />
                  }
                />
                <Route
                  path="/docs/:id"
                  element={<EditorPlaceholder user={auth.user} appId="docs" />}
                />
                <Route
                  path="/slides/:id"
                  element={
                    <EditorPlaceholder user={auth.user} appId="slides" />
                  }
                />
                <Route
                  path="/pdf/:id"
                  element={<EditorPlaceholder user={auth.user} appId="pdf" />}
                />
                <Route path="/sign-in" element={<Navigate to="/" replace />} />
                <Route path="*" element={<NotFound />} />
              </>
            ) : auth.kind === "error" ? (
              <Route
                path="*"
                element={
                  <div role="alert" style={{ padding: 24 }}>
                    Error contacting backend: {auth.message}
                  </div>
                }
              />
            ) : (
              <Route path="*" element={<SignIn />} />
            )}
          </Routes>
        )}
      </BrandProvider>
    </CssVarsProvider>
  );
}
