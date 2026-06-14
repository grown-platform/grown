package alexa

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/music"
)

func TestQueueTokenRoundTrip(t *testing.T) {
	orig := QueueToken{Mode: ModeArtist, Key: "The Beatles", Idx: 7, Seed: 0xdeadbeefcafef00d}
	enc := orig.Encode()
	got, ok := DecodeToken(enc)
	if !ok {
		t.Fatalf("DecodeToken failed for %q", enc)
	}
	if !reflect.DeepEqual(orig, got) {
		t.Fatalf("round-trip mismatch: got %+v want %+v", got, orig)
	}
}

func TestDecodeTokenRejectsGarbage(t *testing.T) {
	for _, s := range []string{"", "!!!notbase64!!!", "e30"} { // e30 == "{}" (invalid mode)
		if _, ok := DecodeToken(s); ok {
			t.Errorf("DecodeToken(%q) unexpectedly ok", s)
		}
	}
}

func TestQueueTokenAt(t *testing.T) {
	tok := QueueToken{Mode: ModeAll, Seed: 42, Idx: 3}
	if got := tok.At(10); got.Idx != 10 {
		t.Fatalf("At(10).Idx = %d want 10", got.Idx)
	}
	if tok.Idx != 3 {
		t.Fatalf("At mutated the receiver: Idx = %d", tok.Idx)
	}
}

func makeTracks(n int) []music.Track {
	out := make([]music.Track, n)
	for i := 0; i < n; i++ {
		// IDs sort lexicographically; pad so 10 > 9 sorts correctly.
		out[i] = music.Track{ID: idFor(i), Title: "t", Artist: "a", Album: "b"}
	}
	return out
}

func idFor(i int) string {
	s := "0000" + itoa(i)
	return "id-" + s[len(s)-4:]
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}

func TestShuffleDeterministic(t *testing.T) {
	a := makeTracks(50)
	b := makeTracks(50)
	shuffle(a, 12345)
	shuffle(b, 12345)
	if !reflect.DeepEqual(a, b) {
		t.Fatal("same seed produced different orders")
	}
	c := makeTracks(50)
	shuffle(c, 99999)
	if reflect.DeepEqual(a, c) {
		t.Fatal("different seeds produced the same order")
	}
}

func TestShuffleIsPermutation(t *testing.T) {
	in := makeTracks(20)
	got := makeTracks(20)
	shuffle(got, 7)
	seen := map[string]bool{}
	for _, tk := range got {
		seen[tk.ID] = true
	}
	if len(seen) != len(in) {
		t.Fatalf("shuffle lost/duplicated elements: %d unique of %d", len(seen), len(in))
	}
}

func TestOrderedTracksReproducible(t *testing.T) {
	lib := makeTracks(30)
	tok := QueueToken{Mode: ModeAll, Seed: 555}
	o1 := orderedTracks(lib, tok)
	// Shuffle the input library to prove the base sort makes order independent of
	// the incoming slice order.
	scrambled := append([]music.Track(nil), lib...)
	shuffle(scrambled, 1)
	o2 := orderedTracks(scrambled, tok)
	if !reflect.DeepEqual(o1, o2) {
		t.Fatal("orderedTracks not reproducible across input orderings")
	}
}

func TestNextPrevIndexMath(t *testing.T) {
	lib := makeTracks(10)
	cur := QueueToken{Mode: ModeAll, Seed: 0, Idx: 3} // unshuffled, stable order
	ordered := orderedTracks(lib, cur)

	next := cur.At(cur.Idx + 1)
	if ordered[next.Idx].ID != ordered[4].ID {
		t.Fatal("next index didn't advance by one")
	}
	prev := cur.At(cur.Idx - 1)
	if ordered[prev.Idx].ID != ordered[2].ID {
		t.Fatal("prev index didn't go back by one")
	}
}

func TestFilterArtistContainsCaseInsensitive(t *testing.T) {
	lib := []music.Track{
		{ID: "1", Artist: "The Beatles"},
		{ID: "2", Artist: "Beatles Tribute Band"},
		{ID: "3", Artist: "Rolling Stones"},
	}
	got := filterTracks(lib, ModeArtist, "beatles")
	if len(got) != 2 {
		t.Fatalf("got %d tracks, want 2", len(got))
	}
}

func TestStreamURLSignAndVerify(t *testing.T) {
	secret := []byte("super-secret-key")
	base := "https://pick.haus"
	u := streamURL(base, secret, "track-123", time.Hour)
	if !strings.HasPrefix(u, "https://pick.haus/api/v1/music/alexa/stream/track-123?") {
		t.Fatalf("unexpected url: %s", u)
	}
	// Re-derive e and s from the URL and confirm the signature matches.
	q := u[strings.IndexByte(u, '?')+1:]
	var e, s string
	for _, kv := range strings.Split(q, "&") {
		if strings.HasPrefix(kv, "e=") {
			e = kv[2:]
		}
		if strings.HasPrefix(kv, "s=") {
			s = kv[2:]
		}
	}
	if e == "" || s == "" {
		t.Fatal("missing e or s in url")
	}
	var eInt int64
	if _, err := scanInt(e, &eInt); err != nil {
		t.Fatalf("bad e: %v", err)
	}
	want := signStream(secret, "track-123", eInt)
	if want != s {
		t.Fatalf("signature mismatch: url %s want %s", s, want)
	}
	// A wrong secret must NOT verify.
	if bad := signStream([]byte("wrong"), "track-123", eInt); bad == s {
		t.Fatal("wrong secret produced a matching signature")
	}
}

func scanInt(s string, out *int64) (int, error) {
	var v int64
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, errBadInt
		}
		v = v*10 + int64(c-'0')
	}
	*out = v
	return 1, nil
}

var errBadInt = stringErr("bad int")

type stringErr string

func (e stringErr) Error() string { return string(e) }

func TestStreamTrackID(t *testing.T) {
	id, ok := StreamTrackID("/api/v1/music/alexa/stream/abc")
	if !ok || id != "abc" {
		t.Fatalf("got (%q,%v)", id, ok)
	}
	if _, ok := StreamTrackID("/api/v1/music/alexa/stream/a/b"); ok {
		t.Fatal("nested path should not match")
	}
	if _, ok := StreamTrackID("/other"); ok {
		t.Fatal("non-prefix should not match")
	}
}

// --- handler-level tests with a fake repo ---

type fakeRepo struct{ tracks []music.Track }

func (f fakeRepo) ListTracks(_ context.Context, _ string) ([]music.Track, error) {
	return f.tracks, nil
}
func (f fakeRepo) GetTrack(_ context.Context, _, id string) (music.Track, error) {
	for _, t := range f.tracks {
		if t.ID == id {
			return t, nil
		}
	}
	return music.Track{}, music.ErrNotFound
}

func newTestHandler(tracks []music.Track) *Handler {
	return New(Options{
		Repo:       fakeRepo{tracks: tracks},
		OrgID:      "org-1",
		Secret:     []byte("k"),
		BaseURL:    "https://pick.haus",
		SkipVerify: true,
	})
}

func TestLaunchStartsPlayback(t *testing.T) {
	h := newTestHandler(makeTracks(5))
	req := &Request{Request: ReqBody{Type: TypeLaunchRequest, RequestID: "r1"}}
	resp := h.route(context.Background(), req)
	if len(resp.Body.Directives) != 1 || resp.Body.Directives[0].Type != DirectivePlay {
		t.Fatalf("expected a Play directive, got %+v", resp.Body.Directives)
	}
	tok := resp.Body.Directives[0].AudioItem.Stream.Token
	if _, ok := DecodeToken(tok); !ok {
		t.Fatalf("Play directive carried an invalid queue token: %q", tok)
	}
}

func TestNearlyFinishedEnqueuesNext(t *testing.T) {
	h := newTestHandler(makeTracks(5))
	start := QueueToken{Mode: ModeAll, Seed: 0, Idx: 0}
	req := &Request{Request: ReqBody{Type: TypePlaybackNearlyFinished, Token: start.Encode()}}
	resp := h.route(context.Background(), req)
	if len(resp.Body.Directives) != 1 {
		t.Fatalf("expected one enqueue directive, got %d", len(resp.Body.Directives))
	}
	d := resp.Body.Directives[0]
	if d.PlayBehavior != PlayEnqueue {
		t.Fatalf("expected ENQUEUE, got %s", d.PlayBehavior)
	}
	if d.AudioItem.Stream.ExpectedPreviousToken != start.Encode() {
		t.Fatal("enqueue must reference the previous token")
	}
	got, _ := DecodeToken(d.AudioItem.Stream.Token)
	if got.Idx != 1 {
		t.Fatalf("enqueued idx = %d want 1", got.Idx)
	}
}

func TestNearlyFinishedAtEndDoesNotEnqueue(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	end := QueueToken{Mode: ModeAll, Seed: 0, Idx: 2}
	req := &Request{Request: ReqBody{Type: TypePlaybackNearlyFinished, Token: end.Encode()}}
	resp := h.route(context.Background(), req)
	if len(resp.Body.Directives) != 0 {
		t.Fatalf("expected no directive at end of queue, got %d", len(resp.Body.Directives))
	}
}

func TestNextIntentAdvances(t *testing.T) {
	h := newTestHandler(makeTracks(5))
	cur := QueueToken{Mode: ModeAll, Seed: 0, Idx: 1}
	req := &Request{Request: ReqBody{
		Type:   TypeIntentRequest,
		Intent: Intent{Name: "AMAZON.NextIntent"},
	}}
	req.Context.AudioPlayer.Token = cur.Encode()
	resp := h.route(context.Background(), req)
	d := resp.Body.Directives[0]
	got, _ := DecodeToken(d.AudioItem.Stream.Token)
	if got.Idx != 2 {
		t.Fatalf("next idx = %d want 2", got.Idx)
	}
	if d.PlayBehavior != PlayReplaceAll {
		t.Fatalf("next should REPLACE_ALL, got %s", d.PlayBehavior)
	}
}

func TestStopIntentStops(t *testing.T) {
	h := newTestHandler(makeTracks(5))
	req := &Request{Request: ReqBody{Type: TypeIntentRequest, Intent: Intent{Name: "AMAZON.StopIntent"}}}
	resp := h.route(context.Background(), req)
	if len(resp.Body.Directives) != 1 || resp.Body.Directives[0].Type != DirectiveStop {
		t.Fatalf("expected a Stop directive, got %+v", resp.Body.Directives)
	}
}

func TestPlayArtistFiltersAndPlays(t *testing.T) {
	lib := []music.Track{
		{ID: "1", Artist: "The Beatles"},
		{ID: "2", Artist: "Queen"},
	}
	h := newTestHandler(lib)
	req := &Request{Request: ReqBody{
		Type:   TypeIntentRequest,
		Intent: Intent{Name: "PlayArtistIntent", Slots: map[string]Slot{"artist": {Name: "artist", Value: "beatles"}}},
	}}
	resp := h.route(context.Background(), req)
	if len(resp.Body.Directives) != 1 {
		t.Fatalf("expected a Play directive, got %+v", resp.Body.Directives)
	}
	tok, _ := DecodeToken(resp.Body.Directives[0].AudioItem.Stream.Token)
	if tok.Mode != ModeArtist || tok.Key != "beatles" {
		t.Fatalf("unexpected token %+v", tok)
	}
}

func TestEmptyLibrarySpeaks(t *testing.T) {
	h := newTestHandler(nil)
	req := &Request{Request: ReqBody{Type: TypeLaunchRequest}}
	resp := h.route(context.Background(), req)
	if len(resp.Body.Directives) != 0 || resp.Body.OutputSpeech == nil {
		t.Fatalf("expected a spoken empty-library response, got %+v", resp.Body)
	}
}

func TestResponseMarshalsCleanly(t *testing.T) {
	h := newTestHandler(makeTracks(2))
	resp := h.route(context.Background(), &Request{Request: ReqBody{Type: TypeLaunchRequest}})
	b, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "AudioPlayer.Play") {
		t.Fatalf("marshaled response missing Play directive: %s", b)
	}
}
