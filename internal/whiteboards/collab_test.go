package whiteboards

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// A read-only peer (viewer/commenter grant) may relay presence only: its
// scene updates would otherwise be applied, and then autosaved, by every
// editor on the board.
func TestServeDropsReadOnlyScenes(t *testing.T) {
	h := NewHub()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.Serve(w, r, "board", r.URL.Query().Get("rw") == "1")
	}))
	defer ts.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	dial := func(rw string) *websocket.Conn {
		c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/?rw="+rw, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.CloseNow() })
		return c
	}
	editor, other, viewer := dial("1"), dial("1"), dial("0")
	time.Sleep(100 * time.Millisecond)
	send := func(c *websocket.Conn, msg string) {
		if err := c.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
			t.Fatal(err)
		}
	}
	send(viewer, `{"type":"scene","elements":[{"id":"viewer-scene"}]}`)
	send(viewer, `{"type":"versionRestored","presence":{}}`)
	send(viewer, `{"type":"presence","presence":{"userId":"viewer-presence"}}`)
	send(other, `{"type":"scene","elements":[{"id":"editor-scene"}]}`)
	got := []string{}
	for len(got) < 2 {
		_, b, err := editor.Read(ctx)
		if err != nil {
			t.Fatalf("read: %v (got %q)", err, got)
		}
		got = append(got, string(b))
	}
	if !strings.Contains(got[0], "viewer-presence") || !strings.Contains(got[1], "editor-scene") {
		t.Fatalf("editor received %q; want only the viewer's presence, then the editor's scene", got)
	}
}
