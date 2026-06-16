package groups

import (
	"reflect"
	"testing"
	"time"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
)

func TestDedupe(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		want []string
	}{
		{"nil", nil, []string{}},
		{"empty", []string{}, []string{}},
		{"drops empties", []string{"", "a", ""}, []string{"a"}},
		{"drops dups preserving order", []string{"b", "a", "b", "a", "c"}, []string{"b", "a", "c"}},
		{"all empty", []string{"", "", ""}, []string{}},
		{"already unique", []string{"x", "y", "z"}, []string{"x", "y", "z"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := dedupe(tt.in)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("dedupe(%v) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestDedupeWith(t *testing.T) {
	tests := []struct {
		name string
		ids  []string
		must string
		want []string
	}{
		{"prepends must when absent", []string{"a", "b"}, "me", []string{"me", "a", "b"}},
		{"keeps must first when already present", []string{"a", "me", "b"}, "me", []string{"me", "a", "b"}},
		{"empty list still has must", nil, "me", []string{"me"}},
		{"dedupes around must", []string{"a", "a", "me", "b", "b"}, "me", []string{"me", "a", "b"}},
		{"empty must is dropped", []string{"a", "b"}, "", []string{"a", "b"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := dedupeWith(tt.ids, tt.must)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("dedupeWith(%v, %q) = %v, want %v", tt.ids, tt.must, got, tt.want)
			}
		})
	}
}

// dedupeWith must guarantee the must id is included even when callers pass a
// member list that omits the creator (the CreateGroup invariant).
func TestDedupeWith_GuaranteesCreatorMembership(t *testing.T) {
	got := dedupeWith([]string{"u1", "u2"}, "creator")
	found := false
	for _, id := range got {
		if id == "creator" {
			found = true
		}
	}
	if !found {
		t.Fatalf("dedupeWith dropped the creator: %v", got)
	}
}

func TestJSONArr(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		want string
	}{
		{"nil becomes empty array", nil, "[]"},
		{"empty becomes empty array", []string{}, "[]"},
		{"single", []string{"a"}, `["a"]`},
		{"multiple", []string{"a", "b"}, `["a","b"]`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := string(jsonArr(tt.in)); got != tt.want {
				t.Fatalf("jsonArr(%v) = %s, want %s", tt.in, got, tt.want)
			}
		})
	}
}

func TestGroupToProto(t *testing.T) {
	created := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	updated := time.Date(2024, 6, 7, 8, 9, 10, 0, time.UTC)
	g := Group{
		ID: "g1", OrgID: "o1", Name: "Eng", Email: "eng@org", Description: "engineering",
		MemberIDs: []string{"u1", "u2"}, MemberCount: 2, TopicCount: 3, PostCount: 7,
		CreatedAt: created, UpdatedAt: updated,
	}
	got := groupToProto(g)
	if got.GetId() != "g1" || got.GetOrgId() != "o1" || got.GetName() != "Eng" {
		t.Fatalf("identity fields wrong: %+v", got)
	}
	if got.GetMemberCount() != 2 || got.GetTopicCount() != 3 || got.GetPostCount() != 7 {
		t.Fatalf("counts wrong: %+v", got)
	}
	if !reflect.DeepEqual(got.GetMemberIds(), []string{"u1", "u2"}) {
		t.Fatalf("member ids wrong: %v", got.GetMemberIds())
	}
	if got.GetCreatedAt() != "2024-01-02T03:04:05Z" {
		t.Fatalf("created_at = %q", got.GetCreatedAt())
	}
	if got.GetUpdatedAt() != "2024-06-07T08:09:10Z" {
		t.Fatalf("updated_at = %q", got.GetUpdatedAt())
	}
}

// Times in non-UTC zones must serialize as their UTC instant (RFC3339, Z).
func TestGroupToProto_NormalizesToUTC(t *testing.T) {
	loc := time.FixedZone("EST", -5*3600)
	g := Group{ID: "g", CreatedAt: time.Date(2024, 1, 1, 0, 0, 0, 0, loc)}
	got := groupToProto(g)
	if got.GetCreatedAt() != "2024-01-01T05:00:00Z" {
		t.Fatalf("created_at not normalized to UTC: %q", got.GetCreatedAt())
	}
}

func TestTopicToProto(t *testing.T) {
	created := time.Date(2024, 3, 4, 5, 6, 7, 0, time.UTC)
	last := time.Date(2024, 3, 5, 6, 7, 8, 0, time.UTC)
	t.Run("with last post", func(t *testing.T) {
		got := topicToProto(Topic{
			ID: "t1", GroupID: "g1", OrgID: "o1", Subject: "Hi", AuthorID: "u1",
			AuthorName: "Alice", PostCount: 4, LastPostAt: &last, CreatedAt: created,
		})
		if got.GetLastPostAt() != "2024-03-05T06:07:08Z" {
			t.Fatalf("last_post_at = %q", got.GetLastPostAt())
		}
		if got.GetSubject() != "Hi" || got.GetAuthorName() != "Alice" || got.GetPostCount() != 4 {
			t.Fatalf("fields wrong: %+v", got)
		}
	})
	t.Run("nil last post yields empty string", func(t *testing.T) {
		got := topicToProto(Topic{ID: "t2", CreatedAt: created, LastPostAt: nil})
		if got.GetLastPostAt() != "" {
			t.Fatalf("nil LastPostAt should be empty, got %q", got.GetLastPostAt())
		}
		if got.GetCreatedAt() != "2024-03-04T05:06:07Z" {
			t.Fatalf("created_at = %q", got.GetCreatedAt())
		}
	})
}

func TestPostToProto(t *testing.T) {
	created := time.Date(2024, 9, 8, 7, 6, 5, 0, time.UTC)
	got := postToProto(Post{
		ID: "p1", TopicID: "t1", GroupID: "g1", OrgID: "o1",
		AuthorID: "u1", AuthorName: "Bob", Body: "hello", CreatedAt: created,
	})
	want := &grownv1.GroupPost{
		Id: "p1", TopicId: "t1", GroupId: "g1", OrgId: "o1",
		AuthorId: "u1", AuthorName: "Bob", Body: "hello", CreatedAt: "2024-09-08T07:06:05Z",
	}
	if got.GetId() != want.GetId() || got.GetTopicId() != want.GetTopicId() ||
		got.GetGroupId() != want.GetGroupId() || got.GetOrgId() != want.GetOrgId() ||
		got.GetAuthorId() != want.GetAuthorId() || got.GetAuthorName() != want.GetAuthorName() ||
		got.GetBody() != want.GetBody() || got.GetCreatedAt() != want.GetCreatedAt() {
		t.Fatalf("postToProto mismatch:\n got %+v\nwant %+v", got, want)
	}
}
