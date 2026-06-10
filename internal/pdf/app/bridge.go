// Package app wires the PDF signing backend's services into grown's own
// server process. The auth bridge in this file translates grown's session
// identity (resolved by grown's auth middleware into the request context) into
// the context keys the PDF handlers expect, so the PDF code authenticates off
// grown's session instead of its own standalone OIDC.
package app

import (
	"context"
	"net/http"

	"google.golang.org/grpc"

	grownauth "code.pick.haus/grown/grown/internal/auth"
	pdfauth "code.pick.haus/grown/grown/internal/pdf/auth"
)

// stampPDFIdentity reads grown's session user off ctx (set by grown's auth
// middleware via auth.WithUser) and re-stamps the PDF auth context keys that
// the PDF handlers read: UserEmailFromContext (email) and UserIDFromCtx (sub).
// When no grown user is present the context is returned unchanged — the PDF
// handlers then see an empty caller and apply their own per-endpoint rules
// (e.g. the SigningService and guest /api/sign/* paths are intentionally
// unauthenticated for token-bearing signers).
func stampPDFIdentity(ctx context.Context) context.Context {
	u, ok := grownauth.UserFromContext(ctx)
	if !ok {
		return ctx
	}
	if u.Email != "" {
		ctx = pdfauth.WithUserEmail(ctx, u.Email)
	}
	if u.ID != "" {
		// PDF's UserIDFromCtx reads what standalone set from claims.Sub. Grown's
		// stable user id plays that role here.
		ctx = pdfauth.WithUserID(ctx, u.ID)
	}
	return ctx
}

// UnaryServerInterceptor bridges grown's session identity into the PDF auth
// context for unary RPCs. Chain it AFTER grown's own interceptors so grown's
// auth context is already populated when this runs.
func UnaryServerInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		return handler(stampPDFIdentity(ctx), req)
	}
}

// StreamServerInterceptor bridges grown's session identity into the PDF auth
// context for streaming RPCs.
func StreamServerInterceptor() grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		return handler(srv, &bridgedStream{ServerStream: ss, ctx: stampPDFIdentity(ss.Context())})
	}
}

// bridgedStream overrides Context() so the PDF handler reads the stamped ctx.
type bridgedStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *bridgedStream) Context() context.Context { return s.ctx }

// HTTPMiddleware bridges grown's session identity into the PDF auth context for
// the raw-HTTP PDF handlers. Mount it OUTSIDE grown's auth middleware so the
// grown user is already on the request context when this wrapper runs.
func HTTPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(stampPDFIdentity(r.Context())))
	})
}
