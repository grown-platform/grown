package contacts

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

// ctxNoAuth is a bare context (no user, no org).
func ctxNoAuth() context.Context { return context.Background() }

// ctxUserNoOrg has a user but no org attached.
func ctxUserNoOrg() context.Context {
	return auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: "o1"})
}

// nilService is a Service whose repo is nil. It is only ever used in tests that
// short-circuit (auth failure / validation) before the repo is dereferenced.
func nilService() *Service { return NewService(nil) }

// wantCode asserts the gRPC status code of err.
func wantCode(t *testing.T, err error, want codes.Code) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error with code %v, got nil", want)
	}
	if got := status.Code(err); got != want {
		t.Fatalf("status code = %v, want %v (err: %v)", got, want, err)
	}
}

// ---------------------------------------------------------------------------
// callerOrg / callerOrgAndUser via every handler: Unauthenticated when no user
// ---------------------------------------------------------------------------

func TestHandlers_Unauthenticated(t *testing.T) {
	s := nilService()
	ctx := ctxNoAuth()

	calls := []struct {
		name string
		fn   func() error
	}{
		{"ListContacts", func() error { _, e := s.ListContacts(ctx, &grownv1.ListContactsRequest{}); return e }},
		{"CreateContact", func() error { _, e := s.CreateContact(ctx, &grownv1.CreateContactRequest{}); return e }},
		{"GetContact", func() error { _, e := s.GetContact(ctx, &grownv1.GetContactRequest{}); return e }},
		{"UpdateContact", func() error { _, e := s.UpdateContact(ctx, &grownv1.UpdateContactRequest{}); return e }},
		{"TrashContact", func() error { _, e := s.TrashContact(ctx, &grownv1.TrashContactRequest{}); return e }},
		{"StarContact", func() error { _, e := s.StarContact(ctx, &grownv1.StarContactRequest{}); return e }},
		{"CreateContactGroup", func() error { _, e := s.CreateContactGroup(ctx, &grownv1.CreateContactGroupRequest{Name: "x"}); return e }},
		{"ListContactGroups", func() error { _, e := s.ListContactGroups(ctx, &grownv1.ListContactGroupsRequest{}); return e }},
		{"UpdateContactGroup", func() error { _, e := s.UpdateContactGroup(ctx, &grownv1.UpdateContactGroupRequest{Name: "x"}); return e }},
		{"DeleteContactGroup", func() error { _, e := s.DeleteContactGroup(ctx, &grownv1.DeleteContactGroupRequest{}); return e }},
		{"AddContactToGroup", func() error { _, e := s.AddContactToGroup(ctx, &grownv1.AddContactToGroupRequest{}); return e }},
		{"RemoveContactFromGroup", func() error { _, e := s.RemoveContactFromGroup(ctx, &grownv1.RemoveContactFromGroupRequest{}); return e }},
		{"ImportVCard", func() error { _, e := s.ImportVCard(ctx, &grownv1.ImportVCardRequest{}); return e }},
		{"ExportVCard", func() error { _, e := s.ExportVCard(ctx, &grownv1.ExportVCardRequest{}); return e }},
	}
	for _, c := range calls {
		t.Run(c.name, func(t *testing.T) {
			wantCode(t, c.fn(), codes.Unauthenticated)
		})
	}
}

// ---------------------------------------------------------------------------
// User present but no org → Internal ("missing org context")
// ---------------------------------------------------------------------------

func TestHandlers_MissingOrg(t *testing.T) {
	s := nilService()
	ctx := ctxUserNoOrg()

	calls := []struct {
		name string
		fn   func() error
	}{
		{"ListContacts", func() error { _, e := s.ListContacts(ctx, &grownv1.ListContactsRequest{}); return e }},
		{"CreateContact", func() error { _, e := s.CreateContact(ctx, &grownv1.CreateContactRequest{}); return e }},
		{"GetContact", func() error { _, e := s.GetContact(ctx, &grownv1.GetContactRequest{}); return e }},
		{"CreateContactGroup", func() error { _, e := s.CreateContactGroup(ctx, &grownv1.CreateContactGroupRequest{Name: "x"}); return e }},
		{"ListContactGroups", func() error { _, e := s.ListContactGroups(ctx, &grownv1.ListContactGroupsRequest{}); return e }},
		{"ImportVCard", func() error { _, e := s.ImportVCard(ctx, &grownv1.ImportVCardRequest{}); return e }},
		{"ExportVCard", func() error { _, e := s.ExportVCard(ctx, &grownv1.ExportVCardRequest{}); return e }},
	}
	for _, c := range calls {
		t.Run(c.name, func(t *testing.T) {
			wantCode(t, c.fn(), codes.Internal)
		})
	}
}

// ---------------------------------------------------------------------------
// Validation short-circuits (InvalidArgument before any repo call)
// ---------------------------------------------------------------------------

// ctxFull has both a user and an org, so handlers proceed past the auth gates.
func ctxFull() context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: "org1"})
	ctx = auth.WithOrg(ctx, orgs.Org{ID: "org1", Slug: "default"})
	return ctx
}

func TestCreateContactGroup_EmptyNameInvalidArgument(t *testing.T) {
	s := nilService() // repo never reached: validation fires first
	_, err := s.CreateContactGroup(ctxFull(), &grownv1.CreateContactGroupRequest{Name: ""})
	wantCode(t, err, codes.InvalidArgument)
}

func TestUpdateContactGroup_EmptyNameInvalidArgument(t *testing.T) {
	s := nilService()
	_, err := s.UpdateContactGroup(ctxFull(), &grownv1.UpdateContactGroupRequest{Id: "g1", Name: ""})
	wantCode(t, err, codes.InvalidArgument)
}

// ---------------------------------------------------------------------------
// toProto / groupToProto shaping
// ---------------------------------------------------------------------------

func TestToProto_Shaping(t *testing.T) {
	created := time.Date(2024, 1, 2, 3, 4, 5, 0, time.FixedZone("EST", -5*3600))
	updated := time.Date(2024, 6, 7, 8, 9, 10, 0, time.UTC)
	c := Contact{
		ID:          "id1",
		OrgID:       "org1",
		OwnerID:     "owner1",
		DisplayName: "Ada",
		FirstName:   "Ada",
		LastName:    "Lovelace",
		Company:     "Babbage",
		JobTitle:    "Analyst",
		Emails:      []string{"a@x.io"},
		Phones:      []string{"111"},
		Labels:      []string{"vip"},
		Notes:       "note",
		Starred:     true,
		CreatedAt:   created,
		UpdatedAt:   updated,
	}
	p := toProto(c)
	if p.GetId() != "id1" || p.GetOrgId() != "org1" || p.GetOwnerId() != "owner1" {
		t.Errorf("id/org/owner mismatch: %+v", p)
	}
	if p.GetDisplayName() != "Ada" || p.GetCompany() != "Babbage" || !p.GetStarred() {
		t.Errorf("field mismatch: %+v", p)
	}
	if len(p.GetEmails()) != 1 || len(p.GetPhones()) != 1 || len(p.GetLabels()) != 1 {
		t.Errorf("slice mismatch: %+v", p)
	}
	// Timestamps must be UTC RFC3339; the EST input must be converted to UTC.
	if p.GetCreatedAt() != "2024-01-02T08:04:05Z" {
		t.Errorf("CreatedAt = %q, want UTC-normalised", p.GetCreatedAt())
	}
	if p.GetUpdatedAt() != "2024-06-07T08:09:10Z" {
		t.Errorf("UpdatedAt = %q", p.GetUpdatedAt())
	}
}

func TestToProto_NilSlicesStayNil(t *testing.T) {
	p := toProto(Contact{ID: "x"})
	if len(p.GetEmails()) != 0 || len(p.GetPhones()) != 0 || len(p.GetLabels()) != 0 {
		t.Errorf("expected empty slices, got %+v", p)
	}
}

func TestGroupToProto_Shaping(t *testing.T) {
	g := ContactGroup{
		ID:          "g1",
		OrgID:       "org1",
		OwnerUserID: "u1",
		Name:        "Friends",
		CreatedAt:   time.Date(2024, 3, 4, 5, 6, 7, 0, time.UTC),
	}
	p := groupToProto(g)
	if p.GetId() != "g1" || p.GetOrgId() != "org1" || p.GetOwnerUserId() != "u1" || p.GetName() != "Friends" {
		t.Errorf("group shaping mismatch: %+v", p)
	}
	if p.GetCreatedAt() != "2024-03-04T05:06:07Z" {
		t.Errorf("CreatedAt = %q", p.GetCreatedAt())
	}
}

// ---------------------------------------------------------------------------
// ImportVCard with no meaningful cards: created==0 without touching the repo.
// ---------------------------------------------------------------------------

func TestImportVCard_NoMeaningfulCards(t *testing.T) {
	// repo is nil, but no card is meaningful so Create is never called.
	s := nilService()
	// A card with only a NOTE/ORG is not "meaningful" (no name/email/phone).
	vcf := "BEGIN:VCARD\nVERSION:3.0\nNOTE:just a note\nEND:VCARD\n"
	resp, err := s.ImportVCard(ctxFull(), &grownv1.ImportVCardRequest{VcfText: vcf})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.GetCreated() != 0 {
		t.Errorf("expected 0 created, got %d", resp.GetCreated())
	}
}

func TestImportVCard_EmptyText(t *testing.T) {
	s := nilService()
	resp, err := s.ImportVCard(ctxFull(), &grownv1.ImportVCardRequest{VcfText: ""})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.GetCreated() != 0 {
		t.Errorf("expected 0 created for empty vcf, got %d", resp.GetCreated())
	}
}
