package telephony

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

func TestExtString(t *testing.T) {
	tests := []struct {
		name string
		in   int
		want string
	}{
		{"zero is empty", 0, ""},
		{"negative is empty", -5, ""},
		{"base extension", baseExtension, "1001"},
		{"arbitrary positive", 4242, "4242"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := extString(tt.in); got != tt.want {
				t.Errorf("extString(%d) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

// TestCallerOrgUser covers the auth short-circuits and the success path. These
// require no DB: the function only reads org/user off the context.
func TestCallerOrgUser(t *testing.T) {
	withUserOnly := auth.WithUser(context.Background(),
		users.User{ID: "u1", OrgID: "org1"})
	full := auth.WithOrg(withUserOnly, orgs.Org{ID: "org1", Slug: "default"})

	tests := []struct {
		name     string
		ctx      context.Context
		wantCode codes.Code
		wantOrg  string
		wantUser string
	}{
		{
			name:     "no session is unauthenticated",
			ctx:      context.Background(),
			wantCode: codes.Unauthenticated,
		},
		{
			name:     "user but no org is internal",
			ctx:      withUserOnly,
			wantCode: codes.Internal,
		},
		{
			name:     "full context succeeds",
			ctx:      full,
			wantCode: codes.OK,
			wantOrg:  "org1",
			wantUser: "u1",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			org, user, err := callerOrgUser(tt.ctx)
			if status.Code(err) != tt.wantCode {
				t.Fatalf("code: got %v want %v (err=%v)", status.Code(err), tt.wantCode, err)
			}
			if tt.wantCode != codes.OK {
				return
			}
			if org != tt.wantOrg || user != tt.wantUser {
				t.Errorf("got (%q,%q) want (%q,%q)", org, user, tt.wantOrg, tt.wantUser)
			}
		})
	}
}

// sqlStateErr is a synthetic error implementing the SQLState() interface that
// isUniqueViolation type-asserts against, so we can exercise the detection
// logic without a live Postgres driver error.
type sqlStateErr struct{ code string }

func (e sqlStateErr) Error() string    { return "sqlstate " + e.code }
func (e sqlStateErr) SQLState() string { return e.code }

func TestIsUniqueViolation(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil error", nil, false},
		{"plain error", errors.New("boom"), false},
		{"unique violation 23505", sqlStateErr{code: "23505"}, true},
		{"other sqlstate", sqlStateErr{code: "23503"}, false},
		{"wrapped unique violation", errors.Join(errors.New("ctx"), sqlStateErr{code: "23505"}), true},
		{"wrapped non-unique", errors.Join(errors.New("ctx"), sqlStateErr{code: "40001"}), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isUniqueViolation(tt.err); got != tt.want {
				t.Errorf("isUniqueViolation(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}
