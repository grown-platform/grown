package chat

import (
	"testing"
	"time"
)

func TestChannelToProto(t *testing.T) {
	created := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	updated := time.Date(2024, 1, 2, 4, 0, 0, 0, time.UTC)
	last := time.Date(2024, 1, 2, 5, 0, 0, 0, time.UTC)

	tests := []struct {
		name       string
		in         Channel
		wantLastAt string
		wantMember []string
	}{
		{
			name: "full channel with last message",
			in: Channel{
				ID:            "c1",
				OrgID:         "o1",
				Kind:          "group",
				Name:          "General",
				MemberIDs:     []string{"u1", "u2"},
				LastMessageAt: &last,
				CreatedAt:     created,
				UpdatedAt:     updated,
				UnreadCount:   3,
			},
			wantLastAt: "2024-01-02T05:00:00Z",
			wantMember: []string{"u1", "u2"},
		},
		{
			name: "nil last message renders empty string",
			in: Channel{
				ID:        "c2",
				OrgID:     "o1",
				Kind:      "dm",
				MemberIDs: []string{"u1"},
				CreatedAt: created,
				UpdatedAt: updated,
			},
			wantLastAt: "",
			wantMember: []string{"u1"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := channelToProto(tt.in)
			if got.GetId() != tt.in.ID {
				t.Errorf("id: got %q want %q", got.GetId(), tt.in.ID)
			}
			if got.GetOrgId() != tt.in.OrgID {
				t.Errorf("org_id: got %q want %q", got.GetOrgId(), tt.in.OrgID)
			}
			if got.GetKind() != tt.in.Kind {
				t.Errorf("kind: got %q want %q", got.GetKind(), tt.in.Kind)
			}
			if got.GetName() != tt.in.Name {
				t.Errorf("name: got %q want %q", got.GetName(), tt.in.Name)
			}
			if got.GetLastMessageAt() != tt.wantLastAt {
				t.Errorf("last_message_at: got %q want %q", got.GetLastMessageAt(), tt.wantLastAt)
			}
			if got.GetUnreadCount() != tt.in.UnreadCount {
				t.Errorf("unread_count: got %d want %d", got.GetUnreadCount(), tt.in.UnreadCount)
			}
			if got.GetCreatedAt() != created.UTC().Format(time.RFC3339) {
				t.Errorf("created_at: got %q", got.GetCreatedAt())
			}
			if len(got.GetMemberIds()) != len(tt.wantMember) {
				t.Fatalf("member count: got %d want %d", len(got.GetMemberIds()), len(tt.wantMember))
			}
			for i, m := range tt.wantMember {
				if got.GetMemberIds()[i] != m {
					t.Errorf("member[%d]: got %q want %q", i, got.GetMemberIds()[i], m)
				}
			}
		})
	}
}

// LastMessageAt is converted to UTC regardless of the source location.
func TestChannelToProto_NormalizesToUTC(t *testing.T) {
	loc := time.FixedZone("EST", -5*3600)
	last := time.Date(2024, 6, 1, 12, 0, 0, 0, loc)
	got := channelToProto(Channel{LastMessageAt: &last})
	if got.GetLastMessageAt() != "2024-06-01T17:00:00Z" {
		t.Errorf("expected UTC normalization, got %q", got.GetLastMessageAt())
	}
}

func TestReactionsToProto(t *testing.T) {
	in := []Reaction{
		{Emoji: "👍", Count: 2, Me: true},
		{Emoji: "🎉", Count: 1, Me: false},
	}
	out := reactionsToProto(in)
	if len(out) != 2 {
		t.Fatalf("len: got %d want 2", len(out))
	}
	if out[0].GetEmoji() != "👍" || out[0].GetCount() != 2 || !out[0].GetMe() {
		t.Errorf("first reaction wrong: %+v", out[0])
	}
	if out[1].GetEmoji() != "🎉" || out[1].GetCount() != 1 || out[1].GetMe() {
		t.Errorf("second reaction wrong: %+v", out[1])
	}
}

func TestReactionsToProto_Empty(t *testing.T) {
	out := reactionsToProto(nil)
	if out == nil {
		t.Fatal("expected non-nil empty slice")
	}
	if len(out) != 0 {
		t.Errorf("len: got %d want 0", len(out))
	}
}

func TestAttachmentsToProto(t *testing.T) {
	metas := []AttachmentMeta{
		{
			Attachment: Attachment{ID: "a1", Name: "pic.png", MimeType: "image/png", Size: 1234},
			OrgID:      "o1",
			BlobKey:    "chat/att/deadbeef",
		},
	}
	out := attachmentsToProto(metas)
	if len(out) != 1 {
		t.Fatalf("len: got %d want 1", len(out))
	}
	a := out[0]
	if a.GetId() != "a1" {
		t.Errorf("id: got %q", a.GetId())
	}
	if a.GetName() != "pic.png" {
		t.Errorf("name: got %q", a.GetName())
	}
	if a.GetMimeType() != "image/png" {
		t.Errorf("mime: got %q", a.GetMimeType())
	}
	if a.GetSize() != 1234 {
		t.Errorf("size: got %d", a.GetSize())
	}
	// The URL is derived from the id and must not leak the blob key.
	if a.GetUrl() != "/api/v1/chat/attachments/a1/content" {
		t.Errorf("url: got %q", a.GetUrl())
	}
}

func TestAttachmentsToProto_Empty(t *testing.T) {
	out := attachmentsToProto(nil)
	if out == nil || len(out) != 0 {
		t.Errorf("expected non-nil empty slice, got %#v", out)
	}
}

func TestMessageToProto(t *testing.T) {
	sentAt := time.Date(2024, 3, 4, 5, 6, 7, 0, time.UTC)
	m := Message{
		ID:         "m1",
		ChannelID:  "c1",
		OrgID:      "o1",
		SenderID:   "u1",
		SenderName: "Alice",
		Body:       "hello",
		Reactions:  `{"👍":1}`,
		SentAt:     sentAt,
		ParentID:   "p1",
		ReplyCount: 4,
	}
	atts := attachmentsToProto([]AttachmentMeta{
		{Attachment: Attachment{ID: "a1", Name: "f.txt"}},
	})
	rxs := []Reaction{{Emoji: "👍", Count: 1, Me: true}}

	got := messageToProto(m, atts, rxs, "nonce-9")

	if got.GetId() != "m1" {
		t.Errorf("id: got %q", got.GetId())
	}
	if got.GetChannelId() != "c1" {
		t.Errorf("channel_id: got %q", got.GetChannelId())
	}
	if got.GetOrgId() != "o1" {
		t.Errorf("org_id: got %q", got.GetOrgId())
	}
	if got.GetSenderId() != "u1" {
		t.Errorf("sender_id: got %q", got.GetSenderId())
	}
	if got.GetSenderName() != "Alice" {
		t.Errorf("sender_name: got %q", got.GetSenderName())
	}
	if got.GetBody() != "hello" {
		t.Errorf("body: got %q", got.GetBody())
	}
	if got.GetReactions() != `{"👍":1}` {
		t.Errorf("reactions(legacy): got %q", got.GetReactions())
	}
	if got.GetSentAt() != "2024-03-04T05:06:07Z" {
		t.Errorf("sent_at: got %q", got.GetSentAt())
	}
	if got.GetParentId() != "p1" {
		t.Errorf("parent_id: got %q", got.GetParentId())
	}
	if got.GetReplyCount() != 4 {
		t.Errorf("reply_count: got %d", got.GetReplyCount())
	}
	if got.GetClientNonce() != "nonce-9" {
		t.Errorf("client_nonce: got %q", got.GetClientNonce())
	}
	if len(got.GetAttachments()) != 1 || got.GetAttachments()[0].GetId() != "a1" {
		t.Errorf("attachments: %+v", got.GetAttachments())
	}
	if len(got.GetReactionDetails()) != 1 || got.GetReactionDetails()[0].GetEmoji() != "👍" {
		t.Errorf("reaction_details: %+v", got.GetReactionDetails())
	}
}

func TestMessageToProto_NormalizesSentAtToUTC(t *testing.T) {
	loc := time.FixedZone("IST", 5*3600+1800) // +05:30
	sentAt := time.Date(2024, 3, 4, 11, 0, 0, 0, loc)
	got := messageToProto(Message{SentAt: sentAt}, nil, nil, "")
	if got.GetSentAt() != "2024-03-04T05:30:00Z" {
		t.Errorf("sent_at not normalized to UTC: got %q", got.GetSentAt())
	}
}

func TestJSONArr(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		want string
	}{
		{"nil becomes empty array", nil, "[]"},
		{"empty stays empty array", []string{}, "[]"},
		{"values preserved in order", []string{"a", "b"}, `["a","b"]`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := string(jsonArr(tt.in)); got != tt.want {
				t.Errorf("got %q want %q", got, tt.want)
			}
		})
	}
}
