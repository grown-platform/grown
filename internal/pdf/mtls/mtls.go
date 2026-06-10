// Package mtls provides mutual TLS client certificate authentication.
// It supports smart cards (DoD CAC, YubiKey PIV) and other X.509 certificates.
package mtls

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"code.pick.haus/grown/grown/internal/pdf/config"
)

// contextKey is the type for context keys to avoid collisions.
type contextKey string

const (
	// ClientCertKey is the context key for the client certificate.
	ClientCertKey contextKey = "clientCert"
	// ClientIdentityKey is the context key for the extracted client identity.
	ClientIdentityKey contextKey = "clientIdentity"
)

// ClientIdentity represents the authenticated identity from a client certificate.
type ClientIdentity struct {
	// Certificate is the raw X.509 certificate.
	Certificate *x509.Certificate

	// Email is the email address extracted from the certificate.
	Email string

	// CommonName is the CN from the certificate subject.
	CommonName string

	// Organization is the O from the certificate subject.
	Organization string

	// OrganizationalUnit is the OU from the certificate subject.
	OrganizationalUnit string

	// SerialNumber is the certificate serial number.
	SerialNumber string

	// Issuer is the certificate issuer DN.
	Issuer string

	// Subject is the full subject DN.
	Subject string
}

// Authenticator handles mTLS client certificate authentication.
type Authenticator struct {
	cfg      *config.MTLSConfig
	clientCA *x509.CertPool
}

// NewAuthenticator creates a new mTLS authenticator.
func NewAuthenticator(cfg *config.MTLSConfig) (*Authenticator, error) {
	if !cfg.Enabled {
		return &Authenticator{cfg: cfg}, nil
	}

	// Load client CA certificates
	clientCA := x509.NewCertPool()

	// Load from file if specified
	if cfg.ClientCAFile != "" {
		caCert, err := os.ReadFile(cfg.ClientCAFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read client CA file: %w", err)
		}
		if !clientCA.AppendCertsFromPEM(caCert) {
			return nil, fmt.Errorf("failed to parse client CA certificates")
		}
		slog.Info("Loaded client CA certificates from file", "file", cfg.ClientCAFile)
	}

	// Load from directory if specified
	if cfg.ClientCADir != "" {
		entries, err := os.ReadDir(cfg.ClientCADir)
		if err != nil {
			return nil, fmt.Errorf("failed to read client CA directory: %w", err)
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			if !strings.HasSuffix(entry.Name(), ".pem") && !strings.HasSuffix(entry.Name(), ".crt") {
				continue
			}
			path := filepath.Join(cfg.ClientCADir, entry.Name())
			caCert, err := os.ReadFile(path)
			if err != nil {
				slog.Warn("Failed to read CA file", "path", path, "error", err)
				continue
			}
			if clientCA.AppendCertsFromPEM(caCert) {
				slog.Info("Loaded client CA certificate", "file", entry.Name())
			}
		}
	}

	// If no CAs loaded and verification is required, use system roots
	if cfg.ClientCAFile == "" && cfg.ClientCADir == "" {
		systemRoots, err := x509.SystemCertPool()
		if err != nil {
			slog.Warn("Failed to load system cert pool, using empty pool", "error", err)
		} else {
			clientCA = systemRoots
			slog.Info("Using system certificate pool for client verification")
		}
	}

	return &Authenticator{
		cfg:      cfg,
		clientCA: clientCA,
	}, nil
}

// TLSConfig returns a TLS configuration with client certificate verification.
func (a *Authenticator) TLSConfig() (*tls.Config, error) {
	if !a.cfg.Enabled {
		return nil, nil
	}

	// Load server certificate
	cert, err := tls.LoadX509KeyPair(a.cfg.CertFile, a.cfg.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("failed to load server certificate: %w", err)
	}

	// Determine client auth type
	var clientAuth tls.ClientAuthType
	switch a.cfg.VerifyMode {
	case "none":
		clientAuth = tls.RequestClientCert
	case "optional":
		clientAuth = tls.VerifyClientCertIfGiven
	case "require", "":
		clientAuth = tls.RequireAndVerifyClientCert
	default:
		return nil, fmt.Errorf("invalid verify_mode: %s", a.cfg.VerifyMode)
	}

	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		ClientCAs:    a.clientCA,
		ClientAuth:   clientAuth,
		MinVersion:   tls.VersionTLS12,
	}, nil
}

// Middleware returns an HTTP middleware that extracts client certificate identity.
// It supports both direct mTLS and proxy mode (via X-SSL-Client-* headers from nginx).
func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.cfg.Enabled && !a.cfg.ProxyMode {
			next.ServeHTTP(w, r)
			return
		}

		var identity *ClientIdentity
		var cert *x509.Certificate

		// Try direct TLS connection first
		if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
			cert = r.TLS.PeerCertificates[0]
			var err error
			identity, err = a.extractIdentity(cert)
			if err != nil {
				slog.Warn("Failed to extract identity from certificate", "error", err, "subject", cert.Subject)
				http.Error(w, "Invalid client certificate", http.StatusUnauthorized)
				return
			}
		} else {
			// Try extracting from proxy headers (nginx passes these)
			identity, cert = a.extractFromProxyHeaders(r)
		}

		// No certificate found
		if identity == nil {
			if a.cfg.VerifyMode == "require" {
				http.Error(w, "Client certificate required", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		// Check allowed OUs if configured
		if len(a.cfg.AllowedOUs) > 0 && cert != nil {
			allowed := false
			for _, ou := range a.cfg.AllowedOUs {
				for _, certOU := range cert.Subject.OrganizationalUnit {
					if certOU == ou {
						allowed = true
						break
					}
				}
			}
			if !allowed {
				slog.Warn("Certificate OU not in allowed list", "ou", cert.Subject.OrganizationalUnit, "allowed", a.cfg.AllowedOUs)
				http.Error(w, "Certificate not authorized", http.StatusForbidden)
				return
			}
		}

		slog.Info("Client authenticated via certificate",
			"email", identity.Email,
			"cn", identity.CommonName,
			"org", identity.Organization,
			"serial", identity.SerialNumber)

		// Add certificate and identity to context
		ctx := r.Context()
		if cert != nil {
			ctx = context.WithValue(ctx, ClientCertKey, cert)
		}
		ctx = context.WithValue(ctx, ClientIdentityKey, identity)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// extractFromProxyHeaders extracts client certificate info from nginx proxy headers.
// Headers: X-SSL-Client-Verify, X-SSL-Client-DN, X-SSL-Client-Cert, X-SSL-Client-Serial
func (a *Authenticator) extractFromProxyHeaders(r *http.Request) (*ClientIdentity, *x509.Certificate) {
	// Check if nginx verified the client
	verify := r.Header.Get("X-SSL-Client-Verify")
	if verify != "SUCCESS" && verify != "NONE" {
		// No valid client cert or verification failed
		if verify != "" {
			slog.Debug("Proxy client cert verification status", "status", verify)
		}
		return nil, nil
	}

	// If NONE, no cert was presented
	if verify == "NONE" {
		return nil, nil
	}

	// Parse the client certificate if provided
	certPEM := r.Header.Get("X-SSL-Client-Cert")
	var cert *x509.Certificate
	if certPEM != "" {
		// URL-decode the certificate (nginx escapes it)
		certPEM = strings.ReplaceAll(certPEM, "%20", " ")
		certPEM = strings.ReplaceAll(certPEM, "%0A", "\n")
		certPEM = strings.ReplaceAll(certPEM, "%2B", "+")
		certPEM = strings.ReplaceAll(certPEM, "%2F", "/")
		certPEM = strings.ReplaceAll(certPEM, "%3D", "=")

		block, _ := pem.Decode([]byte(certPEM))
		if block != nil {
			var err error
			cert, err = x509.ParseCertificate(block.Bytes)
			if err != nil {
				slog.Warn("Failed to parse client certificate from proxy header", "error", err)
			}
		}
	}

	// If we have the cert, extract identity from it
	if cert != nil {
		identity, err := a.extractIdentity(cert)
		if err != nil {
			slog.Warn("Failed to extract identity from proxy cert", "error", err)
			return nil, nil
		}
		return identity, cert
	}

	// Fall back to DN header if cert wasn't passed
	dn := r.Header.Get("X-SSL-Client-DN")
	if dn == "" {
		return nil, nil
	}

	// Parse DN to extract identity (format: /CN=Name/O=Org/...)
	identity := &ClientIdentity{
		Subject:      dn,
		SerialNumber: r.Header.Get("X-SSL-Client-Serial"),
	}

	// Parse DN components
	for _, part := range strings.Split(dn, "/") {
		if part == "" {
			continue
		}
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch kv[0] {
		case "CN":
			identity.CommonName = kv[1]
		case "O":
			identity.Organization = kv[1]
		case "OU":
			identity.OrganizationalUnit = kv[1]
		case "emailAddress":
			identity.Email = kv[1]
		}
	}

	return identity, nil
}

// extractIdentity extracts the user identity from a client certificate.
func (a *Authenticator) extractIdentity(cert *x509.Certificate) (*ClientIdentity, error) {
	identity := &ClientIdentity{
		Certificate:  cert,
		CommonName:   cert.Subject.CommonName,
		SerialNumber: cert.SerialNumber.String(),
		Issuer:       cert.Issuer.String(),
		Subject:      cert.Subject.String(),
	}

	// Extract organization
	if len(cert.Subject.Organization) > 0 {
		identity.Organization = cert.Subject.Organization[0]
	}

	// Extract organizational unit
	if len(cert.Subject.OrganizationalUnit) > 0 {
		identity.OrganizationalUnit = cert.Subject.OrganizationalUnit[0]
	}

	// Extract email based on configuration
	switch a.cfg.ExtractEmail {
	case "subject":
		// Look in subject emailAddress field
		for _, name := range cert.Subject.Names {
			if name.Type.String() == "1.2.840.113549.1.9.1" { // emailAddress OID
				if email, ok := name.Value.(string); ok {
					identity.Email = email
					break
				}
			}
		}
	case "upn":
		// Look for UPN in Subject Alternative Names (common for CAC)
		// UPN is in the otherName SAN with OID 1.3.6.1.4.1.311.20.2.3
		// This requires parsing the raw SAN extension
		identity.Email = extractUPNFromCert(cert)
	case "san", "":
		// Default: Look in SAN email addresses
		if len(cert.EmailAddresses) > 0 {
			identity.Email = cert.EmailAddresses[0]
		}
	}

	// Fallback: try all methods if email not found
	if identity.Email == "" {
		if len(cert.EmailAddresses) > 0 {
			identity.Email = cert.EmailAddresses[0]
		}
	}

	return identity, nil
}

// extractUPNFromCert attempts to extract the User Principal Name from a certificate.
// This is commonly used in DoD CAC cards.
func extractUPNFromCert(cert *x509.Certificate) string {
	// UPN OID: 1.3.6.1.4.1.311.20.2.3
	// This requires parsing the raw SAN extension which is complex
	// For now, fall back to email addresses
	if len(cert.EmailAddresses) > 0 {
		return cert.EmailAddresses[0]
	}
	return ""
}

// GetClientIdentity retrieves the client identity from a context.
func GetClientIdentity(ctx context.Context) *ClientIdentity {
	if identity, ok := ctx.Value(ClientIdentityKey).(*ClientIdentity); ok {
		return identity
	}
	return nil
}

// GetClientCert retrieves the client certificate from a context.
func GetClientCert(ctx context.Context) *x509.Certificate {
	if cert, ok := ctx.Value(ClientCertKey).(*x509.Certificate); ok {
		return cert
	}
	return nil
}
