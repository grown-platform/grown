package docs

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/users"
)

// Service implements grownv1.DocsServiceServer over a Repository. Document
// content is synced separately via the collab WebSocket (see collab.go).
type Service struct {
	repo   *Repository
	grants *sharing.Repository // nil disables per-user ACL grants
	notify Notifier            // best-effort grant notification; nil = no-op
}

// Notifier receives a best-effort callback when a per-user grant is created.
type Notifier interface {
	NotifyGranted(ctx context.Context, granteeUserID, objectType, objectID, role string)
}

// NewService constructs a Service.
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// WithSharing wires the per-user ACL grant repository, enabling GrantAccess/
// ListGrants/RevokeAccess, "Shared with me", and cross-org grant reads.
func (s *Service) WithSharing(grants *sharing.Repository, notify Notifier) *Service {
	s.grants = grants
	s.notify = notify
	return s
}

// accessDoc resolves a document the caller may read: an org member sees their
// org's docs; otherwise a per-user grant (object_grants) is required. Returns
// the doc, the caller's effective role, and a gRPC NotFound error when neither
// path grants access (absent and forbidden are indistinguishable to the caller).
func (s *Service) accessDoc(ctx context.Context, orgID, userID, docID string) (Doc, string, error) {
	if d, err := s.repo.Get(ctx, orgID, docID); err == nil {
		role := "editor"
		if d.OwnerID == userID {
			role = "owner"
		}
		return d, role, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Doc{}, "", status.Errorf(codes.Internal, "get doc: %v", err)
	}
	if s.grants != nil {
		role, ok, err := s.grants.RoleFor(ctx, userID, sharing.TypeDocsDoc, docID)
		if err != nil {
			return Doc{}, "", status.Errorf(codes.Internal, "grant lookup: %v", err)
		}
		if ok {
			d, gerr := s.repo.GetByID(ctx, docID)
			if errors.Is(gerr, ErrNotFound) {
				return Doc{}, "", status.Error(codes.NotFound, "document not found")
			}
			if gerr != nil {
				return Doc{}, "", status.Errorf(codes.Internal, "get doc: %v", gerr)
			}
			return d, role, nil
		}
	}
	return Doc{}, "", status.Error(codes.NotFound, "document not found")
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

// callerOrg returns the org attached to the request context by auth middleware,
// or an Unauthenticated/Internal error.
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

// displayName returns the user's display name, falling back to their email.
func displayName(u users.User) string {
	if u.DisplayName != "" {
		return u.DisplayName
	}
	return u.Email
}

func toProto(d Doc) *grownv1.Doc {
	return &grownv1.Doc{
		Id:          d.ID,
		OrgId:       d.OrgID,
		OwnerId:     d.OwnerID,
		Title:       d.Title,
		CreatedAt:   d.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   d.UpdatedAt.UTC().Format(time.RFC3339),
		PreviewHtml: d.PreviewHTML,
		IsTemplate:  d.IsTemplate,
	}
}

// SetTemplate flags or unflags a document as a gallery template.
func (s *Service) SetTemplate(ctx context.Context, req *grownv1.SetTemplateRequest) (*grownv1.Doc, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	d, err := s.repo.SetTemplate(ctx, orgID, req.GetId(), req.GetIsTemplate())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "set template: %v", err)
	}
	return toProto(d), nil
}

// maxPreviewBytes caps the stored thumbnail HTML.
const maxPreviewBytes = 8 << 10

// UpdatePreview stores a rendered-HTML thumbnail for a document.
func (s *Service) UpdatePreview(ctx context.Context, req *grownv1.UpdatePreviewRequest) (*grownv1.UpdatePreviewResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	html := req.GetHtml()
	if len(html) > maxPreviewBytes {
		html = html[:maxPreviewBytes]
	}
	if err := s.repo.SetPreview(ctx, orgID, req.GetId(), html); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "set preview: %v", err)
	}
	return &grownv1.UpdatePreviewResponse{}, nil
}

// ListDocs returns the caller's org's non-trashed documents.
func (s *Service) ListDocs(ctx context.Context, _ *grownv1.ListDocsRequest) (*grownv1.ListDocsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.List(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list docs: %v", err)
	}
	resp := &grownv1.ListDocsResponse{Docs: make([]*grownv1.Doc, 0, len(list))}
	for _, d := range list {
		resp.Docs = append(resp.Docs, toProto(d))
	}
	return resp, nil
}

// CreateDoc creates a new empty document owned by the caller.
func (s *Service) CreateDoc(ctx context.Context, req *grownv1.CreateDocRequest) (*grownv1.Doc, error) {
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
		return nil, status.Errorf(codes.Internal, "create doc: %v", err)
	}
	return toProto(d), nil
}

// GetDoc returns a single document's metadata. An org member sees their org's
// docs; a per-user grantee (possibly cross-org) sees docs shared with them.
func (s *Service) GetDoc(ctx context.Context, req *grownv1.GetDocRequest) (*grownv1.Doc, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	d, _, aerr := s.accessDoc(ctx, orgID, userID, req.GetId())
	if aerr != nil {
		return nil, aerr
	}
	return toProto(d), nil
}

// RenameDoc changes a document's title.
func (s *Service) RenameDoc(ctx context.Context, req *grownv1.RenameDocRequest) (*grownv1.Doc, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	d, err := s.repo.Rename(ctx, orgID, req.GetId(), req.GetTitle())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "rename doc: %v", err)
	}
	return toProto(d), nil
}

// TrashDoc soft-deletes a document.
func (s *Service) TrashDoc(ctx context.Context, req *grownv1.TrashDocRequest) (*grownv1.TrashDocResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.Trash(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "trash doc: %v", err)
	}
	return &grownv1.TrashDocResponse{}, nil
}

func toShareProto(s Share) *grownv1.DocShare {
	return &grownv1.DocShare{
		Token:     s.Token,
		DocId:     s.DocID,
		Role:      s.Role,
		Audience:  s.Audience,
		CreatedAt: s.CreatedAt.UTC().Format(time.RFC3339),
	}
}

// CreateShare issues a share-link token for a document the caller can access.
func (s *Service) CreateShare(ctx context.Context, req *grownv1.CreateDocShareRequest) (*grownv1.DocShare, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	role := req.GetRole()
	if role != "viewer" && role != "editor" {
		return nil, status.Error(codes.InvalidArgument, "role must be viewer or editor")
	}
	if _, err := s.repo.Get(ctx, o.ID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	share, err := s.repo.CreateShare(ctx, req.GetDocId(), u.ID, role, req.GetAudience())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create share: %v", err)
	}
	return toShareProto(share), nil
}

// ListShares returns active shares for a document the caller can access.
func (s *Service) ListShares(ctx context.Context, req *grownv1.ListDocSharesRequest) (*grownv1.ListDocSharesResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	list, err := s.repo.ListShares(ctx, req.GetDocId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list shares: %v", err)
	}
	resp := &grownv1.ListDocSharesResponse{Shares: make([]*grownv1.DocShare, 0, len(list))}
	for _, sh := range list {
		resp.Shares = append(resp.Shares, toShareProto(sh))
	}
	return resp, nil
}

// RevokeShare revokes a token, checking the share's document is in the caller's org.
func (s *Service) RevokeShare(ctx context.Context, req *grownv1.RevokeDocShareRequest) (*grownv1.RevokeDocShareResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	grant, err := s.repo.GetShareByToken(ctx, req.GetToken())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "share not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "lookup share: %v", err)
	}
	if _, err := s.repo.Get(ctx, orgID, grant.DocID); err != nil {
		return nil, status.Error(codes.NotFound, "share not found")
	}
	if err := s.repo.RevokeShare(ctx, req.GetToken()); err != nil {
		return nil, status.Errorf(codes.Internal, "revoke share: %v", err)
	}
	return &grownv1.RevokeDocShareResponse{}, nil
}

func toVersionProto(v Version) *grownv1.DocVersion {
	return &grownv1.DocVersion{
		Id:          v.ID,
		DocId:       v.DocID,
		AuthorId:    v.AuthorID,
		AuthorName:  v.AuthorName,
		Label:       v.Label,
		ContentHtml: v.ContentHTML,
		IsAuto:      v.IsAuto,
		CreatedAt:   v.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func toCommentProto(c Comment) *grownv1.DocComment {
	resolvedAt := ""
	if c.ResolvedAt != nil {
		resolvedAt = c.ResolvedAt.UTC().Format(time.RFC3339)
	}
	replies := make([]*grownv1.DocComment, 0, len(c.Replies))
	for _, r := range c.Replies {
		replies = append(replies, toCommentProto(r))
	}
	p := &grownv1.DocComment{
		Id:              c.ID,
		DocId:           c.DocID,
		AuthorId:        c.AuthorID,
		AuthorName:      c.AuthorName,
		Body:            c.Body,
		Quote:           c.Quote,
		AnchorFrom:      c.AnchorFrom,
		AnchorTo:        c.AnchorTo,
		Resolved:        c.Resolved,
		CreatedAt:       c.CreatedAt.UTC().Format(time.RFC3339),
		ResolvedAt:      resolvedAt,
		ParentCommentId: c.ParentCommentID,
		Replies:         replies,
	}
	if !c.UpdatedAt.IsZero() {
		p.UpdatedAt = c.UpdatedAt.UTC().Format(time.RFC3339)
	}
	return p
}

// maxCommentBytes caps a comment body.
const maxCommentBytes = 8 << 10

// SnapshotNow captures the current rendered document as a new version.
func (s *Service) SnapshotNow(ctx context.Context, req *grownv1.SnapshotNowRequest) (*grownv1.DocVersion, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	if _, err := s.repo.Get(ctx, o.ID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	v, err := s.repo.CreateVersion(ctx, req.GetDocId(), u.ID, req.GetLabel(), req.GetContentHtml(), req.GetIsAuto())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "snapshot: %v", err)
	}
	v.AuthorName = displayName(u)
	return toVersionProto(v), nil
}

// ListVersions returns a document's saved versions (metadata only).
func (s *Service) ListVersions(ctx context.Context, req *grownv1.ListVersionsRequest) (*grownv1.ListVersionsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	list, err := s.repo.ListVersions(ctx, req.GetDocId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list versions: %v", err)
	}
	resp := &grownv1.ListVersionsResponse{Versions: make([]*grownv1.DocVersion, 0, len(list))}
	for _, v := range list {
		resp.Versions = append(resp.Versions, toVersionProto(v))
	}
	return resp, nil
}

// GetVersion returns a single version including its content_html.
func (s *Service) GetVersion(ctx context.Context, req *grownv1.GetVersionRequest) (*grownv1.DocVersion, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	v, err := s.repo.GetVersion(ctx, req.GetDocId(), req.GetVersionId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "version not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get version: %v", err)
	}
	return toVersionProto(v), nil
}

// RestoreVersion records a new version copying an older one's content and
// returns it, so the restore is itself auditable.
func (s *Service) RestoreVersion(ctx context.Context, req *grownv1.RestoreVersionRequest) (*grownv1.DocVersion, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	if _, err := s.repo.Get(ctx, o.ID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	src, err := s.repo.GetVersion(ctx, req.GetDocId(), req.GetVersionId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "version not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get version: %v", err)
	}
	label := "Restored version"
	if t := src.CreatedAt.UTC().Format("Jan 2, 2006 3:04 PM"); t != "" {
		label = "Restored " + t
	}
	v, err := s.repo.CreateVersion(ctx, req.GetDocId(), u.ID, label, src.ContentHTML, false)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "restore version: %v", err)
	}
	v.AuthorName = displayName(u)
	v.ContentHTML = src.ContentHTML
	return toVersionProto(v), nil
}

// ListComments returns a document's comments.
func (s *Service) ListComments(ctx context.Context, req *grownv1.ListCommentsRequest) (*grownv1.ListCommentsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	list, err := s.repo.ListComments(ctx, req.GetDocId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list comments: %v", err)
	}
	resp := &grownv1.ListCommentsResponse{Comments: make([]*grownv1.DocComment, 0, len(list))}
	for _, c := range list {
		resp.Comments = append(resp.Comments, toCommentProto(c))
	}
	return resp, nil
}

// AddComment anchors a new comment to a text selection.
func (s *Service) AddComment(ctx context.Context, req *grownv1.AddCommentRequest) (*grownv1.DocComment, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	body := req.GetBody()
	if len(body) == 0 {
		return nil, status.Error(codes.InvalidArgument, "comment body required")
	}
	if len(body) > maxCommentBytes {
		body = body[:maxCommentBytes]
	}
	if _, err := s.repo.Get(ctx, o.ID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	c, err := s.repo.CreateComment(ctx, req.GetDocId(), u.ID, body, req.GetQuote(), req.GetAnchorFrom(), req.GetAnchorTo())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "add comment: %v", err)
	}
	c.AuthorName = displayName(u)
	return toCommentProto(c), nil
}

// ReplyToComment posts a reply under an existing top-level comment.
func (s *Service) ReplyToComment(ctx context.Context, req *grownv1.ReplyToCommentRequest) (*grownv1.DocComment, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	body := req.GetBody()
	if len(body) == 0 {
		return nil, status.Error(codes.InvalidArgument, "reply body required")
	}
	if len(body) > maxCommentBytes {
		body = body[:maxCommentBytes]
	}
	if _, err := s.repo.Get(ctx, o.ID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	c, err := s.repo.ReplyToComment(ctx, req.GetDocId(), req.GetCommentId(), u.ID, body)
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "comment not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "reply to comment: %v", err)
	}
	c.AuthorName = displayName(u)
	return toCommentProto(c), nil
}

// ReopenComment reopens a previously resolved comment thread.
func (s *Service) ReopenComment(ctx context.Context, req *grownv1.ReopenCommentRequest) (*grownv1.DocComment, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	c, err := s.repo.ResolveComment(ctx, req.GetDocId(), req.GetCommentId(), false)
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "comment not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "reopen comment: %v", err)
	}
	return toCommentProto(c), nil
}

// ResolveComment marks a comment resolved or reopens it.
func (s *Service) ResolveComment(ctx context.Context, req *grownv1.ResolveCommentRequest) (*grownv1.DocComment, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	c, err := s.repo.ResolveComment(ctx, req.GetDocId(), req.GetCommentId(), req.GetResolved())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "comment not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "resolve comment: %v", err)
	}
	return toCommentProto(c), nil
}

// DeleteComment removes a comment.
func (s *Service) DeleteComment(ctx context.Context, req *grownv1.DeleteCommentRequest) (*grownv1.DeleteCommentResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	if err := s.repo.DeleteComment(ctx, req.GetDocId(), req.GetCommentId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "comment not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "delete comment: %v", err)
	}
	return &grownv1.DeleteCommentResponse{}, nil
}

// GetShare resolves a share token to its document. Public: no session required.
func (s *Service) GetShare(ctx context.Context, req *grownv1.GetDocShareRequest) (*grownv1.DocShareInfo, error) {
	grant, err := s.repo.GetShareByToken(ctx, req.GetToken())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "share not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get share: %v", err)
	}
	return &grownv1.DocShareInfo{DocId: grant.DocID, Role: grant.Role, Title: grant.DocTitle}, nil
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

// GrantAccess grants a grown user a role on a document in the caller's org.
func (s *Service) GrantAccess(ctx context.Context, req *grownv1.GrantDocAccessRequest) (*grownv1.GrantDocAccessResponse, error) {
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
	// Caller must be an org member of the doc to manage its grants.
	if _, err := s.repo.Get(ctx, orgID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	if err := s.grants.GrantAccess(ctx, sharing.TypeDocsDoc, req.GetDocId(), req.GetGranteeUserId(), req.GetRole(), userID); err != nil {
		return nil, status.Errorf(codes.Internal, "grant: %v", err)
	}
	if s.notify != nil {
		s.notify.NotifyGranted(ctx, req.GetGranteeUserId(), sharing.TypeDocsDoc, req.GetDocId(), req.GetRole())
	}
	list, lerr := s.grants.ListGrantsForObject(ctx, sharing.TypeDocsDoc, req.GetDocId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list grants: %v", lerr)
	}
	for _, g := range list {
		if g.GranteeUserID == req.GetGranteeUserId() {
			return &grownv1.GrantDocAccessResponse{Grant: grantToProto(g)}, nil
		}
	}
	return &grownv1.GrantDocAccessResponse{}, nil
}

// ListGrants returns the per-user ACL grants on a document in the caller's org.
func (s *Service) ListGrants(ctx context.Context, req *grownv1.ListDocGrantsRequest) (*grownv1.ListDocGrantsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return &grownv1.ListDocGrantsResponse{}, nil
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	list, lerr := s.grants.ListGrantsForObject(ctx, sharing.TypeDocsDoc, req.GetDocId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list grants: %v", lerr)
	}
	out := make([]*grownv1.ObjectGrant, 0, len(list))
	for _, g := range list {
		out = append(out, grantToProto(g))
	}
	return &grownv1.ListDocGrantsResponse{Grants: out}, nil
}

// RevokeAccess removes a user's per-user grant on a document in the caller's org.
func (s *Service) RevokeAccess(ctx context.Context, req *grownv1.RevokeDocAccessRequest) (*grownv1.RevokeDocAccessResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return nil, status.Error(codes.Unimplemented, "sharing not enabled")
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetDocId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "document not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get doc: %v", err)
	}
	if err := s.grants.RevokeAccess(ctx, sharing.TypeDocsDoc, req.GetDocId(), req.GetGranteeUserId()); err != nil {
		return nil, status.Errorf(codes.Internal, "revoke: %v", err)
	}
	return &grownv1.RevokeDocAccessResponse{}, nil
}

// ListSharedWithMe returns documents granted to the caller by a per-user ACL
// grant (possibly cross-org), excluding the caller's own org docs.
func (s *Service) ListSharedWithMe(ctx context.Context, _ *grownv1.ListDocsSharedWithMeRequest) (*grownv1.ListDocsSharedWithMeResponse, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return &grownv1.ListDocsSharedWithMeResponse{}, nil
	}
	ids, err := s.grants.ListObjectIDsGrantedToUser(ctx, userID, sharing.TypeDocsDoc)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "shared ids: %v", err)
	}
	docsList, err := s.repo.GetByIDs(ctx, ids)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "shared docs: %v", err)
	}
	resp := &grownv1.ListDocsSharedWithMeResponse{Docs: make([]*grownv1.Doc, 0, len(docsList))}
	for _, d := range docsList {
		if d.OrgID == orgID {
			continue
		}
		resp.Docs = append(resp.Docs, toProto(d))
	}
	return resp, nil
}
