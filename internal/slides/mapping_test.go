package slides

// mapping_test.go covers the pure Deck<->proto and Grant->proto shaping helpers
// (toProto, grantToProto) that the service uses on every response. No database,
// no auth context — just struct field mapping and the RFC3339/UTC time shaping.

import (
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/sharing"
)

func TestToProto_FieldMapping(t *testing.T) {
	created := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	updated := time.Date(2026, 1, 2, 6, 7, 8, 0, time.UTC)
	d := Deck{
		ID:        "deck-1",
		OrgID:     "org-1",
		OwnerID:   "user-1",
		Title:     "Q1 Review",
		Data:      `{"slides":[]}`,
		CreatedAt: created,
		UpdatedAt: updated,
	}
	p := toProto(d)
	if p.GetId() != "deck-1" {
		t.Errorf("Id = %q", p.GetId())
	}
	if p.GetOrgId() != "org-1" {
		t.Errorf("OrgId = %q", p.GetOrgId())
	}
	if p.GetOwnerId() != "user-1" {
		t.Errorf("OwnerId = %q", p.GetOwnerId())
	}
	if p.GetTitle() != "Q1 Review" {
		t.Errorf("Title = %q", p.GetTitle())
	}
	if p.GetData() != `{"slides":[]}` {
		t.Errorf("Data = %q", p.GetData())
	}
	if p.GetCreatedAt() != "2026-01-02T03:04:05Z" {
		t.Errorf("CreatedAt = %q", p.GetCreatedAt())
	}
	if p.GetUpdatedAt() != "2026-01-02T06:07:08Z" {
		t.Errorf("UpdatedAt = %q", p.GetUpdatedAt())
	}
}

// toProto must always render timestamps in UTC RFC3339, even when the source
// time carries a non-UTC location.
func TestToProto_TimeNormalizedToUTC(t *testing.T) {
	loc := time.FixedZone("EST", -5*3600)
	// 2026-01-02 03:04:05 EST == 2026-01-02 08:04:05 UTC.
	d := Deck{
		ID:        "d",
		CreatedAt: time.Date(2026, 1, 2, 3, 4, 5, 0, loc),
		UpdatedAt: time.Date(2026, 1, 2, 3, 4, 5, 0, loc),
	}
	p := toProto(d)
	if got, want := p.GetCreatedAt(), "2026-01-02T08:04:05Z"; got != want {
		t.Errorf("CreatedAt = %q want %q", got, want)
	}
	if got, want := p.GetUpdatedAt(), "2026-01-02T08:04:05Z"; got != want {
		t.Errorf("UpdatedAt = %q want %q", got, want)
	}
}

func TestToProto_ZeroDeck(t *testing.T) {
	p := toProto(Deck{})
	if p.GetId() != "" || p.GetTitle() != "" || p.GetData() != "" {
		t.Errorf("zero deck should map to empty strings: %+v", p)
	}
	// The zero time.Time still renders as a valid RFC3339 string.
	if p.GetCreatedAt() != "0001-01-01T00:00:00Z" {
		t.Errorf("zero CreatedAt = %q", p.GetCreatedAt())
	}
}

func TestGrantToProto_FieldMapping(t *testing.T) {
	cases := []struct {
		name string
		in   sharing.Grant
	}{
		{
			name: "full",
			in: sharing.Grant{
				GranteeUserID: "u-2",
				GranteeName:   "Bob Jones",
				GranteeEmail:  "bob@test",
				Role:          sharing.RoleViewer,
				GrantedBy:     "u-1",
			},
		},
		{
			name: "editor",
			in: sharing.Grant{
				GranteeUserID: "u-3",
				GranteeName:   "Carol",
				GranteeEmail:  "carol@test",
				Role:          sharing.RoleEditor,
				GrantedBy:     "u-1",
			},
		},
		{
			name: "empty",
			in:   sharing.Grant{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := grantToProto(tc.in)
			if p.GetGranteeUserId() != tc.in.GranteeUserID {
				t.Errorf("GranteeUserId = %q want %q", p.GetGranteeUserId(), tc.in.GranteeUserID)
			}
			if p.GetGranteeName() != tc.in.GranteeName {
				t.Errorf("GranteeName = %q want %q", p.GetGranteeName(), tc.in.GranteeName)
			}
			if p.GetGranteeEmail() != tc.in.GranteeEmail {
				t.Errorf("GranteeEmail = %q want %q", p.GetGranteeEmail(), tc.in.GranteeEmail)
			}
			if p.GetRole() != tc.in.Role {
				t.Errorf("Role = %q want %q", p.GetRole(), tc.in.Role)
			}
			if p.GetGrantedBy() != tc.in.GrantedBy {
				t.Errorf("GrantedBy = %q want %q", p.GetGrantedBy(), tc.in.GrantedBy)
			}
		})
	}
}
