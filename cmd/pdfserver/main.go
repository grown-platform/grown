package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/oklog/run"
	"github.com/rs/cors"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/reflection"

	"code.pick.haus/grown/grown/internal/pdf/auth"
	"code.pick.haus/grown/grown/internal/pdf/config"
	"code.pick.haus/grown/grown/internal/pdf/crypto"
	"code.pick.haus/grown/grown/internal/pdf/database"
	"code.pick.haus/grown/grown/internal/pdf/email"
	"code.pick.haus/grown/grown/internal/pdf/handler"
	"code.pick.haus/grown/grown/internal/pdf/mtls"
	"code.pick.haus/grown/grown/internal/pdf/pdf"
	"code.pick.haus/grown/grown/internal/pdf/sig"
	"code.pick.haus/grown/grown/internal/pdf/sqlc"
	"code.pick.haus/grown/grown/internal/pdf/storage"
	auditpb "code.pick.haus/grown/grown/internal/pdf/proto/audit"
	documentspb "code.pick.haus/grown/grown/internal/pdf/proto/documents"
	signingpb "code.pick.haus/grown/grown/internal/pdf/proto/signing"
)

func main() {
	// Initialize logger
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		slog.Error("Failed to load configuration", "error", err)
		os.Exit(1)
	}

	// Initialize database
	db, err := database.New(context.Background(), cfg.Database.URL)
	if err != nil {
		slog.Error("Failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	// Run migrations
	if err := database.Migrate(cfg.Database.URL); err != nil {
		slog.Error("Failed to run migrations", "error", err)
		os.Exit(1)
	}

	// Bootstrap first superadmin from env if the table is empty.
	if cfg.Auth.BootstrapSuperadminEmail != "" {
		bootCtx := context.Background()
		n, err := db.Queries.CountSuperadmins(bootCtx)
		if err != nil {
			slog.Warn("CountSuperadmins failed during bootstrap; skipping", "error", err)
		} else if n == 0 {
			grantErr := db.Queries.GrantSuperadmin(bootCtx, sqlc.GrantSuperadminParams{
				Lower:     cfg.Auth.BootstrapSuperadminEmail,
				GrantedBy: "bootstrap",
			})
			if grantErr != nil {
				slog.Error("Bootstrap superadmin grant failed", "error", grantErr, "email", cfg.Auth.BootstrapSuperadminEmail)
			} else {
				slog.Info("Bootstrapped initial superadmin", "email", cfg.Auth.BootstrapSuperadminEmail)
			}
		}
	}

	// Initialize storage client
	storageClient, err := storage.New(context.Background(), storage.Config{
		Endpoint:       cfg.Storage.Endpoint,
		PublicEndpoint: cfg.Storage.PublicEndpoint,
		Region:         cfg.Storage.Region,
		Bucket:         cfg.Storage.Bucket,
		AccessKey:      cfg.Storage.AccessKey,
		SecretKey:      cfg.Storage.SecretKey,
	})
	if err != nil {
		slog.Error("Failed to initialize storage client", "error", err)
		os.Exit(1)
	}

	// Initialize PDF generator
	pdfGenerator := pdf.New()

	// Initialize email sender
	slog.Info("Email configuration",
		"smtp_host", cfg.Email.SMTPHost,
		"smtp_port", cfg.Email.SMTPPort,
		"smtp_user", cfg.Email.SMTPUser,
		"smtp_password_set", cfg.Email.SMTPPassword != "",
		"from_address", cfg.Email.FromAddress,
	)
	emailSender := email.New(email.Config{
		SMTPHost:     cfg.Email.SMTPHost,
		SMTPPort:     cfg.Email.SMTPPort,
		SMTPUser:     cfg.Email.SMTPUser,
		SMTPPassword: cfg.Email.SMTPPassword,
		FromAddress:  cfg.Email.FromAddress,
		FromName:     cfg.Email.FromName,
		FrontendURL:  cfg.Server.FrontendURL,
	})

	// Initialize crypto keystore and certificate authority
	keystore, err := crypto.NewKeystore(cfg.Crypto.KeyEncryptionKey)
	if err != nil {
		slog.Error("Failed to initialize keystore", "error", err)
		os.Exit(1)
	}

	ca, err := crypto.NewSelfSignedCA(context.Background(), db, keystore, cfg.Crypto.OrganizationID)
	if err != nil {
		slog.Error("Failed to initialize certificate authority", "error", err)
		os.Exit(1)
	}
	slog.Info("Certificate authority initialized", "orgId", cfg.Crypto.OrganizationID)

	// Initialize mTLS authenticator
	mtlsAuth, err := mtls.NewAuthenticator(&cfg.MTLS)
	if err != nil {
		slog.Error("Failed to initialize mTLS authenticator", "error", err)
		os.Exit(1)
	}
	if cfg.MTLS.Enabled {
		slog.Info("mTLS client certificate authentication enabled",
			"verifyMode", cfg.MTLS.VerifyMode,
			"extractEmail", cfg.MTLS.ExtractEmail)
	}
	if cfg.MTLS.ProxyMode {
		slog.Info("mTLS proxy mode enabled (reading X-SSL-Client-* headers)")
	}

	// Load the trusted CA bundle used to verify browser-extension-supplied
	// signer certificates. Required when browser-extension signing is on.
	var trustedCAPool *x509.CertPool
	if cfg.Signing.BrowserExtensionEnabled {
		pool, err := sig.LoadCAPool(cfg.Signing.TrustedCABundlePath, os.ReadFile)
		if err != nil {
			slog.Error("Failed to load trusted CA bundle", "path", cfg.Signing.TrustedCABundlePath, "error", err)
			os.Exit(1)
		}
		trustedCAPool = pool
		slog.Info("Loaded trusted CA bundle for signer cert verification",
			"path", cfg.Signing.TrustedCABundlePath)
	}

	// Initialize handlers
	documentsHandler := handler.NewDocumentsHandler(db, cfg, storageClient, emailSender, pdfGenerator, trustedCAPool)
	signingHandler := handler.NewSigningHandler(db, cfg, storageClient, pdfGenerator, emailSender, ca, trustedCAPool)
	auditHandler := handler.NewAuditHandler(db, cfg)
	adminHandler := handler.NewAdminHandler(db)
	annotationsHandler := handler.NewAnnotationsHandler(db)
	documentReplaceHandler := handler.NewDocumentReplaceHandler(db, storageClient)
	templatesHandler := handler.NewTemplatesHandler(db, cfg, storageClient)

	// Initialize auth middleware and OAuth (optional - only if issuer URL is configured)
	var authMiddleware *auth.Middleware
	var oauthHandler *auth.OAuth
	if cfg.Auth.IssuerURL != "" && cfg.Auth.ClientID != "" {
		slog.Info("Initializing OIDC authentication",
			"issuer", cfg.Auth.IssuerURL,
			"client_id", cfg.Auth.ClientID)
		var err error
		authMiddleware, err = auth.NewMiddleware(context.Background(), cfg.Auth.IssuerURL, cfg.Auth.ClientID)
		if err != nil {
			slog.Error("Failed to initialize auth middleware", "error", err)
			os.Exit(1)
		}

		// Initialize OAuth handler for login/callback/logout/me
		oauthHandler, err = auth.NewOAuth(context.Background(), auth.OAuthConfig{
			IssuerURL:    cfg.Auth.IssuerURL,
			ClientID:     cfg.Auth.ClientID,
			ClientSecret: cfg.Auth.ClientSecret,
			RedirectURL:  cfg.Auth.RedirectURL,
			FrontendURL:  cfg.Server.FrontendURL,
			CookieDomain: cfg.Auth.CookieDomain, // from config (empty for localhost, ".domain.com" for prod)
			CookieSecure: cfg.Auth.CookieSecure, // from config (false for HTTP, true for HTTPS)
		})
		if err != nil {
			slog.Error("Failed to initialize OAuth handler", "error", err)
			os.Exit(1)
		}
		slog.Info("OIDC authentication enabled",
			"redirect_url", cfg.Auth.RedirectURL,
			"frontend_url", cfg.Server.FrontendURL)
	} else {
		slog.Warn("OIDC authentication disabled - no issuer URL or client ID configured")
	}

	// Create run group for graceful shutdown
	var g run.Group

	// gRPC server with optional auth interceptors
	var grpcServer *grpc.Server
	if authMiddleware != nil {
		grpcServer = grpc.NewServer(
			grpc.UnaryInterceptor(authMiddleware.UnaryServerInterceptor()),
			grpc.StreamInterceptor(authMiddleware.StreamServerInterceptor()),
		)
	} else {
		grpcServer = grpc.NewServer()
	}
	documentspb.RegisterDocumentsServiceServer(grpcServer, documentsHandler)
	signingpb.RegisterSigningServiceServer(grpcServer, signingHandler)
	auditpb.RegisterAuditServiceServer(grpcServer, auditHandler)
	reflection.Register(grpcServer)

	grpcListener, err := net.Listen("tcp", cfg.Server.GRPCAddr)
	if err != nil {
		slog.Error("Failed to listen on gRPC address", "addr", cfg.Server.GRPCAddr, "error", err)
		os.Exit(1)
	}

	g.Add(func() error {
		slog.Info("Starting gRPC server", "addr", cfg.Server.GRPCAddr)
		return grpcServer.Serve(grpcListener)
	}, func(error) {
		grpcServer.GracefulStop()
	})

	// HTTP gateway server
	ctx, cancel := context.WithCancel(context.Background())
	mux := runtime.NewServeMux()

	opts := []grpc.DialOption{grpc.WithTransportCredentials(insecure.NewCredentials())}

	if err := documentspb.RegisterDocumentsServiceHandlerFromEndpoint(ctx, mux, cfg.Server.GRPCAddr, opts); err != nil {
		slog.Error("Failed to register documents gateway", "error", err)
		os.Exit(1)
	}
	if err := signingpb.RegisterSigningServiceHandlerFromEndpoint(ctx, mux, cfg.Server.GRPCAddr, opts); err != nil {
		slog.Error("Failed to register signing gateway", "error", err)
		os.Exit(1)
	}
	if err := auditpb.RegisterAuditServiceHandlerFromEndpoint(ctx, mux, cfg.Server.GRPCAddr, opts); err != nil {
		slog.Error("Failed to register audit gateway", "error", err)
		os.Exit(1)
	}

	// Create root HTTP mux for routing
	rootMux := http.NewServeMux()

	// Health check endpoint
	rootMux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	// Auth not configured handler
	authNotConfigured := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slog.Warn("Auth route accessed but OAuth not configured", "path", r.URL.Path)
		http.Error(w, "Authentication not configured", http.StatusServiceUnavailable)
	})

	// Register OAuth routes
	if oauthHandler != nil {
		rootMux.Handle("/auth/login", oauthHandler.LoginHandler())
		rootMux.Handle("/auth/callback", oauthHandler.CallbackHandler())
		rootMux.Handle("/auth/logout", oauthHandler.LogoutHandler())
		rootMux.Handle("/api/user/me", oauthHandler.MeHandler(db.Queries))
		slog.Info("OAuth routes registered: /auth/login, /auth/callback, /auth/logout, /api/user/me")

		// Admin routes — super_admin only.
		requireSA := auth.RequireSuperadmin(db.Queries)
		rootMux.Handle("GET /api/admin/superadmins", requireSA(http.HandlerFunc(adminHandler.ListSuperadmins)))
		rootMux.Handle("POST /api/admin/superadmins/", requireSA(http.HandlerFunc(adminHandler.GrantSuperadmin)))
		rootMux.Handle("DELETE /api/admin/superadmins/", requireSA(http.HandlerFunc(adminHandler.RevokeSuperadmin)))
		rootMux.Handle("GET /api/admin/documents", requireSA(http.HandlerFunc(adminHandler.ListAllDocuments)))
		slog.Info("Admin routes registered: /api/admin/superadmins, /api/admin/documents")

		// Document annotations — any authenticated user, document-scoped.
		// Authz tightening (owner / superadmin only) is a deferred follow-up.
		rootMux.Handle("GET /api/documents/{id}/annotations", http.HandlerFunc(annotationsHandler.GetAnnotations))
		rootMux.Handle("PUT /api/documents/{id}/annotations", http.HandlerFunc(annotationsHandler.PutAnnotations))
		// Guest-token-authenticated read endpoint for signers — bypasses OIDC
		// because signers don't have a session cookie.
		rootMux.Handle("GET /api/sign/{token}/annotations", http.HandlerFunc(annotationsHandler.GetAnnotationsByToken))
		slog.Info("Annotation routes registered: /api/documents/{id}/annotations, /api/sign/{token}/annotations")

		// Document replace — re-upload the regenerated PDF after in-place text edits.
		rootMux.Handle("POST /api/documents/{id}/replace-url", http.HandlerFunc(documentReplaceHandler.ReplaceURL))
		slog.Info("Replace-URL route registered: /api/documents/{id}/replace-url")

		// Template routes — list, get, delete, save-as-template, create-from-template.
		rootMux.Handle("GET /api/templates", http.HandlerFunc(templatesHandler.ListTemplates))
		rootMux.Handle("GET /api/templates/", http.HandlerFunc(templatesHandler.GetTemplate))
		rootMux.Handle("DELETE /api/templates/", http.HandlerFunc(templatesHandler.DeleteTemplate))
		rootMux.Handle("POST /api/documents/{id}/save-as-template", http.HandlerFunc(templatesHandler.SaveAsTemplate))
		rootMux.Handle("POST /api/templates/{id}/create-document", http.HandlerFunc(templatesHandler.CreateDocumentFromTemplate))
		slog.Info("Template routes registered")
	} else {
		rootMux.Handle("/auth/login", authNotConfigured)
		rootMux.Handle("/auth/callback", authNotConfigured)
		rootMux.Handle("/auth/logout", authNotConfigured)
		rootMux.Handle("/api/user/me", authNotConfigured)
		slog.Warn("Auth routes registered with 503 fallback (auth not configured)")
	}

	// Route API calls through gRPC gateway
	rootMux.Handle("/api/", mux)

	// Serve static files if configured (for bundled deployment)
	if cfg.Server.StaticDir != "" {
		if _, err := os.Stat(cfg.Server.StaticDir); err == nil {
			slog.Info("Serving static files", "directory", cfg.Server.StaticDir)
			fileServer := http.FileServer(http.Dir(cfg.Server.StaticDir))
			rootMux.Handle("/", spaHandler(fileServer, cfg.Server.StaticDir))
		} else {
			slog.Warn("Static directory not found, static file serving disabled", "directory", cfg.Server.StaticDir)
		}
	}

	// CORS handler wraps the entire root mux (both OAuth and gRPC routes).
	// X-Requested-With is allow-listed so the frontend can send the CSRF
	// gate header set by auth.CSRFMiddleware below.
	corsHandler := cors.New(cors.Options{
		AllowedOrigins:   cfg.Server.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Org-Id", "X-Requested-With"},
		AllowCredentials: true,
	}).Handler(rootMux)

	// Build handler chain: ProxyAuth (outermost) -> mTLS -> Auth (OIDC) -> CSRF -> CORS -> root mux
	var httpHandler http.Handler = corsHandler

	// CSRF gate on state-changing /api/* requests. Runs after CORS so legitimate
	// preflight OPTIONS pass; runs before auth so the gate fails fast.
	httpHandler = auth.CSRFMiddleware(httpHandler)

	// Add OIDC auth middleware if configured
	if authMiddleware != nil {
		httpHandler = authMiddleware.HTTPMiddleware(httpHandler)
	}

	// Add mTLS middleware if configured (existing cert-based identity)
	if cfg.MTLS.Enabled || cfg.MTLS.ProxyMode {
		httpHandler = mtlsAuth.Middleware(httpHandler)
	}

	// Proxy-auth middleware is outermost: it strips client-supplied identity
	// headers before anything else gets to read them, and validates that
	// the request really came from our trusted proxy.
	if cfg.MTLS.ProxyMode {
		httpHandler = mtls.ProxyAuthMiddleware(cfg.MTLS.ProxySharedSecret)(httpHandler)
		slog.Info("Proxy-auth middleware enabled (X-Proxy-Auth required)")
	}

	httpServer := &http.Server{
		Addr:    cfg.Server.HTTPAddr,
		Handler: httpHandler,
	}

	// Configure TLS if mTLS is enabled
	var tlsConfig *tls.Config
	if cfg.MTLS.Enabled {
		tlsConfig, err = mtlsAuth.TLSConfig()
		if err != nil {
			slog.Error("Failed to configure mTLS", "error", err)
			os.Exit(1)
		}
		httpServer.TLSConfig = tlsConfig
	}

	g.Add(func() error {
		if cfg.MTLS.Enabled {
			slog.Info("Starting HTTPS gateway server with mTLS", "addr", cfg.Server.HTTPAddr)
			return httpServer.ListenAndServeTLS("", "") // Certs are in TLSConfig
		}
		slog.Info("Starting HTTP gateway server", "addr", cfg.Server.HTTPAddr)
		return httpServer.ListenAndServe()
	}, func(error) {
		cancel()
		httpServer.Shutdown(context.Background())
	})

	// Signal handler
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	g.Add(func() error {
		sig := <-sigChan
		return fmt.Errorf("received signal: %v", sig)
	}, func(error) {
		close(sigChan)
	})

	// Run
	slog.Info("Pdf server starting...")
	if err := g.Run(); err != nil {
		slog.Info("Server stopped", "reason", err)
	}
}

// spaHandler wraps a file server to support SPA routing.
// It serves index.html for any path that doesn't match a static file.
func spaHandler(fileServer http.Handler, staticDir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Clean the path
		path := filepath.Clean(r.URL.Path)
		if path == "/" {
			path = "/index.html"
		}

		// Check if file exists
		fullPath := filepath.Join(staticDir, path)
		if _, err := os.Stat(fullPath); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}

		// For SPA routes, serve index.html
		// But not for API routes or auth routes (those should 404)
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/auth/") {
			http.NotFound(w, r)
			return
		}

		// Serve index.html for client-side routing
		indexPath := filepath.Join(staticDir, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			http.ServeFile(w, r, indexPath)
			return
		}

		http.NotFound(w, r)
	})
}
