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
