package config

import (
	"strings"
	"testing"
)

func TestLoad_ProxyModeRequiresSharedSecret(t *testing.T) {
	t.Setenv("PDF_MTLS_PROXY_MODE", "true")
	t.Setenv("PDF_MTLS_PROXY_SHARED_SECRET", "")

	_, err := Load()
	if err == nil {
		t.Fatal("expected Load to fail when proxy_mode=true and proxy_shared_secret empty")
	}
	if !strings.Contains(err.Error(), "proxy_shared_secret") {
		t.Fatalf("expected error to mention proxy_shared_secret, got: %v", err)
	}
}

func TestLoad_ProxyModeShortSecretRejected(t *testing.T) {
	t.Setenv("PDF_MTLS_PROXY_MODE", "true")
	t.Setenv("PDF_MTLS_PROXY_SHARED_SECRET", "tooshort")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "proxy_shared_secret") || !strings.Contains(err.Error(), "32") {
		t.Fatalf("expected proxy_shared_secret length error mentioning 32, got: %v", err)
	}
}

func TestLoad_BrowserExtensionRequiresCABundle(t *testing.T) {
	t.Setenv("PDF_SIGNING_BROWSER_EXTENSION_ENABLED", "true")
	t.Setenv("PDF_SIGNING_TRUSTED_CA_BUNDLE_PATH", "")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "trusted_ca_bundle_path") {
		t.Fatalf("expected error to mention trusted_ca_bundle_path, got: %v", err)
	}
}

func TestLoad_ProxyModeWithValidSecretSucceeds(t *testing.T) {
	t.Setenv("PDF_MTLS_PROXY_MODE", "true")
	t.Setenv("PDF_MTLS_PROXY_SHARED_SECRET", "this-is-a-32-char-secret-aaaaaaaa")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if !cfg.MTLS.ProxyMode {
		t.Fatal("expected ProxyMode=true")
	}
	if cfg.MTLS.ProxySharedSecret != "this-is-a-32-char-secret-aaaaaaaa" {
		t.Fatalf("expected secret to load, got %q", cfg.MTLS.ProxySharedSecret)
	}
}

func TestLoad_BrowserExtensionWithCABundleSucceeds(t *testing.T) {
	t.Setenv("PDF_SIGNING_BROWSER_EXTENSION_ENABLED", "true")
	t.Setenv("PDF_SIGNING_TRUSTED_CA_BUNDLE_PATH", "/tmp/pdf-dev-ca.pem")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if !cfg.Signing.BrowserExtensionEnabled {
		t.Fatal("expected BrowserExtensionEnabled=true")
	}
	if cfg.Signing.TrustedCABundlePath != "/tmp/pdf-dev-ca.pem" {
		t.Fatalf("expected CA bundle path to load, got %q", cfg.Signing.TrustedCABundlePath)
	}
}

func TestLoad_BootstrapSuperadminEmailFromEnv(t *testing.T) {
	t.Setenv("PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL", "admin@example.com")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Auth.BootstrapSuperadminEmail != "admin@example.com" {
		t.Fatalf("expected admin@example.com, got %q", cfg.Auth.BootstrapSuperadminEmail)
	}
}

// TestLoad_PdfPrefix verifies the primary PDF_* prefix is read.
func TestLoad_PdfPrefix(t *testing.T) {
	t.Setenv("PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL", "primary@example.com")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Auth.BootstrapSuperadminEmail != "primary@example.com" {
		t.Fatalf("expected primary@example.com, got %q", cfg.Auth.BootstrapSuperadminEmail)
	}
}

// TestLoad_PdfWinsOverPdf verifies that when both prefixes are
// present, the new PDF_* value takes precedence over the deprecated
// PDF_* value.
func TestLoad_PdfWinsOverPdf(t *testing.T) {
	t.Setenv("PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL", "old@example.com")
	t.Setenv("PDF_AUTH_BOOTSTRAP_SUPERADMIN_EMAIL", "new@example.com")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Auth.BootstrapSuperadminEmail != "new@example.com" {
		t.Fatalf("expected new@example.com (PDF_* wins), got %q", cfg.Auth.BootstrapSuperadminEmail)
	}
}
