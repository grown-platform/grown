package projects

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// These tests exercise the pure (non-DB) logic in repository.go / service.go:
// helper functions, the Issue identifier, proto mappers, and error mapping.
// They run without GROWN_TEST_DSN.

func TestIssueIdentifier(t *testing.T) {
	tests := []struct {
		name string
		key  string
		num  int32
		want string
	}{
		{"empty key yields empty", "", 7, ""},
		{"empty key zero number", "", 0, ""},
		{"normal", "ENG", 1, "ENG-1"},
		{"large number", "OPS", 4096, "OPS-4096"},
		{"zero number with key", "ABC", 0, "ABC-0"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := Issue{TeamKey: tc.key, Number: tc.num}.Identifier()
			if got != tc.want {
				t.Errorf("Identifier(): got %q want %q", got, tc.want)
			}
		})
	}
}

func TestJsonArr(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		want string
	}{
		{"nil becomes empty array", nil, `[]`},
		{"empty stays empty array", []string{}, `[]`},
		{"single element", []string{"a"}, `["a"]`},
		{"multiple elements", []string{"a", "b", "c"}, `["a","b","c"]`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := string(jsonArr(tc.in))
			if got != tc.want {
				t.Errorf("jsonArr(%v): got %q want %q", tc.in, got, tc.want)
			}
			// Result must always be valid JSON that round-trips to a slice.
			var back []string
			if err := json.Unmarshal(jsonArr(tc.in), &back); err != nil {
				t.Errorf("jsonArr produced invalid JSON: %v", err)
			}
		})
	}
}

func TestNullable(t *testing.T) {
	if got := nullable(""); got != nil {
		t.Errorf("nullable(\"\"): got %v want nil", got)
	}
	if got := nullable("x"); got != "x" {
		t.Errorf("nullable(\"x\"): got %v want \"x\"", got)
	}
	// A whitespace string is non-empty and must pass through unchanged.
	if got := nullable(" "); got != " " {
		t.Errorf("nullable(\" \"): got %v want \" \"", got)
	}
}

func TestJoinComma(t *testing.T) {
	tests := []struct {
		name  string
		parts []string
		want  string
	}{
		{"empty", nil, ""},
		{"single", []string{"a=1"}, "a=1"},
		{"two", []string{"a=1", "b=2"}, "a=1, b=2"},
		{"three", []string{"a=1", "b=2", "c=3"}, "a=1, b=2, c=3"},
		{"empty strings preserved", []string{"", ""}, ", "},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := joinComma(tc.parts); got != tc.want {
				t.Errorf("joinComma(%v): got %q want %q", tc.parts, got, tc.want)
			}
		})
	}
}

func TestToStatus(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want codes.Code
	}{
		{"not found maps to NotFound", ErrNotFound, codes.NotFound},
		{"wrapped not found maps to NotFound", fmt.Errorf("ctx: %w", ErrNotFound), codes.NotFound},
		{"not org member maps to InvalidArgument", ErrNotOrgMember, codes.InvalidArgument},
		{"wrapped not org member", fmt.Errorf("ctx: %w", ErrNotOrgMember), codes.InvalidArgument},
		{"other maps to Internal", errors.New("boom"), codes.Internal},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := toStatus(tc.err, "thing")
			if status.Code(got) != tc.want {
				t.Errorf("toStatus code: got %v want %v", status.Code(got), tc.want)
			}
		})
	}
	// "what" string is surfaced for NotFound.
	if msg := status.Convert(toStatus(ErrNotFound, "widget")).Message(); msg != "widget not found" {
		t.Errorf("NotFound message: got %q", msg)
	}
	// ErrNotOrgMember surfaces the underlying error text.
	if msg := status.Convert(toStatus(ErrNotOrgMember, "x")).Message(); msg != ErrNotOrgMember.Error() {
		t.Errorf("NotOrgMember message: got %q", msg)
	}
}

func TestTeamProto(t *testing.T) {
	ts := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	in := Team{ID: "t1", OrgID: "o1", Name: "Eng", Key: "ENG", Color: "#abc", Icon: "rocket", IssueCount: 9, CreatedAt: ts}
	got := teamProto(in)
	if got.Id != "t1" || got.OrgId != "o1" || got.Name != "Eng" || got.Key != "ENG" ||
		got.Color != "#abc" || got.Icon != "rocket" || got.IssueCount != 9 {
		t.Errorf("teamProto fields mismatch: %+v", got)
	}
	if got.CreatedAt != "2024-01-02T03:04:05Z" {
		t.Errorf("teamProto CreatedAt: got %q", got.CreatedAt)
	}
}

func TestTeamProto_TimeNormalizedToUTC(t *testing.T) {
	// A non-UTC timestamp must be formatted as UTC RFC3339.
	loc := time.FixedZone("EST", -5*3600)
	ts := time.Date(2024, 1, 2, 3, 4, 5, 0, loc)
	got := teamProto(Team{CreatedAt: ts})
	if got.CreatedAt != "2024-01-02T08:04:05Z" {
		t.Errorf("CreatedAt not normalized to UTC: got %q", got.CreatedAt)
	}
}

func TestIssueProto(t *testing.T) {
	ts := time.Date(2024, 5, 6, 7, 8, 9, 0, time.UTC)
	in := Issue{
		ID: "i1", OrgID: "o1", TeamID: "t1", TeamKey: "ENG", Number: 42,
		Title: "Ship", Description: "do it", Status: "in_progress", Priority: 3,
		AssigneeID: "u1", AssigneeName: "Alice", LabelIDs: []string{"l1", "l2"},
		ProjectID: "p1", Estimate: 5, SortOrder: 12.5, CreatorID: "u9",
		CreatedAt: ts, UpdatedAt: ts, ParentIssueID: "par1", SubIssueCount: 4, SubIssueDone: 2,
	}
	got := issueProto(in)
	if got.Identifier != "ENG-42" {
		t.Errorf("Identifier: got %q want ENG-42", got.Identifier)
	}
	if got.Id != "i1" || got.Status != "in_progress" || got.Priority != 3 ||
		got.AssigneeId != "u1" || got.AssigneeName != "Alice" || got.ProjectId != "p1" ||
		got.Estimate != 5 || got.SortOrder != 12.5 || got.CreatorId != "u9" ||
		got.ParentIssueId != "par1" || got.SubIssueCount != 4 || got.SubIssueDoneCount != 2 {
		t.Errorf("issueProto fields mismatch: %+v", got)
	}
	if len(got.LabelIds) != 2 || got.LabelIds[0] != "l1" || got.LabelIds[1] != "l2" {
		t.Errorf("LabelIds: got %v", got.LabelIds)
	}
	if got.CreatedAt != "2024-05-06T07:08:09Z" || got.UpdatedAt != "2024-05-06T07:08:09Z" {
		t.Errorf("timestamps: created=%q updated=%q", got.CreatedAt, got.UpdatedAt)
	}
}

func TestIssueProto_EmptyTeamKeyHasEmptyIdentifier(t *testing.T) {
	got := issueProto(Issue{ID: "i1", Number: 3})
	if got.Identifier != "" {
		t.Errorf("Identifier with empty team key: got %q want empty", got.Identifier)
	}
}

func TestProjectProto(t *testing.T) {
	ts := time.Date(2023, 12, 25, 1, 2, 3, 0, time.UTC)
	in := Project{
		ID: "p1", OrgID: "o1", Name: "Launch", Description: "desc", Color: "#fff",
		Icon: "star", State: "started", LeadID: "u1", LeadName: "Lead",
		TargetDate: "2024-01-01", CreatedAt: ts, UpdatedAt: ts,
	}
	got := projectProto(in)
	if got.Id != "p1" || got.Name != "Launch" || got.State != "started" ||
		got.LeadId != "u1" || got.LeadName != "Lead" || got.TargetDate != "2024-01-01" {
		t.Errorf("projectProto fields mismatch: %+v", got)
	}
	if got.CreatedAt != "2023-12-25T01:02:03Z" {
		t.Errorf("CreatedAt: got %q", got.CreatedAt)
	}
}

func TestLabelProto(t *testing.T) {
	ts := time.Date(2024, 6, 6, 6, 6, 6, 0, time.UTC)
	got := labelProto(Label{ID: "l1", OrgID: "o1", Name: "bug", Color: "#f00", CreatedAt: ts})
	if got.Id != "l1" || got.OrgId != "o1" || got.Name != "bug" || got.Color != "#f00" {
		t.Errorf("labelProto fields mismatch: %+v", got)
	}
	if got.CreatedAt != "2024-06-06T06:06:06Z" {
		t.Errorf("CreatedAt: got %q", got.CreatedAt)
	}
}

func TestCommentProto(t *testing.T) {
	ts := time.Date(2024, 7, 7, 7, 7, 7, 0, time.UTC)
	got := commentProto(Comment{ID: "c1", IssueID: "i1", AuthorID: "u1", AuthorName: "Bob", Body: "hi", CreatedAt: ts})
	if got.Id != "c1" || got.IssueId != "i1" || got.AuthorId != "u1" ||
		got.AuthorName != "Bob" || got.Body != "hi" {
		t.Errorf("commentProto fields mismatch: %+v", got)
	}
	if got.CreatedAt != "2024-07-07T07:07:07Z" {
		t.Errorf("CreatedAt: got %q", got.CreatedAt)
	}
}
