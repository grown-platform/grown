package telephony

import (
	"context"
	"strconv"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.TelephonyServiceServer over a Repository. It also
// consults the Hub for live online status when building the directory.
type Service struct {
	grownv1.UnimplementedTelephonyServiceServer
	repo *Repository
	hub  *Hub
}

// NewService constructs a Service. hub may be nil (online status then reports
// everyone offline), mirroring how the gRPC surface is independent of the WS
// signaling layer.
func NewService(repo *Repository, hub *Hub) *Service {
	return &Service{repo: repo, hub: hub}
}

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

func extString(ext int) string {
	if ext <= 0 {
		return ""
	}
	return strconv.Itoa(ext)
}

func (s *Service) GetMyExtension(ctx context.Context, _ *grownv1.GetMyExtensionRequest) (*grownv1.Extension, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	e, err := s.repo.EnsureExtension(ctx, orgID, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "ensure extension: %v", err)
	}
	return &grownv1.Extension{
		OrgId:     e.OrgID,
		UserId:    e.UserID,
		Extension: extString(e.Extension),
		CreatedAt: e.CreatedAt.UTC().Format(time.RFC3339),
	}, nil
}

func (s *Service) ListDirectory(ctx context.Context, _ *grownv1.ListDirectoryRequest) (*grownv1.ListDirectoryResponse, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	members, err := s.repo.ListMembers(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list directory: %v", err)
	}
	resp := &grownv1.ListDirectoryResponse{Entries: make([]*grownv1.DirectoryEntry, 0, len(members))}
	for _, m := range members {
		if m.UserID == userID {
			continue // exclude self from the callable directory
		}
		online := s.hub != nil && s.hub.Online(orgID, m.UserID)
		resp.Entries = append(resp.Entries, &grownv1.DirectoryEntry{
			UserId:      m.UserID,
			DisplayName: m.DisplayName,
			Email:       m.Email,
			Extension:   extString(m.Extension),
			Online:      online,
		})
	}
	return resp, nil
}

func (s *Service) ListCallHistory(ctx context.Context, _ *grownv1.ListCallHistoryRequest) (*grownv1.ListCallHistoryResponse, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	calls, err := s.repo.ListCalls(ctx, orgID, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list call history: %v", err)
	}

	// Resolve peer display name + extension for each call's other party.
	members, err := s.repo.ListMembers(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "resolve peers: %v", err)
	}
	byID := make(map[string]Member, len(members))
	for _, m := range members {
		byID[m.UserID] = m
	}

	resp := &grownv1.ListCallHistoryResponse{Calls: make([]*grownv1.CallRecord, 0, len(calls))}
	for _, c := range calls {
		direction := "incoming"
		peerID := c.CallerID
		if c.CallerID == userID {
			direction = "outgoing"
			peerID = c.CalleeID
		}
		peer := byID[peerID]
		var endedAt string
		if c.EndedAt != nil {
			endedAt = c.EndedAt.UTC().Format(time.RFC3339)
		}
		resp.Calls = append(resp.Calls, &grownv1.CallRecord{
			Id:            c.ID,
			OrgId:         c.OrgID,
			CallerId:      c.CallerID,
			CalleeId:      c.CalleeID,
			Direction:     direction,
			Status:        c.Status,
			StartedAt:     c.StartedAt.UTC().Format(time.RFC3339),
			EndedAt:       endedAt,
			PeerName:      peer.DisplayName,
			PeerExtension: extString(peer.Extension),
		})
	}
	return resp, nil
}
