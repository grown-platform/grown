package chat

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.ChatServiceServer.
type Service struct {
	repo *Repository
	hub  *Hub // may be nil; when set, new messages and deletes are broadcast over WS
}

// NewService constructs a Service. hub may be nil (no realtime broadcasts).
func NewService(repo *Repository, hub *Hub) *Service { return &Service{repo: repo, hub: hub} }

// attachmentsToProto converts a slice of AttachmentMeta to proto ChatAttachments.
func attachmentsToProto(metas []AttachmentMeta) []*grownv1.ChatAttachment {
	out := make([]*grownv1.ChatAttachment, 0, len(metas))
	for _, m := range metas {
		out = append(out, &grownv1.ChatAttachment{
			Id:       m.ID,
			Name:     m.Name,
			MimeType: m.MimeType,
			Size:     m.Size,
			Url:      "/api/v1/chat/attachments/" + m.ID + "/content",
		})
	}
	return out
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

func callerUser(ctx context.Context) (string, string, error) {
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

func channelToProto(ch Channel) *grownv1.ChatChannel {
	lastAt := ""
	if ch.LastMessageAt != nil {
		lastAt = ch.LastMessageAt.UTC().Format(time.RFC3339)
	}
	return &grownv1.ChatChannel{
		Id:            ch.ID,
		OrgId:         ch.OrgID,
		Kind:          ch.Kind,
		Name:          ch.Name,
		MemberIds:     ch.MemberIDs,
		CreatedAt:     ch.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:     ch.UpdatedAt.UTC().Format(time.RFC3339),
		LastMessageAt: lastAt,
		UnreadCount:   ch.UnreadCount,
	}
}

func reactionsToProto(rxs []Reaction) []*grownv1.ChatReaction {
	out := make([]*grownv1.ChatReaction, 0, len(rxs))
	for _, rx := range rxs {
		out = append(out, &grownv1.ChatReaction{Emoji: rx.Emoji, Count: rx.Count, Me: rx.Me})
	}
	return out
}

func messageToProto(m Message, atts []*grownv1.ChatAttachment, rxs []Reaction, nonce string) *grownv1.ChatMessage {
	return &grownv1.ChatMessage{
		Id:              m.ID,
		ChannelId:       m.ChannelID,
		OrgId:           m.OrgID,
		SenderId:        m.SenderID,
		SenderName:      m.SenderName,
		Body:            m.Body,
		Reactions:       m.Reactions,
		SentAt:          m.SentAt.UTC().Format(time.RFC3339),
		Attachments:     atts,
		ReactionDetails: reactionsToProto(rxs),
		ParentId:        m.ParentID,
		ReplyCount:      m.ReplyCount,
		ClientNonce:     nonce,
	}
}

// ListChatChannels returns all channels the caller belongs to.
func (s *Service) ListChatChannels(ctx context.Context, _ *grownv1.ListChatChannelsRequest) (*grownv1.ListChatChannelsResponse, error) {
	userID, orgID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	channels, err := s.repo.ListChannelsForUser(ctx, orgID, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list channels: %v", err)
	}
	resp := &grownv1.ListChatChannelsResponse{Channels: make([]*grownv1.ChatChannel, 0, len(channels))}
	for _, ch := range channels {
		resp.Channels = append(resp.Channels, channelToProto(ch))
	}
	return resp, nil
}

// CreateChatChannel creates a DM or group channel.
func (s *Service) CreateChatChannel(ctx context.Context, req *grownv1.CreateChatChannelRequest) (*grownv1.ChatChannel, error) {
	userID, orgID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	kind := req.GetKind()
	if kind != "dm" && kind != "group" {
		return nil, status.Error(codes.InvalidArgument, "kind must be 'dm' or 'group'")
	}

	// Ensure caller is always a member.
	memberSet := map[string]struct{}{userID: {}}
	for _, id := range req.GetMemberIds() {
		if id != "" {
			memberSet[id] = struct{}{}
		}
	}
	members := make([]string, 0, len(memberSet))
	for id := range memberSet {
		members = append(members, id)
	}

	if kind == "dm" {
		// A DM is either with one other person (2 members) or with yourself —
		// a "Notes to self" channel (just the caller). De-duplicate either way.
		switch len(members) {
		case 1:
			if existing, err := s.repo.FindDMChannel(ctx, orgID, userID, userID); err == nil {
				return channelToProto(existing), nil
			}
		case 2:
			if existing, err := s.repo.FindDMChannel(ctx, orgID, members[0], members[1]); err == nil {
				return channelToProto(existing), nil
			}
		default:
			return nil, status.Error(codes.InvalidArgument, "a DM is with yourself or one other member")
		}
	} else {
		if req.GetName() == "" {
			return nil, status.Error(codes.InvalidArgument, "group channel requires a name")
		}
	}

	ch, err := s.repo.CreateChannel(ctx, orgID, kind, req.GetName(), members)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create channel: %v", err)
	}
	return channelToProto(ch), nil
}

// GetChatChannel returns a single channel the caller belongs to.
func (s *Service) GetChatChannel(ctx context.Context, req *grownv1.GetChatChannelRequest) (*grownv1.ChatChannel, error) {
	userID, orgID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	ch, err := s.repo.GetChannel(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "channel not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get channel: %v", err)
	}
	// Verify membership.
	isMember := false
	for _, id := range ch.MemberIDs {
		if id == userID {
			isMember = true
			break
		}
	}
	if !isMember {
		return nil, status.Error(codes.PermissionDenied, "not a member of this channel")
	}
	return channelToProto(ch), nil
}

// ListChatMessages returns messages in a channel the caller belongs to.
func (s *Service) ListChatMessages(ctx context.Context, req *grownv1.ListChatMessagesRequest) (*grownv1.ListChatMessagesResponse, error) {
	userID, orgID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	ch, err := s.repo.GetChannel(ctx, orgID, req.GetChannelId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "channel not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get channel: %v", err)
	}
	isMember := false
	for _, id := range ch.MemberIDs {
		if id == userID {
			isMember = true
			break
		}
	}
	if !isMember {
		return nil, status.Error(codes.PermissionDenied, "not a member of this channel")
	}

	msgs, err := s.repo.ListMessages(ctx, orgID, req.GetChannelId(), req.GetBeforeId(), req.GetLimit())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list messages: %v", err)
	}
	// Reverse to chronological order.
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
	// Update read cursor.
	_ = s.repo.UpdateReadCursor(ctx, req.GetChannelId(), userID)

	// Fetch reactions for all messages in a single query.
	msgIDs := make([]string, 0, len(msgs))
	for _, m := range msgs {
		msgIDs = append(msgIDs, m.ID)
	}
	rxMap, _ := s.repo.GetReactionsForMessages(ctx, msgIDs, userID)

	resp := &grownv1.ListChatMessagesResponse{Messages: make([]*grownv1.ChatMessage, 0, len(msgs))}
	for _, m := range msgs {
		attMetas, _ := s.repo.GetAttachmentsForMessage(ctx, orgID, m.ID)
		resp.Messages = append(resp.Messages, messageToProto(m, attachmentsToProto(attMetas), rxMap[m.ID], ""))
	}
	return resp, nil
}

// PostChatMessage posts a message to a channel.
func (s *Service) PostChatMessage(ctx context.Context, req *grownv1.PostChatMessageRequest) (*grownv1.ChatMessage, error) {
	userID, orgID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetBody() == "" {
		return nil, status.Error(codes.InvalidArgument, "body is required")
	}
	u, _ := auth.UserFromContext(ctx)
	ch, err := s.repo.GetChannel(ctx, orgID, req.GetChannelId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "channel not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get channel: %v", err)
	}
	isMember := false
	for _, id := range ch.MemberIDs {
		if id == userID {
			isMember = true
			break
		}
	}
	if !isMember {
		return nil, status.Error(codes.PermissionDenied, "not a member of this channel")
	}

	senderName := u.DisplayName
	if senderName == "" {
		senderName = u.Email
	}
	m, err := s.repo.PostMessage(ctx, req.GetChannelId(), orgID, userID, senderName, req.GetBody(), "")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "post message: %v", err)
	}
	// Link any pre-uploaded attachments to this message.
	attIDs := req.GetAttachmentIds()
	if len(attIDs) > 0 {
		if linkErr := s.repo.LinkAttachmentsToMessage(ctx, orgID, m.ID, attIDs); linkErr != nil {
			// Non-fatal: message is posted; log and continue.
			_ = linkErr
		}
	}
	attMetas, _ := s.repo.GetAttachmentsForMessage(ctx, orgID, m.ID)
	proto := messageToProto(m, attachmentsToProto(attMetas), nil, req.GetClientNonce())
	// Broadcast to all WebSocket subscribers of this channel so others see
	// the message in real time. The nonce is included so the sender's own
	// client can reconcile its optimistic copy.
	if s.hub != nil {
		s.hub.BroadcastMessage(m.ChannelID, proto)
	}
	return proto, nil
}

// DeleteChatMessage deletes a message (only sender can delete).
func (s *Service) DeleteChatMessage(ctx context.Context, req *grownv1.DeleteChatMessageRequest) (*grownv1.DeleteChatMessageResponse, error) {
	userID, orgID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.DeleteMessage(ctx, orgID, req.GetChannelId(), req.GetId(), userID)
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "message not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete message: %v", err)
	}
	if s.hub != nil {
		s.hub.BroadcastDeleted(req.GetChannelId(), req.GetId())
	}
	return &grownv1.DeleteChatMessageResponse{}, nil
}

// ReactToChatMessage toggles an emoji reaction on a message.
func (s *Service) ReactToChatMessage(ctx context.Context, req *grownv1.ReactToChatMessageRequest) (*grownv1.ReactToChatMessageResponse, error) {
	userID, orgID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetEmoji() == "" {
		return nil, status.Error(codes.InvalidArgument, "emoji is required")
	}
	// Verify the caller is a member of the channel.
	ch, err := s.repo.GetChannel(ctx, orgID, req.GetChannelId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "channel not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get channel: %v", err)
	}
	isMember := false
	for _, id := range ch.MemberIDs {
		if id == userID {
			isMember = true
			break
		}
	}
	if !isMember {
		return nil, status.Error(codes.PermissionDenied, "not a member of this channel")
	}
	rxs, err := s.repo.ToggleReaction(ctx, orgID, req.GetMessageId(), userID, req.GetEmoji())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "toggle reaction: %v", err)
	}
	return &grownv1.ReactToChatMessageResponse{ReactionDetails: reactionsToProto(rxs)}, nil
}

// PostThreadReply posts a reply in a message's thread.
func (s *Service) PostThreadReply(ctx context.Context, req *grownv1.PostThreadReplyRequest) (*grownv1.ChatMessage, error) {
	userID, orgID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetBody() == "" {
		return nil, status.Error(codes.InvalidArgument, "body is required")
	}
	if req.GetParentId() == "" {
		return nil, status.Error(codes.InvalidArgument, "parent_id is required")
	}
	u, _ := auth.UserFromContext(ctx)
	ch, err := s.repo.GetChannel(ctx, orgID, req.GetChannelId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "channel not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get channel: %v", err)
	}
	isMember := false
	for _, id := range ch.MemberIDs {
		if id == userID {
			isMember = true
			break
		}
	}
	if !isMember {
		return nil, status.Error(codes.PermissionDenied, "not a member of this channel")
	}
	senderName := u.DisplayName
	if senderName == "" {
		senderName = u.Email
	}
	m, err := s.repo.PostMessage(ctx, req.GetChannelId(), orgID, userID, senderName, req.GetBody(), req.GetParentId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "post reply: %v", err)
	}
	attIDs := req.GetAttachmentIds()
	if len(attIDs) > 0 {
		_ = s.repo.LinkAttachmentsToMessage(ctx, orgID, m.ID, attIDs)
	}
	attMetas, _ := s.repo.GetAttachmentsForMessage(ctx, orgID, m.ID)
	return messageToProto(m, attachmentsToProto(attMetas), nil, ""), nil
}

// ListThreadReplies returns all replies to a message.
func (s *Service) ListThreadReplies(ctx context.Context, req *grownv1.ListThreadRepliesRequest) (*grownv1.ListThreadRepliesResponse, error) {
	userID, orgID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	ch, err := s.repo.GetChannel(ctx, orgID, req.GetChannelId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "channel not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get channel: %v", err)
	}
	isMember := false
	for _, id := range ch.MemberIDs {
		if id == userID {
			isMember = true
			break
		}
	}
	if !isMember {
		return nil, status.Error(codes.PermissionDenied, "not a member of this channel")
	}
	msgs, err := s.repo.ListThreadReplies(ctx, orgID, req.GetChannelId(), req.GetParentId(), req.GetLimit())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list thread replies: %v", err)
	}
	msgIDs := make([]string, 0, len(msgs))
	for _, m := range msgs {
		msgIDs = append(msgIDs, m.ID)
	}
	rxMap, _ := s.repo.GetReactionsForMessages(ctx, msgIDs, userID)
	resp := &grownv1.ListThreadRepliesResponse{Messages: make([]*grownv1.ChatMessage, 0, len(msgs))}
	for _, m := range msgs {
		attMetas, _ := s.repo.GetAttachmentsForMessage(ctx, orgID, m.ID)
		resp.Messages = append(resp.Messages, messageToProto(m, attachmentsToProto(attMetas), rxMap[m.ID], ""))
	}
	return resp, nil
}
