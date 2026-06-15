package music

import (
	"context"
	"testing"
)

// fakeRadio records Start/Stop calls for WithRadio wiring assertions.
type fakeRadio struct {
	started [][4]string
	stopped [][2]string
}

func (f *fakeRadio) Start(orgID, stationID, listenerID, ownerID string) {
	f.started = append(f.started, [4]string{orgID, stationID, listenerID, ownerID})
}

func (f *fakeRadio) Stop(stationID, listenerID string) {
	f.stopped = append(f.stopped, [2]string{stationID, listenerID})
}

func TestWithRadio_Chaining(t *testing.T) {
	h := newHTTP()
	if h.radio != nil {
		t.Fatal("expected nil radio before WithRadio")
	}
	rc := &fakeRadio{}
	got := h.WithRadio(rc)
	if got != h {
		t.Error("WithRadio should return the receiver for chaining")
	}
	if h.radio == nil {
		t.Error("WithRadio did not attach the controller")
	}
}

// TestSetRetention_InvalidModeShortCircuits verifies the validation guard
// rejects unknown modes before any DB call (pool is nil here).
func TestSetRetention_InvalidModeShortCircuits(t *testing.T) {
	repo := NewRepository(nil)
	for _, mode := range []string{"", "forever", "DAYS", "keepish"} {
		_, err := repo.SetRetention(context.Background(), "o1", "s1", mode, 30)
		if err == nil {
			t.Errorf("SetRetention(mode=%q) = nil error, want invalid-mode error", mode)
		}
	}
}
