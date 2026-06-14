// Package server wires gRPC and the grpc-gateway HTTP surface together
// for the grown-workspace backend.
package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/access"
	"code.pick.haus/grown/grown/internal/admin"
	"code.pick.haus/grown/grown/internal/adminanalytics"
	"code.pick.haus/grown/grown/internal/adminsecurity"
	"code.pick.haus/grown/grown/internal/adminusers"
	"code.pick.haus/grown/grown/internal/apitokens"
	"code.pick.haus/grown/grown/internal/audit"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/books"
	"code.pick.haus/grown/grown/internal/branding"
	"code.pick.haus/grown/grown/internal/calendar"
	"code.pick.haus/grown/grown/internal/chat"
	"code.pick.haus/grown/grown/internal/cloudimport"
	"code.pick.haus/grown/grown/internal/contacts"
	"code.pick.haus/grown/grown/internal/directory"
	"code.pick.haus/grown/grown/internal/docs"
	"code.pick.haus/grown/grown/internal/drive"
	"code.pick.haus/grown/grown/internal/email"
	"code.pick.haus/grown/grown/internal/eventmeet"
	"code.pick.haus/grown/grown/internal/forgejo"
	"code.pick.haus/grown/grown/internal/forms"
	"code.pick.haus/grown/grown/internal/gamerooms"
	"code.pick.haus/grown/grown/internal/games"
	"code.pick.haus/grown/grown/internal/geoaccess"
	"code.pick.haus/grown/grown/internal/groups"
	"code.pick.haus/grown/grown/internal/health"
	"code.pick.haus/grown/grown/internal/honeypot"
	"code.pick.haus/grown/grown/internal/keep"
	"code.pick.haus/grown/grown/internal/live"
	"code.pick.haus/grown/grown/internal/mail"
	"code.pick.haus/grown/grown/internal/meet"
	"code.pick.haus/grown/grown/internal/multiaccounts"
	"code.pick.haus/grown/grown/internal/music"
	"code.pick.haus/grown/grown/internal/notifications"
	"code.pick.haus/grown/grown/internal/orgadmin"
	"code.pick.haus/grown/grown/internal/orgadminhttp"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/orgsync"
	pdfapp "code.pick.haus/grown/grown/internal/pdf/app"
	"code.pick.haus/grown/grown/internal/photos"
	"code.pick.haus/grown/grown/internal/prefs"
	"code.pick.haus/grown/grown/internal/profile"
	"code.pick.haus/grown/grown/internal/projects"
	"code.pick.haus/grown/grown/internal/ratelimit"
	"code.pick.haus/grown/grown/internal/search"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/sheets"
	"code.pick.haus/grown/grown/internal/sites"
	"code.pick.haus/grown/grown/internal/slides"
	"code.pick.haus/grown/grown/internal/tasks"
	"code.pick.haus/grown/grown/internal/telephony"
	"code.pick.haus/grown/grown/internal/tickets"
	"code.pick.haus/grown/grown/internal/useravatar"
	"code.pick.haus/grown/grown/internal/users"
	"code.pick.haus/grown/grown/internal/video"
	"code.pick.haus/grown/grown/internal/visits"
	"code.pick.haus/grown/grown/internal/vpn"
	"code.pick.haus/grown/grown/internal/whiteboards"
	"code.pick.haus/grown/grown/internal/zitadelproxy"
)

// Config bundles the runtime identity and dependencies of the server.
type Config struct {
	Version   string
	Commit    string
	StartedAt time.Time

	AuthConfig      auth.Config
	OIDC            *auth.OIDC
	Sessions        *auth.SessionStore
	UsersRepo       *users.Repository
	OrgsRepo        *orgs.Repository
	DocsRepo        *docs.Repository
	SheetsRepo      *sheets.Repository
	SlidesRepo      *slides.Repository
	ContactsRepo    *contacts.Repository
	WhiteboardsRepo *whiteboards.Repository
	CalendarRepo    *calendar.Repository
	MailRepo        *mail.Repository
	// MailBackend overrides the mail backend (e.g. the IMAP/SMTP bridge to
	// mailcow). When nil, a Postgres-backed LocalBackend over MailRepo is used.
	MailBackend mail.Backend
	// MailBlobs is the blob store for mail attachments (shared with Drive).
	MailBlobs mail.BlobStore
	// GamesRepo + GamesBlobs back the user-imported HTML games feature. When
	// both are set, the /api/v1/games upload/list/content routes are enabled.
	GamesRepo  *games.Repository
	GamesBlobs games.BlobStore
	ChatRepo   *chat.Repository
	// ChatBlobs is the blob store for chat attachments (shared with Drive/Mail).
	ChatBlobs     chat.BlobStore
	MeetRepo      *meet.Repository
	TelephonyRepo *telephony.Repository
	FormsRepo     *forms.Repository
	PhotosRepo    *photos.Repository
	// PhotosBlobs / BooksBlobs / VideoBlobs are the media blob stores (shared with Drive).
	PhotosBlobs photos.BlobStore
	BooksRepo   *books.Repository
	BooksBlobs  books.BlobStore
	VideoRepo   *video.Repository
	VideoBlobs  video.BlobStore
	// VideoShareRepo backs video sharing (per-user grants + public links).
	VideoShareRepo *video.ShareRepository
	// VideoPlaylistRepo / VideoProgressRepo / VideoCaptionRepo back the playlist,
	// watch-progress, and caption features. nil disables each feature.
	VideoPlaylistRepo *video.PlaylistRepository
	VideoProgressRepo *video.ProgressRepository
	VideoCaptionRepo  *video.CaptionRepository
	// PublicHost is grown's public origin (e.g. https://workspace.pick.haus),
	// used to build absolute share-link URLs. Empty = relative URLs.
	PublicHost string
	MusicRepo  *music.Repository
	MusicBlobs music.BlobStore
	// MusicRadio is the radio recorder driving start/stop of station taps. nil
	// disables the radio control + proxy endpoints (stations still list).
	MusicRadio        music.RadioController
	ProjectsRepo      *projects.Repository
	KeepRepo          *keep.Repository
	TasksRepo         *tasks.Repository
	NotificationsRepo *notifications.Repository
	PrefsRepo         *prefs.Repository
	SitesRepo         *sites.Repository
	GroupsRepo        *groups.Repository
	SearchRepo        *search.Repository
	// AdminRepo backs the per-org service-enablement settings. AdminEmails is the
	// raw GROWN_ADMIN_EMAILS allowlist of bootstrap super-admins.
	AdminRepo   *admin.Repository
	AdminEmails string
	// OrgAdminRepo backs per-org admin roles (grown.org_admins). It powers the
	// authorization model (allowlist OR org_admins grant), the grant/revoke API,
	// and first-admin auto-bootstrap. nil disables role-based admin (allowlist only).
	OrgAdminRepo *orgadmin.Repository
	// SharingRepo backs per-object ACL grants (grown.object_grants) for Drive +
	// Docs: GrantAccess/RevokeAccess/ListGrants, "Shared with me", and the
	// cross-org read path. nil disables per-user sharing (link shares still work).
	SharingRepo *sharing.Repository
	// IssuerURL is the OIDC issuer stamped on grown users' oidc_issuer; used to
	// join Zitadel user ids (oidc_subject) to grown users for the isAdmin flag.
	// Falls back to AuthConfig.IssuerURL when empty.
	IssuerURL string
	// AuditRepo backs the cross-cutting audit trail. nil = auditing disabled.
	AuditRepo *audit.Repository
	// BrandingRepo backs per-org branding (logo + accent color) for the Admin
	// console's "Customize branding" feature and the SPA's load-time branding
	// fetch. nil disables the branding routes (the SPA then uses defaults).
	BrandingRepo *branding.Repository
	// BrandingBlobs is the blob store for uploaded org logos (shared with Drive).
	// nil disables logo upload/serving (accent color still works).
	BrandingBlobs *drive.Blobs
	// ZitadelAPIURL / ZitadelServiceToken configure the in-app security proxy to
	// the Zitadel User API v2. URL empty → falls back to AuthConfig.IssuerURL;
	// token empty → the proxy returns 503 (feature disabled).
	ZitadelAPIURL       string
	ZitadelServiceToken string

	// EmailSender is the transactional email sender (Resend). When nil (no
	// RESEND_API_KEY) invite emails are skipped but everything else still works.
	EmailSender *email.Sender
	DefaultOrg  orgs.Org
	Drive       *drive.Service

	// Pool is the pgxpool.Pool passed to the adminanalytics handler for
	// read-only org-scoped COUNT/SUM queries. When nil analytics returns 503.
	Pool *pgxpool.Pool

	// AvatarRepo / AvatarBlobs back per-user avatar upload + serving.
	AvatarRepo  *useravatar.Repository
	AvatarBlobs *drive.Blobs

	// BrowserAccountStore backs multi-account switching.
	BrowserAccountStore *multiaccounts.Store
	// AccessRepo backs the published-apps registry (grown.access_apps). nil
	// disables the /api/v1/access/* routes.
	AccessRepo *access.Repository

	// PDFFrontendURL / PDFBackendURL enable the integrated PDF (editor & sign)
	// app: requests to /pdf/* are reverse-proxied to the PDF frontend and
	// /pdf-api/* (prefix stripped) to the PDF backend, so the separate React-19
	// SPA + Go service live under grown's single origin. Empty disables.
	PDFFrontendURL string
	PDFBackendURL  string

	// PDFBuiltin, when non-nil, mounts the PDF signing backend IN-PROCESS inside
	// grown (gRPC services + gateway + raw-HTTP endpoints under /pdf-api/),
	// authenticated by grown's session via the auth bridge. It is constructed
	// only when the GROWN_PDF_BUILTIN flag is on (see cmd/server/main.go). When
	// nil (the default), the legacy /pdf-api reverse-proxy path is used and
	// behavior is byte-for-byte identical to before this feature.
	PDFBuiltin *pdfapp.App

	// PDFStaticDir is the path to the built PDF SPA (Vite base "/pdf/"). When
	// non-empty AND PDFBuiltin is active, grown serves the PDF frontend itself
	// from this dir for /pdf and /pdf/* (with SPA history fallback), replacing
	// the legacy PDFFrontendURL reverse-proxy. Empty leaves the reverse-proxy
	// behavior unchanged.
	PDFStaticDir string

	// LiveRepo backs multi-user live streaming. nil disables the LiveService and
	// the MediaMTX auth/ready webhooks. LiveURLs carries the public ingest/
	// playback bases used to build a stream's URLs (set from GROWN_LIVE_* env).
	LiveRepo *live.Repository
	LiveURLs live.URLConfig

	// LiveHLSURL / LiveWebRTCURL are the MediaMTX HLS (:8888) and WebRTC (:8889)
	// origins grown reverse-proxies under its own origin (/live-hls, /live-webrtc)
	// so the browser uses one origin. Empty disables the respective proxy.
	LiveHLSURL    string
	LiveWebRTCURL string

	// CRMURL is the internal origin of the integrated Twenty CRM (e.g.
	// http://127.0.0.1:3000). CRMHost is the public subdomain Host that triggers
	// proxying (e.g. crm.workspace.localtest.me:8080). When a request arrives
	// with Host == CRMHost, the WHOLE request (any path) is reverse-proxied to
	// Twenty at root — Twenty owns its origin. Empty disables.
	CRMURL  string
	CRMHost string

	// BoloMpURL is the internal origin of the Orona Bolo multiplayer server
	// (e.g. http://127.0.0.1:6173). grown reverse-proxies /bolo-mp/* to it,
	// stripping the /bolo-mp prefix (so /bolo-mp/match/<gid> -> /match/<gid>).
	// The endpoint is a WebSocket game server; Go's httputil.ReverseProxy
	// forwards the Connection: Upgrade handshake and streams the WS unbuffered.
	// Like the game-room relay it is link-gated, not account-gated, so it
	// bypasses grown's auth middleware. Empty disables the proxy.
	BoloMpURL string

	// ForgejoURL is the internal origin of a per-instance Forgejo (git hosting),
	// e.g. http://forgejo.<ns>.svc:3000. grown reverse-proxies /git/* to it with
	// the /git prefix stripped (so /git/user/login -> /user/login). Set Forgejo's
	// ROOT_URL to https://<host>/git/ so its generated links carry the /git prefix
	// back through this proxy. cloudflared can't strip a path prefix, but this
	// in-process proxy can — which is how the git host lives at <host>/git on the
	// same origin instead of a separate subdomain. Forgejo does its own auth, so
	// the path bypasses grown's auth middleware. Empty disables the proxy.
	ForgejoURL string

	// ForgejoProvisioner mirrors grown orgs/users into the per-instance Forgejo
	// (org auto-create + team membership) at /git access time. When nil or
	// unconfigured (no GROWN_FORGEJO_ADMIN_TOKEN) it is a no-op, which is the
	// case on prod pick.haus. See internal/forgejo.
	ForgejoProvisioner *forgejo.Provisioner

	// AssembleURL is the internal origin of the Assemble spatial-collaboration
	// app, e.g. http://assemble.<ns>.svc:8080. grown reverse-proxies /assemble/*
	// to it with the /assemble prefix stripped. Crucially this path BYPASSES
	// grown's auth wall: Assemble runs its own auth — SSO for signed-in workspace
	// users and GUEST access for joining rooms — so a visitor hitting /assemble
	// must NOT be redirected to grown's sign-in. Serving it on the same origin
	// lets signed-in users share the session. Empty disables the proxy.
	AssembleURL string

	// StaticDir is the path to the built React SPA. Empty disables static
	// serving (API-only mode for tests).
	StaticDir string

	// SiteName is the product name used in server-rendered link-preview
	// (Open Graph) metadata for the SPA shell — e.g. the og:title for the
	// homepage and the og:site_name everywhere. Defaults to "Grown"; set per
	// instance via GROWN_SITE_NAME (e.g. "Grown Platform" on grown.haus).
	SiteName string

	// DemoLogin configures the one-click demo login button. Disabled by default.
	DemoLogin auth.DemoConfig
	// ---- Cloud Import -------------------------------------------------------
	CloudImportRepo      *cloudimport.Repository
	CloudImportDriveRepo *drive.Repository
	CloudImportBlobs     *drive.Blobs
	// VPNHandler serves GET /api/v1/vpn/status.
	VPNHandler *vpn.Handler
}

// Server holds the gRPC server and the HTTP/REST gateway mux wrapped with middleware.
type Server struct {
	grpc        *grpc.Server
	httpHandler http.Handler
}

// New constructs a Server with all services registered.
func New(cfg Config) *Server {
	// Audit recorder resolves the caller's org/user/email from the auth context
	// (kept here so internal/audit stays free of internal/auth's gen/ dep).
	auditRec := audit.NewRecorder(cfg.AuditRepo, func(ctx context.Context) (audit.Actor, bool) {
		org, ok := auth.OrgFromContext(ctx)
		if !ok {
			return audit.Actor{}, false
		}
		a := audit.Actor{OrgID: org.ID}
		if u, ok := auth.UserFromContext(ctx); ok {
			a.UserID = u.ID
			a.Email = u.Email
		}
		return a, true
	})
	// One interceptor auto-audits every mutating RPC across all gRPC services.
	// When the PDF backend is mounted in-process (GROWN_PDF_BUILTIN), the PDF
	// auth bridge interceptors are CHAINED AFTER grown's audit interceptor so the
	// PDF handlers see grown's session identity. Off = grown's interceptors only
	// (unchanged), and no PDF service is registered.
	grpcOpts := []grpc.ServerOption{grpc.ChainUnaryInterceptor(audit.NewInterceptor(auditRec))}
	if cfg.PDFBuiltin != nil {
		grpcOpts = []grpc.ServerOption{
			grpc.ChainUnaryInterceptor(audit.NewInterceptor(auditRec), pdfapp.UnaryServerInterceptor()),
			grpc.ChainStreamInterceptor(pdfapp.StreamServerInterceptor()),
		}
	}
	grpcSrv := grpc.NewServer(grpcOpts...)
	if cfg.PDFBuiltin != nil {
		cfg.PDFBuiltin.RegisterGRPC(grpcSrv)
	}
	healthSvc := health.NewService(cfg.Version, cfg.Commit, cfg.StartedAt)
	grownv1.RegisterHealthServiceServer(grpcSrv, healthSvc)

	authSvc := auth.NewService(cfg.AuthConfig, cfg.OIDC, cfg.Sessions, cfg.UsersRepo, cfg.OrgsRepo)
	if cfg.OrgAdminRepo != nil {
		// Auto-bootstrap the first member of an org with no admins as that org's
		// first admin (see internal/auth/service.go Callback + docs/rbac-design.md).
		authSvc = authSvc.WithFirstAdminBootstrapper(cfg.OrgAdminRepo)
	}
	if cfg.BrowserAccountStore != nil {
		// Multi-account: register each new login's session under the browser's
		// account list so the user can switch without a new OIDC redirect.
		authSvc = authSvc.WithBrowserAccountAdder(cfg.BrowserAccountStore)
	}
	grownv1.RegisterAuthServiceServer(grpcSrv, authSvc)

	// orgAdminFromCtx reports whether the caller (resolved off the auth context)
	// holds an org_admins grant. Shared by the decoupled handlers' AdminCheckers.
	orgAdminFromCtx := func(ctx context.Context) bool {
		if cfg.OrgAdminRepo == nil {
			return false
		}
		u, ok := auth.UserFromContext(ctx)
		if !ok {
			return false
		}
		org, ok := auth.OrgFromContext(ctx)
		if !ok {
			return false
		}
		isAdmin, err := cfg.OrgAdminRepo.IsAdmin(ctx, org.ID, u.ID)
		return err == nil && isAdmin
	}

	if cfg.Drive != nil {
		grownv1.RegisterDriveServiceServer(grpcSrv, cfg.Drive)
	}

	var docsSvc *docs.Service
	var docsHub *docs.Hub
	if cfg.DocsRepo != nil {
		docsSvc = docs.NewService(cfg.DocsRepo)
		if cfg.SharingRepo != nil {
			// Per-user ACL grants for Docs (object_grants). nil notifier = no-op.
			docsSvc = docsSvc.WithSharing(cfg.SharingRepo, nil)
		}
		docsHub = docs.NewHub(cfg.DocsRepo)
		grownv1.RegisterDocsServiceServer(grpcSrv, docsSvc)
	}

	var sheetsSvc *sheets.Service
	var sheetsHub *sheets.Hub
	if cfg.SheetsRepo != nil {
		sheetsSvc = sheets.NewService(cfg.SheetsRepo)
		if cfg.SharingRepo != nil {
			// Per-user ACL grants for Sheets (object_grants).
			sheetsSvc = sheetsSvc.WithSharing(cfg.SharingRepo)
		}
		sheetsHub = sheets.NewHub()
		grownv1.RegisterSheetsServiceServer(grpcSrv, sheetsSvc)
	}

	var slidesSvc *slides.Service
	var slidesHub *slides.Hub
	if cfg.SlidesRepo != nil {
		slidesSvc = slides.NewService(cfg.SlidesRepo)
		if cfg.SharingRepo != nil {
			// Per-user ACL grants for Slides (object_grants).
			slidesSvc = slidesSvc.WithSharing(cfg.SharingRepo)
		}
		slidesHub = slides.NewHub()
		grownv1.RegisterSlidesServiceServer(grpcSrv, slidesSvc)
	}

	var contactsSvc *contacts.Service
	if cfg.ContactsRepo != nil {
		contactsSvc = contacts.NewService(cfg.ContactsRepo)
		grownv1.RegisterContactsServiceServer(grpcSrv, contactsSvc)
	}

	var whiteboardsSvc *whiteboards.Service
	var whiteboardsHub *whiteboards.Hub
	if cfg.WhiteboardsRepo != nil {
		whiteboardsSvc = whiteboards.NewService(cfg.WhiteboardsRepo)
		if cfg.SharingRepo != nil {
			// Per-user ACL grants for Whiteboards (object_grants).
			whiteboardsSvc = whiteboardsSvc.WithSharing(cfg.SharingRepo)
		}
		whiteboardsHub = whiteboards.NewHub()
		grownv1.RegisterWhiteboardsServiceServer(grpcSrv, whiteboardsSvc)
	}

	var calendarSvc *calendar.Service
	if cfg.CalendarRepo != nil {
		calendarSvc = calendar.NewService(cfg.CalendarRepo)
		grownv1.RegisterCalendarServiceServer(grpcSrv, calendarSvc)
	}

	var mailSvc *mail.Service
	mailBackend := cfg.MailBackend
	if mailBackend == nil && cfg.MailRepo != nil {
		mailBackend = mail.NewLocalBackend(cfg.MailRepo)
	}
	// Wire external delivery: recipients off the workspace mail domain are sent
	// via Resend so /mail reaches outside addresses (gmail etc.). Both the local
	// Postgres backend and the Mailu IMAP bridge use the same email.Sender.
	if cfg.EmailSender != nil {
		switch be := mailBackend.(type) {
		case *mail.LocalBackend:
			be.SetExternalSender(cfg.EmailSender)
		case *mail.Bridge:
			be.SetExternalSender(cfg.EmailSender)
		}
	}
	if mailBackend != nil {
		mailSvc = mail.NewService(mailBackend, cfg.MailRepo)
		grownv1.RegisterMailServiceServer(grpcSrv, mailSvc)
	}
	var mailAtt *mail.Attachments
	if cfg.MailRepo != nil && cfg.MailBlobs != nil {
		mailAtt = mail.NewAttachments(cfg.MailRepo, cfg.MailBlobs)
	}

	var gamesH *games.Games
	if cfg.GamesRepo != nil && cfg.GamesBlobs != nil {
		gamesH = games.New(cfg.GamesRepo, cfg.GamesBlobs)
	}

	var chatAtt *chat.Attachments
	if cfg.ChatRepo != nil && cfg.ChatBlobs != nil {
		chatAtt = chat.NewAttachments(cfg.ChatRepo, cfg.ChatBlobs)
	}

	var chatSvc *chat.Service
	var chatHub *chat.Hub
	if cfg.ChatRepo != nil {
		chatHub = chat.NewHub()
		chatSvc = chat.NewService(cfg.ChatRepo, chatHub)
		grownv1.RegisterChatServiceServer(grpcSrv, chatSvc)
	}

	var meetSvc *meet.Service
	var meetHub *meet.Hub
	var meetCodes *meet.CodesHandler
	var eventMeetHTTP *eventmeet.HTTPHandler
	if cfg.MeetRepo != nil {
		meetSvc = meet.NewService(cfg.MeetRepo)
		meetHub = meet.NewHub()
		grownv1.RegisterMeetServiceServer(grpcSrv, meetSvc)
		meetCodes = meet.NewCodesHandler(
			cfg.MeetRepo,
			func(r *http.Request) (string, bool) {
				org, ok := auth.OrgFromContext(r.Context())
				if !ok {
					return "", false
				}
				return org.ID, true
			},
			func(r *http.Request) (string, bool) {
				u, ok := auth.UserFromContext(r.Context())
				if !ok {
					return "", false
				}
				return u.ID, true
			},
		)

		// Per-event meeting links (calendar ↔ meet), plus first-join alerts to
		// invited attendees not yet in the call. Pure HTTP + SQL — no change to
		// the protobuf calendar Event.
		if cfg.Pool != nil {
			emRepo := eventmeet.NewRepository(cfg.Pool)
			eventMeetHTTP = eventmeet.NewHTTPHandler(
				emRepo,
				func(r *http.Request) (string, bool) {
					org, ok := auth.OrgFromContext(r.Context())
					if !ok {
						return "", false
					}
					return org.ID, true
				},
				func(r *http.Request) (string, bool) {
					u, ok := auth.UserFromContext(r.Context())
					if !ok {
						return "", false
					}
					return u.ID, true
				},
			)
			if cfg.NotificationsRepo != nil {
				notifRepo := cfg.NotificationsRepo
				meetHub.OnFirstJoin = func(roomID, joinerID, joinerName string) {
					ctx := context.Background()
					info, err := emRepo.JoinNotify(ctx, roomID)
					if err != nil {
						return // room not tied to an event, or lookup failed
					}
					title := info.EventTitle
					if title == "" {
						title = "the meeting"
					}
					for _, uid := range info.TargetUserIDs {
						if uid == joinerID {
							continue
						}
						_, _ = notifRepo.Create(ctx, notifications.CreateParams{
							OrgID:       info.OrgID,
							UserID:      uid,
							Type:        "meet_join",
							ActorUserID: joinerID,
							Title:       "Meeting started",
							Body:        joinerName + " joined “" + title + "”",
							TargetURL:   "/meet/" + info.Code,
						})
					}
				}
			}
		}
	}

	var telephonySvc *telephony.Service
	var telephonyHub *telephony.Hub
	var telephonyCalls *telephony.LogCallHandler
	if cfg.TelephonyRepo != nil {
		telephonyHub = telephony.NewHub()
		telephonySvc = telephony.NewService(cfg.TelephonyRepo, telephonyHub)
		grownv1.RegisterTelephonyServiceServer(grpcSrv, telephonySvc)
		telephonyCalls = telephony.NewLogCallHandler(
			cfg.TelephonyRepo,
			func(r *http.Request) (string, bool) {
				org, ok := auth.OrgFromContext(r.Context())
				if !ok {
					return "", false
				}
				return org.ID, true
			},
			func(r *http.Request) (string, bool) {
				u, ok := auth.UserFromContext(r.Context())
				if !ok {
					return "", false
				}
				return u.ID, true
			},
		)
	}

	var formsSvc *forms.Service
	if cfg.FormsRepo != nil {
		formsSvc = forms.NewService(cfg.FormsRepo)
		grownv1.RegisterFormsServiceServer(grpcSrv, formsSvc)
	}

	var photosSvc *photos.Service
	if cfg.PhotosRepo != nil {
		photosSvc = photos.NewService(cfg.PhotosRepo)
		grownv1.RegisterPhotosServiceServer(grpcSrv, photosSvc)
	}
	var photosMedia *photos.Media
	if cfg.PhotosRepo != nil && cfg.PhotosBlobs != nil {
		photosMedia = photos.NewMedia(cfg.PhotosRepo, cfg.PhotosBlobs)
	}

	var booksSvc *books.Service
	var booksFiles *books.Files
	if cfg.BooksRepo != nil {
		booksSvc = books.NewService(cfg.BooksRepo)
		grownv1.RegisterBooksServiceServer(grpcSrv, booksSvc)
		if cfg.BooksBlobs != nil {
			booksFiles = books.NewFiles(cfg.BooksRepo, cfg.BooksBlobs)
		}
	}

	var videoSvc *video.Service
	var videoHTTP *video.HTTP
	var videoCaptions *video.CaptionRepository
	if cfg.VideoRepo != nil && cfg.VideoBlobs != nil {
		videoSvc = video.NewService(cfg.VideoRepo, cfg.VideoShareRepo, cfg.VideoBlobs, cfg.PublicHost)
		if cfg.VideoPlaylistRepo != nil && cfg.VideoProgressRepo != nil && cfg.VideoCaptionRepo != nil {
			videoSvc = videoSvc.WithFeatureRepos(cfg.VideoPlaylistRepo, cfg.VideoProgressRepo, cfg.VideoCaptionRepo)
			videoCaptions = cfg.VideoCaptionRepo
		}
		videoHTTP = video.NewHTTP(cfg.VideoRepo, cfg.VideoShareRepo, cfg.VideoBlobs)
		grownv1.RegisterVideoServiceServer(grpcSrv, videoSvc)
	}

	var liveSvc *live.Service
	var liveWebhooks *live.Webhooks
	if cfg.LiveRepo != nil {
		liveSvc = live.NewService(cfg.LiveRepo, cfg.LiveURLs)
		liveWebhooks = live.NewWebhooks(cfg.LiveRepo)
		grownv1.RegisterLiveServiceServer(grpcSrv, liveSvc)
	}

	var musicSvc *music.Service
	var musicHTTP *music.HTTP
	if cfg.MusicRepo != nil && cfg.MusicBlobs != nil {
		musicSvc = music.NewService(cfg.MusicRepo, cfg.MusicBlobs)
		musicHTTP = music.NewHTTP(cfg.MusicRepo, cfg.MusicBlobs)
		if cfg.MusicRadio != nil {
			musicHTTP = musicHTTP.WithRadio(cfg.MusicRadio)
		}
		grownv1.RegisterMusicServiceServer(grpcSrv, musicSvc)
	}

	var projectsSvc *projects.Service
	var projectsHub *projects.Hub
	if cfg.ProjectsRepo != nil {
		projectsHub = projects.NewHub()
		projectsSvc = projects.NewService(cfg.ProjectsRepo, projectsHub)
		grownv1.RegisterProjectsServiceServer(grpcSrv, projectsSvc)
	}

	var adminSvc *admin.Service
	if cfg.AdminRepo != nil {
		adminSvc = admin.NewService(cfg.AdminRepo, cfg.AdminEmails)
		if cfg.OrgAdminRepo != nil {
			adminSvc = adminSvc.WithAdminChecker(func(ctx context.Context, orgID, userID string) bool {
				isAdmin, err := cfg.OrgAdminRepo.IsAdmin(ctx, orgID, userID)
				return err == nil && isAdmin
			})
		}
		grownv1.RegisterAdminServiceServer(grpcSrv, adminSvc)
	}

	var keepSvc *keep.Service
	if cfg.KeepRepo != nil {
		keepSvc = keep.NewService(cfg.KeepRepo)
		if cfg.SharingRepo != nil {
			keepSvc = keepSvc.WithSharing(cfg.SharingRepo)
		}
		grownv1.RegisterKeepServiceServer(grpcSrv, keepSvc)
	}

	// -- Tasks --
	var tasksSvc *tasks.Service
	if cfg.TasksRepo != nil {
		tasksSvc = tasks.NewService(cfg.TasksRepo)
		grownv1.RegisterTasksServiceServer(grpcSrv, tasksSvc)
	}
	// -- Notifications --
	var notifSvc *notifications.Service
	if cfg.NotificationsRepo != nil {
		notifSvc = notifications.NewService(cfg.NotificationsRepo)
		grownv1.RegisterNotificationsServiceServer(grpcSrv, notifSvc)
	}

	var sitesSvc *sites.Service
	if cfg.SitesRepo != nil {
		sitesSvc = sites.NewService(cfg.SitesRepo)
		grownv1.RegisterSitesServiceServer(grpcSrv, sitesSvc)
	}

	var groupsSvc *groups.Service
	if cfg.GroupsRepo != nil {
		groupsSvc = groups.NewService(cfg.GroupsRepo)
		grownv1.RegisterGroupsServiceServer(grpcSrv, groupsSvc)
	}

	var searchSvc *search.Service
	if cfg.SearchRepo != nil {
		searchSvc = search.NewService(cfg.SearchRepo)
		grownv1.RegisterSearchServiceServer(grpcSrv, searchSvc)
	}
	var prefsSvc *prefs.Service
	if cfg.PrefsRepo != nil {
		prefsSvc = prefs.NewService(cfg.PrefsRepo)
		grownv1.RegisterPreferencesServiceServer(grpcSrv, prefsSvc)
	}

	mux := runtime.NewServeMux(
		runtime.WithMarshalerOption(runtime.MIMEWildcard, &runtime.JSONPb{
			MarshalOptions:   protojson.MarshalOptions{UseProtoNames: true, EmitUnpopulated: true},
			UnmarshalOptions: protojson.UnmarshalOptions{DiscardUnknown: true},
		}),
		runtime.WithForwardResponseOption(redirectOnAuthURL),
		// Forward the "set-cookie" gRPC metadata key as the HTTP "Set-Cookie" header.
		// The auth service uses grpc.SendHeader(ctx, metadata.Pairs("set-cookie", ...))
		// to pass cookie directives through the gateway.
		runtime.WithOutgoingHeaderMatcher(func(key string) (string, bool) {
			if key == "set-cookie" {
				return "Set-Cookie", true
			}
			return runtime.DefaultHeaderMatcher(key)
		}),
	)
	_ = grownv1.RegisterHealthServiceHandlerServer(context.Background(), mux, healthSvc)
	_ = grownv1.RegisterAuthServiceHandlerServer(context.Background(), mux, authSvc)
	if docsSvc != nil {
		_ = grownv1.RegisterDocsServiceHandlerServer(context.Background(), mux, docsSvc)
	}
	if sheetsSvc != nil {
		_ = grownv1.RegisterSheetsServiceHandlerServer(context.Background(), mux, sheetsSvc)
	}
	if slidesSvc != nil {
		_ = grownv1.RegisterSlidesServiceHandlerServer(context.Background(), mux, slidesSvc)
	}
	if contactsSvc != nil {
		_ = grownv1.RegisterContactsServiceHandlerServer(context.Background(), mux, contactsSvc)
	}
	if whiteboardsSvc != nil {
		_ = grownv1.RegisterWhiteboardsServiceHandlerServer(context.Background(), mux, whiteboardsSvc)
	}
	if calendarSvc != nil {
		_ = grownv1.RegisterCalendarServiceHandlerServer(context.Background(), mux, calendarSvc)
	}
	if mailSvc != nil {
		_ = grownv1.RegisterMailServiceHandlerServer(context.Background(), mux, mailSvc)
	}
	if chatSvc != nil {
		_ = grownv1.RegisterChatServiceHandlerServer(context.Background(), mux, chatSvc)
	}
	if meetSvc != nil {
		_ = grownv1.RegisterMeetServiceHandlerServer(context.Background(), mux, meetSvc)
	}
	if telephonySvc != nil {
		_ = grownv1.RegisterTelephonyServiceHandlerServer(context.Background(), mux, telephonySvc)
	}
	if formsSvc != nil {
		_ = grownv1.RegisterFormsServiceHandlerServer(context.Background(), mux, formsSvc)
	}
	if photosSvc != nil {
		_ = grownv1.RegisterPhotosServiceHandlerServer(context.Background(), mux, photosSvc)
	}
	if booksSvc != nil {
		_ = grownv1.RegisterBooksServiceHandlerServer(context.Background(), mux, booksSvc)
	}
	if videoSvc != nil {
		_ = grownv1.RegisterVideoServiceHandlerServer(context.Background(), mux, videoSvc)
	}
	if liveSvc != nil {
		_ = grownv1.RegisterLiveServiceHandlerServer(context.Background(), mux, liveSvc)
	}
	if musicSvc != nil {
		_ = grownv1.RegisterMusicServiceHandlerServer(context.Background(), mux, musicSvc)
	}
	if projectsSvc != nil {
		_ = grownv1.RegisterProjectsServiceHandlerServer(context.Background(), mux, projectsSvc)
	}
	if adminSvc != nil {
		_ = grownv1.RegisterAdminServiceHandlerServer(context.Background(), mux, adminSvc)
	}
	if keepSvc != nil {
		_ = grownv1.RegisterKeepServiceHandlerServer(context.Background(), mux, keepSvc)
	}
	if tasksSvc != nil {
		_ = grownv1.RegisterTasksServiceHandlerServer(context.Background(), mux, tasksSvc)
	}
	if notifSvc != nil {
		_ = grownv1.RegisterNotificationsServiceHandlerServer(context.Background(), mux, notifSvc)
	}
	if sitesSvc != nil {
		_ = grownv1.RegisterSitesServiceHandlerServer(context.Background(), mux, sitesSvc)
	}
	if groupsSvc != nil {
		_ = grownv1.RegisterGroupsServiceHandlerServer(context.Background(), mux, groupsSvc)
	}
	if searchSvc != nil {
		_ = grownv1.RegisterSearchServiceHandlerServer(context.Background(), mux, searchSvc)
	}
	if prefsSvc != nil {
		_ = grownv1.RegisterPreferencesServiceHandlerServer(context.Background(), mux, prefsSvc)
	}

	if cfg.Drive != nil {
		_ = grownv1.RegisterDriveServiceHandlerServer(context.Background(), mux, cfg.Drive)
	}

	// The collab WebSocket cannot go through the grpc-gateway mux (it does not
	// speak HTTP upgrades), so intercept it ahead of the mux. Both share the
	// auth wrapper so the handler sees the caller's user/org in context.
	apiHandler := http.Handler(mux)
	if docsHub != nil || sheetsHub != nil || slidesHub != nil || whiteboardsHub != nil || chatHub != nil || meetHub != nil || telephonyHub != nil || projectsHub != nil {
		gateway := mux
		apiHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if docsHub != nil {
				if id, ok := docsConnectID(r.URL.Path); ok {
					serveDocsWS(w, r, id, cfg.DocsRepo, cfg.SharingRepo, docsHub)
					return
				}
				if r.URL.Path == "/api/v1/docs/convert" && r.Method == http.MethodPost {
					serveDocsConvert(w, r)
					return
				}
			}
			if sheetsHub != nil {
				if id, ok := sheetsConnectID(r.URL.Path); ok {
					serveSheetsWS(w, r, id, cfg.SheetsRepo, cfg.SharingRepo, sheetsHub)
					return
				}
			}
			if slidesHub != nil {
				if id, ok := slidesConnectID(r.URL.Path); ok {
					serveSlidesWS(w, r, id, cfg.SlidesRepo, cfg.SharingRepo, slidesHub)
					return
				}
			}
			if whiteboardsHub != nil {
				if id, ok := whiteboardsConnectID(r.URL.Path); ok {
					serveWhiteboardsWS(w, r, id, cfg.WhiteboardsRepo, cfg.SharingRepo, whiteboardsHub)
					return
				}
			}
			if chatHub != nil {
				if id, ok := chatConnectID(r.URL.Path); ok {
					serveChatWS(w, r, id, cfg.ChatRepo, chatHub)
					return
				}
			}
			if meetHub != nil {
				if id, ok := meet.ConnectPathID(r.URL.Path); ok {
					serveMeetWS(w, r, id, cfg.MeetRepo, meetHub)
					return
				}
			}
			if telephonyHub != nil {
				if telephony.ConnectPath(r.URL.Path) {
					serveTelephonyWS(w, r, telephonyHub)
					return
				}
			}
			if projectsHub != nil {
				if id, ok := projectsConnectID(r.URL.Path); ok {
					serveProjectsWS(w, r, id, cfg.ProjectsRepo, projectsHub)
					return
				}
			}
			gateway.ServeHTTP(w, r)
		})
	}

	// Per-user API tokens: authenticate "Authorization: Bearer grw_..." as the
	// owning user, gated to the token's scopes (enforced inside the middleware).
	apiTokensRepo := apitokens.NewRepository(cfg.Pool)
	var apiTokensHTTP *apitokens.HTTPHandler
	if apiTokensRepo != nil {
		apiTokensHTTP = apitokens.NewHTTPHandler(apiTokensRepo, apitokens.AuthFuncs{
			UserID: func(r *http.Request) (string, bool) {
				u, ok := auth.UserFromContext(r.Context())
				if !ok {
					return "", false
				}
				return u.ID, true
			},
			OrgID: func(r *http.Request) (string, bool) {
				o, ok := auth.OrgFromContext(r.Context())
				if !ok {
					return "", false
				}
				return o.ID, true
			},
			IsTokenAuth: func(r *http.Request) bool { return auth.IsTokenAuth(r.Context()) },
		})
	}

	// Org Sync: copy selected Drive files/folders + Contacts to another org the
	// caller administers. Reuses the drive repo/blobs already wired for import.
	var orgSyncHTTP *orgsync.HTTPHandler
	if orgSyncSvc := orgsync.NewService(cfg.CloudImportDriveRepo, cfg.CloudImportBlobs, cfg.ContactsRepo, cfg.OrgsRepo, cfg.OrgAdminRepo); orgSyncSvc != nil {
		orgSyncHTTP = orgsync.NewHTTPHandler(orgSyncSvc,
			func(r *http.Request) (string, bool) {
				o, ok := auth.OrgFromContext(r.Context())
				if !ok {
					return "", false
				}
				return o.ID, true
			},
			func(r *http.Request) (string, bool) {
				u, ok := auth.UserFromContext(r.Context())
				if !ok {
					return "", false
				}
				return u.ID, true
			},
		)
	}

	// Public multiplayer game-room relay: players join a room by code (shared
	// via link) + optional password; the hub broadcasts messages between them.
	// Game-agnostic and account-free, so any game can be made multiplayer.
	gameRoomsStore := gamerooms.NewStore(cfg.Pool)
	gameRoomsHub := gamerooms.NewHub(gameRoomsStore)
	gameRoomsHTTP := gamerooms.NewHTTPHandler(gameRoomsHub)

	// Honeypot / intrusion tripwire: decoy paths + a hidden-form-field trap that
	// legitimate users never touch. Hits record an instance-global security alert
	// (grown.honeypot_alerts, 0087). honeypotStore.Middleware wraps the router
	// early (decoy paths return an innocuous 404); the public form trap is mounted
	// at /api/v1/honeypot; the admin-gated listing is at /api/v1/admin/honeypot.
	// A nil pool yields a nil *Store, which every method tolerates (feature off).
	honeypotStore := honeypot.NewStore(cfg.Pool)

	// Visitor tracker: privacy-preserving (hashed-IP) daily distinct-visitor set
	// behind the public "N players in the last 24h" badge atop /games. A nil pool
	// yields a nil store, which every method tolerates (feature off). A background
	// pruner drops rows older than ~2 days so the table stays tiny.
	visitsStore := visits.NewStore(cfg.Pool)
	go visitsStore.StartPruner(context.Background())

	// Ticketing service (Jira-like): authenticated project/ticket management plus
	// an unauthenticated public intake surface for projects that opt into it.
	ticketsRepo := tickets.NewRepository(cfg.Pool)
	var ticketsHTTP *tickets.HTTPHandler
	var ticketsPublicHTTP *tickets.PublicHandler
	if ticketsRepo != nil {
		ticketsHTTP = tickets.NewHTTPHandler(ticketsRepo, tickets.AuthFuncs{
			UserID: func(r *http.Request) (string, bool) {
				u, ok := auth.UserFromContext(r.Context())
				if !ok {
					return "", false
				}
				return u.ID, true
			},
			OrgID: func(r *http.Request) (string, bool) {
				o, ok := auth.OrgFromContext(r.Context())
				if !ok {
					return "", false
				}
				return o.ID, true
			},
			UserName:  func(r *http.Request) string { u, _ := auth.UserFromContext(r.Context()); return u.DisplayName },
			UserEmail: func(r *http.Request) string { u, _ := auth.UserFromContext(r.Context()); return u.Email },
		})
		ticketsPublicHTTP = tickets.NewPublicHandler(ticketsRepo)
	}

	// Per-IP API rate limiting (outermost), with a stricter bucket on the auth
	// endpoints to blunt credential stuffing. Tunable via GROWN_RATELIMIT_*.
	// The block store makes 429s observable in the admin Rate-limiting panel
	// (grown.ratelimit_blocks, 0088); a nil pool yields a nil store (recording off).
	rateLimitStore := ratelimit.NewStore(cfg.Pool)
	rateLimiter := ratelimit.FromEnv().WithStore(rateLimitStore)
	authWrapped := rateLimiter.Middleware(
		auth.HTTPMiddleware(cfg.AuthConfig, cfg.Sessions, cfg.UsersRepo, cfg.OrgsRepo, cfg.DefaultOrg, apiTokensRepo)(apiHandler),
	)

	// Route /api/* and /healthz to the auth-wrapped gateway; everything
	// else falls through to the static SPA handler.
	static := StaticHandler(cfg.StaticDir, cfg.SiteName)
	driveAuthWrap := auth.HTTPMiddleware(cfg.AuthConfig, cfg.Sessions, cfg.UsersRepo, cfg.OrgsRepo, cfg.DefaultOrg, apiTokensRepo)

	// Zitadel User API v2 proxy for the in-app account-security panel. Runs
	// inside the auth middleware so the caller's oidc_subject is resolvable; the
	// proxy enforces that the path userId equals the caller's own subject.
	zitadelAPIURL := cfg.ZitadelAPIURL
	if zitadelAPIURL == "" {
		zitadelAPIURL = cfg.AuthConfig.IssuerURL
	}
	zproxy := zitadelproxy.New(zitadelAPIURL, cfg.ZitadelServiceToken,
		func(ctx context.Context) (string, bool) {
			u, ok := auth.UserFromContext(ctx)
			if !ok || u.OIDCSubject == "" {
				return "", false
			}
			return u.OIDCSubject, true
		}, nil)

	// Org user directory (member pickers): grown's known users, plus a live
	// Zitadel search (the full org roster) when the service token is set.
	dirHandler := directory.NewHandler(cfg.UsersRepo, cfg.AuthConfig.IssuerURL, zitadelAPIURL, cfg.ZitadelServiceToken)

	// Self-service profile editor: the authenticated user reads/writes their own
	// identity in Zitadel (first/last name, username, phone, email) via the
	// management v1 API. Caller-only — never a supplied id.
	profileHandler := profile.NewHandler(zitadelAPIURL, cfg.ZitadelServiceToken, cfg.UsersRepo).
		WithCaller(func(ctx context.Context) (users.User, bool) {
			u, ok := auth.UserFromContext(ctx)
			return u, ok
		})

	// Admin-gated audit-log viewer (org-scoped). Same trust model as adminUsers:
	// email in GROWN_ADMIN_EMAILS OR an org_admins grant (no open fallback).
	auditHandler := audit.NewHandler(cfg.AuditRepo, cfg.AdminEmails).
		WithResolver(func(ctx context.Context) (string, string, bool) {
			u, ok := auth.UserFromContext(ctx)
			if !ok {
				return "", "", false
			}
			orgID := ""
			if org, ok := auth.OrgFromContext(ctx); ok {
				orgID = org.ID
			}
			return u.Email, orgID, true
		}).
		WithAdminChecker(orgAdminFromCtx)

	// Admin user management: an admin-gated (GROWN_ADMIN_EMAILS) proxy to the
	// Zitadel User API v2 (create/update/(de)activate/password/delete). The
	// resolver reads the caller's email off the auth context (kept here so the
	// package stays free of internal/auth's gen/ dependency).
	issuer := cfg.IssuerURL
	if issuer == "" {
		issuer = cfg.AuthConfig.IssuerURL
	}
	adminUsers := adminusers.NewHandler(cfg.AdminEmails, zitadelAPIURL, cfg.ZitadelServiceToken).
		WithResolver(func(ctx context.Context) (string, bool) {
			u, ok := auth.UserFromContext(ctx)
			if !ok {
				return "", false
			}
			return u.Email, true
		}).
		WithAdminChecker(orgAdminFromCtx).
		// isPersonal drives the SPA's hide-Admin-in-personal-orgs gate (surfaced on
		// /api/v1/admin/whoami). Reads the org off the auth context.
		WithPersonalOrgChecker(func(ctx context.Context) bool {
			org, ok := auth.OrgFromContext(ctx)
			return ok && org.IsPersonal
		})
	if cfg.OrgAdminRepo != nil {
		adminUsers = adminUsers.WithRoster(&orgAdminRoster{
			orgAdmins: cfg.OrgAdminRepo,
			users:     cfg.UsersRepo,
			issuer:    issuer,
		})
	}
	if cfg.UsersRepo != nil {
		// Scope the Users list to the caller-org's members (oidc_subjects in
		// grown.users), and back the remove-from-org delete with a DB store that
		// drops the grown.users row (org_admins cascades) WITHOUT touching Zitadel.
		adminUsers = adminUsers.
			WithOrgMembers(func(ctx context.Context, q string) ([]string, bool) {
				org, ok := auth.OrgFromContext(ctx)
				if !ok || org.ID == "" {
					return nil, false
				}
				ids, err := cfg.UsersRepo.ListOIDCSubjectsByOrg(ctx, org.ID, issuer, q, 200)
				if err != nil {
					return nil, false
				}
				return ids, true
			}).
			WithMembershipStore(&orgMembershipStore{users: cfg.UsersRepo, issuer: issuer})
	}
	if cfg.EmailSender != nil {
		// Wire the Resend invite sender: when RESEND_API_KEY is set, a branded
		// invite email is dispatched after each new user is created with SendInvite=true.
		adminUsers = adminUsers.WithInviteSender(cfg.EmailSender.SendInvite)
	}

	// Bootstrap super-admin allowlist (lower-cased) shared by the org-admin HTTP
	// surface's IsAdmin closure: a caller is an admin iff their email is here OR
	// orgAdminFromCtx reports an org_admins grant. No open fallback.
	adminAllow := make(map[string]struct{})
	for _, e := range strings.Split(cfg.AdminEmails, ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			adminAllow[e] = struct{}{}
		}
	}

	// isAdminFromCtx combines the allowlist + org_admins check into a single
	// predicate reused by both orgadminhttp and adminanalytics.
	isAdminFromCtx := func(ctx context.Context) bool {
		email := ""
		if u, ok := auth.UserFromContext(ctx); ok {
			email = u.Email
		}
		if _, inAllow := adminAllow[strings.ToLower(strings.TrimSpace(email))]; inAllow {
			return true
		}
		return orgAdminFromCtx(ctx)
	}

	// Admin control plane for the public game-room relay: enable/disable
	// multiplayer, monitor live sessions, kick rooms/peers, view the audit log.
	// Same admin gate as audit/analytics (allowlist OR org_admins). Mounted
	// auth-wrapped under /api/v1/gamerooms/admin/* (the public WS/list relay
	// stays account-free).
	gameRoomsAdmin := gamerooms.NewAdminHandler(gameRoomsHub, gameRoomsStore, gamerooms.Identity{
		Caller: func(ctx context.Context) (string, bool) {
			u, ok := auth.UserFromContext(ctx)
			if !ok {
				return "", false
			}
			return u.Email, true
		},
		IsAdmin: isAdminFromCtx,
	})

	// Admin analytics — read-only org-scoped COUNT/SUM queries over every app
	// table. Same admin gate as audit / orgadminhttp (allowlist OR org_admins).
	analyticsHandler := adminanalytics.NewHandler(adminanalytics.Identity{
		Caller: func(ctx context.Context) (userID, email, orgID string, ok bool) {
			u, has := auth.UserFromContext(ctx)
			if !has {
				return "", "", "", false
			}
			orgID = ""
			if org, ok := auth.OrgFromContext(ctx); ok {
				orgID = org.ID
			}
			return u.ID, u.Email, orgID, true
		},
		IsAdmin: isAdminFromCtx,
	}).WithPool(cfg.Pool)
	// Surface the demo user's unique-login-IP count on the admin dashboard, but
	// only when the public demo login is actually enabled for this instance.
	if cfg.DemoLogin.Enabled && cfg.DemoLogin.Username != "" {
		analyticsHandler = analyticsHandler.WithDemoUsername(cfg.DemoLogin.Username)
	}

	// Geo-location access control — an instance-level (NOT per-org) edge policy
	// enforced against Cloudflare's CF-IPCountry header by geoMiddleware (wired
	// at the very bottom around the whole router). geoStore persists the single
	// grown.geo_access row (0085); geoCache is a TTL-bounded snapshot the
	// middleware reads on the hot path; geoHandler is the admin-gated GET/PUT at
	// /api/v1/admin/geo, which invalidates geoCache on write (reload-on-write).
	// Same admin gate as analytics/audit (allowlist OR org_admins).
	geoStore := geoaccess.NewStore(cfg.Pool)
	geoCache := geoaccess.NewCache(geoStore)
	geoHandler := geoaccess.NewHandler(geoStore, geoCache, geoaccess.Identity{
		Caller: func(ctx context.Context) (string, bool) {
			u, ok := auth.UserFromContext(ctx)
			if !ok {
				return "", false
			}
			return u.Email, true
		},
		IsAdmin: isAdminFromCtx,
	})

	// Honeypot admin surface — recent intrusion alerts + counts + clear. Same
	// admin gate as analytics/geo (allowlist OR org_admins). Instance-global data
	// (the traps fire on unauthenticated probers, so there is no org to scope to).
	honeypotAdmin := honeypot.NewAdminHandler(honeypotStore, honeypot.Identity{
		Caller: func(ctx context.Context) (string, bool) {
			u, ok := auth.UserFromContext(ctx)
			if !ok {
				return "", false
			}
			return u.Email, true
		},
		IsAdmin: isAdminFromCtx,
	})

	// Admin rate-limiting panel — read-only observability for the per-IP API
	// limiter: effective config (GROWN_RATELIMIT_*), recent 429 block events, and
	// the top offending IPs. Same admin gate as analytics/honeypot. Instance-global
	// data (the limiter keys on IP, not org).
	rateLimitAdmin := ratelimit.NewAdminHandler(rateLimiter, rateLimitStore, ratelimit.Identity{
		Caller: func(ctx context.Context) (string, bool) {
			u, ok := auth.UserFromContext(ctx)
			if !ok {
				return "", false
			}
			return u.Email, true
		},
		IsAdmin: isAdminFromCtx,
	})

	// Admin security console — reads/writes the caller-org's Zitadel security
	// policies (password complexity, login/MFA/passwordless, lockout) via the
	// service PAT. Same admin gate as analytics. The Caller returns the caller's
	// Zitadel subject (oidc_subject) so the handler can resolve the org's
	// resourceOwner for x-zitadel-orgid scoping (no cross-org access).
	securityHandler := adminsecurity.NewHandler(adminsecurity.Identity{
		Caller: func(ctx context.Context) (zitadelSubject, email, grownOrgID string, ok bool) {
			u, has := auth.UserFromContext(ctx)
			if !has {
				return "", "", "", false
			}
			grownOrgID = ""
			if org, ok := auth.OrgFromContext(ctx); ok {
				grownOrgID = org.ID
			}
			return u.OIDCSubject, u.Email, grownOrgID, true
		},
		IsAdmin: isAdminFromCtx,
	}, zitadelAPIURL, cfg.ZitadelServiceToken)

	// Org settings + branding + sessions: a decoupled, admin-gated HTTP surface
	// (see internal/orgadminhttp). Identity + admin-check are resolved off the
	// auth context (allowlist OR org_admins, same gate as adminUsers/audit). The
	// store interfaces are satisfied by thin adapters so orgadminhttp stays free
	// of internal/auth's gen/ dependency. Each store is passed as a typed nil
	// interface when its underlying repo is absent, so the handler's nil-guards
	// return 503 rather than dereferencing a nil pointer.
	var orgStore orgadminhttp.OrgStore
	if cfg.OrgsRepo != nil {
		orgStore = orgStoreAdapter{cfg.OrgsRepo}
	}
	var brandingStore orgadminhttp.BrandingStore
	if cfg.BrandingRepo != nil {
		brandingStore = brandingStoreAdapter{cfg.BrandingRepo}
	}
	var brandingBlobs orgadminhttp.BlobStore
	if cfg.BrandingBlobs != nil {
		brandingBlobs = brandingBlobAdapter{cfg.BrandingBlobs}
	}
	var sessionStore orgadminhttp.SessionStore
	if cfg.Sessions != nil {
		sessionStore = sessionStoreAdapter{cfg.Sessions}
	}
	orgAdminHandler := orgadminhttp.NewHandler(
		orgadminhttp.Identity{
			Caller: func(ctx context.Context) (userID, email, orgID, sessionToken string, ok bool) {
				u, has := auth.UserFromContext(ctx)
				if !has {
					return "", "", "", "", false
				}
				if org, ok := auth.OrgFromContext(ctx); ok {
					orgID = org.ID
				}
				tok, _ := auth.SessionTokenFromContext(ctx)
				return u.ID, u.Email, orgID, tok, true
			},
			IsAdmin: isAdminFromCtx,
		},
		orgStore,
		brandingStore,
		brandingBlobs,
		sessionStore,
	)

	// User avatar upload / serve — mirrors the org branding logo pattern.
	// Caller resolver: any authenticated user.
	avatarCaller := func(ctx context.Context) (userID string, ok bool) {
		u, has := auth.UserFromContext(ctx)
		if !has {
			return "", false
		}
		return u.ID, true
	}
	var avatarBlobStore useravatar.BlobStore
	if cfg.AvatarBlobs != nil {
		avatarBlobStore = avatarBlobAdapter{cfg.AvatarBlobs}
	}
	var avatarHandler *useravatar.Handler
	if cfg.AvatarRepo != nil {
		avatarHandler = useravatar.NewHandler(avatarCaller, cfg.AvatarRepo, avatarBlobStore)
	}

	// Multi-account switching handler.
	var multiAccountHandler *multiaccounts.Handler
	if cfg.BrowserAccountStore != nil && cfg.Sessions != nil {
		maCookieCfg := multiaccounts.CookieConfig{
			Name:     cfg.AuthConfig.CookieName,
			Domain:   cfg.AuthConfig.CookieDomain,
			Secure:   cfg.AuthConfig.CookieSecure,
			Lifetime: cfg.AuthConfig.SessionLifetime,
		}
		maSessionLookup := &sessionLookupAdapter{
			sessions: cfg.Sessions,
			users:    cfg.UsersRepo,
			orgs:     cfg.OrgsRepo,
		}
		maCaller := func(ctx context.Context) multiaccounts.CallerInfo {
			u, ok := auth.UserFromContext(ctx)
			if !ok {
				return multiaccounts.CallerInfo{}
			}
			orgID := ""
			if o, ok := auth.OrgFromContext(ctx); ok {
				orgID = o.ID
			}
			tok, _ := auth.SessionTokenFromContext(ctx)
			return multiaccounts.CallerInfo{UserID: u.ID, OrgID: orgID, Token: tok, Present: true}
		}
		multiAccountHandler = multiaccounts.NewHandler(maCaller, cfg.BrowserAccountStore, maSessionLookup, maCookieCfg)
		if cfg.AvatarRepo != nil {
			multiAccountHandler = multiAccountHandler.WithAvatarCheck(func(ctx context.Context, userID string) bool {
				_, err := cfg.AvatarRepo.Get(ctx, userID)
				return err == nil
			})
		}
	}
	// Published-apps registry: a decoupled, org-scoped HTTP surface (GET any
	// member; POST/PUT/DELETE admin-gated). Runs inside the auth middleware.
	// CallerFunc resolves (userID, orgID) off the auth context (same pattern as
	// other decoupled handlers). nil repo disables the routes.
	var accessHandler *access.Handler
	if cfg.AccessRepo != nil {
		accessHandler = access.NewHandler(cfg.AccessRepo).
			WithCaller(func(ctx context.Context) (string, string, bool) {
				u, ok := auth.UserFromContext(ctx)
				if !ok {
					return "", "", false
				}
				org, ok := auth.OrgFromContext(ctx)
				if !ok {
					return u.ID, "", false
				}
				return u.ID, org.ID, true
			}).
			WithAdminChecker(orgAdminFromCtx)
	}

	// Integrated PDF app reverse proxies (optional). The PDF app does its own
	// OIDC auth, so these bypass grown's auth middleware (like Drive's raw routes).
	pdfFrontend := newReverseProxy(cfg.PDFFrontendURL)               // serves /pdf/*
	pdfBackend := newStripPrefixProxy(cfg.PDFBackendURL, "/pdf-api") // serves /pdf-api/* → backend /*

	// In-process PDF backend (GROWN_PDF_BUILTIN). When on, /pdf-api/* is served by
	// grown itself: the /pdf-api prefix is stripped (so the PDF handler sees
	// /api/... exactly like the standalone), grown's auth middleware resolves the
	// session, and the HTTP bridge stamps the PDF auth context. This REPLACES the
	// reverse-proxy for /pdf-api (the proxy branch below is skipped while on).
	var pdfBuiltinHandler http.Handler
	if cfg.PDFBuiltin != nil {
		stripped := http.StripPrefix("/pdf-api", cfg.PDFBuiltin.HTTPHandler())
		// bridge (inner) runs after auth (outer) has populated the grown user.
		pdfBuiltinHandler = driveAuthWrap(pdfapp.HTTPMiddleware(stripped))
	}

	// In-process PDF FRONTEND (Phase 2c). When the built-in PDF backend is on
	// AND a static dir is configured, grown serves the PDF SPA itself for /pdf
	// and /pdf/* from PDFStaticDir (SPA history fallback), so no separate
	// pdf-frontend container is needed. This takes precedence over the legacy
	// PDFFrontendURL reverse-proxy below; when off (nil here), the reverse-proxy
	// branch is reached unchanged.
	var pdfStaticHandler http.Handler
	if cfg.PDFBuiltin != nil && cfg.PDFStaticDir != "" {
		pdfStaticHandler = PDFStaticHandler(cfg.PDFStaticDir)
	}

	// MediaMTX playback proxies: grown serves HLS + WebRTC under its own origin
	// so the browser uses a single origin (and org streams are gated by grown's
	// auth middleware — see below). Prefix is stripped so /live-hls/<path>/...
	// → MediaMTX /<path>/...
	liveHLS := newStripPrefixProxy(cfg.LiveHLSURL, "/live-hls")          // /live-hls/*    → :8888/*
	liveWebRTC := newStripPrefixProxy(cfg.LiveWebRTCURL, "/live-webrtc") // /live-webrtc/* → :8889/*

	// Integrated Twenty CRM reverse proxy (optional). Routed by Host, not path:
	// any request whose Host is the CRM subdomain is proxied whole to Twenty at
	// root. Go's httputil.ReverseProxy forwards Connection: Upgrade (WebSockets,
	// used by Twenty's GraphQL subscriptions) and streams bodies unbuffered, so
	// uploads pass through. Twenty does its own OIDC, so this bypasses grown's
	// auth middleware (like the PDF proxies).
	crmProxy := newReverseProxy(cfg.CRMURL)

	// Orona Bolo multiplayer (authoritative WS game server) reverse proxy.
	// /bolo-mp/* → the Bolo MP server with the /bolo-mp prefix stripped, so the
	// browser opens wss://<grown-host>/bolo-mp/match/<gid> and it reaches the
	// server's /match/<gid>. httputil.ReverseProxy forwards the WebSocket
	// Upgrade handshake and switches to unbuffered byte streaming on the 101,
	// so the 50Hz sim deltas pass through. Public/link-gated (no grown account).
	boloMpProxy := newStripPrefixProxy(cfg.BoloMpURL, "/bolo-mp")

	// /git/* → a per-instance Forgejo with the /git prefix stripped. Forgejo
	// serves at its root and ROOT_URL=https://<host>/git/ makes its links carry
	// the /git prefix; this proxy strips it on the way in (cloudflared can't), so
	// the git host lives at <host>/git on the same origin. Forgejo does its own
	// auth, so this bypasses grown's auth wall.
	forgejoProxy := newForgejoProxy(cfg.ForgejoURL, "/git", cfg.ForgejoProvisioner, isAdminFromCtx)
	// forgejoAuthWrap resolves the grown session (cookie or bearer) into the
	// request context WITHOUT requiring it — anonymous visitors pass through with
	// no user, so public Forgejo browsing still works. The proxy director then
	// reads the (optional) user/org from context to drive reverse-proxy SSO.
	forgejoAuthWrap := auth.HTTPMiddleware(cfg.AuthConfig, cfg.Sessions, cfg.UsersRepo, cfg.OrgsRepo, cfg.DefaultOrg, apiTokensRepo)

	// /assemble/* → the Assemble spatial-collaboration app, /assemble prefix
	// stripped. This BYPASSES grown's auth wall on purpose: Assemble does its own
	// auth (workspace SSO + guest room access), so visitors must reach it without
	// being bounced to grown's sign-in. Same origin = signed-in users share the
	// session. Configure Assemble's base path to /assemble.
	assembleProxy := newStripPrefixProxy(cfg.AssembleURL, "/assemble")

	// ---- Cloud Import (plain HTTP, no gRPC) ----------------------------------
	// Wire concrete app-repo closures into cloudimport via the injected-interface
	// pattern so cloudimport has no import-time dependency on internal/calendar,
	// internal/contacts, or internal/drive (avoids import cycles and keeps it
	// standalone-testable).
	var cloudImportHandler *cloudimport.Handler
	if cfg.CloudImportRepo != nil {
		var contactsImp cloudimport.ContactImporter
		if cfg.ContactsRepo != nil {
			contactsImp = cloudimport.NewContactImporter(func(ctx context.Context, orgID, userID string, f cloudimport.ContactFields) error {
				_, err := cfg.ContactsRepo.Create(ctx, orgID, userID, contacts.Fields{
					DisplayName: f.DisplayName,
					FirstName:   f.FirstName,
					LastName:    f.LastName,
					Company:     f.Company,
					JobTitle:    f.JobTitle,
					Emails:      f.Emails,
					Phones:      f.Phones,
					Labels:      f.Labels,
					Notes:       f.Notes,
				})
				return err
			})
		}
		var calendarImp cloudimport.EventImporter
		if cfg.CalendarRepo != nil {
			calendarImp = cloudimport.NewEventImporter(func(ctx context.Context, orgID, userID string, f cloudimport.EventFields) error {
				_, err := cfg.CalendarRepo.Create(ctx, orgID, userID, calendar.Fields{
					Title:       f.Title,
					Description: f.Description,
					Location:    f.Location,
					StartAt:     f.StartAt,
					EndAt:       f.EndAt,
					AllDay:      f.AllDay,
					Recurrence:  f.Recurrence,
				})
				return err
			})
		}
		var driveImp cloudimport.FileImporter
		if cfg.CloudImportDriveRepo != nil && cfg.CloudImportBlobs != nil {
			driveRepo := cfg.CloudImportDriveRepo
			driveBlobs := cfg.CloudImportBlobs
			driveImp = cloudimport.NewFileImporter(func(ctx context.Context, orgID, userID, parent, name, mimeType string, size int64, r io.Reader) error {
				key, err := drive.NewStorageKey()
				if err != nil {
					return err
				}
				if err := driveBlobs.Put(ctx, key, mimeType, size, r); err != nil {
					return err
				}
				if _, err := driveRepo.CreateFile(ctx, orgID, userID, parent, name, mimeType, key, size); err != nil {
					_ = driveBlobs.Delete(ctx, key)
					return err
				}
				return nil
			})
		}
		orch := cloudimport.NewOrchestrator(cfg.CloudImportRepo, contactsImp, calendarImp, driveImp)
		cloudImportHandler = cloudimport.NewHandler(
			cfg.CloudImportRepo,
			orch,
			func(ctx context.Context) (orgID, userID string, ok bool) {
				u, uok := auth.UserFromContext(ctx)
				o, ook := auth.OrgFromContext(ctx)
				if !uok || !ook {
					return "", "", false
				}
				return o.ID, u.ID, true
			},
		)
	}
	// In-app password login and one-click demo login. These are public (no
	// auth wrapper required — they ARE the sign-in mechanism). They talk to
	// Zitadel server-side via the service token, mint a grown session, and set
	// the session cookie directly.
	var zitadelClient *auth.ZitadelClient
	if cfg.ZitadelServiceToken != "" {
		apiURL := cfg.ZitadelAPIURL
		if apiURL == "" {
			apiURL = cfg.AuthConfig.IssuerURL
		}
		zitadelClient = auth.NewZitadelClient(apiURL, cfg.ZitadelServiceToken)
	}
	loginHandlers := auth.NewLoginHandlers(
		cfg.AuthConfig,
		zitadelClient,
		cfg.Sessions,
		cfg.UsersRepo,
		cfg.OrgsRepo,
		issuer,
	).WithDemoLoginAudit(func(r *http.Request, orgID, userID, email string) {
		// Demo sign-in is pre-auth (no session on the inbound request), so we pass
		// the resolved demo identity explicitly. Best-effort; a nil recorder or an
		// empty org is dropped by the recorder.
		auditRec.Record(r.Context(), audit.Event{
			OrgID:        orgID,
			ActorID:      userID,
			ActorEmail:   email,
			Service:      "auth",
			Action:       "demo-login",
			ResourceType: "session",
			Method:       r.Method + " " + r.URL.Path,
			Status:       "ok",
			IP:           r.Header.Get("X-Forwarded-For"),
			UserAgent:    r.UserAgent(),
		})
	})

	// auditMutations wraps an admin handler so that only MUTATING requests
	// (POST/PUT/PATCH/DELETE) are recorded to the org-scoped audit trail via
	// auditRec.Log — read-only GETs pass through unaudited so the log isn't
	// flooded with every console page-load. The wrapped handler still runs inside
	// driveAuthWrap at the call site, so the recorder resolves actor/org from the
	// auth context. Best-effort: a nil recorder yields the handler unchanged.
	auditMutations := func(service, action string, h http.Handler) http.Handler {
		audited := auditRec.Log(service, action, h)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
				audited.ServeHTTP(w, r)
			default:
				h.ServeHTTP(w, r)
			}
		})
	}

	router := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Host-based dispatch: anything on the CRM subdomain goes straight to
		// Twenty at root. Must run before the path-based branches so every path
		// (/, /auth/oidc/callback, /graphql, assets, ws upgrades) on the CRM host
		// reaches Twenty. r.Host carries the authority incl. port.
		if crmProxy != nil && cfg.CRMHost != "" && hostMatches(r.Host, cfg.CRMHost) {
			crmProxy.ServeHTTP(w, r)
			return
		}
		// PDF backend under /pdf-api/. When the in-process builtin is on, grown
		// serves it directly (auth + bridge); otherwise the legacy reverse-proxy
		// path is used. Exactly one claims the prefix.
		if pdfBuiltinHandler != nil && strings.HasPrefix(r.URL.Path, "/pdf-api/") {
			pdfBuiltinHandler.ServeHTTP(w, r)
			return
		}
		if pdfBackend != nil && strings.HasPrefix(r.URL.Path, "/pdf-api/") {
			pdfBackend.ServeHTTP(w, r)
			return
		}
		// PDF frontend under /pdf and /pdf/*. When the in-process static SPA is
		// configured (built-in + PDFStaticDir), grown serves the SPA itself;
		// otherwise the legacy reverse-proxy to PDFFrontendURL is used. /pdf-api/*
		// is already claimed above, so it never reaches here.
		if pdfStaticHandler != nil && (r.URL.Path == "/pdf" || strings.HasPrefix(r.URL.Path, "/pdf/")) {
			pdfStaticHandler.ServeHTTP(w, r)
			return
		}
		if pdfFrontend != nil && (r.URL.Path == "/pdf" || strings.HasPrefix(r.URL.Path, "/pdf/")) {
			pdfFrontend.ServeHTTP(w, r)
			return
		}
		// Drive's binary endpoints (multipart upload, blob download) are NOT
		// gRPC-gateway routes; they're raw HTTP. Route them through the auth
		// middleware then directly to the drive handlers. Path is normalized
		// (trailing slash trimmed) before matching, since some clients/proxies
		// append a slash that an exact `==` check would miss.
		if cfg.Drive != nil {
			path := strings.TrimRight(r.URL.Path, "/")
			if path == "/api/v1/drive/files/upload" && r.Method == http.MethodPost {
				auditRec.Log("drive", "upload", driveAuthWrap(cfg.Drive.UploadHandler())).ServeHTTP(w, r)
				return
			}
			if strings.HasPrefix(path, "/api/v1/drive/files/") && strings.HasSuffix(path, "/content") && r.Method == http.MethodGet {
				// Version download: /api/v1/drive/files/{id}/versions/{vid}/content
				if strings.Contains(path, "/versions/") {
					auditRec.Log("drive", "version-download", driveAuthWrap(cfg.Drive.VersionDownloadHandler())).ServeHTTP(w, r)
					return
				}
				// Current-content download: /api/v1/drive/files/{id}/content
				auditRec.Log("drive", "download", driveAuthWrap(cfg.Drive.DownloadHandler())).ServeHTTP(w, r)
				return
			}
		}
		// Mail attachments — raw multipart upload + blob download.
		if mailAtt != nil {
			path := strings.TrimRight(r.URL.Path, "/")
			if path == "/api/v1/mail/attachments" && r.Method == http.MethodPost {
				auditRec.Log("mail", "attachment-upload", driveAuthWrap(mailAtt.UploadHandler())).ServeHTTP(w, r)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/v1/mail/attachments/") && strings.HasSuffix(r.URL.Path, "/content") && r.Method == http.MethodGet {
				auditRec.Log("mail", "attachment-download", driveAuthWrap(mailAtt.DownloadHandler())).ServeHTTP(w, r)
				return
			}
		}
		// Imported HTML games — multipart upload + list + sandboxed content.
		// Untrusted HTML: ContentHandler sets nosniff + frame-ancestors CSP and
		// the frontend loads it only in a sandboxed iframe (no allow-same-origin).
		if gamesH != nil {
			path := strings.TrimRight(r.URL.Path, "/")
			if path == "/api/v1/games" && r.Method == http.MethodPost {
				auditRec.Log("games", "import", driveAuthWrap(gamesH.UploadHandler())).ServeHTTP(w, r)
				return
			}
			if path == "/api/v1/games" && r.Method == http.MethodGet {
				auditRec.Log("games", "list", driveAuthWrap(gamesH.ListHandler())).ServeHTTP(w, r)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/v1/games/") && strings.HasSuffix(r.URL.Path, "/content") && r.Method == http.MethodGet {
				auditRec.Log("games", "content", driveAuthWrap(gamesH.ContentHandler())).ServeHTTP(w, r)
				return
			}
		}
		// Mail raw source — "Show original" header inspection.
		if mailBackend != nil {
			p := strings.TrimRight(r.URL.Path, "/")
			if strings.HasPrefix(p, "/api/v1/mail/messages/") && strings.HasSuffix(p, "/raw") && r.Method == http.MethodGet {
				auditRec.Log("mail", "raw-source", driveAuthWrap(mail.RawHandler(mailBackend))).ServeHTTP(w, r)
				return
			}
		}
		// Chat attachments — raw multipart upload + blob download (mirrors mail).
		if chatAtt != nil {
			path := strings.TrimRight(r.URL.Path, "/")
			if path == "/api/v1/chat/attachments/upload" && r.Method == http.MethodPost {
				auditRec.Log("chat", "attachment-upload", driveAuthWrap(chatAtt.UploadHandler())).ServeHTTP(w, r)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/v1/chat/attachments/") && strings.HasSuffix(r.URL.Path, "/content") && r.Method == http.MethodGet {
				auditRec.Log("chat", "attachment-download", driveAuthWrap(chatAtt.DownloadHandler())).ServeHTTP(w, r)
				return
			}
		}
		// Photos — raw image upload + download (the /content suffix distinguishes
		// the download from the gRPC-gateway GET /api/v1/photos/{id}).
		if photosMedia != nil {
			path := strings.TrimRight(r.URL.Path, "/")
			if path == "/api/v1/photos/upload" && r.Method == http.MethodPost {
				auditRec.Log("photos", "upload", driveAuthWrap(photosMedia.UploadHandler())).ServeHTTP(w, r)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/v1/photos/") && strings.HasSuffix(r.URL.Path, "/content") && r.Method == http.MethodGet {
				auditRec.Log("photos", "download", driveAuthWrap(photosMedia.DownloadHandler())).ServeHTTP(w, r)
				return
			}
		}
		// Books — raw book-file + cover upload/download.
		if booksFiles != nil {
			path := strings.TrimRight(r.URL.Path, "/")
			if id, ok := books.FileID(path); ok && id != "" {
				switch r.Method {
				case http.MethodPost:
					auditRec.Log("books", "upload", driveAuthWrap(booksFiles.UploadFileHandler())).ServeHTTP(w, r)
					return
				case http.MethodGet:
					auditRec.Log("books", "download", driveAuthWrap(booksFiles.DownloadFileHandler())).ServeHTTP(w, r)
					return
				}
			}
			if id, ok := books.CoverID(path); ok && id != "" {
				switch r.Method {
				case http.MethodPost:
					auditRec.Log("books", "cover-upload", driveAuthWrap(booksFiles.UploadCoverHandler())).ServeHTTP(w, r)
					return
				case http.MethodGet:
					auditRec.Log("books", "cover-download", driveAuthWrap(booksFiles.CoverHandler())).ServeHTTP(w, r)
					return
				}
			}
		}
		// Video — raw multipart upload + range-capable stream/download + captions.
		if videoHTTP != nil {
			path := strings.TrimRight(r.URL.Path, "/")
			if path == "/api/v1/videos/upload" && r.Method == http.MethodPost {
				auditRec.Log("video", "upload", driveAuthWrap(videoHTTP.UploadHandler())).ServeHTTP(w, r)
				return
			}
			// Caption upload: must match before the generic /content route.
			if videoCaptions != nil && strings.HasSuffix(r.URL.Path, "/captions/upload") && r.Method == http.MethodPost {
				auditRec.Log("video", "caption_upload", driveAuthWrap(videoHTTP.CaptionUploadHandler(videoCaptions))).ServeHTTP(w, r)
				return
			}
			// Caption stream: /api/v1/videos/captions/{id}/content
			if videoCaptions != nil {
				if captionID, ok := video.CaptionID(r.URL.Path); ok && captionID != "" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
					auditRec.Log("video", "caption_stream", driveAuthWrap(videoHTTP.CaptionStreamHandler(videoCaptions))).ServeHTTP(w, r)
					return
				}
			}
			if strings.HasPrefix(r.URL.Path, "/api/v1/videos/") && strings.HasSuffix(r.URL.Path, "/content") && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
				auditRec.Log("video", "stream", driveAuthWrap(videoHTTP.StreamHandler())).ServeHTTP(w, r)
				return
			}
		}
		// Music — raw multipart upload + range-capable stream/download.
		if musicHTTP != nil {
			path := strings.TrimRight(r.URL.Path, "/")
			if path == "/api/v1/music/upload" && r.Method == http.MethodPost {
				auditRec.Log("music", "upload", driveAuthWrap(musicHTTP.UploadHandler())).ServeHTTP(w, r)
				return
			}
			// Radio: list / play / stop / retention / live stream proxy. Matched
			// before the generic /content stream so radio paths take precedence.
			if path == "/api/v1/music/radio/stations" && r.Method == http.MethodGet {
				auditRec.Log("music", "radio_stations", driveAuthWrap(musicHTTP.ListStationsHandler())).ServeHTTP(w, r)
				return
			}
			if _, action, ok := music.RadioStationID(r.URL.Path); ok {
				switch {
				case action == "play" && r.Method == http.MethodPost:
					auditRec.Log("music", "radio_play", driveAuthWrap(musicHTTP.PlayHandler())).ServeHTTP(w, r)
					return
				case action == "stop" && r.Method == http.MethodPost:
					auditRec.Log("music", "radio_stop", driveAuthWrap(musicHTTP.StopHandler())).ServeHTTP(w, r)
					return
				case action == "retention" && (r.Method == http.MethodGet || r.Method == http.MethodPut || r.Method == http.MethodPatch):
					auditRec.Log("music", "radio_retention", driveAuthWrap(musicHTTP.RetentionHandler())).ServeHTTP(w, r)
					return
				case action == "stream" && (r.Method == http.MethodGet || r.Method == http.MethodHead):
					driveAuthWrap(musicHTTP.StreamProxyHandler()).ServeHTTP(w, r)
					return
				}
			}
			if strings.HasPrefix(r.URL.Path, "/api/v1/music/") && strings.HasSuffix(r.URL.Path, "/content") && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
				auditRec.Log("music", "stream", driveAuthWrap(musicHTTP.StreamHandler())).ServeHTTP(w, r)
				return
			}
		}
		// Public video share-link routes — NOT auth-wrapped (token-validated).
		if videoHTTP != nil {
			if tok, ok := video.SharedContentToken(r.URL.Path); ok && tok != "" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
				videoHTTP.SharedStreamHandler().ServeHTTP(w, r)
				return
			}
			if tok, ok := video.SharedTokenID(strings.TrimRight(r.URL.Path, "/")); ok && tok != "" && r.Method == http.MethodGet {
				videoHTTP.SharedMetaHandler().ServeHTTP(w, r)
				return
			}
		}
		// In-app account security: proxy /api/zitadel/* to the Zitadel User API
		// v2. Auth-wrapped so the session user is in context; the proxy enforces
		// userId == caller's oidc_subject.
		if strings.HasPrefix(r.URL.Path, zitadelproxy.MountPrefix+"/") {
			driveAuthWrap(zproxy).ServeHTTP(w, r)
			return
		}
		// Admin-gated audit-log JSON listing.
		if r.URL.Path == "/api/v1/admin/audit" {
			driveAuthWrap(auditHandler).ServeHTTP(w, r)
			return
		}
		// Admin-gated org usage analytics (read-only COUNT/SUM over all app tables).
		if r.URL.Path == "/api/v1/admin/analytics" {
			driveAuthWrap(analyticsHandler).ServeHTTP(w, r)
			return
		}
		// Admin-gated geo-location access policy (GET/PUT). Instance-level edge
		// access control enforced by geoMiddleware against CF-IPCountry. This
		// path lives under /api/v1/admin/ so geoMiddleware always exempts it —
		// an admin can never lock themselves out of the policy editor.
		if r.URL.Path == "/api/v1/admin/geo" {
			driveAuthWrap(auditMutations("security", "geo-access-change", geoHandler)).ServeHTTP(w, r)
			return
		}
		// Admin-gated honeypot console: recent intrusion alerts + counts (GET) and
		// clear/acknowledge (DELETE). Under /api/v1/admin/ so geoMiddleware exempts
		// it. The traps that FEED it (decoy paths + /api/v1/honeypot) are public.
		if r.URL.Path == "/api/v1/admin/honeypot" {
			driveAuthWrap(auditMutations("security", "honeypot-clear", honeypotAdmin)).ServeHTTP(w, r)
			return
		}
		// Admin-gated rate-limiting panel: effective config + recent 429 blocks +
		// top offending IPs (read-only). Under /api/v1/admin/ so geoMiddleware
		// exempts it. Instance-global data (the limiter keys on IP, not org).
		if r.URL.Path == "/api/v1/admin/ratelimit" {
			driveAuthWrap(rateLimitAdmin).ServeHTTP(w, r)
			return
		}
		// Admin-gated security console: reads/writes Zitadel org policies
		// (password / MFA / lockout / passwordless) scoped to the caller's org.
		if strings.HasPrefix(r.URL.Path, "/api/v1/admin/security/") {
			driveAuthWrap(auditMutations("security", "security-policy-change", securityHandler)).ServeHTTP(w, r)
			return
		}
		// User avatar: upload (POST), serve (GET), delete (DELETE) for the caller's
		// own avatar; GET for any user's avatar (org member).
		if avatarHandler != nil {
			p := strings.TrimRight(r.URL.Path, "/")
			if p == "/api/v1/me/avatar" ||
				(strings.HasPrefix(p, "/api/v1/users/") && strings.HasSuffix(p, "/avatar")) {
				driveAuthWrap(avatarHandler).ServeHTTP(w, r)
				return
			}
		}
		// Multi-account switching: list browser's accounts, activate one, remove one.
		if multiAccountHandler != nil {
			p := strings.TrimRight(r.URL.Path, "/")
			if p == "/api/v1/me/accounts" ||
				(strings.HasPrefix(p, "/api/v1/me/accounts/") && strings.HasSuffix(p, "/activate")) ||
				(strings.HasPrefix(p, "/api/v1/me/accounts/") && !strings.Contains(strings.TrimPrefix(p, "/api/v1/me/accounts/"), "/")) {
				driveAuthWrap(multiAccountHandler).ServeHTTP(w, r)
				return
			}
		}
		// Org settings (rename), branding (logo + accent color), and sessions —
		// the decoupled, admin-gated orgadminhttp surface. The /admin/* paths are
		// admin-only; the /org/branding and /me/sessions paths are member routes
		// (the handler authorizes each branch itself). All auth-wrapped so the
		// caller's user/org/session-token are on the context. The branding logo
		// routes are audited (upload/download) like the other blob routes; the
		// rest are JSON config calls covered by the gRPC audit elsewhere.
		if p := strings.TrimRight(r.URL.Path, "/"); p == "/api/v1/admin/org" ||
			strings.HasPrefix(p, "/api/v1/admin/org/branding") ||
			p == "/api/v1/admin/sessions" || strings.HasPrefix(p, "/api/v1/admin/sessions/") ||
			p == "/api/v1/org/branding" || strings.HasPrefix(p, "/api/v1/org/branding/") ||
			p == "/api/v1/me/sessions" || strings.HasPrefix(p, "/api/v1/me/sessions/") {
			driveAuthWrap(auditMutations("admin", "org-settings-change", orgAdminHandler)).ServeHTTP(w, r)
			return
		}
		// Non-gated admin self-check: any authenticated member may ask whether
		// THEY are an admin (drives the dashboard "Add user" affordance). Must
		// precede the gated /users prefix.
		if r.URL.Path == "/api/v1/admin/whoami" {
			driveAuthWrap(http.HandlerFunc(adminUsers.WhoAmI)).ServeHTTP(w, r)
			return
		}
		// Admin user management (Zitadel-backed). Distinct path from the gRPC
		// AdminService's /api/v1/admin/service-settings.
		if strings.HasPrefix(r.URL.Path, "/api/v1/admin/users") {
			driveAuthWrap(auditMutations("admin", "user-management", adminUsers)).ServeHTTP(w, r)
			return
		}
		// Org user directory search (member pickers).
		if r.URL.Path == "/api/v1/directory" {
			driveAuthWrap(dirHandler).ServeHTTP(w, r)
			return
		}
		// VPN status (Tailscale integration). Auth-wrapped.
		if cfg.VPNHandler != nil && r.URL.Path == "/api/v1/vpn/status" {
			driveAuthWrap(cfg.VPNHandler).ServeHTTP(w, r)
			return
		}
		// Published-apps registry (Access feature). GET = any member; mutations admin-gated.
		if accessHandler != nil && strings.HasPrefix(r.URL.Path, access.MountPrefix+"/") {
			driveAuthWrap(accessHandler).ServeHTTP(w, r)
			return
		}
		// Self-service profile editor: GET/PATCH /api/v1/me/profile (auth-wrapped).
		if r.URL.Path == "/api/v1/me/profile" {
			driveAuthWrap(profileHandler).ServeHTTP(w, r)
			return
		}
		// MediaMTX → grown webhooks (server-to-server, NOT auth-wrapped). These
		// MUST precede the /api/ auth fallthrough. The auth webhook checks the
		// publish stream_key; the ready/notready hooks flip live/offline.
		if liveWebhooks != nil {
			if h, ok := liveWebhooks.Routes(r); ok {
				h.ServeHTTP(w, r)
				return
			}
		}
		// MediaMTX playback proxies under grown's origin. Auth-wrapped so only
		// signed-in org members reach MediaMTX (org-stream gating). Truly public
		// (signed-out) playback would require unwrapping these for public streams
		// — see the tradeoff note in internal/live/webhooks.go.
		if liveWebRTC != nil && strings.HasPrefix(r.URL.Path, "/live-webrtc/") {
			driveAuthWrap(liveWebRTC).ServeHTTP(w, r)
			return
		}
		if liveHLS != nil && strings.HasPrefix(r.URL.Path, "/live-hls/") {
			driveAuthWrap(liveHLS).ServeHTTP(w, r)
			return
		}
		// Meet short-code surface (create + resolve) — auth-wrapped, pure HTTP.
		if meetCodes != nil {
			if _, ok := meetCodes.Match(r.URL.Path); ok {
				driveAuthWrap(meetCodes).ServeHTTP(w, r)
				return
			}
		}
		// Per-event meeting link surface (/calendar/events/{id}/meet) — must be
		// matched before the grpc-gateway, which has no route for this path.
		if eventMeetHTTP != nil {
			if _, ok := eventMeetHTTP.Match(r.URL.Path); ok {
				driveAuthWrap(eventMeetHTTP).ServeHTTP(w, r)
				return
			}
		}
		// Per-user API token management (/api/v1/me/tokens) — auth-wrapped, pure
		// HTTP, matched before the grpc-gateway.
		if apiTokensHTTP != nil {
			if _, ok := apiTokensHTTP.Match(r.URL.Path); ok {
				driveAuthWrap(apiTokensHTTP).ServeHTTP(w, r)
				return
			}
		}
		// Org Sync transfer (/api/v1/orgsync/transfer) — auth-wrapped.
		if orgSyncHTTP != nil && orgSyncHTTP.Match(r.URL.Path) {
			driveAuthWrap(orgSyncHTTP).ServeHTTP(w, r)
			return
		}
		// Ticketing service (/api/v1/tickets/*) — auth-wrapped project/ticket API.
		if ticketsHTTP != nil && ticketsHTTP.Match(r.URL.Path) {
			driveAuthWrap(ticketsHTTP).ServeHTTP(w, r)
			return
		}
		// Telephony call-logging surface — auth-wrapped, pure HTTP.
		if telephonyCalls != nil {
			if telephonyCalls.Match(r.URL.Path) {
				driveAuthWrap(telephonyCalls).ServeHTTP(w, r)
				return
			}
		}
		// In-app password login — public, no auth wrapper needed.
		if r.URL.Path == "/api/v1/auth/login-password" {
			loginHandlers.PasswordLogin(w, r)
			return
		}
		// Demo login — capability probe (GET) + one-click sign-in (POST), public.
		if r.URL.Path == "/api/v1/auth/demo-login" {
			loginHandlers.DemoLogin(w, r)
			return
		}
		// Recently-updated games feed — public, read-only; drives the "NEW" badge
		// on the arcade. Stats the bundled games/*.html files (same StaticDir the
		// SPA + games are served from).
		if r.URL.Path == recentGamesPath {
			recentGamesHandler(cfg.StaticDir)(w, r)
			return
		}
		// Public 24h unique-visitor counter atop /games — no auth (same posture as
		// the recent-games feed). Returns {"unique_24h": N} from grown.visits.
		if r.URL.Path == visits.ActiveUsersPath {
			visitsStore.Handler().ServeHTTP(w, r)
			return
		}
		// Cloud Import — multipart upload + job-status polling (auth-wrapped).
		if cloudImportHandler != nil && strings.HasPrefix(r.URL.Path, "/api/v1/import") {
			driveAuthWrap(cloudImportHandler).ServeHTTP(w, r)
			return
		}
		// Game-room ADMIN control plane — auth-wrapped + admin-gated (the handler
		// enforces the admin check). Checked before the public relay so the more
		// specific /admin/* paths win.
		if gameRoomsAdmin.Match(r.URL.Path) {
			driveAuthWrap(gameRoomsAdmin).ServeHTTP(w, r)
			return
		}
		// Public "recently updated games" feed — read-only, no auth (the bundled
		// games are public too). Stats <StaticDir>/games/*.html so the /games
		// frontend can show a NEW badge on freshly-updated games.
		if r.URL.Path == recentGamesPath {
			recentGamesHandler(cfg.StaticDir).ServeHTTP(w, r)
			return
		}
		// Public honeypot form trap (POST /api/v1/honeypot). PUBLIC by design — the
		// point is to catch unauthenticated bots that fill a hidden form field a
		// human never would. Bypasses the auth wall; always returns 204 so a bot
		// gets no signal. The admin LISTING (/api/v1/admin/honeypot) stays gated.
		if r.URL.Path == "/api/v1/honeypot" {
			honeypotStore.FormHandler().ServeHTTP(w, r)
			return
		}
		// Public game-room WS relay — joinable by link, no workspace account, so
		// it must bypass the auth wall (its access control is code + password).
		if gameRoomsHTTP.Match(r.URL.Path) {
			gameRoomsHTTP.ServeHTTP(w, r)
			return
		}
		// Bolo multiplayer (Orona authoritative WS server) — reverse-proxied at
		// /bolo-mp/*. Link-gated (a 20-letter gid in the URL), no grown account,
		// so it bypasses the auth wall just like the game-room relay.
		if boloMpProxy != nil && strings.HasPrefix(r.URL.Path, "/bolo-mp/") {
			boloMpProxy.ServeHTTP(w, r)
			return
		}
		// Per-instance Forgejo (git hosting) at /git/* — reverse-proxied with the
		// /git prefix stripped. Forgejo does its own auth, so it bypasses the wall.
		if forgejoProxy != nil {
			if r.URL.Path == "/git" {
				http.Redirect(w, r, "/git/", http.StatusMovedPermanently)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/git/") {
				// Wrap with the auth middleware so the grown session is resolved
				// (optionally) into context for reverse-proxy SSO; the director
				// reads it. Anonymous requests still pass through unauthenticated.
				forgejoAuthWrap(forgejoProxy).ServeHTTP(w, r)
				return
			}
		}
		// Assemble (spatial collaboration) at /assemble/* — reverse-proxied,
		// prefix stripped, BYPASSING grown's auth wall so guests reach it without
		// a forced sign-in (Assemble handles SSO + guest access itself).
		if assembleProxy != nil {
			if r.URL.Path == "/assemble" {
				http.Redirect(w, r, "/assemble/", http.StatusMovedPermanently)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/assemble/") {
				assembleProxy.ServeHTTP(w, r)
				return
			}
		}
		// Public ticket intake (/api/v1/public/tickets/{token}) — unauthenticated
		// submission for projects that opted into a public intake link.
		if ticketsPublicHTTP != nil && ticketsPublicHTTP.Match(r.URL.Path) {
			ticketsPublicHTTP.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" {
			authWrapped.ServeHTTP(w, r)
			return
		}
		// Public documentation site at /docs (no auth). The bare path serves the
		// docs index directly (avoiding ServeFile's index.html redirect loop);
		// /docs/* files (css, images) fall through to the static handler.
		if r.URL.Path == "/docs" {
			http.Redirect(w, r, "/docs/", http.StatusMovedPermanently)
			return
		}
		if r.URL.Path == "/docs/" || r.URL.Path == "/docs/index.html" {
			serveStaticFile(w, r, cfg.StaticDir, "docs/index.html")
			return
		}
		static.ServeHTTP(w, r)
	})

	// Geo-location access control wraps the WHOLE router: every route (main app,
	// games area, all API + static) passes through geoMiddleware. When the policy
	// mode is off (the default) it is a no-op. When block/allow is active it
	// returns 403 for disallowed CF-IPCountry values — EXCEPT the always-exempt
	// recovery paths (/api/v1/admin/*, /api/v1/auth/*, health) so an admin can
	// never lock themselves out. Unknown/absent country headers fail open.
	// Visitor tracker wraps the router (inside geo/honeypot) so it observes real
	// navigations only — it records a hashed-IP daily visit for GET page/app
	// requests, skipping API/relay/static/bot noise (and decoy 404s, which the
	// honeypot layer short-circuits before this). Cheap, async, non-blocking.
	tracked := visitsStore.Middleware(router)
	geoMiddleware := geoCache.Middleware(tracked)

	// Honeypot decoy tripwire wraps the OUTERMOST layer so the fixed decoy paths
	// (/.env, /wp-login.php, …) are intercepted before anything else — recording
	// an alert and returning a plain 404 — while every real path falls straight
	// through to geoMiddleware/router. It only matches the exact decoy paths, so
	// it never shadows a real route, the geo middleware, or auth.
	honeypotMiddleware := honeypotStore.Middleware(geoMiddleware)

	return &Server{grpc: grpcSrv, httpHandler: honeypotMiddleware}
}

// orgAdminRoster adapts the org_admins + users repositories to the
// adminusers.AdminRoster interface, mapping Zitadel user ids (oidc_subject) to
// grown user ids and exposing grant/revoke/count for the admin-role API. It
// reads the caller's identity off the auth context (so adminusers stays free of
// internal/auth's gen/ dependency).
type orgAdminRoster struct {
	orgAdmins *orgadmin.Repository
	users     *users.Repository
	issuer    string
}

func (r *orgAdminRoster) CallerUserID(ctx context.Context) (string, bool) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return "", false
	}
	return u.ID, true
}

func (r *orgAdminRoster) CallerOrgID(ctx context.Context) (string, bool) {
	org, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", false
	}
	return org.ID, true
}

// GrownUserIDForZitadel resolves a Zitadel user id (oidc_subject) to a grown
// user id within orgID. If the user has never signed into grown, a minimal grown
// row is provisioned (empty email/display_name, enriched on their next sign-in)
// so an admin can grant the role before the user's first login.
func (r *orgAdminRoster) GrownUserIDForZitadel(ctx context.Context, orgID, zitadelID string) (string, error) {
	u, err := r.users.GetByOIDC(ctx, orgID, r.issuer, zitadelID)
	if err == nil {
		return u.ID, nil
	}
	if !errors.Is(err, users.ErrNotFound) {
		return "", err
	}
	provisioned, perr := r.users.UpsertByOIDC(ctx, users.UpsertInput{
		OrgID: orgID, OIDCIssuer: r.issuer, OIDCSubject: zitadelID,
	})
	if perr != nil {
		return "", perr
	}
	return provisioned.ID, nil
}

func (r *orgAdminRoster) AdminZitadelIDs(ctx context.Context, orgID string, zitadelIDs []string) (map[string]bool, error) {
	return r.orgAdmins.AdminUserIDsForZitadel(ctx, orgID, r.issuer, zitadelIDs)
}

func (r *orgAdminRoster) Grant(ctx context.Context, orgID, targetUserID, byUserID string) error {
	return r.orgAdmins.GrantAdmin(ctx, orgID, targetUserID, byUserID)
}

func (r *orgAdminRoster) Revoke(ctx context.Context, orgID, targetUserID string) error {
	return r.orgAdmins.RevokeAdmin(ctx, orgID, targetUserID)
}

// orgMembershipStore adapts the users repository to adminusers.OrgMembershipStore
// for the remove-from-org delete. It deletes the grown.users row for a Zitadel id
// in the caller's org (org_admins cascades via its ON DELETE CASCADE FK). It
// NEVER touches Zitadel.
type orgMembershipStore struct {
	users  *users.Repository
	issuer string
}

func (s *orgMembershipStore) RemoveFromOrg(ctx context.Context, orgID, zitadelID string) (bool, error) {
	_, removed, err := s.users.DeleteByOIDC(ctx, orgID, s.issuer, zitadelID)
	return removed, err
}

func (r *orgAdminRoster) CountAdmins(ctx context.Context, orgID string) (int, error) {
	return r.orgAdmins.CountAdmins(ctx, orgID)
}

// ---- orgadminhttp store adapters -------------------------------------------
// These thin wrappers map grown's concrete repos/blob store to the narrow
// interface types orgadminhttp declares, so that package stays decoupled from
// gen/ + internal/auth. A nil underlying repo yields a no-op/"unavailable" via
// the handler's own nil-store guards (the adapter value is non-nil but its
// field is nil, so we guard here too).

type orgStoreAdapter struct{ repo *orgs.Repository }

func (a orgStoreAdapter) UpdateDisplayName(ctx context.Context, id, displayName string) (orgadminhttp.Org, error) {
	o, err := a.repo.UpdateDisplayName(ctx, id, displayName)
	if err != nil {
		return orgadminhttp.Org{}, err
	}
	return orgadminhttp.Org{ID: o.ID, Slug: o.Slug, DisplayName: o.DisplayName}, nil
}

type brandingStoreAdapter struct{ repo *branding.Repository }

func (a brandingStoreAdapter) Get(ctx context.Context, orgID string) (orgadminhttp.Branding, error) {
	b, err := a.repo.Get(ctx, orgID)
	if err != nil {
		return orgadminhttp.Branding{}, err
	}
	return orgadminhttp.Branding{
		OrgID: b.OrgID, LogoBlobKey: b.LogoBlobKey, LogoMIME: b.LogoMIME, AccentColor: b.AccentColor, ProductName: b.ProductName,
	}, nil
}

func (a brandingStoreAdapter) SetAccentColor(ctx context.Context, orgID, accent string) error {
	return a.repo.SetAccentColor(ctx, orgID, accent)
}

func (a brandingStoreAdapter) SetProductName(ctx context.Context, orgID, name string) error {
	return a.repo.SetProductName(ctx, orgID, name)
}

func (a brandingStoreAdapter) SetLogo(ctx context.Context, orgID, blobKey, mime string) error {
	return a.repo.SetLogo(ctx, orgID, blobKey, mime)
}

type brandingBlobAdapter struct{ blobs *drive.Blobs }

func (a brandingBlobAdapter) Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error {
	return a.blobs.Put(ctx, key, mimeType, size, body)
}

func (a brandingBlobAdapter) Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error) {
	return a.blobs.Get(ctx, key)
}

type sessionStoreAdapter struct{ store *auth.SessionStore }

func (a sessionStoreAdapter) ListByOrg(ctx context.Context, orgID, currentToken string) ([]orgadminhttp.SessionInfo, error) {
	infos, err := a.store.ListByOrg(ctx, orgID, currentToken)
	if err != nil {
		return nil, err
	}
	return toHTTPSessions(infos), nil
}

func (a sessionStoreAdapter) ListByUser(ctx context.Context, userID, currentToken string) ([]orgadminhttp.SessionInfo, error) {
	infos, err := a.store.ListByUser(ctx, userID, currentToken)
	if err != nil {
		return nil, err
	}
	return toHTTPSessions(infos), nil
}

func (a sessionStoreAdapter) RevokeByOrgAndID(ctx context.Context, orgID, id string) (bool, error) {
	return a.store.RevokeByOrgAndID(ctx, orgID, id)
}

func (a sessionStoreAdapter) RevokeByUserAndID(ctx context.Context, userID, id string) (bool, error) {
	return a.store.RevokeByUserAndID(ctx, userID, id)
}

// toHTTPSessions maps auth.SessionInfo to orgadminhttp.SessionInfo.
func toHTTPSessions(in []auth.SessionInfo) []orgadminhttp.SessionInfo {
	out := make([]orgadminhttp.SessionInfo, 0, len(in))
	for _, s := range in {
		out = append(out, orgadminhttp.SessionInfo{
			ID: s.ID, UserID: s.UserID, Email: s.Email, DisplayName: s.DisplayName,
			CreatedAt: s.CreatedAt, ExpiresAt: s.ExpiresAt, LastSeenAt: s.LastSeenAt,
			RevokedAt: s.RevokedAt, IP: s.IP, UserAgent: s.UserAgent, Current: s.Current,
		})
	}
	return out
}

// ---- useravatar blob adapter ------------------------------------------------

type avatarBlobAdapter struct{ blobs *drive.Blobs }

func (a avatarBlobAdapter) Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error {
	return a.blobs.Put(ctx, key, mimeType, size, body)
}

func (a avatarBlobAdapter) Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error) {
	return a.blobs.Get(ctx, key)
}

func (a avatarBlobAdapter) Delete(ctx context.Context, key string) error {
	return a.blobs.Delete(ctx, key)
}

// ---- multiaccounts session lookup adapter ----------------------------------

// sessionLookupAdapter adapts auth.SessionStore + users/orgs repos to the
// multiaccounts.SessionLookup interface, keeping internal/multiaccounts free
// of internal/auth's gen/ dependency.
type sessionLookupAdapter struct {
	sessions *auth.SessionStore
	users    *users.Repository
	orgs     *orgs.Repository
}

func (a *sessionLookupAdapter) LookupFull(ctx context.Context, token string) (userID, email, displayName, orgID, orgName, orgSlug, publicID string, ok bool) {
	sess, err := a.sessions.Lookup(ctx, token)
	if err != nil {
		return
	}
	u, uerr := a.users.GetByID(ctx, sess.UserID)
	if uerr != nil {
		return
	}
	var oName, oSlug string
	if a.orgs != nil {
		o, oerr := a.orgs.GetByID(ctx, u.OrgID)
		if oerr == nil {
			oName = o.DisplayName
			oSlug = o.Slug
		}
	}
	pubID, _ := a.sessions.LookupPublicID(ctx, token)
	return u.ID, u.Email, u.DisplayName, u.OrgID, oName, oSlug, pubID, true
}

func (a *sessionLookupAdapter) LookupTokenByPublicID(ctx context.Context, publicID string) (string, error) {
	return a.sessions.LookupTokenByPublicID(ctx, publicID)
}

// hostMatches reports whether the request Host equals the configured CRM host,
// comparing case-insensitively and tolerating a port mismatch (a client may or
// may not include grown's :8080). So "crm.workspace.localtest.me" and
// "crm.workspace.localtest.me:8080" both match either configured form.
func hostMatches(reqHost, want string) bool {
	strip := func(h string) string {
		h = strings.ToLower(strings.TrimSpace(h))
		if i := strings.LastIndex(h, ":"); i >= 0 {
			h = h[:i]
		}
		return h
	}
	return strip(reqHost) == strip(want)
}

// newReverseProxy builds a reverse proxy to target (e.g. the PDF frontend),
// preserving the request path. Returns nil when target is empty.
func newReverseProxy(target string) *httputil.ReverseProxy {
	u, err := url.Parse(target)
	if err != nil || target == "" {
		return nil
	}
	p := httputil.NewSingleHostReverseProxy(u)
	// Preserve the upstream host so its dev server / router matches correctly.
	orig := p.Director
	p.Director = func(r *http.Request) { orig(r); r.Host = u.Host }
	return p
}

// newStripPrefixProxy builds a reverse proxy to target that strips prefix from
// the request path before forwarding (e.g. /pdf-api/api/x → backend /api/x).
// Returns nil when target is empty.
func newStripPrefixProxy(target, prefix string) *httputil.ReverseProxy {
	u, err := url.Parse(target)
	if err != nil || target == "" {
		return nil
	}
	return &httputil.ReverseProxy{
		Director: func(r *http.Request) {
			r.URL.Scheme = u.Scheme
			r.URL.Host = u.Host
			r.Host = u.Host
			p := strings.TrimPrefix(r.URL.Path, prefix)
			if p == "" {
				p = "/"
			}
			r.URL.Path = p
		},
	}
}

// newForgejoProxy builds the /git reverse proxy with grown→Forgejo SSO via
// Forgejo's reverse-proxy authentication (X-WEBAUTH-USER / X-WEBAUTH-EMAIL) plus
// access-time org/team provisioning.
//
// Security model: the request has ALREADY passed through grown's auth middleware
// (so the grown user, if any, is in r.Context()). The director:
//
//  1. UNCONDITIONALLY strips any client-supplied X-WEBAUTH-* headers FIRST, so a
//     visitor can never forge an identity by sending those headers themselves.
//  2. Sets X-WEBAUTH-USER / X-WEBAUTH-EMAIL server-side ONLY for an authenticated
//     grown session. Forgejo (ENABLE_REVERSE_PROXY_AUTH + AUTO_REGISTER) then
//     auto-creates + auto-logs-in the matching user with zero extra clicks.
//  3. Anonymous visitors get NO header → Forgejo serves them as a guest (public
//     repo browsing still works).
//
// When an authenticated user is present, it also kicks off best-effort, cached,
// non-blocking org/team provisioning in a goroutine (provisioner is a no-op when
// unconfigured, e.g. on prod pick.haus).
func newForgejoProxy(target, prefix string, prov *forgejo.Provisioner, isAdmin func(context.Context) bool) *httputil.ReverseProxy {
	u, err := url.Parse(target)
	if err != nil || target == "" {
		return nil
	}
	return &httputil.ReverseProxy{
		Director: func(r *http.Request) {
			r.URL.Scheme = u.Scheme
			r.URL.Host = u.Host
			r.Host = u.Host
			p := strings.TrimPrefix(r.URL.Path, prefix)
			if p == "" {
				p = "/"
			}
			r.URL.Path = p

			// (1) Always drop any inbound reverse-proxy auth headers BEFORE we
			// decide whether to set them — prevents client impersonation.
			r.Header.Del("X-WEBAUTH-USER")
			r.Header.Del("X-WEBAUTH-EMAIL")

			ctx := r.Context()
			user, hasUser := auth.UserFromContext(ctx)
			if !hasUser || user.Email == "" {
				return // anonymous: no SSO header, guest browsing
			}

			// (2) Trusted, server-side identity for an authenticated session.
			r.Header.Set("X-WEBAUTH-USER", forgejo.UsernameFromEmail(user.Email))
			r.Header.Set("X-WEBAUTH-EMAIL", user.Email)

			// (3) Access-time org/team provisioning (best-effort, non-blocking).
			if prov == nil || !prov.Configured() {
				return
			}
			org, hasOrg := auth.OrgFromContext(ctx)
			if !hasOrg || org.Slug == "" {
				return
			}
			admin := isAdmin != nil && isAdmin(ctx)
			slug, display, email := org.Slug, org.DisplayName, user.Email
			go func() {
				// Detached context: outlive the proxied request, but bound it.
				bg, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				prov.EnsureAccess(bg, slug, display, email, admin)
			}()
		},
	}
}

// HTTPHandler returns the HTTP/REST handler (driven by grpc-gateway + middleware).
func (s *Server) HTTPHandler() http.Handler { return s.httpHandler }

// GRPC returns the underlying *grpc.Server.
func (s *Server) GRPC() *grpc.Server { return s.grpc }

// docsConnectID returns the document id from a collab WebSocket path of the form
// /api/v1/docs/d/{id}/connect, and whether the path matched.
func docsConnectID(path string) (string, bool) {
	const prefix = "/api/v1/docs/d/"
	const suffix = "/connect"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// serveDocsWS authorizes the collab WebSocket request and hands it to the hub.
// Three paths grant access: (1) an authenticated org member whose org owns the
// document (full edit), (2) an authenticated per-user grantee (object_grants),
// whose role determines read/write (cross-org), or (3) a valid share-link token
// for the document. Viewers/commenters connect read-only.
func serveDocsWS(w http.ResponseWriter, r *http.Request, id string, repo *docs.Repository, grants *sharing.Repository, hub *docs.Hub) {
	ctx := r.Context()
	authorized, canWrite := false, false

	if u, hasUser := auth.UserFromContext(ctx); hasUser {
		if org, ok := auth.OrgFromContext(ctx); ok {
			if _, err := repo.Get(ctx, org.ID, id); err == nil {
				authorized, canWrite = true, true
			}
		}
		// Per-user grant path: a non-org-member with a grant may connect; only an
		// editor grant gets write.
		if !authorized && grants != nil {
			if role, ok, err := grants.RoleFor(ctx, u.ID, sharing.TypeDocsDoc, id); err == nil && ok {
				// Confirm the document still exists (not trashed) before connecting.
				if _, derr := repo.GetByID(ctx, id); derr == nil {
					authorized = true
					canWrite = sharing.CanWrite(role)
				}
			}
		}
	}

	if !authorized {
		if token := r.URL.Query().Get("token"); token != "" {
			if grant, err := repo.GetShareByToken(ctx, token); err == nil && grant.DocID == id {
				authorized = true
				canWrite = grant.Role == "editor"
			}
		}
	}

	if !authorized {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	hub.Serve(w, r, id, canWrite)
}

// sheetsConnectID returns the sheet id from /api/v1/sheets/d/{id}/connect.
func sheetsConnectID(path string) (string, bool) {
	const prefix = "/api/v1/sheets/d/"
	const suffix = "/connect"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// serveSheetsWS authorizes the sheet collab WebSocket and hands it to the
// broadcast hub. Two paths grant access: (1) an org member whose org owns the
// sheet (full edit), or (2) a per-user grantee (object_grants), whose role
// determines read/write (cross-org). Viewers/commenters connect read-only.
func serveSheetsWS(w http.ResponseWriter, r *http.Request, id string, repo *sheets.Repository, grants *sharing.Repository, hub *sheets.Hub) {
	ctx := r.Context()
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	authorized, canWrite := false, false
	if org, ok := auth.OrgFromContext(ctx); ok {
		if _, err := repo.Get(ctx, org.ID, id); err == nil {
			authorized, canWrite = true, true
		}
	}
	// Per-user grant path: a non-org-member with a grant may connect; only an
	// editor grant gets write.
	if !authorized && grants != nil {
		if role, ok, err := grants.RoleFor(ctx, u.ID, sharing.TypeSheetsSheet, id); err == nil && ok {
			if _, derr := repo.GetByID(ctx, id); derr == nil {
				authorized = true
				canWrite = sharing.CanWrite(role)
			}
		}
	}
	if !authorized {
		http.Error(w, "sheet not found", http.StatusNotFound)
		return
	}
	hub.Serve(w, r, id, canWrite)
}

// slidesConnectID returns the deck id from /api/v1/slides/d/{id}/connect.
func slidesConnectID(path string) (string, bool) {
	const prefix = "/api/v1/slides/d/"
	const suffix = "/connect"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// serveSlidesWS authorizes the deck collab WebSocket and hands it to the
// broadcast hub. Two paths grant access: (1) an org member whose org owns the
// deck (full edit), or (2) a per-user grantee (object_grants), whose role
// determines read/write (cross-org). Viewers/commenters connect read-only.
func serveSlidesWS(w http.ResponseWriter, r *http.Request, id string, repo *slides.Repository, grants *sharing.Repository, hub *slides.Hub) {
	ctx := r.Context()
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	authorized, canWrite := false, false
	if org, ok := auth.OrgFromContext(ctx); ok {
		if _, err := repo.Get(ctx, org.ID, id); err == nil {
			authorized, canWrite = true, true
		}
	}
	// Per-user grant path: a non-org-member with a grant may connect; only an
	// editor grant gets write.
	if !authorized && grants != nil {
		if role, ok, err := grants.RoleFor(ctx, u.ID, sharing.TypeSlidesDeck, id); err == nil && ok {
			if _, derr := repo.GetByID(ctx, id); derr == nil {
				authorized = true
				canWrite = sharing.CanWrite(role)
			}
		}
	}
	if !authorized {
		http.Error(w, "deck not found", http.StatusNotFound)
		return
	}
	hub.Serve(w, r, id, canWrite)
}

// whiteboardsConnectID returns the board id from /api/v1/whiteboards/d/{id}/connect.
func whiteboardsConnectID(path string) (string, bool) {
	const prefix = "/api/v1/whiteboards/d/"
	const suffix = "/connect"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// serveWhiteboardsWS authorizes the board collab WebSocket and hands it to the
// broadcast hub. Two paths grant access: (1) an org member whose org owns the
// board (full edit), or (2) a per-user grantee (object_grants), whose role
// determines read/write (cross-org).
func serveWhiteboardsWS(w http.ResponseWriter, r *http.Request, id string, repo *whiteboards.Repository, grants *sharing.Repository, hub *whiteboards.Hub) {
	ctx := r.Context()
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	authorized := false
	if org, ok := auth.OrgFromContext(ctx); ok {
		if _, err := repo.Get(ctx, org.ID, id); err == nil {
			authorized = true
		}
	}
	// Per-user grant path: a non-org-member with a grant may connect.
	if !authorized && grants != nil {
		if _, ok, err := grants.RoleFor(ctx, u.ID, sharing.TypeWhiteboardBoard, id); err == nil && ok {
			if _, derr := repo.GetByID(ctx, id); derr == nil {
				authorized = true
			}
		}
	}
	if !authorized {
		http.Error(w, "whiteboard not found", http.StatusNotFound)
		return
	}
	hub.Serve(w, r, id)
}

// serveDocsConvert converts client-rendered HTML to a downloadable format via
// pandoc. The document content lives client-side as a Yjs CRDT, so the client
// posts its rendered HTML here; ?to= selects the format and ?name= the filename.
func serveDocsConvert(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserFromContext(r.Context()); !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	to := r.URL.Query().Get("to")
	if _, ok := docs.ConvertSupported(to); !ok {
		http.Error(w, "unsupported format", http.StatusBadRequest)
		return
	}
	html, err := io.ReadAll(io.LimitReader(r.Body, 16<<20))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	data, f, err := docs.ConvertHTML(r.Context(), html, to)
	if err != nil {
		http.Error(w, "conversion failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	name := r.URL.Query().Get("name")
	if name == "" {
		name = "document"
	}
	w.Header().Set("Content-Type", f.MIME)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name+"."+f.Ext))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// redirectOnAuthURL converts AuthService.Login responses into HTTP 302 redirects
// to the IdP authorization URL. Also converts Callback responses into 302
// redirects to the post-login URL.
func redirectOnAuthURL(_ context.Context, w http.ResponseWriter, msg proto.Message) error {
	switch m := msg.(type) {
	case *grownv1.LoginResponse:
		if u := m.GetAuthorizationUrl(); u != "" {
			w.Header().Set("Location", u)
			w.WriteHeader(http.StatusFound)
			return nil
		}
	case *grownv1.CallbackResponse:
		if u := m.GetRedirectTo(); u != "" {
			w.Header().Set("Location", u)
			w.WriteHeader(http.StatusFound)
			return nil
		}
	}
	return nil
}

// chatConnectID extracts the channel id from /api/v1/chat/channels/{id}/connect.
func chatConnectID(path string) (string, bool) {
	const prefix = "/api/v1/chat/channels/"
	const suffix = "/connect"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// serveChatWS authorizes the chat WebSocket (org member of the channel) and
// hands it to the broadcast/presence hub.
func serveChatWS(w http.ResponseWriter, r *http.Request, channelID string, repo *chat.Repository, hub *chat.Hub) {
	ctx := r.Context()
	u, hasUser := auth.UserFromContext(ctx)
	if !hasUser {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	org, ok := auth.OrgFromContext(ctx)
	if !ok {
		http.Error(w, "no org context", http.StatusInternalServerError)
		return
	}
	ch, err := repo.GetChannel(ctx, org.ID, channelID)
	if err != nil {
		http.Error(w, "channel not found", http.StatusNotFound)
		return
	}
	isMember := false
	for _, id := range ch.MemberIDs {
		if id == u.ID {
			isMember = true
			break
		}
	}
	if !isMember {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	hub.Serve(w, r, channelID, u.ID)
}

// serveMeetWS authorizes the Meet signaling WebSocket (org member whose org owns
// the room) and hands it to the signaling hub.
func serveMeetWS(w http.ResponseWriter, r *http.Request, roomID string, repo *meet.Repository, hub *meet.Hub) {
	ctx := r.Context()
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	org, ok := auth.OrgFromContext(ctx)
	if !ok {
		http.Error(w, "no org context", http.StatusInternalServerError)
		return
	}
	if _, err := repo.Get(ctx, org.ID, roomID); err != nil {
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}
	displayName := u.DisplayName
	if displayName == "" {
		displayName = u.Email
	}
	if displayName == "" {
		displayName = u.ID
	}
	hub.Serve(w, r, roomID, u.ID, displayName)
}

// serveTelephonyWS authorizes the telephony signaling WebSocket (any org member)
// and hands it to the signaling hub, keyed by the caller's org + user id.
func serveTelephonyWS(w http.ResponseWriter, r *http.Request, hub *telephony.Hub) {
	ctx := r.Context()
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	org, ok := auth.OrgFromContext(ctx)
	if !ok {
		http.Error(w, "no org context", http.StatusInternalServerError)
		return
	}
	displayName := u.DisplayName
	if displayName == "" {
		displayName = u.Email
	}
	if displayName == "" {
		displayName = u.ID
	}
	hub.Serve(w, r, org.ID, u.ID, displayName)
}

// projectsConnectID extracts the team id from /api/v1/projects/teams/{id}/connect.
func projectsConnectID(path string) (string, bool) {
	const prefix = "/api/v1/projects/teams/"
	const suffix = "/connect"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// serveProjectsWS authorizes the projects WebSocket (org owns the team) and
// hands it to the issue broadcast/presence hub.
func serveProjectsWS(w http.ResponseWriter, r *http.Request, teamID string, repo *projects.Repository, hub *projects.Hub) {
	ctx := r.Context()
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	org, ok := auth.OrgFromContext(ctx)
	if !ok {
		http.Error(w, "no org context", http.StatusInternalServerError)
		return
	}
	if _, err := repo.GetTeam(ctx, org.ID, teamID); err != nil {
		http.Error(w, "team not found", http.StatusNotFound)
		return
	}
	hub.Serve(w, r, teamID, u.ID)
}
