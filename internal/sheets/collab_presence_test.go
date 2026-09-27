package sheets

import "testing"

// A read-only viewer may relay presence only. The check parses the message
// type: a viewer must not smuggle other messages (a "versionRestored" notice
// makes every editor reload and lose unsaved work) past it by mentioning
// "presence".
func TestIsPresenceIsStrict(t *testing.T) {
	for msg, want := range map[string]bool{
		`{"type":"presence","presence":{"userId":"u"}}`:             true,
		` {"type":"presence"}`:                                      true,
		`{"type":"versionRestored","presence":{"userId":"u"}}`:      false,
		`{"type":"versionRestored","note":"presence"}`:              false,
		`{"t":"versionRestored","type":"presence"}`:                 false,
		`{"presence":{}}`:                                           false,
		`[{"op":"replace","path":["data",0,0],"value":"presence"}]`: false,
		`{"type":"presence"`:                                        false,
		``:                                                          false,
	} {
		if got := isPresence([]byte(msg)); got != want {
			t.Errorf("isPresence(%s) = %v, want %v", msg, got, want)
		}
	}
}
