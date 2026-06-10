package config

import (
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/env"
	"github.com/knadh/koanf/providers/file"
	"github.com/knadh/koanf/v2"
)

type Config struct {
	Server   ServerConfig   `koanf:"server"`
	Database DatabaseConfig `koanf:"database"`
	Storage  StorageConfig  `koanf:"storage"`
	Auth     AuthConfig     `koanf:"auth"`
	Email    EmailConfig    `koanf:"email"`
	Crypto   CryptoConfig   `koanf:"crypto"`
	MTLS     MTLSConfig     `koanf:"mtls"`
	Signing  SigningConfig  `koanf:"signing"`
}

type ServerConfig struct {
	GRPCAddr    string   `koanf:"grpc_addr"`
	HTTPAddr    string   `koanf:"http_addr"`
	CORSOrigins []string `koanf:"cors_origins"`
	FrontendURL string   `koanf:"frontend_url"`
	StaticDir   string   `koanf:"static_dir"` // Directory to serve static files from (for bundled deployment)
}

type DatabaseConfig struct {
	URL string `koanf:"url"`
}

type StorageConfig struct {
	Endpoint       string `koanf:"endpoint"`
	PublicEndpoint string `koanf:"public_endpoint"` // Public URL for browser-accessible presigned URLs
	Region         string `koanf:"region"`
	Bucket         string `koanf:"bucket"`
	AccessKey      string `koanf:"access_key"`
	SecretKey      string `koanf:"secret_key"`
}

type AuthConfig struct {
	IssuerURL    string `koanf:"issuer_url"`
	ClientID     string `koanf:"client_id"`
	ClientSecret string `koanf:"client_secret"`
	RedirectURL  string `koanf:"redirect_url"`
	CookieDomain string `koanf:"cookie_domain"` // Domain for auth cookies (e.g., ".pick.haus")
	CookieSecure bool   `koanf:"cookie_secure"` // Set to true for HTTPS

	// BootstrapSuperadminEmail is the email granted superadmin on first
	// boot when the `superadmins` table is empty. Idempotent: only runs
	// when zero superadmins exist. If unset, no bootstrap happens.
	BootstrapSuperadminEmail string `koanf:"bootstrap_superadmin_email"`
}

type EmailConfig struct {
	SMTPHost     string `koanf:"smtp_host"`
	SMTPPort     int    `koanf:"smtp_port"`
	SMTPUser     string `koanf:"smtp_user"`
	SMTPPassword string `koanf:"smtp_password"`
	FromAddress  string `koanf:"from_address"`
	FromName     string `koanf:"from_name"`
}

type CryptoConfig struct {
	// KeyEncryptionKey is a base64-encoded 32-byte key for encrypting private keys.
	// If empty, a random key will be generated (suitable for development only).
	KeyEncryptionKey string `koanf:"key_encryption_key"`

	// TSAUrl is the optional RFC 3161 timestamp server URL.
	// Example: http://timestamp.digicert.com
	TSAUrl string `koanf:"tsa_url"`

	// OrganizationID is the organization ID for the signing CA.
	// Defaults to "default_org" if not set.
	OrganizationID string `koanf:"organization_id"`
}

// MTLSConfig configures mutual TLS client certificate authentication.
// This enables authentication via smart cards (CAC, YubiKey PIV, etc.)
type MTLSConfig struct {
	// Enabled enables direct mTLS client certificate authentication.
	// When true, the server terminates TLS and verifies client certs directly.
	Enabled bool `koanf:"enabled"`

	// ProxyMode enables reading client cert info from reverse proxy headers.
	// Use this when TLS is terminated by nginx/etc. which passes X-SSL-Client-* headers.
	// Can be used together with Enabled or standalone.
	ProxyMode bool `koanf:"proxy_mode"`

	// CertFile is the path to the server's TLS certificate.
	CertFile string `koanf:"cert_file"`

	// KeyFile is the path to the server's TLS private key.
	KeyFile string `koanf:"key_file"`

	// ClientCAFile is the path to a PEM file containing trusted CA certificates
	// for validating client certificates. Can contain multiple CAs.
	// For DoD CAC support, include the DoD Root CA bundle.
	ClientCAFile string `koanf:"client_ca_file"`

	// ClientCADir is an optional directory containing CA certificate files.
	// Each file should contain a single CA certificate in PEM format.
	ClientCADir string `koanf:"client_ca_dir"`

	// VerifyMode controls client certificate verification:
	// - "require" - Client must present a valid certificate (default when enabled)
	// - "optional" - Client certificate is validated if presented, but not required
	// - "none" - Accept any certificate (for testing only)
	VerifyMode string `koanf:"verify_mode"`

	// AllowedOUs is an optional list of allowed Organizational Units.
	// If set, only certificates with matching OUs are accepted.
	// Useful for restricting to specific DoD organizations.
	AllowedOUs []string `koanf:"allowed_ous"`

	// ExtractEmail controls how email is extracted from client certificates:
	// - "san" - From Subject Alternative Name email (default)
	// - "subject" - From Subject DN emailAddress field
	// - "upn" - From UPN in SAN (common for CAC cards)
	ExtractEmail string `koanf:"extract_email"`

	// ProxySharedSecret is a shared secret the trusted reverse proxy must
	// send in the X-Proxy-Auth header. Required when ProxyMode=true.
	// Must be at least 32 characters.
	ProxySharedSecret string `koanf:"proxy_shared_secret"`
}

// SigningConfig configures document signing options.
type SigningConfig struct {
	// CACMTLSEnabled enables CAC/PIV signing via mTLS redirect.
	// When true, users can sign with their CAC by redirecting through the mTLS endpoint.
	// The server signs the PDF but captures the CAC certificate identity.
	CACMTLSEnabled bool `koanf:"cac_mtls_enabled"`

	// CACMTLSEndpoint is the URL of the mTLS endpoint for CAC signing.
	// Example: https://pdf.pick.haus:8443
	CACMTLSEndpoint string `koanf:"cac_mtls_endpoint"`

	// BrowserExtensionEnabled enables true hardware signing via browser extension.
	// When true, users with the Pdf Signing Agent extension can sign with
	// their CAC/YubiKey's private key.
	BrowserExtensionEnabled bool `koanf:"browser_extension_enabled"`

	// DefaultMethod is the default signing method when multiple are available.
	// Options: "typed" (typed signature), "drawn" (drawn signature),
	//          "cac_mtls" (CAC via mTLS), "cac_extension" (CAC via extension)
	DefaultMethod string `koanf:"default_method"`

	// TrustedCABundlePath is the path to a PEM file containing the root CAs
	// that signer certificates must chain to. Required when BrowserExtensionEnabled=true.
	TrustedCABundlePath string `koanf:"trusted_ca_bundle_path"`
}

func Load() (*Config, error) {
	k := koanf.New(".")

	// Load defaults
	defaults := map[string]interface{}{
		"server.grpc_addr":    ":50053",
		"server.http_addr":    ":8085",
		"server.cors_origins": []string{"http://localhost:5173", "http://localhost:3000"},
		"server.frontend_url": "http://localhost:5173",
		"database.url":        "postgres://pdf:pdf@localhost:5433/pdf?sslmode=disable",
		"storage.region":      "us-east-1",
		"storage.bucket":      "pdf-documents",
		// Resend SMTP defaults
		"email.smtp_host":    "smtp.resend.com",
		"email.smtp_port":    587,
		"email.smtp_user":    "resend",
		"email.from_address": "noreply@pick.haus",
		"email.from_name":    "Pdf",
		// Crypto defaults
		"crypto.organization_id": "default_org",
		// mTLS defaults
		"mtls.enabled":       false,
		"mtls.proxy_mode":    false,
		"mtls.verify_mode":   "optional",
		"mtls.extract_email": "san",
		// Signing defaults
		"signing.cac_mtls_enabled":          false,
		"signing.cac_mtls_endpoint":         "https://localhost:8443",
		"signing.browser_extension_enabled": false,
		"signing.default_method":            "typed",
		// Auth cookie defaults. Empty domain = host-only cookie: it binds to
		// whatever host served the response, so it works both standalone
		// (localhost) and behind grown's reverse proxy (workspace.localtest.me).
		// A fixed "localhost" here is rejected by the browser when the app is
		// served from any other host. Override with PDF_AUTH_COOKIE_DOMAIN.
		"auth.cookie_domain": "",
		"auth.cookie_secure": false,
	}

	for key, value := range defaults {
		k.Set(key, value)
	}

	// Load from config file if exists
	if err := k.Load(file.Provider("config.yaml"), yaml.Parser()); err != nil {
		// Ignore file not found
	}

	// Load from environment variables.
	// Primary prefix is PDF_; the legacy PDF_ prefix is read as a
	// fallback for the deployment grace window — when an old PDF_* name
	// is observed, we log a deprecation warning. PDF_* wins on conflict
	// because it is loaded last.
	// e.g., PDF_SERVER_GRPC_ADDR -> server.grpc_addr
	keyTransform := func(prefix string) func(string) string {
		return func(s string) string {
			s = strings.ToLower(strings.TrimPrefix(s, prefix))
			// Split into parts and rejoin with first part as section, rest as field
			parts := strings.SplitN(s, "_", 2)
			if len(parts) == 2 {
				return parts[0] + "." + parts[1]
			}
			return s
		}
	}

	// Legacy PDF_* prefix (deprecated; logs a warning per variable seen).
	var legacyVars []string
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "PDF_") {
			name := kv
			if eq := strings.Index(kv, "="); eq >= 0 {
				name = kv[:eq]
			}
			legacyVars = append(legacyVars, name)
		}
	}
	if len(legacyVars) > 0 {
		slog.Warn("deprecated PDF_* environment variables in use; please rename to PDF_*",
			"variables", legacyVars)
		if err := k.Load(env.Provider("PDF_", ".", keyTransform("PDF_")), nil); err != nil {
			return nil, err
		}
	}

	// Primary PDF_* prefix.
	if err := k.Load(env.Provider("PDF_", ".", keyTransform("PDF_")), nil); err != nil {
		return nil, err
	}

	var cfg Config
	if err := k.Unmarshal("", &cfg); err != nil {
		return nil, err
	}

	if cfg.MTLS.ProxyMode {
		if cfg.MTLS.ProxySharedSecret == "" {
			return nil, fmt.Errorf("mtls.proxy_shared_secret is required when mtls.proxy_mode=true")
		}
		if len(cfg.MTLS.ProxySharedSecret) < 32 {
			return nil, fmt.Errorf("mtls.proxy_shared_secret must be at least 32 characters, got %d", len(cfg.MTLS.ProxySharedSecret))
		}
	}
	if cfg.Signing.BrowserExtensionEnabled && cfg.Signing.TrustedCABundlePath == "" {
		return nil, fmt.Errorf("signing.trusted_ca_bundle_path is required when signing.browser_extension_enabled=true")
	}

	return &cfg, nil
}
