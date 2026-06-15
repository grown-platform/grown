package sites

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// ctxWith builds a context optionally carrying a user and/or an org, mirroring
// what the auth middleware attaches before a request reaches the service.
func ctxWith(withUser, withOrg bool) context.Context {
	ctx := context.Background()
	if withUser {
		ctx = auth.WithUser(ctx, users.User{ID: "user-1", OrgID: "org-1"})
	}
	if withOrg {
		ctx = auth.WithOrg(ctx, orgs.Org{ID: "org-1", Slug: "default"})
	}
	return ctx
}

func codeOf(err error) codes.Code {
	return status.Code(err)
}

func TestCallerOrg(t *testing.T) {
	tests := []struct {
		name     string
		withUser bool
		withOrg  bool
		wantOrg  string
		wantCode codes.Code
	}{
		{name: "no user", withUser: false, withOrg: true, wantCode: codes.Unauthenticated},
		{name: "user but no org", withUser: true, withOrg: false, wantCode: codes.Internal},
		{name: "user and org", withUser: true, withOrg: true, wantOrg: "org-1", wantCode: codes.OK},
		{name: "neither", withUser: false, withOrg: false, wantCode: codes.Unauthenticated},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			org, err := callerOrg(ctxWith(tt.withUser, tt.withOrg))
			if got := codeOf(err); got != tt.wantCode {
				t.Fatalf("code: got %v want %v", got, tt.wantCode)
			}
			if org != tt.wantOrg {
				t.Fatalf("org: got %q want %q", org, tt.wantOrg)
			}
		})
	}
}

func TestOrgOnly(t *testing.T) {
	tests := []struct {
		name     string
		withUser bool
		withOrg  bool
		wantOrg  string
		wantCode codes.Code
	}{
		// orgOnly never requires a user: an anonymous-but-tenanted request is OK.
		{name: "org only, no user", withUser: false, withOrg: true, wantOrg: "org-1", wantCode: codes.OK},
		{name: "user and org", withUser: true, withOrg: true, wantOrg: "org-1", wantCode: codes.OK},
		{name: "no org", withUser: true, withOrg: false, wantCode: codes.Internal},
		{name: "neither", withUser: false, withOrg: false, wantCode: codes.Internal},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			org, err := orgOnly(ctxWith(tt.withUser, tt.withOrg))
			if got := codeOf(err); got != tt.wantCode {
				t.Fatalf("code: got %v want %v", got, tt.wantCode)
			}
			if org != tt.wantOrg {
				t.Fatalf("org: got %q want %q", org, tt.wantOrg)
			}
		})
	}
}

func TestToProto(t *testing.T) {
	created := time.Date(2024, 1, 2, 3, 4, 5, 0, time.FixedZone("EST", -5*3600))
	updated := time.Date(2024, 6, 7, 8, 9, 10, 0, time.UTC)
	s := Site{
		ID:          "site-1",
		OrgID:       "org-1",
		OwnerID:     "owner-1",
		Name:        "Handbook",
		ContentJSON: `{"pages":[]}`,
		Published:   true,
		CreatedAt:   created,
		UpdatedAt:   updated,
	}
	p := toProto(s)

	if p.GetId() != s.ID || p.GetOrgId() != s.OrgID || p.GetOwnerId() != s.OwnerID {
		t.Fatalf("identity fields mismatch: %+v", p)
	}
	if p.GetName() != s.Name {
		t.Fatalf("name: got %q want %q", p.GetName(), s.Name)
	}
	if p.GetContentJson() != s.ContentJSON {
		t.Fatalf("content: got %q want %q", p.GetContentJson(), s.ContentJSON)
	}
	if !p.GetPublished() {
		t.Fatalf("published: got false want true")
	}
	// Timestamps must be RFC3339 and normalised to UTC.
	if got, want := p.GetCreatedAt(), "2024-01-02T08:04:05Z"; got != want {
		t.Fatalf("created_at: got %q want %q", got, want)
	}
	if got, want := p.GetUpdatedAt(), "2024-06-07T08:09:10Z"; got != want {
		t.Fatalf("updated_at: got %q want %q", got, want)
	}
	if _, err := time.Parse(time.RFC3339, p.GetCreatedAt()); err != nil {
		t.Fatalf("created_at not RFC3339: %v", err)
	}
}

func TestToProto_Zero(t *testing.T) {
	p := toProto(Site{})
	if p.GetId() != "" || p.GetPublished() {
		t.Fatalf("zero site should map to empty proto, got %+v", p)
	}
	// Zero time still formats to a valid RFC3339 string.
	if _, err := time.Parse(time.RFC3339, p.GetCreatedAt()); err != nil {
		t.Fatalf("zero created_at not RFC3339: %v", err)
	}
}

// The service handlers must short-circuit on auth/tenancy failures *before*
// touching the repository. We can exercise that path with a nil repo: if the
// guard works, the handler returns the auth error and never dereferences repo.
func newServiceNilRepo() *Service { return NewService(nil) }

func TestHandlers_AuthShortCircuit(t *testing.T) {
	svc := newServiceNilRepo()

	tests := []struct {
		name     string
		ctx      context.Context
		call     func(ctx context.Context) error
		wantCode codes.Code
	}{
		{
			name: "ListSites unauthenticated",
			ctx:  ctxWith(false, true),
			call: func(ctx context.Context) error {
				_, err := svc.ListSites(ctx, &grownv1.ListSitesRequest{})
				return err
			},
			wantCode: codes.Unauthenticated,
		},
		{
			name: "ListSites missing org",
			ctx:  ctxWith(true, false),
			call: func(ctx context.Context) error {
				_, err := svc.ListSites(ctx, &grownv1.ListSitesRequest{})
				return err
			},
			wantCode: codes.Internal,
		},
		{
			name: "CreateSite unauthenticated",
			ctx:  ctxWith(false, true),
			call: func(ctx context.Context) error {
				_, err := svc.CreateSite(ctx, &grownv1.CreateSiteRequest{Name: "x"})
				return err
			},
			wantCode: codes.Unauthenticated,
		},
		{
			name: "CreateSite missing org",
			ctx:  ctxWith(true, false),
			call: func(ctx context.Context) error {
				_, err := svc.CreateSite(ctx, &grownv1.CreateSiteRequest{Name: "x"})
				return err
			},
			wantCode: codes.Internal,
		},
		{
			name: "GetSite unauthenticated",
			ctx:  ctxWith(false, true),
			call: func(ctx context.Context) error {
				_, err := svc.GetSite(ctx, &grownv1.GetSiteRequest{Id: "s"})
				return err
			},
			wantCode: codes.Unauthenticated,
		},
		{
			name: "UpdateSite unauthenticated",
			ctx:  ctxWith(false, true),
			call: func(ctx context.Context) error {
				_, err := svc.UpdateSite(ctx, &grownv1.UpdateSiteRequest{Id: "s"})
				return err
			},
			wantCode: codes.Unauthenticated,
		},
		{
			name: "UpdateSite missing org",
			ctx:  ctxWith(true, false),
			call: func(ctx context.Context) error {
				_, err := svc.UpdateSite(ctx, &grownv1.UpdateSiteRequest{Id: "s"})
				return err
			},
			wantCode: codes.Internal,
		},
		{
			name: "DeleteSite unauthenticated",
			ctx:  ctxWith(false, true),
			call: func(ctx context.Context) error {
				_, err := svc.DeleteSite(ctx, &grownv1.DeleteSiteRequest{Id: "s"})
				return err
			},
			wantCode: codes.Unauthenticated,
		},
		{
			name: "DeleteSite missing org",
			ctx:  ctxWith(true, false),
			call: func(ctx context.Context) error {
				_, err := svc.DeleteSite(ctx, &grownv1.DeleteSiteRequest{Id: "s"})
				return err
			},
			wantCode: codes.Internal,
		},
		{
			// GetPublishedSite uses orgOnly, so a missing org (not user) is the
			// only short-circuit; an anonymous-but-tenanted call would proceed
			// to the repo, so we don't exercise that here.
			name: "GetPublishedSite missing org",
			ctx:  ctxWith(false, false),
			call: func(ctx context.Context) error {
				_, err := svc.GetPublishedSite(ctx, &grownv1.GetPublishedSiteRequest{Id: "s"})
				return err
			},
			wantCode: codes.Internal,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.call(tt.ctx)
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if got := codeOf(err); got != tt.wantCode {
				t.Fatalf("code: got %v want %v (err=%v)", got, tt.wantCode, err)
			}
		})
	}
}

func TestNewService(t *testing.T) {
	if NewService(nil) == nil {
		t.Fatal("NewService returned nil")
	}
}
