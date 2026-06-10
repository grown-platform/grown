# Security fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Patch the four high-confidence vulnerabilities in pdf (IDOR token leak, OAuth login CSRF, spoofable mTLS proxy headers, signature verification bypass) per `docs/superpowers/specs/2026-05-26-security-fixes-design.md`.

**Architecture:** Two cross-cutting primitives are introduced — (1) a proxy-auth HTTP middleware that strips inbound identity headers, validates a shared-secret, and re-populates a `ProxyIdentity` context value, and (2) a small `internal/sig` package with x509 chain + email binding + signature verification. The four handler fixes are then layered on top.

**Tech Stack:** Go 1.21+, koanf config, gRPC-Gateway, `crypto/x509`, `crypto/subtle`, `crypto/rand`, `github.com/coreos/go-oidc/v3`. Run all commands inside `nix develop`.

---

## File map

| File                                                      | Action | Purpose                                                                                    |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `backend/internal/config/config.go`                       | Modify | Add `ProxySharedSecret`, `TrustedCABundlePath`; startup validation                         |
| `backend/internal/config/config_test.go`                  | Create | Validate startup failures and defaults                                                     |
| `backend/internal/mtls/proxyauth.go`                      | Create | Shared-secret middleware that strips + repopulates identity headers                        |
| `backend/internal/mtls/proxyauth_test.go`                 | Create | Middleware tests                                                                           |
| `backend/internal/mtls/identity.go`                       | Create | `ProxyIdentity` type + context helpers (extracted from mtls.go)                            |
| `backend/internal/mtls/mtls.go`                           | Modify | Stop reading headers directly outside middleware                                           |
| `backend/internal/handler/documents.go`                   | Modify | `ListDocumentsToSign` reads email from `ProxyIdentity`; `VerifyDocument` actually verifies |
| `backend/internal/handler/documents_list_to_sign_test.go` | Create | Test request-derived email is ignored                                                      |
| `backend/internal/auth/oauth.go`                          | Modify | State + nonce in short-lived cookie; verify in callback                                    |
| `backend/internal/auth/oauth_test.go`                     | Create | State mismatch, nonce mismatch, missing cookie                                             |
| `backend/internal/sig/verify.go`                          | Create | `VerifyClientSignature(cert, sig, hash, hashAlgo, expectedEmail, roots)`                   |
| `backend/internal/sig/verify_test.go`                     | Create | Chain validation, email binding, signature math                                            |
| `backend/internal/handler/signing.go`                     | Modify | `CompleteSignature` calls `sig.VerifyClientSignature`                                      |
| `backend/cmd/server/main.go`                              | Modify | Load CA bundle, wire proxy-auth middleware outermost, refuse start on misconfig            |
| `process-compose.yaml`                                    | Modify | Add the two new env vars for local dev                                                     |
| `backend/api/proto/documents.proto`                       | Modify | Deprecate `email` field on `ListDocumentsToSignRequest`                                    |

Each task ends with a green test run and a commit. Use `nix develop --command <cmd>` for all build/test commands.

---

## Task 1: Add new config keys and startup validation

**Files:**

- Modify: `backend/internal/config/config.go:78-141, 143-208`
- Create: `backend/internal/config/config_test.go`

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/config/config_test.go`:

```go
package config

import (
	"os"
	"strings"
	"testing"
)

func TestLoad_ProxyModeRequiresSharedSecret(t *testing.T) {
	os.Setenv("PDF_MTLS_PROXY_MODE", "true")
	os.Setenv("PDF_MTLS_PROXY_SHARED_SECRET", "")
	t.Cleanup(func() {
		os.Unsetenv("PDF_MTLS_PROXY_MODE")
		os.Unsetenv("PDF_MTLS_PROXY_SHARED_SECRET")
	})

	_, err := Load()
	if err == nil {
		t.Fatal("expected Load to fail when proxy_mode=true and proxy_shared_secret empty")
	}
	if !strings.Contains(err.Error(), "proxy_shared_secret") {
		t.Fatalf("expected error to mention proxy_shared_secret, got: %v", err)
	}
}

func TestLoad_ProxyModeShortSecretRejected(t *testing.T) {
	os.Setenv("PDF_MTLS_PROXY_MODE", "true")
	os.Setenv("PDF_MTLS_PROXY_SHARED_SECRET", "tooshort")
	t.Cleanup(func() {
		os.Unsetenv("PDF_MTLS_PROXY_MODE")
		os.Unsetenv("PDF_MTLS_PROXY_SHARED_SECRET")
	})

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "32") {
		t.Fatalf("expected length error, got: %v", err)
	}
}

func TestLoad_BrowserExtensionRequiresCABundle(t *testing.T) {
	os.Setenv("PDF_SIGNING_BROWSER_EXTENSION_ENABLED", "true")
	os.Setenv("PDF_SIGNING_TRUSTED_CA_BUNDLE_PATH", "")
	t.Cleanup(func() {
		os.Unsetenv("PDF_SIGNING_BROWSER_EXTENSION_ENABLED")
		os.Unsetenv("PDF_SIGNING_TRUSTED_CA_BUNDLE_PATH")
	})

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "trusted_ca_bundle_path") {
		t.Fatalf("expected error to mention trusted_ca_bundle_path, got: %v", err)
	}
}

func TestLoad_ProxyModeWithValidSecretSucceeds(t *testing.T) {
	os.Setenv("PDF_MTLS_PROXY_MODE", "true")
	os.Setenv("PDF_MTLS_PROXY_SHARED_SECRET", "this-is-a-32-char-secret-aaaaaaaa")
	t.Cleanup(func() {
		os.Unsetenv("PDF_MTLS_PROXY_MODE")
		os.Unsetenv("PDF_MTLS_PROXY_SHARED_SECRET")
	})

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nix develop --command go test ./internal/config/... -run 'TestLoad_' -v` from `backend/`.
Expected: All four tests FAIL (fields don't exist; validation not implemented).

- [ ] **Step 3: Add the fields**

In `backend/internal/config/config.go`, inside the `MTLSConfig` struct (after line 118, before the closing brace at line 119), add:

```go
	// ProxySharedSecret is a shared secret the trusted reverse proxy must
	// send in the X-Proxy-Auth header. Required when ProxyMode=true.
	// Must be at least 32 characters.
	ProxySharedSecret string `koanf:"proxy_shared_secret"`
```

Inside the `SigningConfig` struct (after line 140, before the closing brace at line 141), add:

```go
	// TrustedCABundlePath is the path to a PEM file containing the root CAs
	// that signer certificates must chain to. Required when BrowserExtensionEnabled=true.
	TrustedCABundlePath string `koanf:"trusted_ca_bundle_path"`
```

- [ ] **Step 4: Add the validation block in `Load`**

In `backend/internal/config/config.go`, immediately before the final `return &cfg, nil` (currently line 207), insert:

```go
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
```

Add `"fmt"` to the imports if it's not already present (it's not — the current imports are only `"strings"` and three koanf packages).

- [ ] **Step 5: Run tests to verify they pass**

Run: `nix develop --command go test ./internal/config/... -run 'TestLoad_' -v` from `backend/`.
Expected: All four tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/config/config.go backend/internal/config/config_test.go
git commit -m "config: add proxy_shared_secret and trusted_ca_bundle_path with startup validation"
```

---

## Task 2: Create `ProxyIdentity` type and context helpers

**Files:**

- Create: `backend/internal/mtls/identity.go`

- [ ] **Step 1: Create the file**

Write `backend/internal/mtls/identity.go`:

```go
package mtls

import "context"

// ProxyIdentity is the identity asserted by a trusted reverse proxy after
// the proxy-auth middleware has validated the shared secret. It is populated
// only when the request carries a valid X-Proxy-Auth header.
type ProxyIdentity struct {
	// Email is the value of X-User-Email as sent by the proxy. Empty if not provided.
	Email string

	// ClientCertVerify is the value of X-SSL-Client-Verify (e.g. "SUCCESS", "NONE").
	ClientCertVerify string

	// ClientDN is the value of X-SSL-Client-DN.
	ClientDN string

	// ClientCertPEM is the raw PEM cert body the proxy passed, URL-decoded.
	ClientCertPEM string

	// ClientSerial is the value of X-SSL-Client-Serial.
	ClientSerial string
}

type proxyIdentityKeyType struct{}

var proxyIdentityKey = proxyIdentityKeyType{}

// WithProxyIdentity returns a new context that carries the given ProxyIdentity.
func WithProxyIdentity(ctx context.Context, id *ProxyIdentity) context.Context {
	return context.WithValue(ctx, proxyIdentityKey, id)
}

// ProxyIdentityFromContext returns the ProxyIdentity from the context, or nil if absent.
func ProxyIdentityFromContext(ctx context.Context) *ProxyIdentity {
	id, _ := ctx.Value(proxyIdentityKey).(*ProxyIdentity)
	return id
}
```

- [ ] **Step 2: Verify it compiles**

Run: `nix develop --command go build ./internal/mtls/...` from `backend/`.
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/mtls/identity.go
git commit -m "mtls: add ProxyIdentity type and context helpers"
```

---

## Task 3: Implement proxy-auth middleware

**Files:**

- Create: `backend/internal/mtls/proxyauth.go`
- Create: `backend/internal/mtls/proxyauth_test.go`

- [ ] **Step 1: Write the failing tests**

Write `backend/internal/mtls/proxyauth_test.go`:

```go
package mtls

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

const testSecret = "test-secret-32-chars-aaaaaaaaaaa"

func TestProxyAuth_NoSecretRejects(t *testing.T) {
	mw := ProxyAuthMiddleware(testSecret)
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/foo", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", w.Code)
	}
}

func TestProxyAuth_WrongSecretRejects(t *testing.T) {
	mw := ProxyAuthMiddleware(testSecret)
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("inner handler must not run")
	}))

	req := httptest.NewRequest("GET", "/api/foo", nil)
	req.Header.Set("X-Proxy-Auth", "wrong")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", w.Code)
	}
}

func TestProxyAuth_StripsInboundIdentityHeadersBeforeRepopulate(t *testing.T) {
	// Even when the secret is valid, inbound identity headers from the client
	// must be cleared before the proxy's view is read. We simulate this by
	// setting both a fake "client-supplied" value and the proxy's actual value
	// in the same request (in real life the proxy would overwrite, but we
	// verify the middleware doesn't rely on whichever wins in header maps).
	mw := ProxyAuthMiddleware(testSecret)

	var gotEmail string
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := ProxyIdentityFromContext(r.Context())
		if id != nil {
			gotEmail = id.Email
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/foo", nil)
	req.Header.Set("X-Proxy-Auth", testSecret)
	req.Header.Set("X-User-Email", "victim@example.com") // proxy's value
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	if gotEmail != "victim@example.com" {
		t.Fatalf("expected email from proxy header, got %q", gotEmail)
	}
}

func TestProxyAuth_ValidSecretPopulatesContext(t *testing.T) {
	mw := ProxyAuthMiddleware(testSecret)

	var gotID *ProxyIdentity
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotID = ProxyIdentityFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/foo", nil)
	req.Header.Set("X-Proxy-Auth", testSecret)
	req.Header.Set("X-User-Email", "alice@example.com")
	req.Header.Set("X-SSL-Client-Verify", "SUCCESS")
	req.Header.Set("X-SSL-Client-DN", "/CN=Alice")
	req.Header.Set("X-SSL-Client-Serial", "ABCD")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	if gotID == nil {
		t.Fatal("expected ProxyIdentity in context")
	}
	if gotID.Email != "alice@example.com" {
		t.Errorf("Email: want alice@example.com, got %q", gotID.Email)
	}
	if gotID.ClientCertVerify != "SUCCESS" {
		t.Errorf("ClientCertVerify: want SUCCESS, got %q", gotID.ClientCertVerify)
	}
	if gotID.ClientDN != "/CN=Alice" {
		t.Errorf("ClientDN: want /CN=Alice, got %q", gotID.ClientDN)
	}
	if gotID.ClientSerial != "ABCD" {
		t.Errorf("ClientSerial: want ABCD, got %q", gotID.ClientSerial)
	}
}

func TestProxyAuth_ConstantTimeCompare(t *testing.T) {
	// Different-length wrong secret must also reject.
	mw := ProxyAuthMiddleware(testSecret)
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("inner handler must not run")
	}))

	req := httptest.NewRequest("GET", "/api/foo", nil)
	req.Header.Set("X-Proxy-Auth", "x")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", w.Code)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nix develop --command go test ./internal/mtls/... -run 'TestProxyAuth_' -v` from `backend/`.
Expected: tests FAIL to compile (`ProxyAuthMiddleware` undefined).

- [ ] **Step 3: Implement the middleware**

Write `backend/internal/mtls/proxyauth.go`:

```go
package mtls

import (
	"crypto/subtle"
	"net/http"
)

// identityHeaders are the inbound headers the middleware strips before
// re-reading them as proxy-asserted values. Any client-originated value
// for these headers is dropped.
var identityHeaders = []string{
	"X-User-Email",
	"X-SSL-Client-Verify",
	"X-SSL-Client-DN",
	"X-SSL-Client-Cert",
	"X-SSL-Client-Serial",
	"X-Proxy-Identity",
}

// ProxyAuthMiddleware returns an HTTP middleware that:
//  1. Strips every inbound identity header from the request.
//  2. Validates X-Proxy-Auth against the shared secret with constant-time compare.
//  3. On match: re-reads the proxy-supplied identity headers (which can only
//     have come from the proxy itself, because step 1 just cleared them) and
//     stashes them in a ProxyIdentity context value for downstream handlers.
//  4. On mismatch or missing: writes 401 and stops the chain.
//
// expectedSecret MUST be non-empty; the caller (config.Load) is responsible
// for enforcing minimum length before invoking this middleware.
func ProxyAuthMiddleware(expectedSecret string) func(http.Handler) http.Handler {
	expected := []byte(expectedSecret)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			provided := r.Header.Get("X-Proxy-Auth")
			// Snapshot the headers we trust ONLY from the proxy, then clear
			// them from r.Header so anything downstream that accidentally
			// reads them sees nothing.
			snapshot := make(map[string]string, len(identityHeaders))
			for _, h := range identityHeaders {
				snapshot[h] = r.Header.Get(h)
				r.Header.Del(h)
			}
			r.Header.Del("X-Proxy-Auth")

			if subtle.ConstantTimeCompare([]byte(provided), expected) != 1 {
				http.Error(w, "proxy auth required", http.StatusUnauthorized)
				return
			}

			id := &ProxyIdentity{
				Email:            snapshot["X-User-Email"],
				ClientCertVerify: snapshot["X-SSL-Client-Verify"],
				ClientDN:         snapshot["X-SSL-Client-DN"],
				ClientCertPEM:    snapshot["X-SSL-Client-Cert"],
				ClientSerial:     snapshot["X-SSL-Client-Serial"],
			}
			next.ServeHTTP(w, r.WithContext(WithProxyIdentity(r.Context(), id)))
		})
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nix develop --command go test ./internal/mtls/... -run 'TestProxyAuth_' -v` from `backend/`.
Expected: all five tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/mtls/proxyauth.go backend/internal/mtls/proxyauth_test.go
git commit -m "mtls: add proxy-auth middleware with header strip and constant-time secret check"
```

---

## Task 4: Wire proxy-auth middleware into main.go

**Files:**

- Modify: `backend/cmd/server/main.go:270-283`

- [ ] **Step 1: Edit the handler chain**

In `backend/cmd/server/main.go`, replace the handler-chain block (lines 270-282) which currently reads:

```go
	// Build handler chain: mTLS middleware -> Auth middleware -> CORS -> root mux
	var httpHandler http.Handler = corsHandler

	// Add OIDC auth middleware if configured
	if authMiddleware != nil {
		httpHandler = authMiddleware.HTTPMiddleware(httpHandler)
	}

	// Add mTLS middleware if configured
	if cfg.MTLS.Enabled || cfg.MTLS.ProxyMode {
		httpHandler = mtlsAuth.Middleware(httpHandler)
	}
```

with:

```go
	// Build handler chain: ProxyAuth (outermost) -> mTLS -> Auth (OIDC) -> CORS -> root mux
	var httpHandler http.Handler = corsHandler

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
```

- [ ] **Step 2: Verify the binary builds**

Run: `nix develop --command go build ./cmd/server/...` from `backend/`.
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/cmd/server/main.go
git commit -m "server: wire proxy-auth middleware as outermost layer when proxy_mode=true"
```

---

## Task 5: Fix Vuln 1 — `ListDocumentsToSign` reads email from proxy identity

**Files:**

- Modify: `backend/internal/handler/documents.go:491-554`
- Create: `backend/internal/handler/documents_list_to_sign_test.go`
- Modify: `backend/api/proto/documents.proto`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/handler/documents_list_to_sign_test.go`:

```go
package handler

import (
	"context"
	"testing"

	"code.pick.haus/grown/pdf/internal/mtls"
	pb "code.pick.haus/grown/pdf/pkg/proto/documents"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestListDocumentsToSign_NoProxyIdentity_Unauthenticated(t *testing.T) {
	h := &DocumentsHandler{}
	_, err := h.ListDocumentsToSign(context.Background(), &pb.ListDocumentsToSignRequest{
		Email: "anyone@example.com",
	})
	if err == nil {
		t.Fatal("expected Unauthenticated error, got nil")
	}
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", status.Code(err))
	}
}

func TestListDocumentsToSign_EmptyProxyEmail_Unauthenticated(t *testing.T) {
	h := &DocumentsHandler{}
	ctx := mtls.WithProxyIdentity(context.Background(), &mtls.ProxyIdentity{Email: ""})
	_, err := h.ListDocumentsToSign(ctx, &pb.ListDocumentsToSignRequest{
		Email: "anyone@example.com",
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", err)
	}
}
```

(Integration tests that exercise the DB path are out of scope for this plan and will be exercised manually via curl during deployment — see Task 11.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `nix develop --command go test ./internal/handler/... -run 'TestListDocumentsToSign_' -v` from `backend/`.
Expected: tests FAIL (handler still returns based on `req.Email`).

- [ ] **Step 3: Rewrite the handler entry block**

In `backend/internal/handler/documents.go`, replace lines 491-497 which currently read:

```go
func (h *DocumentsHandler) ListDocumentsToSign(ctx context.Context, req *pb.ListDocumentsToSignRequest) (*pb.ListDocumentsToSignResponse, error) {
	email := req.Email
	if email == "" {
		// In production, get from auth context
		// For development, default to test user
		email = "lpick@pick.haus"
	}
```

with:

```go
func (h *DocumentsHandler) ListDocumentsToSign(ctx context.Context, req *pb.ListDocumentsToSignRequest) (*pb.ListDocumentsToSignResponse, error) {
	// Vuln 1 fix: never trust req.Email. The trusted reverse proxy populates
	// ProxyIdentity.Email after the proxy-auth middleware validates X-Proxy-Auth.
	id := mtls.ProxyIdentityFromContext(ctx)
	if id == nil {
		return nil, status.Error(codes.Unauthenticated, "proxy identity required")
	}
	email := id.Email
	if email == "" {
		return nil, status.Error(codes.Unauthenticated, "user email not asserted by proxy")
	}
```

Then add the import. At the top of `backend/internal/handler/documents.go`, add to the existing import block:

```go
	"code.pick.haus/grown/pdf/internal/mtls"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nix develop --command go test ./internal/handler/... -run 'TestListDocumentsToSign_' -v` from `backend/`.
Expected: both tests PASS.

- [ ] **Step 5: Deprecate the proto field**

In `backend/api/proto/documents.proto`, find the `ListDocumentsToSignRequest` message and mark its `email` field deprecated. Search for `ListDocumentsToSignRequest` (around line 440-460 based on the gateway URL we saw earlier) and change:

```protobuf
  string email = 1;
```

to:

```protobuf
  // Deprecated: email is no longer read from the request. The trusted reverse
  // proxy asserts the caller's email via the X-User-Email header. Field is
  // kept for ABI compatibility but ignored by the server.
  string email = 1 [deprecated = true];
```

- [ ] **Step 6: Regenerate proto**

Run: `nix develop --command proto-gen` from the repo root.
Expected: regenerated files in `backend/pkg/proto/documents/`. Verify no other diffs.

- [ ] **Step 7: Run the broader test set**

Run: `nix develop --command go build ./...` and `nix develop --command go test ./internal/...` from `backend/`.
Expected: builds clean, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/handler/documents.go \
        backend/internal/handler/documents_list_to_sign_test.go \
        backend/api/proto/documents.proto \
        backend/pkg/proto/documents/
git commit -m "fix(documents): read email from proxy identity instead of request body"
```

---

## Task 6: Fix Vuln 2 — OAuth state + nonce

**Files:**

- Modify: `backend/internal/auth/oauth.go`
- Create: `backend/internal/auth/oauth_test.go`

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/auth/oauth_test.go`:

```go
package auth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// We test the parts of LoginHandler / CallbackHandler that don't require a
// real OIDC provider — namely the state+nonce cookie issuance and validation.

func TestLoginHandler_SetsRandomStateCookie(t *testing.T) {
	o := &OAuth{
		oauthConfig: nil, // we'll only invoke the parts that don't need it
	}
	// Force the path that builds and sets the cookie without performing the
	// actual provider redirect. We do this by calling buildLoginRedirect and
	// inspecting its return values directly.
	state1, nonce1 := o.generateStateAndNonce()
	state2, nonce2 := o.generateStateAndNonce()

	if state1 == "" || nonce1 == "" {
		t.Fatal("expected non-empty state and nonce")
	}
	if state1 == state2 || nonce1 == nonce2 {
		t.Fatalf("state/nonce must be unique per call (got duplicates)")
	}
	if len(state1) < 32 || len(nonce1) < 32 {
		t.Fatalf("state/nonce too short: state=%d nonce=%d", len(state1), len(nonce1))
	}
}

func TestCallbackHandler_RejectsMissingStateCookie(t *testing.T) {
	o := &OAuth{cookieName: "pdf_auth"}

	req := httptest.NewRequest("GET", "/auth/callback?code=x&state=anything", nil)
	w := httptest.NewRecorder()
	o.CallbackHandler().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for missing cookie, got %d", w.Code)
	}
}

func TestCallbackHandler_RejectsStateMismatch(t *testing.T) {
	o := &OAuth{cookieName: "pdf_auth"}

	req := httptest.NewRequest("GET", "/auth/callback?code=x&state=attacker-state", nil)
	req.AddCookie(&http.Cookie{
		Name:  oauthStateCookieName,
		Value: url.QueryEscape("real-state:real-nonce"),
	})
	w := httptest.NewRecorder()
	o.CallbackHandler().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for state mismatch, got %d", w.Code)
	}
}

func TestCallbackHandler_RejectsMalformedStateCookie(t *testing.T) {
	o := &OAuth{cookieName: "pdf_auth"}

	req := httptest.NewRequest("GET", "/auth/callback?code=x&state=foo", nil)
	req.AddCookie(&http.Cookie{
		Name:  oauthStateCookieName,
		Value: "no-colon-separator",
	})
	w := httptest.NewRecorder()
	o.CallbackHandler().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for malformed cookie, got %d", w.Code)
	}
}

func TestCallbackHandler_DeletesCookieOnMismatch(t *testing.T) {
	o := &OAuth{cookieName: "pdf_auth"}

	req := httptest.NewRequest("GET", "/auth/callback?code=x&state=wrong", nil)
	req.AddCookie(&http.Cookie{
		Name:  oauthStateCookieName,
		Value: url.QueryEscape("right:nonce"),
	})
	w := httptest.NewRecorder()
	o.CallbackHandler().ServeHTTP(w, req)

	// Confirm Set-Cookie clears the state cookie
	for _, sc := range w.Result().Cookies() {
		if sc.Name == oauthStateCookieName && (sc.MaxAge < 0 || strings.HasPrefix(sc.Value, "")) && sc.Value == "" {
			return
		}
	}
	t.Fatal("expected state cookie to be cleared on mismatch")
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nix develop --command go test ./internal/auth/... -run 'TestLoginHandler_|TestCallbackHandler_' -v` from `backend/`.
Expected: tests FAIL (`generateStateAndNonce`, `oauthStateCookieName` undefined; current callback rejects with 400 only on missing `code`).

- [ ] **Step 3: Implement state + nonce in `oauth.go`**

Add this new constant and helper at the top of `backend/internal/auth/oauth.go` (immediately after the existing imports, before the `OAuthConfig` type):

```go
const (
	// oauthStateCookieName holds the per-login state and nonce, joined by ":".
	oauthStateCookieName = "pdf_oauth_state"
	// oauthStateCookieMaxAge is how long the user has to complete the login.
	oauthStateCookieMaxAgeSeconds = 600
)

// generateStateAndNonce returns two independent 32-byte random values,
// URL-base64-encoded without padding.
func (o *OAuth) generateStateAndNonce() (string, string) {
	return randURLSafe(32), randURLSafe(32)
}

func randURLSafe(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand.Read does not fail on linux; if it does the process is unusable.
		panic("crypto/rand: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}
```

Add to the existing import block:

```go
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"strings"
```

(`crypto/subtle` is needed for the constant-time compare in Step 5.)

- [ ] **Step 4: Replace `LoginHandler`**

In `backend/internal/auth/oauth.go`, replace the `LoginHandler` method (lines 72-80) with:

```go
// LoginHandler handles GET /auth/login - redirects to the OIDC provider with
// a freshly-generated state and nonce. Both values are stashed in a short-lived
// HttpOnly cookie that the callback verifies.
func (o *OAuth) LoginHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		state, nonce := o.generateStateAndNonce()

		http.SetCookie(w, &http.Cookie{
			Name:     oauthStateCookieName,
			Value:    state + ":" + nonce,
			Path:     "/auth/callback",
			Domain:   o.cookieCfg.domain,
			Secure:   o.cookieCfg.secure,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   oauthStateCookieMaxAgeSeconds,
		})

		authURL := o.oauthConfig.AuthCodeURL(state, oidc.Nonce(nonce))
		slog.Debug("OAuth login redirect", "url", authURL)
		http.Redirect(w, r, authURL, http.StatusFound)
	})
}
```

- [ ] **Step 5: Replace `CallbackHandler`**

In `backend/internal/auth/oauth.go`, replace the `CallbackHandler` method (lines 83-140) with:

```go
// CallbackHandler handles GET /auth/callback - validates the state cookie
// against the state query param, exchanges the code, and verifies the ID
// token's nonce claim matches the cookie nonce.
func (o *OAuth) CallbackHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Always clear the state cookie when this handler runs, regardless of outcome.
		clearStateCookie := func() {
			http.SetCookie(w, &http.Cookie{
				Name:     oauthStateCookieName,
				Value:    "",
				Path:     "/auth/callback",
				Domain:   o.cookieCfg.domain,
				Secure:   o.cookieCfg.secure,
				HttpOnly: true,
				SameSite: http.SameSiteLaxMode,
				MaxAge:   -1,
			})
		}

		stateCookie, err := r.Cookie(oauthStateCookieName)
		if err != nil || stateCookie.Value == "" {
			clearStateCookie()
			slog.Warn("OAuth callback missing state cookie", "error", err)
			http.Error(w, "missing oauth state", http.StatusBadRequest)
			return
		}

		parts := strings.SplitN(stateCookie.Value, ":", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			clearStateCookie()
			slog.Warn("OAuth callback malformed state cookie")
			http.Error(w, "malformed oauth state", http.StatusBadRequest)
			return
		}
		expectedState, expectedNonce := parts[0], parts[1]

		gotState := r.URL.Query().Get("state")
		if subtle.ConstantTimeCompare([]byte(gotState), []byte(expectedState)) != 1 {
			clearStateCookie()
			slog.Warn("OAuth callback state mismatch")
			http.Error(w, "state mismatch", http.StatusBadRequest)
			return
		}

		// State is validated; clear the cookie now that it's consumed.
		clearStateCookie()

		code := r.URL.Query().Get("code")
		if code == "" {
			slog.Error("OAuth callback missing code")
			http.Error(w, "missing code", http.StatusBadRequest)
			return
		}

		// oauthConfig may be nil in pure unit tests; bail out before touching
		// the real provider so the state-validation tests can exercise the
		// bail-out paths without needing a live OIDC server.
		if o.oauthConfig == nil {
			http.Error(w, "oauth not configured", http.StatusInternalServerError)
			return
		}

		token, err := o.oauthConfig.Exchange(r.Context(), code)
		if err != nil {
			slog.Error("OAuth token exchange failed", "error", err)
			http.Error(w, "token exchange failed", http.StatusInternalServerError)
			return
		}

		rawIDToken, ok := token.Extra("id_token").(string)
		if !ok || rawIDToken == "" {
			slog.Error("OAuth response missing id_token")
			http.Error(w, "no id_token in response", http.StatusInternalServerError)
			return
		}

		idToken, err := o.verifier.Verify(r.Context(), rawIDToken)
		if err != nil {
			slog.Error("OAuth id_token verification failed", "error", err)
			http.Error(w, "invalid id_token", http.StatusUnauthorized)
			return
		}

		// Verify the nonce in the ID token matches the nonce we issued.
		if subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(expectedNonce)) != 1 {
			slog.Warn("OAuth id_token nonce mismatch")
			http.Error(w, "nonce mismatch", http.StatusBadRequest)
			return
		}

		// Set cookie expiry from token.
		expires := token.Expiry
		if expires.IsZero() {
			expires = time.Now().Add(time.Hour)
		}

		http.SetCookie(w, &http.Cookie{
			Name:     o.cookieName,
			Value:    rawIDToken,
			Path:     "/",
			Domain:   o.cookieCfg.domain,
			Secure:   o.cookieCfg.secure,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Expires:  expires,
		})

		slog.Info("OAuth login successful, setting cookie and redirecting",
			"cookieName", o.cookieName,
			"cookieDomain", o.cookieCfg.domain,
			"cookieSecure", o.cookieCfg.secure,
			"redirectTo", o.frontendURL)
		http.Redirect(w, r, o.frontendURL, http.StatusFound)
	})
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `nix develop --command go test ./internal/auth/... -run 'TestLoginHandler_|TestCallbackHandler_' -v` from `backend/`.
Expected: all five tests PASS.

- [ ] **Step 7: Verify the binary still builds**

Run: `nix develop --command go build ./...` from `backend/`.
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/auth/oauth.go backend/internal/auth/oauth_test.go
git commit -m "fix(auth): add OAuth state and nonce per-login CSRF protection"
```

---

## Task 7: Create `internal/sig` package with signature verification

**Files:**

- Create: `backend/internal/sig/verify.go`
- Create: `backend/internal/sig/verify_test.go`

- [ ] **Step 1: Write the failing tests**

Create `backend/internal/sig/verify_test.go`:

```go
package sig

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"testing"
	"time"
)

// mkRSACA creates a self-signed root for tests and returns the root cert + its key.
func mkRSACA(t *testing.T, cn string) (*x509.Certificate, *rsa.PrivateKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		IsCA:         true,
		BasicConstraintsValid: true,
		KeyUsage:     x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert, key
}

// mkRSALeaf returns a leaf cert signed by ca with the given email SAN.
func mkRSALeaf(t *testing.T, ca *x509.Certificate, caKey *rsa.PrivateKey, email string) (*x509.Certificate, *rsa.PrivateKey) {
	t.Helper()
	leafKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:   big.NewInt(2),
		Subject:        pkix.Name{CommonName: "Test Signer"},
		EmailAddresses: []string{email},
		NotBefore:      time.Now().Add(-time.Hour),
		NotAfter:       time.Now().Add(time.Hour),
		KeyUsage:       x509.KeyUsageDigitalSignature,
		ExtKeyUsage:    []x509.ExtKeyUsage{x509.ExtKeyUsageEmailProtection},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert, leafKey
}

func TestVerifyClientSignature_HappyPath(t *testing.T) {
	ca, caKey := mkRSACA(t, "Test Root")
	leaf, leafKey := mkRSALeaf(t, ca, caKey, "alice@example.com")

	pool := x509.NewCertPool()
	pool.AddCert(ca)

	hash := sha256.Sum256([]byte("the document"))
	sig, err := rsa.SignPKCS1v15(rand.Reader, leafKey, crypto.SHA256, hash[:])
	if err != nil {
		t.Fatal(err)
	}

	err = VerifyClientSignature(VerifyParams{
		Cert:          leaf,
		Signature:     sig,
		Hash:          hash[:],
		HashAlgorithm: "SHA256",
		ExpectedEmail: "alice@example.com",
		Roots:         pool,
		Now:           time.Now(),
	})
	if err != nil {
		t.Fatalf("expected verification to succeed, got %v", err)
	}
}

func TestVerifyClientSignature_ChainFailsWithoutRoot(t *testing.T) {
	ca, caKey := mkRSACA(t, "Test Root")
	leaf, leafKey := mkRSALeaf(t, ca, caKey, "alice@example.com")

	emptyPool := x509.NewCertPool() // no roots

	hash := sha256.Sum256([]byte("doc"))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, leafKey, crypto.SHA256, hash[:])

	err := VerifyClientSignature(VerifyParams{
		Cert:          leaf,
		Signature:     sig,
		Hash:          hash[:],
		HashAlgorithm: "SHA256",
		ExpectedEmail: "alice@example.com",
		Roots:         emptyPool,
		Now:           time.Now(),
	})
	if err == nil || err.Error() == "" {
		t.Fatal("expected chain error, got nil")
	}
}

func TestVerifyClientSignature_EmailMismatchFails(t *testing.T) {
	ca, caKey := mkRSACA(t, "Test Root")
	leaf, leafKey := mkRSALeaf(t, ca, caKey, "alice@example.com")

	pool := x509.NewCertPool()
	pool.AddCert(ca)

	hash := sha256.Sum256([]byte("doc"))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, leafKey, crypto.SHA256, hash[:])

	err := VerifyClientSignature(VerifyParams{
		Cert:          leaf,
		Signature:     sig,
		Hash:          hash[:],
		HashAlgorithm: "SHA256",
		ExpectedEmail: "bob@example.com",
		Roots:         pool,
		Now:           time.Now(),
	})
	if err == nil {
		t.Fatal("expected email mismatch error")
	}
}

func TestVerifyClientSignature_TamperedSignatureFails(t *testing.T) {
	ca, caKey := mkRSACA(t, "Test Root")
	leaf, leafKey := mkRSALeaf(t, ca, caKey, "alice@example.com")

	pool := x509.NewCertPool()
	pool.AddCert(ca)

	hash := sha256.Sum256([]byte("doc"))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, leafKey, crypto.SHA256, hash[:])
	sig[0] ^= 0xff // tamper

	err := VerifyClientSignature(VerifyParams{
		Cert:          leaf,
		Signature:     sig,
		Hash:          hash[:],
		HashAlgorithm: "SHA256",
		ExpectedEmail: "alice@example.com",
		Roots:         pool,
		Now:           time.Now(),
	})
	if err == nil {
		t.Fatal("expected signature verification failure")
	}
}

func TestVerifyClientSignature_ECDSACertPath(t *testing.T) {
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "ECDSA Root"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		IsCA:         true,
		BasicConstraintsValid: true,
		KeyUsage:     x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	ca, _ := x509.ParseCertificate(caDER)

	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	leafTmpl := &x509.Certificate{
		SerialNumber:   big.NewInt(2),
		Subject:        pkix.Name{CommonName: "ECDSA Signer"},
		EmailAddresses: []string{"alice@example.com"},
		NotBefore:      time.Now().Add(-time.Hour),
		NotAfter:       time.Now().Add(time.Hour),
		KeyUsage:       x509.KeyUsageDigitalSignature,
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, ca, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	leaf, _ := x509.ParseCertificate(leafDER)

	pool := x509.NewCertPool()
	pool.AddCert(ca)

	hash := sha256.Sum256([]byte("doc"))
	sig, err := ecdsa.SignASN1(rand.Reader, leafKey, hash[:])
	if err != nil {
		t.Fatal(err)
	}

	err = VerifyClientSignature(VerifyParams{
		Cert:          leaf,
		Signature:     sig,
		Hash:          hash[:],
		HashAlgorithm: "SHA256",
		ExpectedEmail: "alice@example.com",
		Roots:         pool,
		Now:           time.Now(),
	})
	if err != nil {
		t.Fatalf("expected ECDSA verification to succeed, got %v", err)
	}
}

func TestVerifyClientSignature_EmailMatchIsCaseInsensitive(t *testing.T) {
	ca, caKey := mkRSACA(t, "Root")
	leaf, leafKey := mkRSALeaf(t, ca, caKey, "Alice@Example.COM")

	pool := x509.NewCertPool()
	pool.AddCert(ca)

	hash := sha256.Sum256([]byte("doc"))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, leafKey, crypto.SHA256, hash[:])

	err := VerifyClientSignature(VerifyParams{
		Cert:          leaf,
		Signature:     sig,
		Hash:          hash[:],
		HashAlgorithm: "SHA256",
		ExpectedEmail: "alice@example.com", // lowercase
		Roots:         pool,
		Now:           time.Now(),
	})
	if err != nil {
		t.Fatalf("expected case-insensitive match, got %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nix develop --command go test ./internal/sig/... -v` from `backend/`.
Expected: tests FAIL to compile (`VerifyClientSignature`, `VerifyParams` undefined).

- [ ] **Step 3: Implement `verify.go`**

Create `backend/internal/sig/verify.go`:

```go
// Package sig provides signature verification helpers used at signing time
// (CompleteSignature) and at audit time (VerifyDocument).
package sig

import (
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"fmt"
	"strings"
	"time"
)

// VerifyParams bundles all inputs for VerifyClientSignature.
type VerifyParams struct {
	// Cert is the parsed signer certificate.
	Cert *x509.Certificate
	// Signature is the raw signature bytes (no PKCS#7 envelope).
	Signature []byte
	// Hash is the document hash the signature should validate against.
	Hash []byte
	// HashAlgorithm is one of: "SHA256", "SHA384", "SHA512".
	HashAlgorithm string
	// ExpectedEmail is the email asserted by the signer record; the cert
	// must carry this email (SAN rfc822Name or subject emailAddress, case-insensitive).
	ExpectedEmail string
	// Roots is the trust anchor pool.
	Roots *x509.CertPool
	// Intermediates is optional — additional intermediate certs supplied by the client.
	Intermediates *x509.CertPool
	// Now is the time used for chain validity. Pass time.Now() in production.
	Now time.Time
}

// VerifyClientSignature checks all four invariants:
//  1. Cert chains to one of Roots at time Now.
//  2. Cert carries ExpectedEmail in its SAN or subject (case-insensitive).
//  3. HashAlgorithm + Cert.PublicKeyAlgorithm combine into a supported x509.SignatureAlgorithm.
//  4. Signature is a valid signature over Hash under Cert.PublicKey.
//
// Returns nil on full success, error on any failure.
func VerifyClientSignature(p VerifyParams) error {
	if p.Cert == nil {
		return fmt.Errorf("nil cert")
	}
	if p.Roots == nil {
		return fmt.Errorf("nil roots pool")
	}

	// 1. Chain validation.
	opts := x509.VerifyOptions{
		Roots:         p.Roots,
		Intermediates: p.Intermediates,
		CurrentTime:   p.Now,
		KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	}
	if _, err := p.Cert.Verify(opts); err != nil {
		return fmt.Errorf("cert chain: %w", err)
	}

	// 2. Email binding.
	wantEmail := strings.ToLower(strings.TrimSpace(p.ExpectedEmail))
	if wantEmail == "" {
		return fmt.Errorf("expected email is empty")
	}
	if !certHasEmail(p.Cert, wantEmail) {
		return fmt.Errorf("certificate does not carry expected email %q", p.ExpectedEmail)
	}

	// 3. Algorithm mapping.
	sigAlgo, err := MapSignatureAlgorithm(p.HashAlgorithm, p.Cert.PublicKeyAlgorithm)
	if err != nil {
		return err
	}

	// 4. Signature math. We use x509.CheckSignature which dispatches based on
	// the cert's public key type.
	if err := p.Cert.CheckSignature(sigAlgo, p.Hash, p.Signature); err != nil {
		return fmt.Errorf("signature invalid: %w", err)
	}
	return nil
}

// MapSignatureAlgorithm picks the x509.SignatureAlgorithm constant for the
// given hash name + key algorithm. Returns an error for unsupported combos.
func MapSignatureAlgorithm(hashAlgo string, keyAlgo x509.PublicKeyAlgorithm) (x509.SignatureAlgorithm, error) {
	switch strings.ToUpper(hashAlgo) {
	case "SHA256":
		switch keyAlgo {
		case x509.RSA:
			return x509.SHA256WithRSA, nil
		case x509.ECDSA:
			return x509.ECDSAWithSHA256, nil
		}
	case "SHA384":
		switch keyAlgo {
		case x509.RSA:
			return x509.SHA384WithRSA, nil
		case x509.ECDSA:
			return x509.ECDSAWithSHA384, nil
		}
	case "SHA512":
		switch keyAlgo {
		case x509.RSA:
			return x509.SHA512WithRSA, nil
		case x509.ECDSA:
			return x509.ECDSAWithSHA512, nil
		}
	}
	return 0, fmt.Errorf("unsupported hash/key combination: %s + %v", hashAlgo, keyAlgo)
}

// emailAddressOID identifies the subject emailAddress attribute.
var emailAddressOID = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 9, 1}

// certHasEmail returns true if the cert carries the given lowercased email
// in its SAN rfc822Name list or its subject emailAddress attribute.
func certHasEmail(cert *x509.Certificate, lowerEmail string) bool {
	for _, e := range cert.EmailAddresses {
		if strings.ToLower(strings.TrimSpace(e)) == lowerEmail {
			return true
		}
	}
	if subjEmail := subjectEmailFromCert(cert); subjEmail != "" {
		if strings.ToLower(strings.TrimSpace(subjEmail)) == lowerEmail {
			return true
		}
	}
	return false
}

// subjectEmailFromCert returns the value of the emailAddress attribute in
// the certificate subject, or "" if not present.
func subjectEmailFromCert(cert *x509.Certificate) string {
	for _, name := range cert.Subject.Names {
		if name.Type.Equal(emailAddressOID) {
			if s, ok := name.Value.(string); ok {
				return s
			}
		}
	}
	return ""
}

// LoadCAPool reads PEM-encoded root certificates from path into a fresh CertPool.
// Returns an error if the file cannot be read or contains zero certificates.
func LoadCAPool(path string, readFile func(string) ([]byte, error)) (*x509.CertPool, error) {
	data, err := readFile(path)
	if err != nil {
		return nil, fmt.Errorf("read CA bundle %s: %w", path, err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(data) {
		return nil, fmt.Errorf("no certificates parsed from CA bundle %s", path)
	}
	return pool, nil
}

// dummy reference to silence unused-import linters when this file is extended.
var _ = pkix.Name{}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nix develop --command go test ./internal/sig/... -v` from `backend/`.
Expected: all six tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/sig/
git commit -m "sig: add signature verification helper with x509 chain + email binding"
```

---

## Task 8: Fix Vuln 4 write-path — `CompleteSignature` actually verifies

**Files:**

- Modify: `backend/internal/handler/signing.go:37-50, 62-76, 767-878`

- [ ] **Step 1: Add trusted CA pool to SigningHandler**

In `backend/internal/handler/signing.go`, modify the `SigningHandler` struct (lines 37-49) to add a field:

```go
type SigningHandler struct {
	pb.UnimplementedSigningServiceServer
	db        *database.DB
	cfg       *config.Config
	storage   *storage.Client
	pdf       *pdf.Generator
	email     *email.Sender
	ca        crypto.CertificateAuthority
	pdfSigner *crypto.PDFSigner

	// trustedCAPool is the root pool for verifying browser-extension-supplied
	// signer certificates. Nil unless cfg.Signing.BrowserExtensionEnabled=true.
	trustedCAPool *x509.CertPool

	// pendingSignatures stores prepared hashes for browser extension signing
	pendingSignatures sync.Map // map[signatureId]*pendingSignature
}
```

Update `NewSigningHandler` (lines 62-76):

```go
func NewSigningHandler(db *database.DB, cfg *config.Config, storage *storage.Client, pdfGen *pdf.Generator, emailSender *email.Sender, ca crypto.CertificateAuthority, trustedCAPool *x509.CertPool) *SigningHandler {
	var pdfSigner *crypto.PDFSigner
	if ca != nil {
		pdfSigner = crypto.NewPDFSigner(ca)
	}
	return &SigningHandler{
		db:            db,
		cfg:           cfg,
		storage:       storage,
		pdf:           pdfGen,
		email:         emailSender,
		ca:            ca,
		pdfSigner:     pdfSigner,
		trustedCAPool: trustedCAPool,
	}
}
```

Add to the import block at the top of `signing.go`:

```go
	"crypto/x509"

	"code.pick.haus/grown/pdf/internal/sig"
```

- [ ] **Step 2: Replace the verification stub in `CompleteSignature`**

In `backend/internal/handler/signing.go`, locate the comment block at lines 803-805:

```go
	// TODO: Verify the signature matches the hash
	// TODO: Parse and validate the certificate
	// TODO: Embed the signature in the PDF
```

Replace lines 792-811 (the decode + TODO + slog.Info block) with:

```go
	// Decode the signature and certificate
	signatureBytes, err := base64.StdEncoding.DecodeString(req.Signature)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid signature encoding")
	}

	certBytes, err := base64.StdEncoding.DecodeString(req.Certificate)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid certificate encoding")
	}

	// Vuln 4 fix: parse cert, validate chain to trusted roots, bind to signer
	// email, and verify the signature actually validates the prepared hash.
	if h.trustedCAPool == nil {
		return nil, status.Error(codes.FailedPrecondition, "trusted CA pool not configured")
	}
	cert, err := x509.ParseCertificate(certBytes)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "certificate could not be parsed")
	}

	// Look up the signer row so we can bind the cert to the signer's email.
	signer, err := h.db.Queries.GetSigner(ctx, pending.SignerID)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to look up signer")
	}

	if err := sig.VerifyClientSignature(sig.VerifyParams{
		Cert:          cert,
		Signature:     signatureBytes,
		Hash:          pending.Hash,
		HashAlgorithm: pending.Algorithm,
		ExpectedEmail: signer.Email,
		Roots:         h.trustedCAPool,
		Now:           time.Now(),
	}); err != nil {
		slog.Warn("CompleteSignature: signature verification failed",
			"signerId", pending.SignerID,
			"documentId", pending.DocumentID,
			"error", err)
		return nil, status.Error(codes.PermissionDenied, "signature verification failed")
	}

	slog.Info("CompleteSignature: signature verified",
		"signerId", pending.SignerID,
		"documentId", pending.DocumentID,
		"certSubject", cert.Subject.String(),
		"certSerial", cert.SerialNumber.String())
```

- [ ] **Step 3: Persist cert metadata fields**

Further down in `CompleteSignature` (around line 853), the call to `h.db.Queries.CreateSignature` needs the certificate metadata populated. Replace the `CreateSignatureParams{...}` literal (lines 853-863) with:

```go
	_, err = h.db.Queries.CreateSignature(ctx, sqlc.CreateSignatureParams{
		ID:                    sigID,
		DocumentID:            pending.DocumentID,
		SignerID:              pending.SignerID,
		SignatureData:         signatureBytes,
		SignatureAlgorithm:    sqlc.SignatureAlgorithmRSASHA256,
		CertificateChain:      string(certBytes),
		SigningTimestamp:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
		DocumentHash:          base64.StdEncoding.EncodeToString(pending.Hash),
		DocumentHashAlgorithm: pending.Algorithm,
		CertificateIssuer:     pgtype.Text{String: cert.Issuer.String(), Valid: true},
		CertificateSerial:     pgtype.Text{String: cert.SerialNumber.String(), Valid: true},
		CertificateValidFrom:  pgtype.Timestamptz{Time: cert.NotBefore, Valid: true},
		CertificateValidTo:    pgtype.Timestamptz{Time: cert.NotAfter, Valid: true},
	})
```

- [ ] **Step 4: Verify build**

Run: `nix develop --command go build ./...` from `backend/`.
Expected: clean build. There will be an unresolved reference to `NewSigningHandler`'s new parameter in `main.go` — that's Task 10. If the build complains about that, proceed.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler/signing.go
git commit -m "fix(signing): verify signer cert chain, email binding, and signature math in CompleteSignature"
```

(The `main.go` adjustment is in Task 10 — temporarily the build will fail on that file. If you must commit a green tree, defer this commit until after Task 10. For subagent-driven execution, Task 8 → Task 10 are tightly coupled.)

---

## Task 9: Fix Vuln 4 read-path — `VerifyDocument` actually verifies

**Files:**

- Modify: `backend/internal/handler/documents.go:25-50, 715-835`

- [ ] **Step 1: Add the trusted CA pool to DocumentsHandler**

In `backend/internal/handler/documents.go`, modify `DocumentsHandler` (struct starting at line 25) by adding a field:

```go
type DocumentsHandler struct {
	pb.UnimplementedDocumentsServiceServer
	db      *database.DB
	cfg     *config.Config
	storage *storage.Client
	email   *email.Sender
	pdf     *pdf.Generator

	// trustedCAPool is used by VerifyDocument to re-verify stored signatures.
	// Nil disables read-side verification (signatures are reported as unknown).
	trustedCAPool *x509.CertPool
}
```

Update `NewDocumentsHandler` to take the pool. Search for `func NewDocumentsHandler(` (it exists; check the current signature first):

Run: `nix develop --command grep -n 'func NewDocumentsHandler' backend/internal/handler/documents.go` from the repo root to find the line.

Append a `trustedCAPool *x509.CertPool` parameter and store it on the handler.

Add `"crypto/x509"` to the imports.

- [ ] **Step 2: Rewrite the verification loop**

In `backend/internal/handler/documents.go`, replace the per-signature loop in `VerifyDocument` (lines 756-817) with:

```go
	for _, dbSig := range signatures {
		signer, err := h.db.Queries.GetSigner(ctx, dbSig.SignerID)
		if err != nil {
			slog.Error("Failed to get signer", "error", err, "signerId", dbSig.SignerID)
			continue
		}

		now := time.Now()
		certValidFrom := dbSig.CertificateValidFrom.Time
		certValidTo := dbSig.CertificateValidTo.Time
		certExpired := dbSig.CertificateValidTo.Valid && now.After(certValidTo)

		// Vuln 4 fix: actually verify the stored signature against the trust
		// bundle and the recomputed document hash. If trustedCAPool is nil
		// or any step fails we report the signature as invalid.
		sigValid := false
		hashMatches := false
		sigStatus := "invalid"
		sigMessage := "signature could not be verified"

		if h.trustedCAPool == nil {
			sigMessage = "trusted CA pool not configured; signatures cannot be verified"
		} else {
			cert, parseErr := x509.ParseCertificate([]byte(dbSig.CertificateChain))
			if parseErr != nil {
				sigMessage = "certificate could not be parsed"
			} else {
				// Recompute the document hash from the stored object.
				recomputedHash, hashErr := h.recomputeDocumentHash(ctx, doc, dbSig.DocumentHashAlgorithm)
				if hashErr != nil {
					sigMessage = "could not recompute document hash"
				} else {
					storedHash, _ := base64.StdEncoding.DecodeString(dbSig.DocumentHash)
					hashMatches = bytes.Equal(storedHash, recomputedHash)

					if !hashMatches {
						sigMessage = "document hash does not match stored signature hash"
					} else {
						verifyErr := sig.VerifyClientSignature(sig.VerifyParams{
							Cert:          cert,
							Signature:     dbSig.SignatureData,
							Hash:          recomputedHash,
							HashAlgorithm: dbSig.DocumentHashAlgorithm,
							ExpectedEmail: signer.Email,
							Roots:         h.trustedCAPool,
							Now:           certValidFrom, // verify chain at signing time, not now
						})
						if verifyErr != nil {
							sigMessage = "signature verification failed: " + verifyErr.Error()
						} else {
							sigValid = true
							sigStatus = "valid"
							sigMessage = "Signature is valid"
							if certExpired {
								sigStatus = "valid_expired_cert"
								sigMessage = "Signature was valid at signing time; certificate has since expired"
							}
						}
					}
				}
			}
		}

		hasTimestamp := len(dbSig.TimestampToken) > 0

		verification := &pb.SignatureVerification{
			SignerName:           signer.Name,
			SignerEmail:          signer.Email,
			IsValid:              sigValid,
			Status:               sigStatus,
			Message:              sigMessage,
			CertificateSubject:   signer.Name,
			CertificateIssuer:    dbSig.CertificateIssuer.String,
			CertificateSerial:    dbSig.CertificateSerial.String,
			CertificateValidFrom: timestamppb.New(certValidFrom),
			CertificateValidTo:   timestamppb.New(certValidTo),
			CertificateExpired:   certExpired,
			HasTimestamp:         hasTimestamp,
			DocumentHash:         dbSig.DocumentHash,
			HashAlgorithm:        dbSig.DocumentHashAlgorithm,
			HashMatches:          hashMatches,
		}

		if hasTimestamp {
			verification.Timestamp = timestamppb.New(dbSig.SigningTimestamp.Time)
			verification.TimestampAuthority = "RFC 3161 TSA"
		}

		pbSignatures = append(pbSignatures, verification)

		if !sigValid {
			allValid = false
		}
	}
```

Add imports needed at the top of the file:

```go
	"bytes"
	"crypto/sha256"
	"crypto/sha512"
	"hash"

	"code.pick.haus/grown/pdf/internal/sig"
```

- [ ] **Step 3: Add the hash-recompute helper**

Append to `backend/internal/handler/documents.go`:

```go
// recomputeDocumentHash downloads the document's stored PDF and computes a
// fresh digest using the algorithm recorded at signing time. Used by
// VerifyDocument to detect post-sign tampering.
func (h *DocumentsHandler) recomputeDocumentHash(ctx context.Context, doc sqlc.Document, algo string) ([]byte, error) {
	body, err := h.storage.Download(ctx, doc.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", doc.StorageKey, err)
	}
	defer body.Close()

	var hasher hash.Hash
	switch algo {
	case "SHA256":
		hasher = sha256.New()
	case "SHA384":
		hasher = sha512.New384()
	case "SHA512":
		hasher = sha512.New()
	default:
		return nil, fmt.Errorf("unsupported hash algorithm: %s", algo)
	}
	if _, err := io.Copy(hasher, body); err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	return hasher.Sum(nil), nil
}
```

Add `"io"` to the imports if not already present.

- [ ] **Step 4: Verify build**

Run: `nix develop --command go build ./...` from `backend/`.
Expected: clean build (after Task 10 wires `NewDocumentsHandler` correctly).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/handler/documents.go backend/internal/storage/
git commit -m "fix(documents): VerifyDocument re-verifies chain, recomputes hash, and validates signature"
```

---

## Task 10: Wire CA bundle loading and updated handler constructors in main.go

**Files:**

- Modify: `backend/cmd/server/main.go:114-132`

- [ ] **Step 1: Add CA bundle loading after mtls initialization**

In `backend/cmd/server/main.go`, just after the `mtlsAuth, err := mtls.NewAuthenticator(&cfg.MTLS)` block (line ~115-128), insert:

```go
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
```

Add `"crypto/x509"` and `"code.pick.haus/grown/pdf/internal/sig"` to imports.

- [ ] **Step 2: Update the handler constructor calls**

Find lines 130-131 and replace:

```go
	documentsHandler := handler.NewDocumentsHandler(db, cfg, storageClient, emailSender, pdfGenerator)
	signingHandler := handler.NewSigningHandler(db, cfg, storageClient, pdfGenerator, emailSender, ca)
```

with:

```go
	documentsHandler := handler.NewDocumentsHandler(db, cfg, storageClient, emailSender, pdfGenerator, trustedCAPool)
	signingHandler := handler.NewSigningHandler(db, cfg, storageClient, pdfGenerator, emailSender, ca, trustedCAPool)
```

- [ ] **Step 3: Verify the binary builds**

Run: `nix develop --command go build ./cmd/server/...` and `nix develop --command go test ./internal/...` from `backend/`.
Expected: build clean; all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add backend/cmd/server/main.go
git commit -m "server: load trusted CA bundle and pass to handlers"
```

---

## Task 11: Update process-compose dev env vars

**Files:**

- Modify: `process-compose.yaml`

- [ ] **Step 1: Generate a dev secret and a dev CA bundle path**

Run: `head -c 32 /dev/urandom | base64` and capture the output as the dev `proxy_shared_secret`. Save the value into `.env.local` (gitignored):

```
PDF_MTLS_PROXY_SHARED_SECRET=<the-base64-secret>
PDF_SIGNING_TRUSTED_CA_BUNDLE_PATH=/tmp/pdf-dev-ca.pem
```

- [ ] **Step 2: Produce the dev CA bundle**

Run: `nix develop --command go run ./cmd/dump-ca /tmp/pdf-dev-ca.pem` from `backend/` if such a tool exists. If it doesn't, create `backend/cmd/dump-ca/main.go`:

```go
package main

import (
	"context"
	"encoding/pem"
	"fmt"
	"os"

	"code.pick.haus/grown/pdf/internal/config"
	"code.pick.haus/grown/pdf/internal/crypto"
	"code.pick.haus/grown/pdf/internal/database"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: dump-ca <out-path>")
		os.Exit(1)
	}
	outPath := os.Args[1]

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "config load:", err)
		os.Exit(1)
	}
	db, err := database.New(context.Background(), cfg.Database.URL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "database:", err)
		os.Exit(1)
	}
	defer db.Close()

	keystore, err := crypto.NewKeystore(cfg.Crypto.KeyEncryptionKey)
	if err != nil {
		fmt.Fprintln(os.Stderr, "keystore:", err)
		os.Exit(1)
	}
	ca, err := crypto.NewSelfSignedCA(context.Background(), db, keystore, cfg.Crypto.OrganizationID)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ca:", err)
		os.Exit(1)
	}

	rootCert := ca.GetCACertificate()
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: rootCert.Raw})
	if err := os.WriteFile(outPath, pemBytes, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "write:", err)
		os.Exit(1)
	}
	fmt.Println("wrote", outPath)
}
```

Run: `nix develop --command go run ./cmd/dump-ca /tmp/pdf-dev-ca.pem` from `backend/`.
Expected: writes the file.

- [ ] **Step 3: Pass the env vars into the backend in `process-compose.yaml`**

In `process-compose.yaml`, locate the backend process (search for `backend-run` or similar). In its `environment:` block (or wherever env vars are set), add the two values, sourcing the secret from `.env.local`:

```yaml
backend:
  command: backend-run
  environment:
    - PDF_MTLS_PROXY_MODE=false # off in local dev unless testing the path
    - PDF_MTLS_PROXY_SHARED_SECRET=$PDF_MTLS_PROXY_SHARED_SECRET
    - PDF_SIGNING_BROWSER_EXTENSION_ENABLED=true
    - PDF_SIGNING_TRUSTED_CA_BUNDLE_PATH=/tmp/pdf-dev-ca.pem
```

(Adjust to the actual schema of the file — search for the existing PDF\_ env entries first.)

- [ ] **Step 4: Smoke test the full chain**

Run: `nix develop --command pc up` from the repo root. Wait for "Pdf server starting...". The server should boot without errors.

In another terminal:

```bash
curl -i 'http://localhost:8085/api/to-sign?email=lpick@pick.haus'
```

Expected: HTTP 200 with documents (proxy_mode=false → no proxy-auth required, but the handler now refuses because no ProxyIdentity in context). Actually the expected response is HTTP 401 / Unauthenticated — confirming Vuln 1 is closed.

To test the proxy-auth path:

```bash
curl -i \
  -H "X-Proxy-Auth: $PDF_MTLS_PROXY_SHARED_SECRET" \
  -H "X-User-Email: lpick@pick.haus" \
  'http://localhost:8085/api/to-sign'
```

Expected: HTTP 200 with documents — but only after flipping `PDF_MTLS_PROXY_MODE=true`. If proxy_mode=false the middleware doesn't run and the handler still refuses (no identity).

- [ ] **Step 5: Commit**

```bash
git add process-compose.yaml backend/cmd/dump-ca/ backend/internal/crypto/ca.go
git commit -m "dev: wire proxy_shared_secret and trusted_ca_bundle_path into process-compose"
```

---

## Task 12: Full regression and PR prep

- [ ] **Step 1: Run all backend tests**

Run: `nix develop --command go test ./...` from `backend/`.
Expected: every test passes.

- [ ] **Step 2: Verify the local backend boots clean with default config**

Run: `nix develop --command pc up`. Tail logs; confirm:

- No errors loading config
- `Proxy-auth middleware enabled (X-Proxy-Auth required)` log line if proxy_mode=true
- `Loaded trusted CA bundle...` log line if browser extension on

- [ ] **Step 3: Push the branch**

```bash
git push -u origin fix/security-fixes
```

- [ ] **Step 4: Open a PR**

PR title: `fix: address vulns 1-4 from 2026-05-26 security review`

PR body: link to the spec and to the security review report. Call out the new env vars operators must set:

- `PDF_MTLS_PROXY_SHARED_SECRET` (required when `PDF_MTLS_PROXY_MODE=true`)
- `PDF_SIGNING_TRUSTED_CA_BUNDLE_PATH` (required when `PDF_SIGNING_BROWSER_EXTENSION_ENABLED=true`)
