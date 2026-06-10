package sheets

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/sharing"
)

// Service implements grownv1.SheetsServiceServer over a Repository.
type Service struct {
	repo   *Repository
	grants *sharing.Repository // nil disables per-user ACL grants
}

// NewService constructs a Service.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// WithSharing wires the per-user ACL grant repository, enabling GrantAccess/
// ListGrants/RevokeAccess, "Shared with me", and cross-org grant reads.
func (s *Service) WithSharing(grants *sharing.Repository) *Service {
	s.grants = grants
	return s
}

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

// callerOrgUser returns the caller's org id and user id, or an auth error.
func callerOrgUser(ctx context.Context) (orgID, userID string, err error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return "", "", status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", "", status.Error(codes.Internal, "missing org context")
	}
	return o.ID, u.ID, nil
}

// accessSheet resolves a sheet the caller may read: an org member sees their
// org's sheets; otherwise a per-user grant (object_grants) is required. Returns
// the sheet, the caller's effective role, and a gRPC NotFound error when neither
// path grants access (absent and forbidden are indistinguishable to the caller).
func (s *Service) accessSheet(ctx context.Context, orgID, userID, sheetID string) (Sheet, string, error) {
	if sh, err := s.repo.Get(ctx, orgID, sheetID); err == nil {
		role := "editor"
		if sh.OwnerID == userID {
			role = "owner"
		}
		return sh, role, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Sheet{}, "", status.Errorf(codes.Internal, "get sheet: %v", err)
	}
	if s.grants != nil {
		role, ok, err := s.grants.RoleFor(ctx, userID, sharing.TypeSheetsSheet, sheetID)
		if err != nil {
			return Sheet{}, "", status.Errorf(codes.Internal, "grant lookup: %v", err)
		}
		if ok {
			sh, gerr := s.repo.GetByID(ctx, sheetID)
			if errors.Is(gerr, ErrNotFound) {
				return Sheet{}, "", status.Error(codes.NotFound, "sheet not found")
			}
			if gerr != nil {
				return Sheet{}, "", status.Errorf(codes.Internal, "get sheet: %v", gerr)
			}
			return sh, role, nil
		}
	}
	return Sheet{}, "", status.Error(codes.NotFound, "sheet not found")
}

func grantToProto(g sharing.Grant) *grownv1.ObjectGrant {
	return &grownv1.ObjectGrant{
		GranteeUserId: g.GranteeUserID,
		GranteeName:   g.GranteeName,
		GranteeEmail:  g.GranteeEmail,
		Role:          g.Role,
		GrantedBy:     g.GrantedBy,
	}
}

func toProto(s Sheet) *grownv1.Sheet {
	return &grownv1.Sheet{
		Id:        s.ID,
		OrgId:     s.OrgID,
		OwnerId:   s.OwnerID,
		Title:     s.Title,
		CreatedAt: s.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: s.UpdatedAt.UTC().Format(time.RFC3339),
		Data:      s.Data,
	}
}

func (s *Service) ListSheets(ctx context.Context, _ *grownv1.ListSheetsRequest) (*grownv1.ListSheetsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.List(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list sheets: %v", err)
	}
	resp := &grownv1.ListSheetsResponse{Sheets: make([]*grownv1.Sheet, 0, len(list))}
	for _, sh := range list {
		resp.Sheets = append(resp.Sheets, toProto(sh))
	}
	return resp, nil
}

func (s *Service) CreateSheet(ctx context.Context, req *grownv1.CreateSheetRequest) (*grownv1.Sheet, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	sh, err := s.repo.Create(ctx, o.ID, u.ID, req.GetTitle())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create sheet: %v", err)
	}
	return toProto(sh), nil
}

// GetSheet returns a single sheet's metadata + workbook. An org member sees
// their org's sheets; a per-user grantee (possibly cross-org) sees sheets shared
// with them.
func (s *Service) GetSheet(ctx context.Context, req *grownv1.GetSheetRequest) (*grownv1.Sheet, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	sh, _, aerr := s.accessSheet(ctx, orgID, userID, req.GetId())
	if aerr != nil {
		return nil, aerr
	}
	return toProto(sh), nil
}

func (s *Service) RenameSheet(ctx context.Context, req *grownv1.RenameSheetRequest) (*grownv1.Sheet, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	sh, err := s.repo.Rename(ctx, orgID, req.GetId(), req.GetTitle())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "sheet not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "rename sheet: %v", err)
	}
	return toProto(sh), nil
}

func (s *Service) SaveSheet(ctx context.Context, req *grownv1.SaveSheetRequest) (*grownv1.SaveSheetResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	// Recompute formula cells server-side so that persisted data carries computed
	// display values. Clients reopening the sheet see results immediately, and
	// headless consumers (exports, integrations) read correct values without
	// needing a browser-side formula engine. If recompute fails for any reason we
	// fall back to storing the raw data unchanged.
	data := RecomputeWorkbook(req.GetData())
	err = s.repo.Save(ctx, orgID, req.GetId(), data)
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "sheet not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "save sheet: %v", err)
	}
	return &grownv1.SaveSheetResponse{}, nil
}

func (s *Service) TrashSheet(ctx context.Context, req *grownv1.TrashSheetRequest) (*grownv1.TrashSheetResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.Trash(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "sheet not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "trash sheet: %v", err)
	}
	return &grownv1.TrashSheetResponse{}, nil
}

// GrantAccess grants a grown user a role on a sheet in the caller's org. Only an
// org member of the sheet may grant (a mere grantee cannot re-share).
func (s *Service) GrantAccess(ctx context.Context, req *grownv1.GrantSheetAccessRequest) (*grownv1.GrantSheetAccessResponse, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return nil, status.Error(codes.Unimplemented, "sharing not enabled")
	}
	if !sharing.ValidRole(req.GetRole()) {
		return nil, status.Error(codes.InvalidArgument, "role must be viewer, commenter, or editor")
	}
	if req.GetGranteeUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "grantee_user_id required")
	}
	// Caller must be an org member of the sheet to manage its grants.
	if _, err := s.repo.Get(ctx, orgID, req.GetSheetId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "sheet not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get sheet: %v", err)
	}
	if err := s.grants.GrantAccess(ctx, sharing.TypeSheetsSheet, req.GetSheetId(), req.GetGranteeUserId(), req.GetRole(), userID); err != nil {
		return nil, status.Errorf(codes.Internal, "grant: %v", err)
	}
	list, lerr := s.grants.ListGrantsForObject(ctx, sharing.TypeSheetsSheet, req.GetSheetId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list grants: %v", lerr)
	}
	for _, g := range list {
		if g.GranteeUserID == req.GetGranteeUserId() {
			return &grownv1.GrantSheetAccessResponse{Grant: grantToProto(g)}, nil
		}
	}
	return &grownv1.GrantSheetAccessResponse{}, nil
}

// ListGrants returns the per-user ACL grants on a sheet in the caller's org.
func (s *Service) ListGrants(ctx context.Context, req *grownv1.ListSheetGrantsRequest) (*grownv1.ListSheetGrantsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return &grownv1.ListSheetGrantsResponse{}, nil
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetSheetId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "sheet not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get sheet: %v", err)
	}
	list, lerr := s.grants.ListGrantsForObject(ctx, sharing.TypeSheetsSheet, req.GetSheetId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list grants: %v", lerr)
	}
	out := make([]*grownv1.ObjectGrant, 0, len(list))
	for _, g := range list {
		out = append(out, grantToProto(g))
	}
	return &grownv1.ListSheetGrantsResponse{Grants: out}, nil
}

// RevokeAccess removes a user's per-user grant on a sheet in the caller's org.
func (s *Service) RevokeAccess(ctx context.Context, req *grownv1.RevokeSheetAccessRequest) (*grownv1.RevokeSheetAccessResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return nil, status.Error(codes.Unimplemented, "sharing not enabled")
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetSheetId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "sheet not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get sheet: %v", err)
	}
	if err := s.grants.RevokeAccess(ctx, sharing.TypeSheetsSheet, req.GetSheetId(), req.GetGranteeUserId()); err != nil {
		return nil, status.Errorf(codes.Internal, "revoke: %v", err)
	}
	return &grownv1.RevokeSheetAccessResponse{}, nil
}

// ListSharedWithMe returns sheets granted to the caller by a per-user ACL grant
// (possibly cross-org), excluding the caller's own org sheets.
func (s *Service) ListSharedWithMe(ctx context.Context, _ *grownv1.ListSheetsSharedWithMeRequest) (*grownv1.ListSheetsSharedWithMeResponse, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return &grownv1.ListSheetsSharedWithMeResponse{}, nil
	}
	ids, err := s.grants.ListObjectIDsGrantedToUser(ctx, userID, sharing.TypeSheetsSheet)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "shared ids: %v", err)
	}
	list, err := s.repo.GetByIDs(ctx, ids)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "shared sheets: %v", err)
	}
	resp := &grownv1.ListSheetsSharedWithMeResponse{Sheets: make([]*grownv1.Sheet, 0, len(list))}
	for _, sh := range list {
		if sh.OrgID == orgID {
			continue
		}
		resp.Sheets = append(resp.Sheets, toProto(sh))
	}
	return resp, nil
}
