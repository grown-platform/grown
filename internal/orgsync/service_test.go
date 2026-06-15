package orgsync

import (
	"encoding/hex"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/contacts"
	"code.pick.haus/grown/grown/internal/drive"
	"code.pick.haus/grown/grown/internal/orgadmin"
	"code.pick.haus/grown/grown/internal/orgs"
)

// Zero-value repository pointers stand in for "present" dependencies. NewService
// only checks them for nil and never dereferences them, so we can construct
// them without a database.
var (
	someDrive    = &drive.Repository{}
	someBlobs    = &drive.Blobs{}
	someContacts = &contacts.Repository{}
	someOrgs     = &orgs.Repository{}
	someAdmin    = &orgadmin.Repository{}
)

// TestNewService_NilGuard verifies NewService returns nil if any dependency is
// nil, and a non-nil Service when all five are present.
func TestNewService_NilGuard(t *testing.T) {
	tests := []struct {
		name    string
		d       *drive.Repository
		b       *drive.Blobs
		c       *contacts.Repository
		o       *orgs.Repository
		admin   *orgadmin.Repository
		wantNil bool
	}{
		{"all present", someDrive, someBlobs, someContacts, someOrgs, someAdmin, false},
		{"all nil", nil, nil, nil, nil, nil, true},
		{"missing drive", nil, someBlobs, someContacts, someOrgs, someAdmin, true},
		{"missing blobs", someDrive, nil, someContacts, someOrgs, someAdmin, true},
		{"missing contacts", someDrive, someBlobs, nil, someOrgs, someAdmin, true},
		{"missing orgs", someDrive, someBlobs, someContacts, nil, someAdmin, true},
		{"missing admin", someDrive, someBlobs, someContacts, someOrgs, nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NewService(tt.d, tt.b, tt.c, tt.o, tt.admin)
			if (got == nil) != tt.wantNil {
				t.Fatalf("NewService nil=%v, want nil=%v", got == nil, tt.wantNil)
			}
		})
	}
}

// TestRandomKey_FormatAndUniqueness checks the storage-key generator produces a
// well-formed, unique key on each call.
func TestRandomKey_FormatAndUniqueness(t *testing.T) {
	const prefix = "drive/"
	seen := make(map[string]struct{})
	const n = 1000
	for i := 0; i < n; i++ {
		key, err := randomKey()
		if err != nil {
			t.Fatalf("randomKey: %v", err)
		}
		if !strings.HasPrefix(key, prefix) {
			t.Fatalf("key %q missing prefix %q", key, prefix)
		}
		hexPart := strings.TrimPrefix(key, prefix)
		// 16 random bytes => 32 hex chars.
		if len(hexPart) != 32 {
			t.Fatalf("hex part %q has length %d, want 32", hexPart, len(hexPart))
		}
		if _, err := hex.DecodeString(hexPart); err != nil {
			t.Fatalf("hex part %q is not valid hex: %v", hexPart, err)
		}
		if _, dup := seen[key]; dup {
			t.Fatalf("duplicate key generated: %q", key)
		}
		seen[key] = struct{}{}
	}
	if len(seen) != n {
		t.Fatalf("expected %d unique keys, got %d", n, len(seen))
	}
}
