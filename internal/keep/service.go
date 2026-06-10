package keep

import (
	"context"
	"errors"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/sharing"
)

// Service implements grownv1.KeepServiceServer over a Repository.
type Service struct {
	repo   *Repository
	grants *sharing.Repository // nil disables per-user ACL grants
}

// NewService constructs a Service.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// WithSharing wires the per-user ACL grant repository, enabling
// GrantNoteAccess/ListNoteGrants/RevokeNoteAccess and "Shared with me".
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

// accessNote resolves a note the caller may read: an org member sees their
// org's notes; otherwise a per-user grant (object_grants) is required. Returns
// the note, the effective role, and a gRPC NotFound error when neither path
// grants access (absent and forbidden are indistinguishable to the caller).
func (s *Service) accessNote(ctx context.Context, orgID, userID, noteID string) (Note, string, error) {
	if n, err := s.repo.Get(ctx, orgID, noteID); err == nil {
		role := "editor"
		if n.OwnerID == userID {
			role = "owner"
		}
		return n, role, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Note{}, "", status.Errorf(codes.Internal, "get note: %v", err)
	}
	if s.grants != nil {
		role, ok, err := s.grants.RoleFor(ctx, userID, sharing.TypeKeepNote, noteID)
		if err != nil {
			return Note{}, "", status.Errorf(codes.Internal, "grant lookup: %v", err)
		}
		if ok {
			n, gerr := s.repo.GetByID(ctx, noteID)
			if errors.Is(gerr, ErrNotFound) {
				return Note{}, "", status.Error(codes.NotFound, "note not found")
			}
			if gerr != nil {
				return Note{}, "", status.Errorf(codes.Internal, "get note: %v", gerr)
			}
			return n, role, nil
		}
	}
	return Note{}, "", status.Error(codes.NotFound, "note not found")
}

func checklistToProto(items []ChecklistItem) []*grownv1.KeepChecklistItem {
	out := make([]*grownv1.KeepChecklistItem, 0, len(items))
	for _, it := range items {
		out = append(out, &grownv1.KeepChecklistItem{Text: it.Text, Checked: it.Checked})
	}
	return out
}

func checklistFromProto(items []*grownv1.KeepChecklistItem) []ChecklistItem {
	out := make([]ChecklistItem, 0, len(items))
	for _, it := range items {
		out = append(out, ChecklistItem{Text: it.GetText(), Checked: it.GetChecked()})
	}
	return out
}

func toProto(n Note) *grownv1.KeepNote {
	remindAt := ""
	if n.RemindAt != nil {
		remindAt = n.RemindAt.UTC().Format(time.RFC3339)
	}
	return &grownv1.KeepNote{
		Id:        n.ID,
		OrgId:     n.OrgID,
		OwnerId:   n.OwnerID,
		Title:     n.Title,
		Body:      n.Body,
		Color:     n.Color,
		Pinned:    n.Pinned,
		Archived:  n.Archived,
		Labels:    n.Labels,
		Checklist: checklistToProto(n.Checklist),
		CreatedAt: n.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: n.UpdatedAt.UTC().Format(time.RFC3339),
		RemindAt:  remindAt,
	}
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

// ListNotes returns notes for the caller's org. Archived notes are EXCLUDED by
// default (archived=false) — they are only returned when req.Archived is true.
// When req.LabelId is set, only notes linked to that label are returned.
func (s *Service) ListNotes(ctx context.Context, req *grownv1.ListKeepNotesRequest) (*grownv1.ListKeepNotesResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.ListFiltered(ctx, orgID, req.GetArchived(), req.GetLabelId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list notes: %v", err)
	}
	resp := &grownv1.ListKeepNotesResponse{Notes: make([]*grownv1.KeepNote, 0, len(list))}
	for _, n := range list {
		resp.Notes = append(resp.Notes, toProto(n))
	}
	return resp, nil
}

func (s *Service) CreateNote(ctx context.Context, req *grownv1.CreateKeepNoteRequest) (*grownv1.KeepNote, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	n, err := s.repo.Create(ctx, o.ID, u.ID, Fields{
		Title: req.GetTitle(), Body: req.GetBody(), Color: req.GetColor(),
		Pinned: req.GetPinned(), Archived: req.GetArchived(),
		Labels: req.GetLabels(), Checklist: checklistFromProto(req.GetChecklist()),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create note: %v", err)
	}
	return toProto(n), nil
}

func (s *Service) GetNote(ctx context.Context, req *grownv1.GetKeepNoteRequest) (*grownv1.KeepNote, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	n, _, aerr := s.accessNote(ctx, orgID, userID, req.GetId())
	if aerr != nil {
		return nil, aerr
	}
	return toProto(n), nil
}

func (s *Service) UpdateNote(ctx context.Context, req *grownv1.UpdateKeepNoteRequest) (*grownv1.KeepNote, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	n, err := s.repo.Update(ctx, orgID, req.GetId(), Fields{
		Title: req.GetTitle(), Body: req.GetBody(), Color: req.GetColor(),
		Pinned: req.GetPinned(), Archived: req.GetArchived(),
		Labels: req.GetLabels(), Checklist: checklistFromProto(req.GetChecklist()),
	})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "note not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update note: %v", err)
	}
	return toProto(n), nil
}

func (s *Service) TrashNote(ctx context.Context, req *grownv1.TrashKeepNoteRequest) (*grownv1.TrashKeepNoteResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.Trash(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "note not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "trash note: %v", err)
	}
	return &grownv1.TrashKeepNoteResponse{}, nil
}

// SetReminder sets (or clears, if remind_at is empty) the reminder on a note.
func (s *Service) SetReminder(ctx context.Context, req *grownv1.SetKeepReminderRequest) (*grownv1.KeepNote, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	var remindAt *time.Time
	if raw := req.GetRemindAt(); raw != "" {
		t, perr := time.Parse(time.RFC3339, raw)
		if perr != nil {
			return nil, status.Errorf(codes.InvalidArgument, "remind_at must be RFC3339: %v", perr)
		}
		remindAt = &t
	}
	n, err := s.repo.SetReminder(ctx, orgID, req.GetId(), remindAt)
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "note not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "set reminder: %v", err)
	}
	return toProto(n), nil
}

// ClearReminder removes the reminder from a note.
func (s *Service) ClearReminder(ctx context.Context, req *grownv1.ClearKeepReminderRequest) (*grownv1.KeepNote, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	n, err := s.repo.SetReminder(ctx, orgID, req.GetId(), nil)
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "note not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "clear reminder: %v", err)
	}
	return toProto(n), nil
}

// ListNoteReminders returns notes that have a reminder set, soonest first.
func (s *Service) ListNoteReminders(ctx context.Context, _ *grownv1.ListKeepNoteRemindersRequest) (*grownv1.ListKeepNoteRemindersResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.ListReminders(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list reminders: %v", err)
	}
	resp := &grownv1.ListKeepNoteRemindersResponse{Notes: make([]*grownv1.KeepNote, 0, len(list))}
	for _, n := range list {
		resp.Notes = append(resp.Notes, toProto(n))
	}
	return resp, nil
}

// GrantNoteAccess grants a grown user a role on a note in the caller's org.
func (s *Service) GrantNoteAccess(ctx context.Context, req *grownv1.GrantKeepNoteAccessRequest) (*grownv1.GrantKeepNoteAccessResponse, error) {
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
	// Caller must be an org member of the note to manage its grants.
	if _, err := s.repo.Get(ctx, orgID, req.GetNoteId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "note not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get note: %v", err)
	}
	if err := s.grants.GrantAccess(ctx, sharing.TypeKeepNote, req.GetNoteId(), req.GetGranteeUserId(), req.GetRole(), userID); err != nil {
		return nil, status.Errorf(codes.Internal, "grant: %v", err)
	}
	list, lerr := s.grants.ListGrantsForObject(ctx, sharing.TypeKeepNote, req.GetNoteId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list grants: %v", lerr)
	}
	for _, g := range list {
		if g.GranteeUserID == req.GetGranteeUserId() {
			return &grownv1.GrantKeepNoteAccessResponse{Grant: grantToProto(g)}, nil
		}
	}
	return &grownv1.GrantKeepNoteAccessResponse{}, nil
}

// ListNoteGrants returns the per-user ACL grants on a note in the caller's org.
func (s *Service) ListNoteGrants(ctx context.Context, req *grownv1.ListKeepNoteGrantsRequest) (*grownv1.ListKeepNoteGrantsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return &grownv1.ListKeepNoteGrantsResponse{}, nil
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetNoteId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "note not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get note: %v", err)
	}
	list, lerr := s.grants.ListGrantsForObject(ctx, sharing.TypeKeepNote, req.GetNoteId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list grants: %v", lerr)
	}
	out := make([]*grownv1.ObjectGrant, 0, len(list))
	for _, g := range list {
		out = append(out, grantToProto(g))
	}
	return &grownv1.ListKeepNoteGrantsResponse{Grants: out}, nil
}

// RevokeNoteAccess removes a user's per-user grant on a note in the caller's org.
func (s *Service) RevokeNoteAccess(ctx context.Context, req *grownv1.RevokeKeepNoteAccessRequest) (*grownv1.RevokeKeepNoteAccessResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return nil, status.Error(codes.Unimplemented, "sharing not enabled")
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetNoteId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "note not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get note: %v", err)
	}
	if err := s.grants.RevokeAccess(ctx, sharing.TypeKeepNote, req.GetNoteId(), req.GetGranteeUserId()); err != nil {
		return nil, status.Errorf(codes.Internal, "revoke: %v", err)
	}
	return &grownv1.RevokeKeepNoteAccessResponse{}, nil
}

// ListNotesSharedWithMe returns notes granted to the caller by a per-user ACL
// grant (possibly cross-org), excluding the caller's own org notes.
func (s *Service) ListNotesSharedWithMe(ctx context.Context, _ *grownv1.ListKeepNotesSharedWithMeRequest) (*grownv1.ListKeepNotesSharedWithMeResponse, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return &grownv1.ListKeepNotesSharedWithMeResponse{}, nil
	}
	ids, err := s.grants.ListObjectIDsGrantedToUser(ctx, userID, sharing.TypeKeepNote)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "shared ids: %v", err)
	}
	notesList, err := s.repo.GetByIDs(ctx, ids)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "shared notes: %v", err)
	}
	resp := &grownv1.ListKeepNotesSharedWithMeResponse{Notes: make([]*grownv1.KeepNote, 0, len(notesList))}
	for _, n := range notesList {
		if n.OrgID == orgID {
			continue
		}
		resp.Notes = append(resp.Notes, toProto(n))
	}
	return resp, nil
}

// labelToProto converts a Label to its proto representation.
func labelToProto(l Label) *grownv1.KeepLabel {
	return &grownv1.KeepLabel{
		Id:        l.ID,
		OrgId:     l.OrgID,
		UserId:    l.UserID,
		Name:      l.Name,
		CreatedAt: l.CreatedAt.UTC().Format(time.RFC3339),
	}
}

// CreateLabel creates a new named label for the calling user.
func (s *Service) CreateLabel(ctx context.Context, req *grownv1.CreateKeepLabelRequest) (*grownv1.KeepLabel, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.GetName())
	if name == "" {
		return nil, status.Error(codes.InvalidArgument, "label name required")
	}
	l, err := s.repo.CreateLabel(ctx, orgID, userID, name)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create label: %v", err)
	}
	return labelToProto(l), nil
}

// ListLabels returns labels owned by the calling user within their org.
func (s *Service) ListLabels(ctx context.Context, _ *grownv1.ListKeepLabelsRequest) (*grownv1.ListKeepLabelsResponse, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.ListLabels(ctx, orgID, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list labels: %v", err)
	}
	out := make([]*grownv1.KeepLabel, 0, len(list))
	for _, l := range list {
		out = append(out, labelToProto(l))
	}
	return &grownv1.ListKeepLabelsResponse{Labels: out}, nil
}

// DeleteLabel removes a label and detaches it from all notes.
func (s *Service) DeleteLabel(ctx context.Context, req *grownv1.DeleteKeepLabelRequest) (*grownv1.DeleteKeepLabelResponse, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteLabel(ctx, orgID, userID, req.GetId()); errors.Is(err, ErrLabelNotFound) {
		return nil, status.Error(codes.NotFound, "label not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "delete label: %v", err)
	}
	return &grownv1.DeleteKeepLabelResponse{}, nil
}

// ApplyLabel attaches a label to a note (idempotent).
func (s *Service) ApplyLabel(ctx context.Context, req *grownv1.ApplyKeepLabelRequest) (*grownv1.ApplyKeepLabelResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.ApplyLabel(ctx, orgID, req.GetNoteId(), req.GetLabelId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "note not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "apply label: %v", err)
	}
	return &grownv1.ApplyKeepLabelResponse{}, nil
}

// RemoveLabel detaches a label from a note.
func (s *Service) RemoveLabel(ctx context.Context, req *grownv1.RemoveKeepLabelRequest) (*grownv1.RemoveKeepLabelResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.RemoveLabel(ctx, orgID, req.GetNoteId(), req.GetLabelId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "note not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "remove label: %v", err)
	}
	return &grownv1.RemoveKeepLabelResponse{}, nil
}

// ArchiveNote sets archived=true on a note.
func (s *Service) ArchiveNote(ctx context.Context, req *grownv1.ArchiveKeepNoteRequest) (*grownv1.KeepNote, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	n, err := s.repo.SetArchived(ctx, orgID, req.GetId(), true)
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "note not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "archive note: %v", err)
	}
	return toProto(n), nil
}

// UnarchiveNote sets archived=false on a note, restoring it to the main view.
func (s *Service) UnarchiveNote(ctx context.Context, req *grownv1.UnarchiveKeepNoteRequest) (*grownv1.KeepNote, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	n, err := s.repo.SetArchived(ctx, orgID, req.GetId(), false)
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "note not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "unarchive note: %v", err)
	}
	return toProto(n), nil
}
