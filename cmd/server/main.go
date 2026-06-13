// Command server runs the grown-workspace backend: gRPC on 9000, HTTP/REST on 8080.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"code.pick.haus/grown/grown/internal/access"
	"code.pick.haus/grown/grown/internal/admin"
	"code.pick.haus/grown/grown/internal/audit"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/books"
	"code.pick.haus/grown/grown/internal/branding"
	"code.pick.haus/grown/grown/internal/calendar"
	"code.pick.haus/grown/grown/internal/chat"
	"code.pick.haus/grown/grown/internal/cloudimport"
	"code.pick.haus/grown/grown/internal/contacts"
	"code.pick.haus/grown/grown/internal/docs"
	"code.pick.haus/grown/grown/internal/drive"
	"code.pick.haus/grown/grown/internal/email"
	"code.pick.haus/grown/grown/internal/forgejo"
	"code.pick.haus/grown/grown/internal/forms"
	"code.pick.haus/grown/grown/internal/games"
	"code.pick.haus/grown/grown/internal/groups"
	"code.pick.haus/grown/grown/internal/keep"
	"code.pick.haus/grown/grown/internal/live"
	"code.pick.haus/grown/grown/internal/mail"
	"code.pick.haus/grown/grown/internal/meet"
	"code.pick.haus/grown/grown/internal/multiaccounts"
	"code.pick.haus/grown/grown/internal/music"
	"code.pick.haus/grown/grown/internal/notifications"
	"code.pick.haus/grown/grown/internal/orgadmin"
	"code.pick.haus/grown/grown/internal/orgs"
	pdfapp "code.pick.haus/grown/grown/internal/pdf/app"
	"code.pick.haus/grown/grown/internal/photos"
	"code.pick.haus/grown/grown/internal/prefs"
	"code.pick.haus/grown/grown/internal/projects"
	"code.pick.haus/grown/grown/internal/search"
	"code.pick.haus/grown/grown/internal/server"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/sheets"
	"code.pick.haus/grown/grown/internal/sites"
	"code.pick.haus/grown/grown/internal/slides"
	"code.pick.haus/grown/grown/internal/storage"
	"code.pick.haus/grown/grown/internal/tasks"
	"code.pick.haus/grown/grown/internal/telephony"
	"code.pick.haus/grown/grown/internal/useravatar"
	"code.pick.haus/grown/grown/internal/users"
	"code.pick.haus/grown/grown/internal/video"
	"code.pick.haus/grown/grown/internal/vpn"
	"code.pick.haus/grown/grown/internal/whiteboards"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	version = "0.0.0-dev"
	commit  = "unknown"
)

func main() {
	httpAddr := flag.String("http-addr", ":8080", "HTTP/REST listen address")
	grpcAddr := flag.String("grpc-addr", ":9000", "gRPC listen address")
	dsn := flag.String("postgres-dsn", os.Getenv("GROWN_POSTGRES_DSN"), "Postgres DSN")
	staticDir := flag.String("static-dir", os.Getenv("GROWN_STATIC_DIR"), "Path to the built React SPA (web/app/dist). Empty = API-only.")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	if *dsn == "" {
		logger.Error("postgres DSN is required (--postgres-dsn or GROWN_POSTGRES_DSN)")
		os.Exit(1)
	}

	startupCtx, startupCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer startupCancel()

	pool, err := storage.NewPool(startupCtx, *dsn)
	if err != nil {
		logger.Error("connect postgres", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := storage.RunMigrations(startupCtx, pool); err != nil {
		logger.Error("run migrations", "err", err)
		os.Exit(1)
	}
	logger.Info("migrations applied")

	authCfg, err := loadAuthConfigFromEnv()
	if err != nil {
		logger.Error("load auth config", "err", err)
		os.Exit(1)
	}

	oidcClient, err := auth.NewOIDC(startupCtx, authCfg)
	if err != nil {
		logger.Error("init OIDC", "err", err)
		os.Exit(1)
	}

	orgsRepo := orgs.NewRepository(pool)
	defaultOrg, err := orgsRepo.GetBySlug(startupCtx, authCfg.DefaultOrgSlug)
	if err != nil {
		logger.Error("lookup default org", "err", err)
		os.Exit(1)
	}
	logger.Info("default org resolved", "id", defaultOrg.ID, "slug", defaultOrg.Slug)

	blobs, err := drive.NewBlobs(startupCtx, drive.BlobsConfig{
		Endpoint:  os.Getenv("GROWN_RUSTFS_ENDPOINT"),
		AccessKey: os.Getenv("GROWN_RUSTFS_ACCESS_KEY"),
		SecretKey: os.Getenv("GROWN_RUSTFS_SECRET_KEY"),
		Bucket:    defaultEnv("GROWN_RUSTFS_BUCKET", "grown-default"),
		Region:    "us-east-1",
	})
	if err != nil {
		logger.Error("init drive blobs", "err", err)
		os.Exit(1)
	}

	// Per-object ACL grants (object_grants) — the per-user sharing primitive for
	// Drive + Docs. Shared by both services; nil notifier = no-op (best-effort).
	sharingRepo := sharing.NewRepository(pool)

	// Notifications feed — wired before Drive so the OnGrant hook can reference it.
	notifRepo := notifications.NewRepository(pool)

	// When a user is granted access to a shared object, emit a notification to
	// them. We use the OnGrant callback on sharingRepo to avoid a hard import
	// of internal/notifications in internal/sharing.
	sharingRepo.OnGrant = func(ctx context.Context, e sharing.GrantEvent) {
		_, _ = notifRepo.Create(ctx, notifications.CreateParams{
			// Notifications are scoped to the org the grantee belongs to; we do a
			// best-effort lookup inside the repo — if it fails the notification is
			// silently dropped rather than failing the share operation.
			OrgID:       resolveUserOrg(ctx, pool, e.GranteeUserID),
			UserID:      e.GranteeUserID,
			Type:        "share_grant",
			ActorUserID: e.GrantedBy,
			Title:       shareGrantTitle(e),
			Body:        "You have been granted " + e.Role + " access.",
			TargetURL:   shareGrantURL(e),
		})
	}

	// ---- Forgejo org auto-provisioning ----------------------------------------
	// When a grown org is created, mirror it into Forgejo (best-effort, never
	// blocks org creation). Activated by GROWN_FORGEJO_URL + GROWN_FORGEJO_ADMIN_TOKEN;
	// both env vars must be set — if either is empty the provisioner is a no-op.
	//
	// Username mapping: the Forgejo username is the local-part of the creator's
	// grown email (e.g. alice@example.com → "alice"). See internal/forgejo package
	// docs for the assumption and its limitations.
	forgejoProvisioner := forgejo.NewProvisionerFromEnv()
	orgsRepo.OnCreate = func(ctx context.Context, o orgs.Org, creatorEmail string) {
		forgejoProvisioner.OnOrgCreated(ctx, forgejo.OrgEvent{
			OrgID:        o.ID,
			Slug:         o.Slug,
			DisplayName:  o.DisplayName,
			CreatorEmail: creatorEmail,
		})
	}
	// ---- end Forgejo wiring ----------------------------------------------------

	driveSvc := drive.NewService(
		drive.NewRepository(pool),
		drive.NewACL(pool),
		blobs,
	).WithSharing(sharingRepo, nil)

	// Seed one sample book of each supported format into the default org's
	// library on first run (no-op when the library already has books).
	booksRepo := books.NewRepository(pool)
	books.SeedSamples(startupCtx, booksRepo, blobs, defaultOrg.ID)

	// Feature flag: GROWN_PDF_BUILTIN=true mounts the PDF signing backend
	// in-process (gRPC + gateway + raw-HTTP under /pdf-api/), authenticated by
	// grown's session via the auth bridge. Default (unset/anything-but-"true")
	// leaves the legacy /pdf-api reverse-proxy path untouched — behavior is
	// byte-for-byte identical to before this feature.
	var pdfBuiltin *pdfapp.App
	if os.Getenv("GROWN_PDF_BUILTIN") == "true" {
		var perr error
		pdfBuiltin, perr = pdfapp.New(startupCtx, os.Environ())
		if perr != nil {
			// Fail OPEN: a PDF misconfiguration must never take down the whole
			// grown app. Log loudly and continue with pdfBuiltin=nil, which
			// leaves /pdf-api on the legacy reverse-proxy path (PDF unavailable
			// rather than grown crash-looping).
			logger.Error("GROWN_PDF_BUILTIN is on but PDF backend failed to construct; continuing without built-in PDF", "err", perr)
			pdfBuiltin = nil
		} else {
			defer pdfBuiltin.Close()
			logger.Info("PDF backend mounted in-process (GROWN_PDF_BUILTIN=true)")
		}
	}

	srv := server.New(server.Config{
		Version:           version,
		Commit:            commit,
		StartedAt:         time.Now(),
		AuthConfig:        authCfg,
		OIDC:              oidcClient,
		Sessions:          auth.NewSessionStore(pool),
		UsersRepo:         users.NewRepository(pool),
		OrgsRepo:          orgsRepo,
		DocsRepo:          docs.NewRepository(pool),
		SheetsRepo:        sheets.NewRepository(pool),
		SlidesRepo:        slides.NewRepository(pool),
		ContactsRepo:      contacts.NewRepository(pool),
		WhiteboardsRepo:   whiteboards.NewRepository(pool),
		CalendarRepo:      calendar.NewRepository(pool),
		MailRepo:          mail.NewRepository(pool),
		MailBackend:       mailBackend(),
		MailBlobs:         blobs,
		GamesRepo:         games.NewRepository(pool),
		GamesBlobs:        blobs,
		ChatRepo:          chat.NewRepository(pool),
		ChatBlobs:         blobs,
		MeetRepo:          meet.NewRepository(pool),
		TelephonyRepo:     telephony.NewRepository(pool),
		FormsRepo:         forms.NewRepository(pool),
		PhotosRepo:        photos.NewRepository(pool),
		PhotosBlobs:       blobs,
		BooksRepo:         booksRepo,
		BooksBlobs:        blobs,
		VideoRepo:         video.NewRepository(pool),
		VideoBlobs:        blobs,
		VideoShareRepo:    video.NewShareRepository(pool),
		VideoPlaylistRepo: video.NewPlaylistRepository(pool),
		VideoProgressRepo: video.NewProgressRepository(pool),
		VideoCaptionRepo:  video.NewCaptionRepository(pool),
		PublicHost:        os.Getenv("GROWN_PUBLIC_HOST"),
		LiveRepo:          live.NewRepository(pool),
		LiveURLs: live.URLConfig{
			HLSBase:  defaultEnv("GROWN_LIVE_HLS_BASE", "/live-hls"),
			WHEPBase: defaultEnv("GROWN_LIVE_WEBRTC_BASE", "/live-webrtc"),
			WHIPBase: defaultEnv("GROWN_LIVE_WEBRTC_BASE", "/live-webrtc"),
			RTMPHost: defaultEnv("GROWN_LIVE_RTMP_HOST", "localhost:1935"),
		},
		LiveHLSURL:          defaultEnv("GROWN_LIVE_HLS_URL", "http://127.0.0.1:8888"),
		LiveWebRTCURL:       defaultEnv("GROWN_LIVE_WEBRTC_URL", "http://127.0.0.1:8889"),
		MusicRepo:           music.NewRepository(pool),
		MusicBlobs:          blobs,
		ProjectsRepo:        projects.NewRepository(pool),
		KeepRepo:            keep.NewRepository(pool),
		TasksRepo:           tasks.NewRepository(pool),
		NotificationsRepo:   notifRepo,
		PrefsRepo:           prefs.NewRepository(pool),
		SitesRepo:           sites.NewRepository(pool),
		GroupsRepo:          groups.NewRepository(pool),
		SearchRepo:          search.NewRepository(pool),
		AccessRepo:          access.NewRepository(pool),
		AdminRepo:           admin.NewRepository(pool),
		AdminEmails:         os.Getenv("GROWN_ADMIN_EMAILS"),
		OrgAdminRepo:        orgadmin.NewRepository(pool),
		SharingRepo:         sharingRepo,
		IssuerURL:           authCfg.IssuerURL,
		AuditRepo:           audit.NewRepository(pool),
		BrandingRepo:        branding.NewRepository(pool),
		BrandingBlobs:       blobs,
		AvatarRepo:          useravatar.NewRepository(pool),
		AvatarBlobs:         blobs,
		BrowserAccountStore: multiaccounts.NewStore(pool),
		ZitadelAPIURL:       os.Getenv("GROWN_ZITADEL_API_URL"),
		ZitadelServiceToken: os.Getenv("GROWN_ZITADEL_SERVICE_TOKEN"),
		// EmailSender is configured from RESEND_API_KEY + GROWN_EMAIL_FROM.
		// When RESEND_API_KEY is unset the sender is a no-op: invite emails are
		// logged but not delivered, so dev environments work without credentials.
		EmailSender: email.NewSenderFromEnv(),
		DefaultOrg:  defaultOrg,
		Drive:       driveSvc,
		Pool:        pool,
		StaticDir:   *staticDir,
		DemoLogin:   loadDemoConfig(),
		// Integrated PDF (editor & sign) app proxy targets. Empty disables the
		// /pdf reverse proxy (e.g. when the PDF services aren't running).
		PDFFrontendURL: os.Getenv("GROWN_PDF_FRONTEND_URL"),
		PDFBackendURL:  os.Getenv("GROWN_PDF_BACKEND_URL"),
		// In-process PDF backend (GROWN_PDF_BUILTIN). nil = legacy reverse-proxy.
		PDFBuiltin: pdfBuiltin,
		// In-process PDF frontend SPA (Phase 2c). When set AND the built-in PDF
		// backend is on, grown serves the PDF SPA from this dir for /pdf*.
		// Empty = legacy PDFFrontendURL reverse-proxy.
		PDFStaticDir: os.Getenv("GROWN_PDF_STATIC_DIR"),
		// Integrated Twenty CRM. GROWN_CRM_URL is Twenty's internal origin;
		// GROWN_CRM_HOST is the public subdomain whose requests get proxied
		// whole to Twenty at root. Both empty disables the CRM proxy.
		CRMURL:  os.Getenv("GROWN_CRM_URL"),
		CRMHost: os.Getenv("GROWN_CRM_HOST"),
		// Orona Bolo multiplayer server origin. grown reverse-proxies /bolo-mp/*
		// to it (WebSocket-capable), stripping the prefix. Empty disables the
		// proxy (the bolo single-player path is unaffected). e.g. http://127.0.0.1:6173.
		BoloMpURL: os.Getenv("GROWN_BOLO_MP_URL"),
		// Per-instance Forgejo (git hosting) reverse-proxied at /git/* (prefix
		// stripped). Set Forgejo ROOT_URL to https://<host>/git/. Empty disables.
		ForgejoURL: os.Getenv("GROWN_FORGEJO_URL"),
		// Cloud Import — upload-based import from Google Takeout and Apple exports.
		CloudImportRepo:      cloudimport.NewRepository(pool),
		CloudImportDriveRepo: drive.NewRepository(pool),
		CloudImportBlobs:     blobs,
		// VPN (Tailscale) status endpoint.
		VPNHandler: vpn.NewHandlerFromEnv(),
	})

	httpServer := &http.Server{
		Addr:              *httpAddr,
		Handler:           srv.HTTPHandler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	grpcLis, err := net.Listen("tcp", *grpcAddr)
	if err != nil {
		logger.Error("listen gRPC", "err", err)
		os.Exit(1)
	}

	go func() {
		logger.Info("serving gRPC", "addr", *grpcAddr)
		if err := srv.GRPC().Serve(grpcLis); err != nil && !errors.Is(err, net.ErrClosed) {
			logger.Error("gRPC serve", "err", err)
		}
	}()

	go func() {
		logger.Info("serving HTTP", "addr", *httpAddr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP serve", "err", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	logger.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
	srv.GRPC().GracefulStop()
}

// mailBackend selects the mail backend. Default (or GROWN_MAIL_BACKEND=local)
// is the Postgres store with internal delivery. GROWN_MAIL_BACKEND=imap (or
// "mailcow") uses the IMAP/SMTP bridge configured via GROWN_MAIL_* env vars.
func mailBackend() mail.Backend {
	switch os.Getenv("GROWN_MAIL_BACKEND") {
	case "imap", "mailcow":
		return mail.NewBridge(mail.BridgeConfigFromEnv())
	default:
		return nil // server falls back to the Postgres LocalBackend
	}
}

// loadAuthConfigFromEnv reads GROWN_OIDC_* env vars into an auth.Config.
func loadAuthConfigFromEnv() (auth.Config, error) {
	secure, _ := strconv.ParseBool(os.Getenv("GROWN_SESSION_COOKIE_SECURE"))
	lifetimeStr := os.Getenv("GROWN_SESSION_LIFETIME")
	if lifetimeStr == "" {
		lifetimeStr = "168h"
	}
	lifetime, err := time.ParseDuration(lifetimeStr)
	if err != nil {
		return auth.Config{}, err
	}
	cfg := auth.Config{
		IssuerURL:       os.Getenv("GROWN_OIDC_ISSUER"),
		ClientID:        os.Getenv("GROWN_OIDC_CLIENT_ID"),
		ClientSecret:    os.Getenv("GROWN_OIDC_CLIENT_SECRET"),
		RedirectURL:     os.Getenv("GROWN_OIDC_REDIRECT_URL"),
		CookieName:      defaultEnv("GROWN_SESSION_COOKIE_NAME", "grown_session"),
		CookieSecure:    secure,
		CookieDomain:    sessionCookieDomain(),
		SessionLifetime: lifetime,
		DefaultOrgSlug:  defaultEnv("GROWN_DEFAULT_ORG_SLUG", "default"),
		PersonalOrgs:    personalOrgsEnabled(),
	}
	return cfg, cfg.Validate()
}

// sessionCookieDomain decides the Domain attribute for the session + OIDC-state
// cookies. An explicit GROWN_SESSION_COOKIE_DOMAIN wins. Otherwise it is derived
// from the OIDC redirect URL's host so the cookies are valid across subdomains
// (e.g. the CRM subdomain crm.<host>) with no extra config. Hosts that can't
// carry a Domain attribute (bare "localhost", IP addresses) stay host-only.
func sessionCookieDomain() string {
	if d := os.Getenv("GROWN_SESSION_COOKIE_DOMAIN"); d != "" {
		return d
	}
	u, err := url.Parse(os.Getenv("GROWN_OIDC_REDIRECT_URL"))
	if err != nil {
		return ""
	}
	host := u.Hostname()
	if !strings.Contains(host, ".") || net.ParseIP(host) != nil {
		return "" // localhost / IP — cannot scope to a parent domain
	}
	return host
}

// personalOrgsEnabled reports whether first-ever sign-ins get a personal
// (org-per-user) org. Controlled by GROWN_PERSONAL_ORGS; defaults to ON. Set it
// to a falsey value ("0", "false", "off", "no") to keep all new users in the
// shared default org (legacy single-org behavior).
func personalOrgsEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("GROWN_PERSONAL_ORGS")))
	switch v {
	case "0", "false", "off", "no":
		return false
	default:
		return true
	}
}

// loadDemoConfig reads GROWN_DEMO_LOGIN_ENABLED and GROWN_DEMO_USERNAME from the
// environment. GROWN_DEMO_PASSWORD is intentionally not read here — it lives only
// in the operator's secrets store and in Zitadel; grown never handles it.
func loadDemoConfig() auth.DemoConfig {
	enabled, _ := strconv.ParseBool(os.Getenv("GROWN_DEMO_LOGIN_ENABLED"))
	return auth.DemoConfig{
		Enabled:  enabled,
		Username: os.Getenv("GROWN_DEMO_USERNAME"),
	}
}

func defaultEnv(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

// resolveUserOrg looks up the org_id for a given user id. Returns "" on any
// error so the caller can skip the notification silently.
func resolveUserOrg(ctx context.Context, pool *pgxpool.Pool, userID string) string {
	if userID == "" {
		return ""
	}
	var orgID string
	_ = pool.QueryRow(ctx, `SELECT org_id::text FROM grown.users WHERE id=$1`, userID).Scan(&orgID)
	return orgID
}

// shareGrantTitle builds a human-readable notification title for a sharing grant.
func shareGrantTitle(e sharing.GrantEvent) string {
	switch e.ObjectType {
	case sharing.TypeDriveFile:
		return "A file was shared with you"
	case sharing.TypeDocsDoc:
		return "A document was shared with you"
	case sharing.TypeSheetsSheet:
		return "A spreadsheet was shared with you"
	case sharing.TypeSlidesDeck:
		return "A presentation was shared with you"
	default:
		return "An item was shared with you"
	}
}

// shareGrantURL builds a deep link for the notification based on the object type.
func shareGrantURL(e sharing.GrantEvent) string {
	switch e.ObjectType {
	case sharing.TypeDriveFile:
		return "/drive"
	case sharing.TypeDocsDoc:
		return "/docs/d/" + e.ObjectID
	case sharing.TypeSheetsSheet:
		return "/sheets/d/" + e.ObjectID
	case sharing.TypeSlidesDeck:
		return "/slides/d/" + e.ObjectID
	default:
		return "/"
	}
}
