package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// ctxKey is used for context values
type ctxKey string

const (
	userIDKey   ctxKey = "auth_user_id"
	userNameKey ctxKey = "auth_user_name"
	orgIDKey    ctxKey = "auth_org_id"
)

// WithUserID adds user ID to context
func WithUserID(ctx context.Context, uid string) context.Context {
	return context.WithValue(ctx, userIDKey, uid)
}

// UserIDFromCtx extracts user ID from context
func UserIDFromCtx(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(userIDKey).(string)
	return v, ok
}

// UserEmailFromCtx extracts user email from context (convenience wrapper)
func UserEmailFromCtx(ctx context.Context) (string, bool) {
	v := UserEmailFromContext(ctx)
	return v, v != ""
}

// WithUserName adds user name to context
func WithUserName(ctx context.Context, name string) context.Context {
	return context.WithValue(ctx, userNameKey, name)
}

// UserNameFromCtx extracts user name from context
func UserNameFromCtx(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(userNameKey).(string)
	return v, ok
}

// OIDCClaims represents the claims we extract from the OIDC token
type OIDCClaims struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Name  string `json:"name"`
	OrgID string `json:"org_id,omitempty"`
}

// Middleware holds dependencies for authentication
type Middleware struct {
	verifier   *oidc.IDTokenVerifier
	cookieName string
}

// NewMiddleware creates a new authentication middleware
func NewMiddleware(ctx context.Context, issuerURL, clientID string) (*Middleware, error) {
	provider, err := oidc.NewProvider(ctx, issuerURL)
	if err != nil {
		return nil, err
	}

	verifier := provider.Verifier(&oidc.Config{
		ClientID: clientID,
	})

	return &Middleware{
		verifier:   verifier,
		cookieName: "pdf_auth",
	}, nil
}

// bearerFromMD extracts bearer token from gRPC metadata
func bearerFromMD(md metadata.MD) (string, error) {
	authz := md.Get("authorization")
	if len(authz) == 0 {
		return "", errors.New("missing authorization header")
	}
	parts := strings.SplitN(authz[0], " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", errors.New("malformed authorization header")
	}
	return parts[1], nil
}

// bearerFromHeader extracts bearer token from HTTP header
func bearerFromHeader(r *http.Request) (string, error) {
	authz := r.Header.Get("Authorization")
	if authz == "" {
		return "", errors.New("missing authorization header")
	}
	parts := strings.SplitN(authz, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", errors.New("malformed authorization header")
	}
	return parts[1], nil
}

// UnaryServerInterceptor returns a gRPC unary interceptor for authentication
func (m *Middleware) UnaryServerInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		// Skip auth for signing service endpoints (guest access via token)
		if strings.HasPrefix(info.FullMethod, "/pdf.signing.SigningService/") {
			return handler(ctx, req)
		}

		md, ok := metadata.FromIncomingContext(ctx)
		if !ok {
			return nil, status.Error(codes.Unauthenticated, "missing metadata")
		}

		token, err := bearerFromMD(md)
		if err != nil {
			return nil, status.Error(codes.Unauthenticated, "unauthorized")
		}

		idToken, err := m.verifier.Verify(ctx, token)
		if err != nil {
			slog.Error("OIDC token verification failed", "err", err)
			return nil, status.Error(codes.Unauthenticated, "invalid token")
		}

		var claims OIDCClaims
		if err := idToken.Claims(&claims); err != nil {
			slog.Error("OIDC failed to parse claims", "err", err)
			return nil, status.Error(codes.Internal, "failed to parse claims")
		}

		if claims.Sub == "" {
			return nil, status.Error(codes.Unauthenticated, "invalid token: missing subject")
		}

		// Add user info to context
		ctx = WithUserID(ctx, claims.Sub)
		ctx = WithUserEmail(ctx, claims.Email)
		ctx = WithUserName(ctx, claims.Name)

		// Add to metadata for downstream services
		md = metadata.Join(md, metadata.Pairs(
			"user-id", claims.Sub,
			"email", claims.Email,
		))
		ctx = metadata.NewIncomingContext(ctx, md)

		slog.Debug("OIDC authenticated", "user_id", claims.Sub, "email", claims.Email)
		return handler(ctx, req)
	}
}

// StreamServerInterceptor returns a gRPC stream interceptor for authentication
func (m *Middleware) StreamServerInterceptor() grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		// Skip auth for signing service endpoints (guest access via token)
		if strings.HasPrefix(info.FullMethod, "/pdf.signing.SigningService/") {
			return handler(srv, ss)
		}

		md, ok := metadata.FromIncomingContext(ss.Context())
		if !ok {
			return status.Error(codes.Unauthenticated, "missing metadata")
		}

		token, err := bearerFromMD(md)
		if err != nil {
			return status.Error(codes.Unauthenticated, "unauthorized")
		}

		idToken, err := m.verifier.Verify(ss.Context(), token)
		if err != nil {
			slog.Error("OIDC stream token verification failed", "err", err)
			return status.Error(codes.Unauthenticated, "invalid token")
		}

		var claims OIDCClaims
		if err := idToken.Claims(&claims); err != nil {
			slog.Error("OIDC stream failed to parse claims", "err", err)
			return status.Error(codes.Internal, "failed to parse claims")
		}

		if claims.Sub == "" {
			return status.Error(codes.Unauthenticated, "invalid token: missing subject")
		}

		// Add user info to context
		ctx := WithUserID(ss.Context(), claims.Sub)
		ctx = WithUserEmail(ctx, claims.Email)
		ctx = WithUserName(ctx, claims.Name)

		// Add to metadata
		md = metadata.Join(md, metadata.Pairs(
			"user-id", claims.Sub,
			"email", claims.Email,
		))
		ctx = metadata.NewIncomingContext(ctx, md)

		ws := &wrappedStream{ServerStream: ss, ctx: ctx}
		slog.Debug("OIDC stream authenticated", "user_id", claims.Sub, "email", claims.Email)
		return handler(srv, ws)
	}
}

// wrappedStream wraps a grpc.ServerStream with a custom context
type wrappedStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (w *wrappedStream) Context() context.Context { return w.ctx }

// HTTPMiddleware returns an HTTP middleware for authentication
// This is used for the grpc-gateway HTTP endpoints
// It supports both Bearer token auth (for API clients) and cookie auth (for browser)
func (m *Middleware) HTTPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for signing endpoints (guest access via token)
		if strings.HasPrefix(r.URL.Path, "/api/sign/") {
			next.ServeHTTP(w, r)
			return
		}

		// Skip auth for health checks
		if r.URL.Path == "/health" || r.URL.Path == "/ready" {
			next.ServeHTTP(w, r)
			return
		}

		// Skip auth for /auth/* endpoints (handled separately)
		if strings.HasPrefix(r.URL.Path, "/auth/") {
			next.ServeHTTP(w, r)
			return
		}

		// Skip auth for /api/user/me (handled by OAuth handler)
		if r.URL.Path == "/api/user/me" {
			next.ServeHTTP(w, r)
			return
		}

		// Skip OPTIONS requests (CORS preflight)
		if r.Method == "OPTIONS" {
			next.ServeHTTP(w, r)
			return
		}

		// Skip auth for static files (frontend SPA)
		// Only require auth for /api/* paths (except those already skipped above)
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}

		// Try Bearer token first, then fall back to cookie
		var rawToken string
		var err error

		rawToken, err = bearerFromHeader(r)
		if err != nil {
			// Try cookie auth
			cookie, cookieErr := r.Cookie(m.cookieName)
			if cookieErr == nil && cookie.Value != "" {
				rawToken = cookie.Value
				err = nil
			}
		}

		if err != nil || rawToken == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// If we got the token from a cookie, set the Authorization header
		// so grpc-gateway forwards it to the gRPC server
		if r.Header.Get("Authorization") == "" {
			r.Header.Set("Authorization", "Bearer "+rawToken)
		}

		idToken, err := m.verifier.Verify(r.Context(), rawToken)
		if err != nil {
			slog.Error("HTTP OIDC token verification failed", "err", err)
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}

		var claims OIDCClaims
		if err := idToken.Claims(&claims); err != nil {
			slog.Error("HTTP OIDC failed to parse claims", "err", err)
			http.Error(w, "Failed to parse token", http.StatusInternalServerError)
			return
		}

		if claims.Sub == "" {
			http.Error(w, "Invalid token: missing subject", http.StatusUnauthorized)
			return
		}

		// Add user info to context
		ctx := WithUserID(r.Context(), claims.Sub)
		ctx = WithUserEmail(ctx, claims.Email)
		ctx = WithUserName(ctx, claims.Name)

		slog.Debug("HTTP OIDC authenticated", "user_id", claims.Sub, "email", claims.Email)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
