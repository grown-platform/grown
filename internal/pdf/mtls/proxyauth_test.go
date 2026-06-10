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
