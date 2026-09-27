package forms

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"code.pick.haus/grown/grown/internal/auth"
)

// MyResponsePath is the gateway pattern for the caller's own response status.
// It is a plain HTTP route (registered with the gateway mux's HandlePath)
// rather than an RPC so it doesn't need a proto change.
const MyResponsePath = "/api/v1/forms/{form_id}/my-response"

// MyResponseStatus tells the fill view whether the signed-in user has already
// responded, so a "Limit to 1 response" form can show "You've already
// responded" instead of the questions.
type MyResponseStatus struct {
	Responded  bool   `json:"responded"`
	ResponseID string `json:"response_id,omitempty"`
	CreatedAt  string `json:"created_at,omitempty"`
}

// MyResponse reports whether the caller has responded to formID. The form must
// belong to the caller's org.
func (s *Service) MyResponse(ctx context.Context, formID string) (MyResponseStatus, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return MyResponseStatus{}, status.Error(codes.Unauthenticated, "no session")
	}
	orgID, err := callerOrg(ctx)
	if err != nil {
		return MyResponseStatus{}, err
	}
	if _, err := s.repo.Get(ctx, orgID, formID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return MyResponseStatus{}, status.Error(codes.NotFound, "form not found")
		}
		return MyResponseStatus{}, status.Errorf(codes.Internal, "get form: %v", err)
	}
	r, err := s.repo.UserResponse(ctx, orgID, formID, u.ID)
	if errors.Is(err, ErrNotFound) {
		return MyResponseStatus{}, nil
	}
	if err != nil {
		return MyResponseStatus{}, status.Errorf(codes.Internal, "get response: %v", err)
	}
	return MyResponseStatus{
		Responded:  true,
		ResponseID: r.ID,
		CreatedAt:  r.CreatedAt.UTC().Format(time.RFC3339),
	}, nil
}

// ServeMyResponse is the HTTP handler for GET MyResponsePath.
func (s *Service) ServeMyResponse(w http.ResponseWriter, r *http.Request, formID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": "method not allowed"})
		return
	}
	st, err := s.MyResponse(r.Context(), formID)
	if err != nil {
		code := http.StatusInternalServerError
		switch status.Code(err) {
		case codes.Unauthenticated:
			code = http.StatusUnauthorized
		case codes.NotFound:
			code = http.StatusNotFound
		}
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": status.Convert(err).Message()})
		return
	}
	_ = json.NewEncoder(w).Encode(st)
}
