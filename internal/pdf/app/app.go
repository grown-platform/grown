package app

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"google.golang.org/grpc"

	grownauth "code.pick.haus/grown/grown/internal/auth"
	pdfauth "code.pick.haus/grown/grown/internal/pdf/auth"
	"code.pick.haus/grown/grown/internal/pdf/config"
	"code.pick.haus/grown/grown/internal/pdf/crypto"
	"code.pick.haus/grown/grown/internal/pdf/database"
	"code.pick.haus/grown/grown/internal/pdf/email"
	"code.pick.haus/grown/grown/internal/pdf/handler"
	"code.pick.haus/grown/grown/internal/pdf/pdf"
	auditpb "code.pick.haus/grown/grown/internal/pdf/proto/audit"
	documentspb "code.pick.haus/grown/grown/internal/pdf/proto/documents"
	signingpb "code.pick.haus/grown/grown/internal/pdf/proto/signing"
	"code.pick.haus/grown/grown/internal/pdf/sig"
	"code.pick.haus/grown/grown/internal/pdf/sqlc"
	"code.pick.haus/grown/grown/internal/pdf/storage"
)

// App holds the PDF backend's constructed gRPC services, raw-HTTP handlers, and
// the db handle, ready to be mounted in-process inside grown's server. It is
// built only when the GROWN_PDF_BUILTIN flag is on; the standalone
// cmd/pdfserver remains the authoritative reference for construction.
//
// Authentication is NOT done here: the in-process mount relies on grown's
// session (bridged into the PDF auth context by bridge.go). The PDF backend's
// own OIDC middleware/OAuth handlers are intentionally not constructed.
type App struct {
	cfg *config.Config
	db  *database.DB

	documents documentspb.DocumentsServiceServer
	signing   signingpb.SigningServiceServer
	audit     auditpb.AuditServiceServer

	admin           *handler.AdminHandler
	annotations     *handler.AnnotationsHandler
	documentReplace *handler.DocumentReplaceHandler
	templates       *handler.TemplatesHandler
}

// New constructs every PDF backend dependency from PDF_* env (via
// config.Load) and returns a ready-to-mount App. The caller only invokes New
// when GROWN_PDF_BUILTIN is on, so a missing-config error here is fatal to the
// flag (but never reached on the default off path).
//
// Construction degrades gracefully where the standalone server does: the mTLS
// authenticator is a no-op when mtls is disabled, the crypto keystore mints a
// random KEK when none is configured (dev), the self-signed CA is created on
// demand, and the trusted CA bundle is only loaded when browser-extension
// signing is enabled. Hard dependencies (DB, storage, email, PDF generator)
// must succeed or New returns a clear error.
func New(ctx context.Context, _ []string) (*App, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, fmt.Errorf("pdf: load config: %w", err)
	}

	db, err := database.New(ctx, cfg.Database.URL)
	if err != nil {
		return nil, fmt.Errorf("pdf: connect database: %w", err)
	}

	if err := database.Migrate(cfg.Database.URL); err != nil {
		db.Close()
		return nil, fmt.Errorf("pdf: run migrations: %w", err)
	}

	// Bootstrap first superadmin from env if the table is empty (idempotent).
	if cfg.Auth.BootstrapSuperadminEmail != "" {
		n, cErr := db.Queries.CountSuperadmins(ctx)
		switch {
		case cErr != nil:
			slog.Warn("pdf: CountSuperadmins failed during bootstrap; skipping", "error", cErr)
		case n == 0:
			if gErr := db.Queries.GrantSuperadmin(ctx, sqlc.GrantSuperadminParams{
				Lower:     cfg.Auth.BootstrapSuperadminEmail,
				GrantedBy: "bootstrap",
			}); gErr != nil {
				slog.Error("pdf: bootstrap superadmin grant failed", "error", gErr, "email", cfg.Auth.BootstrapSuperadminEmail)
			} else {
				slog.Info("pdf: bootstrapped initial superadmin", "email", cfg.Auth.BootstrapSuperadminEmail)
			}
		}
	}

	storageClient, err := storage.New(ctx, storage.Config{
		Endpoint:       cfg.Storage.Endpoint,
		PublicEndpoint: cfg.Storage.PublicEndpoint,
		Region:         cfg.Storage.Region,
		Bucket:         cfg.Storage.Bucket,
		AccessKey:      cfg.Storage.AccessKey,
		SecretKey:      cfg.Storage.SecretKey,
	})
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("pdf: init storage: %w", err)
	}

	pdfGenerator := pdf.New()

	emailSender := email.New(email.Config{
		SMTPHost:     cfg.Email.SMTPHost,
		SMTPPort:     cfg.Email.SMTPPort,
		SMTPUser:     cfg.Email.SMTPUser,
		SMTPPassword: cfg.Email.SMTPPassword,
		FromAddress:  cfg.Email.FromAddress,
		FromName:     cfg.Email.FromName,
		FrontendURL:  cfg.Server.FrontendURL,
	})

	// Crypto keystore + self-signed signing CA. NewKeystore mints a random KEK
	// when none is configured (dev), so this does not require config.
	keystore, err := crypto.NewKeystore(cfg.Crypto.KeyEncryptionKey)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("pdf: init keystore: %w", err)
	}
	ca, err := crypto.NewSelfSignedCA(ctx, db, keystore, cfg.Crypto.OrganizationID)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("pdf: init certificate authority: %w", err)
	}

	// Trusted CA bundle for verifying browser-extension signer certs. Only
	// loaded — and only required — when browser-extension signing is enabled.
	var trustedCAPool *x509.CertPool
	if cfg.Signing.BrowserExtensionEnabled {
		pool, lErr := sig.LoadCAPool(cfg.Signing.TrustedCABundlePath, os.ReadFile)
		if lErr != nil {
			db.Close()
			return nil, fmt.Errorf("pdf: load trusted CA bundle %q: %w", cfg.Signing.TrustedCABundlePath, lErr)
		}
		trustedCAPool = pool
	}

	a := &App{
		cfg:             cfg,
		db:              db,
		documents:       handler.NewDocumentsHandler(db, cfg, storageClient, emailSender, pdfGenerator, trustedCAPool),
		signing:         handler.NewSigningHandler(db, cfg, storageClient, pdfGenerator, emailSender, ca, trustedCAPool),
		audit:           handler.NewAuditHandler(db, cfg),
		admin:           handler.NewAdminHandler(db),
		annotations:     handler.NewAnnotationsHandler(db),
		documentReplace: handler.NewDocumentReplaceHandler(db, storageClient),
		templates:       handler.NewTemplatesHandler(db, cfg, storageClient),
	}
	slog.Info("pdf: built-in app constructed (GROWN_PDF_BUILTIN)",
		"orgId", cfg.Crypto.OrganizationID,
		"browserExtensionSigning", cfg.Signing.BrowserExtensionEnabled)
	return a, nil
}

// RegisterGRPC registers the PDF gRPC services on grown's gRPC server. The
// caller is responsible for chaining the bridge interceptors (UnaryServerInterceptor /
// StreamServerInterceptor) when constructing that server so the PDF handlers
// see grown's session identity.
func (a *App) RegisterGRPC(s *grpc.Server) {
	documentspb.RegisterDocumentsServiceServer(s, a.documents)
	signingpb.RegisterSigningServiceServer(s, a.signing)
	auditpb.RegisterAuditServiceServer(s, a.audit)
}

// RegisterGateway registers the PDF gRPC-gateway HTTP handlers in-process on
// mux, mirroring grown's RegisterXServiceHandlerServer pattern (no extra TCP
// dial — the gateway calls the service implementations directly). The PDF
// gateway routes live under /api/* (e.g. /api/documents, /api/sign/{token}),
// which is why HTTPHandler mounts this mux under the /pdf-api prefix.
func (a *App) RegisterGateway(ctx context.Context, mux *runtime.ServeMux) error {
	if err := documentspb.RegisterDocumentsServiceHandlerServer(ctx, mux, a.documents); err != nil {
		return fmt.Errorf("pdf: register documents gateway: %w", err)
	}
	if err := signingpb.RegisterSigningServiceHandlerServer(ctx, mux, a.signing); err != nil {
		return fmt.Errorf("pdf: register signing gateway: %w", err)
	}
	if err := auditpb.RegisterAuditServiceHandlerServer(ctx, mux, a.audit); err != nil {
		return fmt.Errorf("pdf: register audit gateway: %w", err)
	}
	return nil
}

// HTTPHandler returns the router for the PDF backend's HTTP surface, to be
// mounted under grown's /pdf-api/ prefix (with the prefix stripped before this
// handler runs, so it sees /api/... exactly like the standalone server). It
// combines the gRPC-gateway mux (/api/documents, /api/sign/...) with the
// raw-HTTP handlers (admin, annotations, document-replace, templates).
//
// Auth is supplied by grown: this handler expects the caller's identity to
// already be on the request context (grown's auth middleware + the HTTP bridge
// stamp it). Superadmin-gated admin routes are additionally checked against the
// PDF superadmins table via RequireSuperadmin, reading the bridged email.
func (a *App) HTTPHandler() http.Handler {
	ctx := context.Background()

	gw := runtime.NewServeMux()
	if err := a.RegisterGateway(ctx, gw); err != nil {
		// Construction-time programmer error (bad codegen) — surface loudly but
		// keep a handler so the mount doesn't nil-panic.
		slog.Error("pdf: gateway registration failed", "error", err)
	}

	mux := http.NewServeMux()

	// Admin routes — super_admin only (gated against the PDF superadmins table,
	// reading the bridged grown email from context).
	requireSA := pdfauth.RequireSuperadmin(a.db.Queries)
	mux.Handle("GET /api/admin/superadmins", requireSA(http.HandlerFunc(a.admin.ListSuperadmins)))
	mux.Handle("POST /api/admin/superadmins/", requireSA(http.HandlerFunc(a.admin.GrantSuperadmin)))
	mux.Handle("DELETE /api/admin/superadmins/", requireSA(http.HandlerFunc(a.admin.RevokeSuperadmin)))
	mux.Handle("GET /api/admin/documents", requireSA(http.HandlerFunc(a.admin.ListAllDocuments)))

	// Document annotations — any authenticated user, document-scoped.
	mux.Handle("GET /api/documents/{id}/annotations", http.HandlerFunc(a.annotations.GetAnnotations))
	mux.Handle("PUT /api/documents/{id}/annotations", http.HandlerFunc(a.annotations.PutAnnotations))
	// Guest-token read endpoint for signers (no session) — bridged identity is
	// empty here, which is correct; the handler authorizes via the token.
	mux.Handle("GET /api/sign/{token}/annotations", http.HandlerFunc(a.annotations.GetAnnotationsByToken))

	// Document replace — re-upload the regenerated PDF after in-place text edits.
	mux.Handle("POST /api/documents/{id}/replace-url", http.HandlerFunc(a.documentReplace.ReplaceURL))

	// Template routes — list, get, delete, save-as-template, create-from-template.
	mux.Handle("GET /api/templates", http.HandlerFunc(a.templates.ListTemplates))
	mux.Handle("GET /api/templates/", http.HandlerFunc(a.templates.GetTemplate))
	mux.Handle("DELETE /api/templates/", http.HandlerFunc(a.templates.DeleteTemplate))
	mux.Handle("POST /api/documents/{id}/save-as-template", http.HandlerFunc(a.templates.SaveAsTemplate))
	mux.Handle("POST /api/templates/{id}/create-document", http.HandlerFunc(a.templates.CreateDocumentFromTemplate))

	// Current-user endpoint. In built-in mode the PDF frontend's UserContext
	// calls GET /api/user/me to learn who it is; the standalone OAuth MeHandler
	// is not constructed here, so serve the bridged grown user (same
	// {id,email,name,isSuperadmin} shape the frontend expects).
	mux.HandleFunc("GET /api/user/me", func(w http.ResponseWriter, r *http.Request) {
		u, ok := grownauth.UserFromContext(r.Context())
		if !ok || u.Email == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		resp := struct {
			ID           string `json:"id"`
			Email        string `json:"email"`
			Name         string `json:"name"`
			IsSuperadmin bool   `json:"isSuperadmin"`
		}{
			ID:           u.ID,
			Email:        u.Email,
			Name:         u.DisplayName,
			IsSuperadmin: pdfauth.IsSuperadmin(r.Context(), a.db.Queries, u.Email),
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	})

	// Everything else under /api/ falls through to the gRPC gateway.
	mux.Handle("/api/", gw)

	// Health endpoint for the mounted surface.
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	return mux
}

// Close releases the PDF app's resources (the database pool).
func (a *App) Close() {
	if a.db != nil {
		a.db.Close()
	}
}
