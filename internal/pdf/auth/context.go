package auth

import "context"

// userEmailKeyType is a unique private type for the user-email context key
// so external packages can't accidentally collide.
type userEmailKeyType struct{}

var userEmailKey = userEmailKeyType{}

// WithUserEmail returns a new context carrying the given email as the
// authenticated user's verified email.
func WithUserEmail(ctx context.Context, email string) context.Context {
	return context.WithValue(ctx, userEmailKey, email)
}

// UserEmailFromContext returns the authenticated user's email if the
// auth middleware has stashed one. Empty string means no user.
func UserEmailFromContext(ctx context.Context) string {
	email, _ := ctx.Value(userEmailKey).(string)
	return email
}
