package server

import (
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/docs"
)

func TestDocsProtectionID(t *testing.T) {
	cases := map[string]string{
		"/api/v1/docs/d/abc/protection": "abc",
		"/api/v1/docs/d//protection":    "",
		"/api/v1/docs/d/a/b/protection": "",
		"/api/v1/docs/d/abc/connect":    "",
	}
	for path, want := range cases {
		got, ok := docsProtectionID(path)
		if (want != "") != ok || got != want {
			t.Errorf("%s: got %q %v, want %q", path, got, ok, want)
		}
	}
}

func TestDocsWriteGate(t *testing.T) {
	mode := "readOnly"
	gate := &docs.ProtectionGate{TTL: time.Nanosecond, Load: func() (string, error) { return mode, nil }}
	if docsWriteGate(false, true, gate)() {
		t.Error("a viewer never writes")
	}
	if !docsWriteGate(true, true, gate)() {
		t.Error("the owner writes a read-only document")
	}
	if docsWriteGate(true, false, gate)() {
		t.Error("an editor can't write a read-only document")
	}
	mode = "forms"
	time.Sleep(time.Millisecond)
	if !docsWriteGate(true, false, gate)() {
		t.Error("other modes are enforced by the editors, not the server")
	}
}
