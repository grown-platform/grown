// Package zitadelproxy proxies a narrow slice of the Zitadel User API v2 to the
// browser so grown can host in-app account security (TOTP, passkeys, password)
// without redirecting the user to the Zitadel console.
//
// Trust model: the handler is mounted INSIDE grown's auth middleware
// (auth.HTTPMiddleware), so the caller's grown user — including its
// oidc_subject, which equals the Zitadel user id — is already resolved and
// attached to the request context. The handler:
//
//  1. requires an authenticated session (auth.UserFromContext),
//  2. restricts the proxied path to /v2/users/{id}/... (and GET /v2/users/{id}),
//  3. requires that {id} equals the caller's own oidc_subject (403 otherwise),
//  4. attaches the service-account PAT as a Bearer token, and
//  5. injects the request Host as `domain` on passkey-registration starts so the
//     WebAuthN RP id is always the origin the user is actually on.
//
// All upstream calls are hand-rolled net/http — no Zitadel SDK.
package zitadelproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// DefaultTimeout is the HTTP client timeout for upstream Zitadel requests.
const DefaultTimeout = 30 * time.Second

// MountPrefix is the path under which the proxy is mounted. Everything after it
// is forwarded to Zitadel (e.g. /api/zitadel/v2/users/{id}/totp →
// {ZITADEL_API_URL}/v2/users/{id}/totp).
const MountPrefix = "/api/zitadel"

// passkeyRegistrationPath matches POST /v2/users/{userId}/passkeys exactly —
// NOT /passkeys/{id} (verify) or /passkeys/_search (list). The domain is only
// injected on the registration-start call.
var passkeyRegistrationPath = regexp.MustCompile(`^/v2/users/[^/]+/passkeys$`)

// SubjectResolver returns the Zitadel user id (the OIDC subject) of the caller
// bound to ctx, and whether a caller is present. The wiring in server.go
// supplies a closure backed by auth.UserFromContext, keeping this package
// decoupled from the auth package (and its generated-proto dependency) so it
// builds and tests standalone.
type SubjectResolver func(ctx context.Context) (subject string, ok bool)

// Handler is the http.Handler that proxies to Zitadel using a service PAT.
type Handler struct {
	zitadelURL   string
	serviceToken string
	client       *http.Client
	subjectOf    SubjectResolver
}

// New constructs a proxy Handler.
//
//   - zitadelURL is the Zitadel API base (no trailing slash needed; trimmed).
//     Defaults are handled by the caller (typically the OIDC issuer base).
//   - serviceToken is the service-account PAT used as the upstream Bearer token.
//   - resolver extracts the caller's OIDC subject from the request context. It
//     must be non-nil; every request without a resolvable subject is rejected
//     with 401.
//   - client may be nil, in which case a client with DefaultTimeout is used.
func New(zitadelURL, serviceToken string, resolver SubjectResolver, client *http.Client) *Handler {
	if client == nil {
		client = &http.Client{Timeout: DefaultTimeout}
	}
	return &Handler{
		zitadelURL:   strings.TrimRight(zitadelURL, "/"),
		serviceToken: serviceToken,
		client:       client,
		subjectOf:    resolver,
	}
}

// ServeHTTP implements http.Handler.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// The auth middleware must have attached the caller. No subject → no session.
	subject, ok := "", false
	if h.subjectOf != nil {
		subject, ok = h.subjectOf(r.Context())
	}
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.serviceToken == "" {
		http.Error(w, "zitadel proxy not configured", http.StatusServiceUnavailable)
		return
	}

	path := extractProxyPath(r.URL.Path)
	if !authorizeUserAccess(w, path, subject) {
		return
	}

	targetURL := h.buildTargetURL(path, r.URL.RawQuery)

	// On passkey-registration starts, force the WebAuthN RP id to the request's
	// own host so the credential is bound to the origin the user is on. The
	// backend — not the client — is the source of truth for the domain.
	if r.Method == http.MethodPost && passkeyRegistrationPath.MatchString(path) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			http.Error(w, "failed to read request body", http.StatusBadRequest)
			return
		}
		body = injectPasskeyDomain(body, hostWithoutPort(r.Host))

		proxyReq, err := h.newProxyRequest(r, targetURL, body)
		if err != nil {
			http.Error(w, "failed to create request", http.StatusInternalServerError)
			return
		}
		proxyReq.Header.Set("Content-Type", "application/json")
		h.execute(w, proxyReq)
		return
	}

	proxyReq, err := h.newProxyRequest(r, targetURL, nil)
	if err != nil {
		http.Error(w, "failed to create request", http.StatusInternalServerError)
		return
	}
	h.execute(w, proxyReq)
}

// extractProxyPath strips the mount prefix, yielding the Zitadel API path.
func extractProxyPath(urlPath string) string {
	path := strings.TrimPrefix(urlPath, MountPrefix)
	if path == "" {
		path = "/"
	}
	return path
}

// authorizeUserAccess enforces that the path is a permitted /v2/users/{id}/...
// route and that {id} is the caller's own oidc_subject. Writes the error
// response and returns false when access is denied.
func authorizeUserAccess(w http.ResponseWriter, path, callerSubject string) bool {
	if !strings.HasPrefix(path, "/v2/users/") {
		http.Error(w, "forbidden: path not allowed", http.StatusForbidden)
		return false
	}
	parts := strings.SplitN(strings.TrimPrefix(path, "/v2/users/"), "/", 2)
	userID := parts[0]
	if userID == "" {
		http.Error(w, "forbidden: missing user id", http.StatusForbidden)
		return false
	}
	if callerSubject == "" || userID != callerSubject {
		http.Error(w, "forbidden: can only access your own account", http.StatusForbidden)
		return false
	}
	return true
}

// buildTargetURL joins the Zitadel base, the path, and any query string.
func (h *Handler) buildTargetURL(path, rawQuery string) string {
	target := h.zitadelURL + path
	if rawQuery != "" {
		target += "?" + rawQuery
	}
	return target
}

// newProxyRequest builds the upstream request. When body is non-nil it replaces
// the request body; otherwise the original body is forwarded as-is.
func (h *Handler) newProxyRequest(r *http.Request, targetURL string, body []byte) (*http.Request, error) {
	var reqBody io.Reader = r.Body
	if body != nil {
		reqBody = bytes.NewReader(body)
	}
	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, reqBody)
	if err != nil {
		return nil, err
	}
	copyProxyHeaders(proxyReq, r)
	proxyReq.Header.Set("Authorization", "Bearer "+h.serviceToken)
	return proxyReq, nil
}

// execute sends the upstream request and streams the response back.
func (h *Handler) execute(w http.ResponseWriter, proxyReq *http.Request) {
	resp, err := h.client.Do(proxyReq)
	if err != nil {
		http.Error(w, "proxy request failed", http.StatusBadGateway)
		return
	}
	defer func() { _ = resp.Body.Close() }()

	copyResponseHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// injectPasskeyDomain sets/overrides the `domain` field on the registration
// body. A malformed/empty body is treated as an empty object.
func injectPasskeyDomain(body []byte, domain string) []byte {
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil || parsed == nil {
		parsed = make(map[string]any)
	}
	parsed["domain"] = domain
	out, err := json.Marshal(parsed)
	if err != nil {
		return body
	}
	return out
}

// hostWithoutPort strips a trailing :port (and any IPv6 brackets) from a Host
// header so it can serve as the WebAuthN RP id.
func hostWithoutPort(host string) string {
	if host == "" {
		return ""
	}
	// IPv6 literal: [::1]:8080 → ::1
	if strings.HasPrefix(host, "[") {
		if end := strings.Index(host, "]"); end >= 0 {
			return host[1:end]
		}
	}
	if idx := strings.LastIndex(host, ":"); idx >= 0 {
		return host[:idx]
	}
	return host
}

// copyProxyHeaders forwards request headers to the upstream, skipping headers
// that must not be forwarded. Cookie is dropped so the caller's grown session
// never leaks to Zitadel; Authorization is replaced by the PAT; Accept-Encoding
// is stripped so the upstream returns uncompressed data (copyResponseHeaders
// does not forward Content-Encoding).
func copyProxyHeaders(dst *http.Request, src *http.Request) {
	for key, values := range src.Header {
		switch http.CanonicalHeaderKey(key) {
		case "Host", "Cookie", "Authorization", "Accept-Encoding", "Content-Length":
			continue
		}
		for _, v := range values {
			dst.Header.Add(key, v)
		}
	}
}

// copyResponseHeaders forwards a safe subset of upstream response headers.
func copyResponseHeaders(dst, src http.Header) {
	for key, values := range src {
		switch http.CanonicalHeaderKey(key) {
		// Hop-by-hop / encoding headers we deliberately do not forward.
		case "Content-Encoding", "Content-Length", "Connection", "Transfer-Encoding":
			continue
		}
		for _, v := range values {
			dst.Add(key, v)
		}
	}
}
