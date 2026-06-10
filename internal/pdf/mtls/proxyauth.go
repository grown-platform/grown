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
