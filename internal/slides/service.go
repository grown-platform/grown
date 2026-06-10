package slides

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

// Service implements grownv1.SlidesServiceServer over a Repository.
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

// accessDeck resolves a deck the caller may read: an org member sees their org's
// decks; otherwise a per-user grant (object_grants) is required. Returns the
// deck, the caller's effective role, and a gRPC NotFound error when neither path
// grants access (absent and forbidden are indistinguishable to the caller).
func (s *Service) accessDeck(ctx context.Context, orgID, userID, deckID string) (Deck, string, error) {
	if d, err := s.repo.Get(ctx, orgID, deckID); err == nil {
		role := "editor"
		if d.OwnerID == userID {
			role = "owner"
		}
		return d, role, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Deck{}, "", status.Errorf(codes.Internal, "get deck: %v", err)
	}
	if s.grants != nil {
		role, ok, err := s.grants.RoleFor(ctx, userID, sharing.TypeSlidesDeck, deckID)
		if err != nil {
			return Deck{}, "", status.Errorf(codes.Internal, "grant lookup: %v", err)
		}
		if ok {
			d, gerr := s.repo.GetByID(ctx, deckID)
			if errors.Is(gerr, ErrNotFound) {
				return Deck{}, "", status.Error(codes.NotFound, "deck not found")
			}
			if gerr != nil {
				return Deck{}, "", status.Errorf(codes.Internal, "get deck: %v", gerr)
			}
			return d, role, nil
		}
	}
	return Deck{}, "", status.Error(codes.NotFound, "deck not found")
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

func toProto(d Deck) *grownv1.Deck {
	return &grownv1.Deck{
		Id:        d.ID,
		OrgId:     d.OrgID,
		OwnerId:   d.OwnerID,
		Title:     d.Title,
		CreatedAt: d.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: d.UpdatedAt.UTC().Format(time.RFC3339),
		Data:      d.Data,
	}
}

func (s *Service) ListDecks(ctx context.Context, _ *grownv1.ListDecksRequest) (*grownv1.ListDecksResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.List(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list decks: %v", err)
	}
	resp := &grownv1.ListDecksResponse{Decks: make([]*grownv1.Deck, 0, len(list))}
	for _, d := range list {
		resp.Decks = append(resp.Decks, toProto(d))
	}
	return resp, nil
}

func (s *Service) CreateDeck(ctx context.Context, req *grownv1.CreateDeckRequest) (*grownv1.Deck, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	d, err := s.repo.Create(ctx, o.ID, u.ID, req.GetTitle())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create deck: %v", err)
	}
	return toProto(d), nil
}

// GetDeck returns a single deck's metadata + deck JSON. An org member sees their
// org's decks; a per-user grantee (possibly cross-org) sees decks shared with
// them.
func (s *Service) GetDeck(ctx context.Context, req *grownv1.GetDeckRequest) (*grownv1.Deck, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	d, _, aerr := s.accessDeck(ctx, orgID, userID, req.GetId())
	if aerr != nil {
		return nil, aerr
	}
	return toProto(d), nil
}

func (s *Service) RenameDeck(ctx context.Context, req *grownv1.RenameDeckRequest) (*grownv1.Deck, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	d, err := s.repo.Rename(ctx, orgID, req.GetId(), req.GetTitle())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "deck not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "rename deck: %v", err)
	}
	return toProto(d), nil
}

func (s *Service) SaveDeck(ctx context.Context, req *grownv1.SaveDeckRequest) (*grownv1.SaveDeckResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.Save(ctx, orgID, req.GetId(), req.GetData())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "deck not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "save deck: %v", err)
	}
	return &grownv1.SaveDeckResponse{}, nil
}

func (s *Service) TrashDeck(ctx context.Context, req *grownv1.TrashDeckRequest) (*grownv1.TrashDeckResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.Trash(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "deck not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "trash deck: %v", err)
	}
	return &grownv1.TrashDeckResponse{}, nil
}

// GrantAccess grants a grown user a role on a deck in the caller's org. Only an
// org member of the deck may grant (a mere grantee cannot re-share).
func (s *Service) GrantAccess(ctx context.Context, req *grownv1.GrantDeckAccessRequest) (*grownv1.GrantDeckAccessResponse, error) {
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
	// Caller must be an org member of the deck to manage its grants.
	if _, err := s.repo.Get(ctx, orgID, req.GetDeckId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "deck not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get deck: %v", err)
	}
	if err := s.grants.GrantAccess(ctx, sharing.TypeSlidesDeck, req.GetDeckId(), req.GetGranteeUserId(), req.GetRole(), userID); err != nil {
		return nil, status.Errorf(codes.Internal, "grant: %v", err)
	}
	list, lerr := s.grants.ListGrantsForObject(ctx, sharing.TypeSlidesDeck, req.GetDeckId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list grants: %v", lerr)
	}
	for _, g := range list {
		if g.GranteeUserID == req.GetGranteeUserId() {
			return &grownv1.GrantDeckAccessResponse{Grant: grantToProto(g)}, nil
		}
	}
	return &grownv1.GrantDeckAccessResponse{}, nil
}

// ListGrants returns the per-user ACL grants on a deck in the caller's org.
func (s *Service) ListGrants(ctx context.Context, req *grownv1.ListDeckGrantsRequest) (*grownv1.ListDeckGrantsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return &grownv1.ListDeckGrantsResponse{}, nil
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetDeckId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "deck not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get deck: %v", err)
	}
	list, lerr := s.grants.ListGrantsForObject(ctx, sharing.TypeSlidesDeck, req.GetDeckId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list grants: %v", lerr)
	}
	out := make([]*grownv1.ObjectGrant, 0, len(list))
	for _, g := range list {
		out = append(out, grantToProto(g))
	}
	return &grownv1.ListDeckGrantsResponse{Grants: out}, nil
}

// RevokeAccess removes a user's per-user grant on a deck in the caller's org.
func (s *Service) RevokeAccess(ctx context.Context, req *grownv1.RevokeDeckAccessRequest) (*grownv1.RevokeDeckAccessResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return nil, status.Error(codes.Unimplemented, "sharing not enabled")
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetDeckId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "deck not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get deck: %v", err)
	}
	if err := s.grants.RevokeAccess(ctx, sharing.TypeSlidesDeck, req.GetDeckId(), req.GetGranteeUserId()); err != nil {
		return nil, status.Errorf(codes.Internal, "revoke: %v", err)
	}
	return &grownv1.RevokeDeckAccessResponse{}, nil
}

// ListSharedWithMe returns decks granted to the caller by a per-user ACL grant
// (possibly cross-org), excluding the caller's own org decks.
func (s *Service) ListSharedWithMe(ctx context.Context, _ *grownv1.ListDecksSharedWithMeRequest) (*grownv1.ListDecksSharedWithMeResponse, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return &grownv1.ListDecksSharedWithMeResponse{}, nil
	}
	ids, err := s.grants.ListObjectIDsGrantedToUser(ctx, userID, sharing.TypeSlidesDeck)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "shared ids: %v", err)
	}
	list, err := s.repo.GetByIDs(ctx, ids)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "shared decks: %v", err)
	}
	resp := &grownv1.ListDecksSharedWithMeResponse{Decks: make([]*grownv1.Deck, 0, len(list))}
	for _, d := range list {
		if d.OrgID == orgID {
			continue
		}
		resp.Decks = append(resp.Decks, toProto(d))
	}
	return resp, nil
}
