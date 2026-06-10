package admin

import (
	"context"
	"net/url"
	"sort"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// AdminChecker reports whether the user holds a per-org admin role (an
// org_admins grant). server.go injects a closure backed by the org_admins repo;
// it's optional so admin.Service stays testable without a DB.
type AdminChecker func(ctx context.Context, orgID, userID string) bool

// Service implements grownv1.AdminServiceServer over a Repository.
type Service struct {
	repo *Repository

	// adminEmails is the lower-cased allowlist of bootstrap super-admins. A
	// caller may mutate admin settings iff their email is here OR they hold an
	// org_admins grant (isOrgAdmin). There is NO open fallback.
	adminEmails map[string]struct{}
	isOrgAdmin  AdminChecker
}

// NewService constructs a Service. adminEmails is the raw value of the
// GROWN_ADMIN_EMAILS env var (a comma-separated list of emails); pass "" to
// leave the allowlist empty.
//
// Admin authorization model (see docs/rbac-design.md):
//   - GetServiceSettings: allowed for any authenticated org member (read-only).
//   - SetServiceSettings: requires the caller to be an admin — email in
//     GROWN_ADMIN_EMAILS OR an org_admins grant (via the injected AdminChecker).
//     There is no open fallback; an empty allowlist with no grant denies the write.
func NewService(repo *Repository, adminEmails string) *Service {
	allow := make(map[string]struct{})
	for _, e := range strings.Split(adminEmails, ",") {
		e = strings.ToLower(strings.TrimSpace(e))
		if e != "" {
			allow[e] = struct{}{}
		}
	}
	return &Service{repo: repo, adminEmails: allow}
}

// WithAdminChecker injects the per-org admin predicate and returns the Service
// for chaining. server.go calls this with a closure backed by the org_admins repo.
func (s *Service) WithAdminChecker(c AdminChecker) *Service {
	s.isOrgAdmin = c
	return s
}

// callerOrg validates the session and returns the caller's org id.
func callerOrg(ctx context.Context) (string, error) {
	if _, ok := auth.UserFromContext(ctx); !ok {
		return "", status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", status.Error(codes.Internal, "missing org context")
	}
	return o.ID, nil
}

// requireAdmin validates the session and enforces the admin allowlist for
// mutating operations. It returns the caller's org id on success.
func (s *Service) requireAdmin(ctx context.Context) (string, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return "", status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", status.Error(codes.Internal, "missing org context")
	}
	// Admin iff email is in the bootstrap allowlist OR an org_admins grant exists.
	// No open fallback (see docs/rbac-design.md).
	if _, ok := s.adminEmails[strings.ToLower(strings.TrimSpace(u.Email))]; ok {
		return o.ID, nil
	}
	if s.isOrgAdmin != nil && s.isOrgAdmin(ctx, o.ID, u.ID) {
		return o.ID, nil
	}
	return "", status.Error(codes.PermissionDenied, "admin privileges required")
}

// toProto builds a ServiceSettings response from the repo's settings map,
// emitting entries in a stable (service-id) order.
func toProto(orgID string, m map[string]Setting) *grownv1.ServiceSettings {
	ids := make([]string, 0, len(m))
	for id := range m {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := &grownv1.ServiceSettings{
		OrgId:    orgID,
		Settings: make([]*grownv1.ServiceSetting, 0, len(ids)),
	}
	for _, id := range ids {
		out.Settings = append(out.Settings, &grownv1.ServiceSetting{
			ServiceId:   m[id].ServiceID,
			Enabled:     m[id].Enabled,
			ExternalUrl: m[id].ExternalURL,
		})
	}
	return out
}

// GetServiceSettings returns the org's explicit per-service toggles. Any service
// id not present is enabled by default; the frontend applies that default.
func (s *Service) GetServiceSettings(ctx context.Context, _ *grownv1.GetServiceSettingsRequest) (*grownv1.ServiceSettings, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	m, err := s.repo.GetSettings(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get service settings: %v", err)
	}
	return toProto(orgID, m), nil
}

// validateExternalURL returns an error if rawURL is not a valid http(s) URL.
// An empty string is valid (meaning "clear the override").
func validateExternalURL(serviceID, rawURL string) error {
	if rawURL == "" {
		return nil
	}
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return status.Errorf(codes.InvalidArgument,
			"external_url for %q must be an http(s) URL or empty", serviceID)
	}
	return nil
}

// SetServiceSettings upserts the supplied toggles for the org and returns the
// full, updated settings. Restricted to org admins.
func (s *Service) SetServiceSettings(ctx context.Context, req *grownv1.SetServiceSettingsRequest) (*grownv1.ServiceSettings, error) {
	orgID, err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	in := make([]Setting, 0, len(req.GetSettings()))
	for _, ss := range req.GetSettings() {
		if ss.GetServiceId() == "" {
			return nil, status.Error(codes.InvalidArgument, "service_id is required")
		}
		extURL := strings.TrimSpace(ss.GetExternalUrl())
		if err := validateExternalURL(ss.GetServiceId(), extURL); err != nil {
			return nil, err
		}
		in = append(in, Setting{ServiceID: ss.GetServiceId(), Enabled: ss.GetEnabled(), ExternalURL: extURL})
	}
	m, err := s.repo.UpsertSettings(ctx, orgID, in)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "set service settings: %v", err)
	}
	return toProto(orgID, m), nil
}
