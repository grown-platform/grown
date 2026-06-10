package prefs

import (
	"context"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.PreferencesServiceServer over a Repository.
type Service struct {
	repo *Repository
}

// NewService constructs a Service.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func callerIDs(ctx context.Context) (userID, orgID string, err error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return "", "", status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", "", status.Error(codes.Internal, "missing org context")
	}
	return u.ID, o.ID, nil
}

func toProto(p Preferences) *grownv1.UserPreferences {
	return &grownv1.UserPreferences{
		UserId:             p.UserID,
		OrgId:              p.OrgID,
		Language:           p.Language,
		Density:            p.Density,
		DefaultApp:         p.DefaultApp,
		DateFormat:         p.DateFormat,
		TimeFormat:         p.TimeFormat,
		WeekStart:          p.WeekStart,
		EmailNotifications: p.EmailNotifications,
		Extra:              p.Extra,
		UpdatedAt:          p.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) GetPreferences(ctx context.Context, _ *grownv1.GetPreferencesRequest) (*grownv1.UserPreferences, error) {
	userID, orgID, err := callerIDs(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.GetOrDefault(ctx, orgID, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get preferences: %v", err)
	}
	return toProto(p), nil
}

func (s *Service) UpdatePreferences(ctx context.Context, req *grownv1.UpdatePreferencesRequest) (*grownv1.UserPreferences, error) {
	userID, orgID, err := callerIDs(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.UpdatePreferences(ctx, orgID, userID, UpdateFields{
		Language:           req.GetLanguage(),
		Density:            req.GetDensity(),
		DefaultApp:         req.GetDefaultApp(),
		DateFormat:         req.GetDateFormat(),
		TimeFormat:         req.GetTimeFormat(),
		WeekStart:          req.GetWeekStart(),
		EmailNotifications: req.GetEmailNotifications(),
		Extra:              req.GetExtra(),
		Mask:               req.GetUpdateMask(),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update preferences: %v", err)
	}
	return toProto(p), nil
}
