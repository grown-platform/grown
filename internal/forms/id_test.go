package forms

import (
	"context"
	"errors"
	"testing"
)

// Malformed ids from request paths are "not found", never a database error
// (which the RPCs would surface as a 500 carrying the SQL error text). The
// repository isn't touched, so a nil pool is enough.
func TestMalformedIDIsNotFound(t *testing.T) {
	r := &Repository{}
	ctx := context.Background()
	for _, id := range []string{"", "..", "not-a-uuid", "' OR '1'='1", "\x00", "00000000-0000-0000-0000-00000000000g", "00000000_0000_0000_0000_000000000000"} {
		if _, err := r.Get(ctx, "org", id); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get(%q): %v", id, err)
		}
		if _, err := r.GetForFill(ctx, id); !errors.Is(err, ErrNotFound) {
			t.Errorf("GetForFill(%q): %v", id, err)
		}
		if _, err := r.Update(ctx, "org", id, Fields{}); !errors.Is(err, ErrNotFound) {
			t.Errorf("Update(%q): %v", id, err)
		}
		if err := r.Trash(ctx, "org", id); !errors.Is(err, ErrNotFound) {
			t.Errorf("Trash(%q): %v", id, err)
		}
	}
	for _, id := range []string{"00000000-0000-0000-0000-000000000000", "0A1b2C3d-4e5F-6789-abcd-ef0123456789"} {
		if !isUUID(id) {
			t.Errorf("isUUID(%q) = false", id)
		}
	}
}
