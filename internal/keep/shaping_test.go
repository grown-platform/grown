package keep

import (
	"encoding/json"
	"testing"
	"time"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/sharing"
)

// TestJSONLabels covers the nil-coalescing + marshaling helper used on the
// write path. A nil slice must serialize to an empty JSON array (not null),
// so the column never holds SQL/JSON null.
func TestJSONLabels(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		want string
	}{
		{"nil becomes empty array", nil, `[]`},
		{"empty stays empty array", []string{}, `[]`},
		{"single", []string{"home"}, `["home"]`},
		{"multiple preserves order", []string{"work", "home", "urgent"}, `["work","home","urgent"]`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := string(jsonLabels(tc.in))
			if got != tc.want {
				t.Fatalf("jsonLabels(%v) = %q, want %q", tc.in, got, tc.want)
			}
			// Must always be valid JSON that round-trips to a slice.
			var back []string
			if err := json.Unmarshal(jsonLabels(tc.in), &back); err != nil {
				t.Fatalf("jsonLabels(%v) not valid JSON: %v", tc.in, err)
			}
		})
	}
}

// TestJSONChecklist mirrors TestJSONLabels for checklist items, including the
// Checked flag and Text fields.
func TestJSONChecklist(t *testing.T) {
	tests := []struct {
		name string
		in   []ChecklistItem
		want string
	}{
		{"nil becomes empty array", nil, `[]`},
		{"empty stays empty array", []ChecklistItem{}, `[]`},
		{
			"items preserve fields and order",
			[]ChecklistItem{{Text: "Milk", Checked: false}, {Text: "Eggs", Checked: true}},
			`[{"text":"Milk","checked":false},{"text":"Eggs","checked":true}]`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := string(jsonChecklist(tc.in))
			if got != tc.want {
				t.Fatalf("jsonChecklist(%v) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// TestChecklistProtoRoundTrip verifies checklistToProto/checklistFromProto are
// inverse conversions and never return nil (the make([]T, 0, ...) contract).
func TestChecklistProtoRoundTrip(t *testing.T) {
	tests := []struct {
		name string
		in   []ChecklistItem
	}{
		{"nil yields empty non-nil slice", nil},
		{"empty yields empty non-nil slice", []ChecklistItem{}},
		{"single unchecked", []ChecklistItem{{Text: "a", Checked: false}}},
		{"mixed", []ChecklistItem{{Text: "a", Checked: true}, {Text: "b", Checked: false}}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			proto := checklistToProto(tc.in)
			if proto == nil {
				t.Fatalf("checklistToProto returned nil slice")
			}
			if len(proto) != len(tc.in) {
				t.Fatalf("checklistToProto len = %d, want %d", len(proto), len(tc.in))
			}
			back := checklistFromProto(proto)
			if back == nil {
				t.Fatalf("checklistFromProto returned nil slice")
			}
			if len(back) != len(tc.in) {
				t.Fatalf("round-trip len = %d, want %d", len(back), len(tc.in))
			}
			for i := range tc.in {
				if back[i].Text != tc.in[i].Text || back[i].Checked != tc.in[i].Checked {
					t.Fatalf("round-trip[%d] = %+v, want %+v", i, back[i], tc.in[i])
				}
			}
		})
	}
}

// TestChecklistFromProtoNilGetters proves the GetText/GetChecked getters
// tolerate nil *KeepChecklistItem entries without panicking.
func TestChecklistFromProtoNilEntry(t *testing.T) {
	in := []*grownv1.KeepChecklistItem{nil, {Text: "ok", Checked: true}}
	out := checklistFromProto(in)
	if len(out) != 2 {
		t.Fatalf("len = %d, want 2", len(out))
	}
	if out[0].Text != "" || out[0].Checked {
		t.Fatalf("nil entry not zero-valued: %+v", out[0])
	}
	if out[1].Text != "ok" || !out[1].Checked {
		t.Fatalf("second entry = %+v", out[1])
	}
}

// TestToProto covers note->proto shaping: field copying, RemindAt formatting
// (nil vs set), and UTC normalization of all timestamps.
func TestToProto(t *testing.T) {
	created := time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)
	updated := time.Date(2025, 6, 7, 8, 9, 10, 0, time.UTC)

	t.Run("no reminder yields empty string", func(t *testing.T) {
		n := Note{
			ID: "n1", OrgID: "o1", OwnerID: "u1",
			Title: "T", Body: "B", Color: "#fff",
			Pinned: true, Archived: false,
			Labels:    []string{"a"},
			Checklist: []ChecklistItem{{Text: "x", Checked: true}},
			CreatedAt: created, UpdatedAt: updated,
		}
		p := toProto(n)
		if p.GetId() != "n1" || p.GetOrgId() != "o1" || p.GetOwnerId() != "u1" {
			t.Fatalf("ids: %+v", p)
		}
		if p.GetTitle() != "T" || p.GetBody() != "B" || p.GetColor() != "#fff" {
			t.Fatalf("text fields: %+v", p)
		}
		if !p.GetPinned() || p.GetArchived() {
			t.Fatalf("flags: pinned=%v archived=%v", p.GetPinned(), p.GetArchived())
		}
		if len(p.GetLabels()) != 1 || p.GetLabels()[0] != "a" {
			t.Fatalf("labels: %v", p.GetLabels())
		}
		if len(p.GetChecklist()) != 1 || p.GetChecklist()[0].GetText() != "x" {
			t.Fatalf("checklist: %v", p.GetChecklist())
		}
		if p.GetRemindAt() != "" {
			t.Fatalf("expected empty remind_at, got %q", p.GetRemindAt())
		}
		if p.GetCreatedAt() != "2025-01-02T03:04:05Z" {
			t.Fatalf("created_at = %q", p.GetCreatedAt())
		}
		if p.GetUpdatedAt() != "2025-06-07T08:09:10Z" {
			t.Fatalf("updated_at = %q", p.GetUpdatedAt())
		}
	})

	t.Run("reminder formatted RFC3339 in UTC", func(t *testing.T) {
		// Build a time in a non-UTC zone to prove UTC normalization.
		loc := time.FixedZone("UTC+5", 5*60*60)
		remind := time.Date(2025, 3, 4, 10, 0, 0, 0, loc)
		n := Note{ID: "n", RemindAt: &remind, CreatedAt: created, UpdatedAt: updated}
		p := toProto(n)
		// 10:00 at UTC+5 == 05:00 UTC.
		if p.GetRemindAt() != "2025-03-04T05:00:00Z" {
			t.Fatalf("remind_at = %q, want 2025-03-04T05:00:00Z", p.GetRemindAt())
		}
	})
}

// TestLabelToProto verifies label shaping and CreatedAt UTC formatting.
func TestLabelToProto(t *testing.T) {
	created := time.Date(2024, 12, 31, 23, 0, 0, 0, time.UTC)
	l := Label{ID: "l1", OrgID: "o1", UserID: "u1", Name: "work", CreatedAt: created}
	p := labelToProto(l)
	if p.GetId() != "l1" || p.GetOrgId() != "o1" || p.GetUserId() != "u1" || p.GetName() != "work" {
		t.Fatalf("label proto: %+v", p)
	}
	if p.GetCreatedAt() != "2024-12-31T23:00:00Z" {
		t.Fatalf("created_at = %q", p.GetCreatedAt())
	}
}

// TestGrantToProto verifies grant shaping copies all grantee fields.
func TestGrantToProto(t *testing.T) {
	g := sharing.Grant{
		ObjectType:    sharing.TypeKeepNote,
		ObjectID:      "n1",
		GranteeUserID: "u2",
		GranteeName:   "Bob",
		GranteeEmail:  "bob@test",
		Role:          sharing.RoleEditor,
		GrantedBy:     "u1",
	}
	p := grantToProto(g)
	if p.GetGranteeUserId() != "u2" || p.GetGranteeName() != "Bob" ||
		p.GetGranteeEmail() != "bob@test" || p.GetRole() != sharing.RoleEditor ||
		p.GetGrantedBy() != "u1" {
		t.Fatalf("grant proto: %+v", p)
	}
}
