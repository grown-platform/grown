//go:build pkcs11

// PKCS#11 / HSM-backed signing (YubiKey, SoftHSM, etc.). Requires cgo + a
// PKCS#11 shared library, so it is excluded from the default static
// (CGO_ENABLED=0) build; build with `-tags pkcs11` (and CGO enabled) to use it.
// The default build uses the software self-signed CA (ca.go) instead.
package crypto

import (
	"context"
	"crypto"
	"crypto/x509"
	"fmt"
	"log/slog"
	"os"

	"github.com/ThalesIgnite/crypto11"
)

// PKCS11Config contains configuration for PKCS#11 signing.
type PKCS11Config struct {
	// Path to the PKCS#11 module library
	// macOS YubiKey: /usr/local/lib/libykcs11.dylib
	// Linux YubiKey: /usr/lib/x86_64-linux-gnu/libykcs11.so or /usr/lib/libykcs11.so
	ModulePath string

	// PIN for the token
	PIN string

	// Slot ID (optional, will use first slot if not specified)
	SlotID *int

	// Token label (optional, alternative to SlotID)
	TokenLabel string

	// Key label to identify the signing key (e.g., "Digital Signature" for PIV slot 9c)
	KeyLabel string
}

// PKCS11CA implements CertificateAuthority using a PKCS#11 hardware token (e.g., YubiKey).
type PKCS11CA struct {
	ctx    *crypto11.Context
	signer crypto11.Signer
	cert   *x509.Certificate
}

// NewPKCS11CA creates a new PKCS#11 CA using a hardware token.
func NewPKCS11CA(cfg PKCS11Config) (*PKCS11CA, error) {
	// Build crypto11 config
	config := &crypto11.Config{
		Path: cfg.ModulePath,
		Pin:  cfg.PIN,
	}

	// Set token selection - prefer TokenLabel, then SlotID, then default to slot 0
	if cfg.TokenLabel != "" {
		config.TokenLabel = cfg.TokenLabel
	} else if cfg.SlotID != nil {
		config.SlotNumber = cfg.SlotID
	} else {
		// Default to slot 0
		slot := 0
		config.SlotNumber = &slot
	}

	// Initialize PKCS#11 context
	ctx, err := crypto11.Configure(config)
	if err != nil {
		return nil, fmt.Errorf("failed to configure PKCS#11: %w", err)
	}

	// Find the signing key
	// For YubiKey PIV slot 9c (Digital Signature), the key is labeled "Private key for Digital Signature"
	// Try to find by label or by iterating
	var signer crypto11.Signer

	if cfg.KeyLabel != "" {
		signer, err = ctx.FindKeyPair(nil, []byte(cfg.KeyLabel))
		if err != nil {
			// Try alternate label patterns
			signer, err = ctx.FindKeyPair(nil, []byte("Private key for Digital Signature"))
		}
	}

	// If still not found, try to get all key pairs and use the first one
	if signer == nil {
		keyPairs, err := ctx.FindAllKeyPairs()
		if err != nil {
			ctx.Close()
			return nil, fmt.Errorf("failed to find key pairs: %w", err)
		}
		if len(keyPairs) == 0 {
			ctx.Close()
			return nil, fmt.Errorf("no key pairs found on token")
		}
		signer = keyPairs[0]
		slog.Info("Using first available key pair from token")
	}

	if signer == nil {
		ctx.Close()
		return nil, fmt.Errorf("no signing key found on token")
	}

	// Find the certificate associated with the key
	certs, err := ctx.FindAllPairedCertificates()
	if err != nil {
		ctx.Close()
		return nil, fmt.Errorf("failed to find certificates: %w", err)
	}

	var cert *x509.Certificate
	for _, c := range certs {
		// tls.Certificate has Leaf field for the parsed cert
		if c.Leaf != nil {
			cert = c.Leaf
			break
		}
		// If Leaf is nil, parse the first certificate in the chain
		if len(c.Certificate) > 0 {
			parsed, err := x509.ParseCertificate(c.Certificate[0])
			if err == nil {
				cert = parsed
				break
			}
		}
	}

	if cert == nil {
		ctx.Close()
		return nil, fmt.Errorf("no certificate found on token")
	}

	slog.Info("PKCS#11 CA initialized",
		"subject", cert.Subject.CommonName,
		"issuer", cert.Issuer.CommonName,
		"serial", cert.SerialNumber.String(),
		"validTo", cert.NotAfter)

	return &PKCS11CA{
		ctx:    ctx,
		signer: signer,
		cert:   cert,
	}, nil
}

// GetOrCreateSignerCertificate returns the hardware token's certificate and signer.
// For PKCS#11, we use the same certificate for all signing operations.
func (ca *PKCS11CA) GetOrCreateSignerCertificate(ctx context.Context, orgID, email, name string) (*x509.Certificate, crypto.PrivateKey, error) {
	// With PKCS#11, we use the hardware token's certificate
	// The signer implements crypto.Signer interface
	slog.Info("Using PKCS#11 hardware key for signing",
		"requestedName", name,
		"requestedEmail", email,
		"actualCertSubject", ca.cert.Subject.CommonName)

	return ca.cert, ca.signer, nil
}

// GetCACertificate returns the certificate (for self-signed certs, this is the same as the signing cert).
func (ca *PKCS11CA) GetCACertificate() *x509.Certificate {
	// For self-signed certificates on hardware tokens, the cert is its own CA
	// In production with a CA-issued cert, you'd return the actual CA cert
	return ca.cert
}

// Close releases PKCS#11 resources.
func (ca *PKCS11CA) Close() error {
	if ca.ctx != nil {
		return ca.ctx.Close()
	}
	return nil
}

// GetYubiKeyModulePath returns the PKCS#11 module path for YubiKey.
// It checks the PKCS11_MODULE_PATH environment variable first, then searches common paths.
func GetYubiKeyModulePath() string {
	// Check environment variable first (set by Nix flake)
	if envPath := os.Getenv("PKCS11_MODULE_PATH"); envPath != "" && fileExists(envPath) {
		return envPath
	}

	// Common paths for YubiKey PKCS#11 module
	paths := []string{
		// Nix store (this specific hash will change with updates)
		"/nix/store/74i32wilxy5f2b15g57hxygid8q7yry0-yubico-piv-tool-2.7.2/lib/libykcs11.so",
		// macOS Homebrew
		"/usr/local/lib/libykcs11.dylib",
		"/opt/homebrew/lib/libykcs11.dylib",
		// Debian/Ubuntu
		"/usr/lib/x86_64-linux-gnu/libykcs11.so",
		// Generic Linux
		"/usr/lib/libykcs11.so",
		// Linux ARM64
		"/usr/lib/aarch64-linux-gnu/libykcs11.so",
		// Windows
		"C:\\Program Files\\Yubico\\Yubico PIV Tool\\bin\\libykcs11.dll",
	}

	for _, p := range paths {
		if fileExists(p) {
			return p
		}
	}

	// Fallback to first path
	return paths[0]
}

// FindYubiKeyModulePath searches for libykcs11 in Nix store and common locations.
func FindYubiKeyModulePath() (string, error) {
	path := GetYubiKeyModulePath()
	if fileExists(path) {
		return path, nil
	}
	return "", fmt.Errorf("libykcs11 not found - install yubico-piv-tool package")
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
