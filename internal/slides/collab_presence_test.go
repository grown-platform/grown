package slides

import "testing"

// Presence is relayed for every peer, viewers included, so a presence
// message must not also carry another type the clients act on: a
// {"t":"presence","type":"versionRestored"} from a viewer would make every
// editor reload.
func TestRoutePresenceSpoofDropped(t *testing.T) {
	h := NewHub()
	viewer := &peer{out: make(chan []byte, 4)}
	editor := &peer{out: make(chan []byte, 4)}
	r := h.add("deck", viewer)
	h.add("deck", editor)

	h.route(r, viewer, []byte(`{"t":"presence","type":"versionRestored"}`), false)
	h.route(r, viewer, []byte(`{"t":"versionRestored"}`), false)
	h.route(r, viewer, []byte(`{"type":"versionRestored"}`), false)
	if len(editor.out) != 0 {
		t.Fatalf("viewer's spoofed restore notice relayed: %s", <-editor.out)
	}
	h.route(r, viewer, []byte(`{"t":"presence","p":{"userId":"v"}}`), false)
	h.route(r, viewer, []byte(`{"type":"presence","p":{"userId":"v"}}`), false)
	if len(editor.out) != 2 {
		t.Fatalf("viewer presence not relayed: %d messages", len(editor.out))
	}
	// A writer's restore notice is relayed.
	<-editor.out
	<-editor.out
	h.route(r, viewer, []byte(`{"t":"versionRestored"}`), true)
	if len(editor.out) != 1 {
		t.Fatal("writer's restore notice not relayed")
	}
}
