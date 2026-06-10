package tenancy

// Multi-org subdomain routing is intentionally absent in V1. The auth
// middleware (in internal/auth) attaches the default org for single-org
// mode. When multi-org mode lands in Plan 5, the resolver here will inspect
// the request host, look up the corresponding org row, and attach it before
// the auth middleware fires.
//
// Until then, this file is a placeholder so the directory and module path
// exist and consumers can import it without compile errors.
