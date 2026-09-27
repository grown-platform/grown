package slides

import (
	"fmt"
	"reflect"
	"sort"
	"testing"
)

func TestOpKeys(t *testing.T) {
	cases := []struct {
		msg  string
		want []string
	}{
		{`{"t":"upsert","si":"s","el":{"id":"a"}}`, []string{"e:s:a"}},
		{`{"t":"remove","si":"s","elId":"a"}`, []string{"e:s:a"}},
		{`{"t":"upsertMany","si":"s","els":[{"id":"a"},{"id":"b"}]}`, []string{"e:s:a", "e:s:b"}},
		{`{"t":"removeMany","si":"s","ids":["a","b"]}`, []string{"e:s:a", "e:s:b"}},
		{`{"t":"reorder","si":"s","ids":["a"]}`, []string{"s:s"}},
		{`{"t":"setElements","si":"s","elements":[]}`, []string{"s:s"}},
		{`{"t":"slideProps","si":"s","patch":{}}`, []string{"p:s"}},
		{`{"t":"comment","c":{"id":"c1"}}`, []string{"c:c1"}},
		{`{"t":"commentRemove","cid":"x","commentId":"c1"}`, []string{"c:c1"}},
		{`{"t":"commentResolve","commentId":"c1","resolved":true}`, []string{"c:c1"}},
		{`{"t":"commentReply","commentId":"c1","r":{"id":"r1"}}`, []string{"r:c1:r1"}},
		{`{"t":"commentReplyRemove","commentId":"c1","replyId":"r1"}`, []string{"r:c1:r1"}},
		{`{"t":"slides","slides":[]}`, []string{"*"}},
		{`{"t":"deck","deck":{}}`, []string{"*"}},
		{`{"t":"mystery"}`, []string{"*"}},
	}
	for _, tc := range cases {
		env, err := parseEnvelope([]byte(tc.msg))
		if err != nil {
			t.Fatalf("%s: %v", tc.msg, err)
		}
		got := env.keys()
		sort.Strings(got)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("keys(%s) = %v want %v", tc.msg, got, tc.want)
		}
	}
}

func TestKeysOverlap(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"*", "e:s:a", true},
		{"c:1", "*", true},
		{"e:s:a", "e:s:a", true},
		{"e:s:a", "e:s:b", false},
		{"s:s", "e:s:a", true},
		{"e:s:a", "s:s", true},
		{"s:s", "e:t:a", false},
		{"p:s", "e:s:a", false},
		{"p:s", "p:s", true},
		{"c:1", "c:2", false},
		{"c:1", "r:1:a", false},
		{"r:1:a", "r:1:b", false},
	}
	for _, tc := range cases {
		if got := keyOverlap(tc.a, tc.b); got != tc.want {
			t.Errorf("overlap(%s,%s)=%v", tc.a, tc.b, got)
		}
	}
}

func TestStamp(t *testing.T) {
	if got := string(stamp([]byte(`{"t":"x"}`), 5, "A")); got != `{"seq":5,"cid":"A","t":"x"}` {
		t.Fatalf("stamp = %s", got)
	}
	if got := string(stamp([]byte(` {}`), 1, "")); got != `{"seq":1,"cid":""}` {
		t.Fatalf("stamp empty = %s", got)
	}
}

// A peer whose queue is full is kicked (its connection is closed so it
// reconnects and catches up from the log) rather than silently missing the
// op and diverging for the rest of the session.
func TestRoom_KicksPeerWhoseQueueOverflows(t *testing.T) {
	r := newRoom()
	kicked := false
	full := &peer{out: make(chan []byte), kick: func() { kicked = true }}
	r.peers[full] = struct{}{}
	r.fanout(nil, []byte("m"))
	if !kicked {
		t.Fatal("overflowing peer not kicked")
	}
}

// The log is trimmed only past what a saved snapshot covers, up to a hard cap.
func TestRoom_TrimKeepsUnsavedOps(t *testing.T) {
	r := newRoom()
	for i := 0; i < logMaxEntries+10; i++ {
		r.seq++
		r.appendLog(logEntry{seq: r.seq, msg: []byte(fmt.Sprint(i))})
	}
	if len(r.log) != logMaxEntries+10 {
		t.Fatalf("trimmed unsaved ops: %d", len(r.log))
	}
	r.markSaved(20)
	r.trim()
	if len(r.log) != logMaxEntries || r.base != 10 || r.log[0].seq != 11 {
		t.Fatalf("base %d first %d", r.base, r.log[0].seq)
	}
	for i := 0; i < logHardMaxEntries; i++ {
		r.seq++
		r.appendLog(logEntry{seq: r.seq})
	}
	if len(r.log) > logHardMaxEntries {
		t.Fatalf("hard cap not enforced: %d", len(r.log))
	}
}
