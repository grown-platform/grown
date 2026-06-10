package mail

import (
	"context"
	"errors"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.MailServiceServer over a Backend (local Postgres
// store or the IMAP/SMTP bridge to mailcow). Rules are always stored in the
// Postgres repo (applied at delivery by LocalBackend; future: Sieve for mailcow).
type Service struct {
	backend Backend
	repo    *Repository
}

// NewService constructs a Service over the given backend; repo backs rule CRUD.
func NewService(backend Backend, repo *Repository) *Service {
	return &Service{backend: backend, repo: repo}
}

func caller(ctx context.Context) (Caller, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return Caller{}, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return Caller{}, status.Error(codes.Internal, "missing org context")
	}
	name := u.DisplayName
	if name == "" {
		name = u.Email
	}
	return Caller{UserID: u.ID, OrgID: o.ID, Email: u.Email, Name: name}, nil
}

func toProto(m Message) *grownv1.MailMessage {
	return &grownv1.MailMessage{
		Id:          m.ID,
		ThreadId:    m.ThreadID,
		Folder:      m.Folder,
		FromAddr:    m.FromAddr,
		FromName:    m.FromName,
		ToAddrs:     m.ToAddrs,
		CcAddrs:     m.CcAddrs,
		Subject:     m.Subject,
		Body:        m.Body,
		Snippet:     m.Snippet,
		IsRead:      m.IsRead,
		Starred:     m.Starred,
		Labels:      m.Labels,
		SentAt:      m.SentAt.UTC().Format(time.RFC3339),
		Attachments: attachmentsToProto(m.Attachments),
		SnoozeUntil: snoozeStr(m.SnoozeUntil),
	}
}

// snoozeStr renders a snooze timestamp as RFC3339, or "" when not snoozed.
func snoozeStr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func attachmentsToProto(as []Attachment) []*grownv1.MailAttachment {
	out := make([]*grownv1.MailAttachment, 0, len(as))
	for _, a := range as {
		out = append(out, &grownv1.MailAttachment{Id: a.ID, Filename: a.Filename, ContentType: a.ContentType, Size: a.Size})
	}
	return out
}

func snippetOf(body string) string {
	s := strings.Join(strings.Fields(body), " ")
	if len(s) > 140 {
		s = s[:140] + "…"
	}
	return s
}

func mapErr(err error, what string) error {
	if errors.Is(err, ErrNotFound) {
		return status.Error(codes.NotFound, "message not found")
	}
	if errors.Is(err, ErrNotImplemented) {
		return status.Error(codes.Unimplemented, err.Error())
	}
	return status.Errorf(codes.Internal, "%s: %v", what, err)
}

func (s *Service) ListMessages(ctx context.Context, req *grownv1.ListMessagesRequest) (*grownv1.ListMessagesResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	list, counts, err := s.backend.List(ctx, c, req.GetFolder(), req.GetLabel(), req.GetQuery(), req.GetStarred())
	if err != nil {
		return nil, mapErr(err, "list messages")
	}
	resp := &grownv1.ListMessagesResponse{Messages: make([]*grownv1.MailMessage, 0, len(list)), Unread: counts}
	for _, m := range list {
		m.Body = "" // list stays light
		resp.Messages = append(resp.Messages, toProto(m))
	}
	return resp, nil
}

func (s *Service) GetMessage(ctx context.Context, req *grownv1.GetMessageRequest) (*grownv1.MailMessage, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	m, err := s.backend.Get(ctx, c, req.GetId())
	if err != nil {
		return nil, mapErr(err, "get message")
	}
	return toProto(m), nil
}

func threadToProto(t Thread) *grownv1.MailThread {
	latest := toProto(t.Latest)
	latest.Body = "" // thread list stays light
	return &grownv1.MailThread{
		ThreadId:     t.ThreadID,
		Latest:       latest,
		MessageCount: int32(t.MessageCount),
		AnyUnread:    t.AnyUnread,
		Starred:      t.Starred,
		Labels:       t.Labels,
		Participants: t.Participants,
	}
}

func (s *Service) ListThreads(ctx context.Context, req *grownv1.ListMessagesRequest) (*grownv1.ListThreadsResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	threads, counts, err := s.backend.ListThreads(ctx, c, req.GetFolder(), req.GetLabel(), req.GetQuery(), req.GetStarred())
	if err != nil {
		return nil, mapErr(err, "list threads")
	}
	resp := &grownv1.ListThreadsResponse{Threads: make([]*grownv1.MailThread, 0, len(threads)), Unread: counts}
	for _, t := range threads {
		resp.Threads = append(resp.Threads, threadToProto(t))
	}
	return resp, nil
}

func (s *Service) GetThread(ctx context.Context, req *grownv1.GetThreadRequest) (*grownv1.GetThreadResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	msgs, err := s.backend.GetThread(ctx, c, req.GetThreadId(), req.GetFolder())
	if err != nil {
		return nil, mapErr(err, "get thread")
	}
	resp := &grownv1.GetThreadResponse{Messages: make([]*grownv1.MailMessage, 0, len(msgs))}
	for _, m := range msgs {
		resp.Messages = append(resp.Messages, toProto(m))
	}
	return resp, nil
}

func (s *Service) SendMessage(ctx context.Context, req *grownv1.SendMessageRequest) (*grownv1.MailMessage, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	var atts []Attachment
	for _, aid := range req.GetAttachmentIds() {
		if meta, e := s.repo.GetAttachment(ctx, c.OrgID, aid); e == nil {
			atts = append(atts, meta.Attachment)
		}
	}
	m, err := s.backend.Send(ctx, c, Compose{
		To: req.GetToAddrs(), Cc: req.GetCcAddrs(), Subject: req.GetSubject(), Body: req.GetBody(), Draft: req.GetDraft(),
		Attachments: atts,
	})
	if err != nil {
		return nil, mapErr(err, "send message")
	}
	return toProto(m), nil
}

func (s *Service) ModifyMessage(ctx context.Context, req *grownv1.ModifyMessageRequest) (*grownv1.MailMessage, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	ch := Changes{
		IsRead: req.GetIsRead(), Starred: req.GetStarred(), Folder: req.GetFolder(),
		Labels: req.GetLabels(), SetLabels: req.GetSetLabels(),
		SetSnooze: req.GetSetSnooze(),
	}
	if req.GetSetSnooze() {
		if s := strings.TrimSpace(req.GetSnoozeUntil()); s != "" {
			t, perr := time.Parse(time.RFC3339, s)
			if perr != nil {
				return nil, status.Errorf(codes.InvalidArgument, "invalid snooze_until: %v", perr)
			}
			ut := t.UTC()
			ch.SnoozeUntil = &ut
		}
	}
	m, err := s.backend.Modify(ctx, c, req.GetId(), ch)
	if err != nil {
		return nil, mapErr(err, "modify message")
	}
	return toProto(m), nil
}

func (s *Service) DeleteMessage(ctx context.Context, req *grownv1.DeleteMessageRequest) (*grownv1.DeleteMessageResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.backend.Delete(ctx, c, req.GetId()); err != nil {
		return nil, mapErr(err, "delete message")
	}
	return &grownv1.DeleteMessageResponse{}, nil
}

// --- Rules / filters ---

func ruleToProto(r Rule) *grownv1.MailRule {
	return &grownv1.MailRule{
		Id: r.ID, Name: r.Name, MatchFrom: r.MatchFrom, MatchTo: r.MatchTo, MatchSubject: r.MatchSubject,
		ActLabel: r.ActLabel, ActFolder: r.ActFolder, ActForward: r.ActForward, ActMarkRead: r.ActMarkRead, ActStar: r.ActStar,
	}
}

func (s *Service) ListRules(ctx context.Context, _ *grownv1.ListRulesRequest) (*grownv1.ListRulesResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	rules, err := s.repo.ListRules(ctx, c.UserID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list rules: %v", err)
	}
	resp := &grownv1.ListRulesResponse{Rules: make([]*grownv1.MailRule, 0, len(rules))}
	for _, r := range rules {
		resp.Rules = append(resp.Rules, ruleToProto(r))
	}
	return resp, nil
}

func (s *Service) CreateRule(ctx context.Context, req *grownv1.CreateRuleRequest) (*grownv1.MailRule, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	r, err := s.repo.CreateRule(ctx, c.OrgID, c.UserID, Rule{
		Name: req.GetName(), MatchFrom: req.GetMatchFrom(), MatchTo: req.GetMatchTo(), MatchSubject: req.GetMatchSubject(),
		ActLabel: req.GetActLabel(), ActFolder: req.GetActFolder(), ActForward: req.GetActForward(),
		ActMarkRead: req.GetActMarkRead(), ActStar: req.GetActStar(),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create rule: %v", err)
	}
	return ruleToProto(r), nil
}

func (s *Service) DeleteRule(ctx context.Context, req *grownv1.DeleteRuleRequest) (*grownv1.DeleteRuleResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteRule(ctx, c.UserID, req.GetId()); err != nil {
		return nil, mapErr(err, "delete rule")
	}
	return &grownv1.DeleteRuleResponse{}, nil
}

// --- Label entity CRUD ---

func labelEntityToProto(l LabelEntity) *grownv1.MailLabel {
	return &grownv1.MailLabel{Id: l.ID, Name: l.Name, Color: l.Color}
}

func (s *Service) CreateMailLabel(ctx context.Context, req *grownv1.CreateMailLabelRequest) (*grownv1.MailLabel, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.GetName())
	if name == "" {
		return nil, status.Error(codes.InvalidArgument, "label name is required")
	}
	l, err := s.repo.CreateLabelEntity(ctx, c.OrgID, c.UserID, name, req.GetColor())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create label: %v", err)
	}
	return labelEntityToProto(l), nil
}

func (s *Service) UpdateMailLabel(ctx context.Context, req *grownv1.UpdateMailLabelRequest) (*grownv1.MailLabel, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.GetName())
	if name == "" {
		return nil, status.Error(codes.InvalidArgument, "label name is required")
	}
	l, err := s.repo.UpdateLabelEntity(ctx, c.UserID, req.GetId(), name, req.GetColor())
	if err != nil {
		return nil, mapErr(err, "update label")
	}
	return labelEntityToProto(l), nil
}

func (s *Service) DeleteMailLabel(ctx context.Context, req *grownv1.DeleteMailLabelRequest) (*grownv1.DeleteMailLabelResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteLabelEntity(ctx, c.UserID, req.GetId()); err != nil {
		return nil, mapErr(err, "delete label")
	}
	return &grownv1.DeleteMailLabelResponse{}, nil
}

func (s *Service) ApplyMailLabel(ctx context.Context, req *grownv1.ApplyMailLabelRequest) (*grownv1.ApplyMailLabelResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.ApplyLabelToMessage(ctx, c.UserID, req.GetMessageId(), req.GetLabelId()); err != nil {
		return nil, mapErr(err, "apply label")
	}
	return &grownv1.ApplyMailLabelResponse{}, nil
}

func (s *Service) RemoveMailLabel(ctx context.Context, req *grownv1.RemoveMailLabelRequest) (*grownv1.RemoveMailLabelResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.RemoveLabelFromMessage(ctx, c.UserID, req.GetMessageId(), req.GetLabelId()); err != nil {
		return nil, mapErr(err, "remove label")
	}
	return &grownv1.RemoveMailLabelResponse{}, nil
}

// Override ListLabels to also return label entities.
func (s *Service) ListLabels(ctx context.Context, _ *grownv1.ListLabelsRequest) (*grownv1.ListLabelsResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	labels, err := s.backend.ListLabels(ctx, c)
	if err != nil {
		return nil, mapErr(err, "list labels")
	}
	entities, err := s.repo.ListLabelEntities(ctx, c.UserID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list label entities: %v", err)
	}
	resp := &grownv1.ListLabelsResponse{Labels: labels}
	for _, l := range entities {
		resp.LabelObjects = append(resp.LabelObjects, labelEntityToProto(l))
	}
	return resp, nil
}

// --- Normalized filters ---

func filterToProto(f Filter) *grownv1.MailFilter {
	return &grownv1.MailFilter{
		Id: f.ID, MatchField: f.MatchField, MatchOp: f.MatchOp, MatchValue: f.MatchValue,
		ActionType: f.ActionType, ActionValue: f.ActionValue,
	}
}

func (s *Service) ListFilters(ctx context.Context, _ *grownv1.ListFiltersRequest) (*grownv1.ListFiltersResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	filters, err := s.repo.ListFilters(ctx, c.UserID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list filters: %v", err)
	}
	resp := &grownv1.ListFiltersResponse{Filters: make([]*grownv1.MailFilter, 0, len(filters))}
	for _, f := range filters {
		resp.Filters = append(resp.Filters, filterToProto(f))
	}
	return resp, nil
}

func (s *Service) CreateFilter(ctx context.Context, req *grownv1.CreateFilterRequest) (*grownv1.MailFilter, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetMatchValue() == "" {
		return nil, status.Error(codes.InvalidArgument, "match_value is required")
	}
	f, err := s.repo.CreateFilter(ctx, c.OrgID, c.UserID, Filter{
		MatchField:  req.GetMatchField(),
		MatchOp:     req.GetMatchOp(),
		MatchValue:  req.GetMatchValue(),
		ActionType:  req.GetActionType(),
		ActionValue: req.GetActionValue(),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create filter: %v", err)
	}
	return filterToProto(f), nil
}

func (s *Service) DeleteFilter(ctx context.Context, req *grownv1.DeleteFilterRequest) (*grownv1.DeleteFilterResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteFilter(ctx, c.UserID, req.GetId()); err != nil {
		return nil, mapErr(err, "delete filter")
	}
	return &grownv1.DeleteFilterResponse{}, nil
}

func (s *Service) ApplyFilters(ctx context.Context, _ *grownv1.ApplyFiltersRequest) (*grownv1.ApplyFiltersResponse, error) {
	c, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	lb, ok := s.backend.(*LocalBackend)
	if !ok {
		return nil, status.Error(codes.Unimplemented, "ApplyFilters only supported on the local backend")
	}
	n, err := lb.ApplyFiltersNow(ctx, c)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "apply filters: %v", err)
	}
	return &grownv1.ApplyFiltersResponse{Modified: n}, nil
}
