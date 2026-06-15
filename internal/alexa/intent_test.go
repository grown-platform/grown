package alexa

import (
	"context"
	"encoding/base64"
	"errors"
	"testing"

	"code.pick.haus/grown/grown/internal/music"
)

func encodeRawURL(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// errRepo is a repo whose ListTracks always fails, to exercise the
// "couldn't reach your music library" branches.
type errRepo struct{}

func (errRepo) ListTracks(_ context.Context, _ string) ([]music.Track, error) {
	return nil, errors.New("boom")
}
func (errRepo) GetTrack(_ context.Context, _, _ string) (music.Track, error) {
	return music.Track{}, errors.New("boom")
}

func newErrHandler() *Handler {
	return New(Options{
		Repo:       errRepo{},
		OrgID:      "org-1",
		Secret:     []byte("k"),
		BaseURL:    "https://pick.haus",
		SkipVerify: true,
	})
}

// intentReq builds an IntentRequest with the given intent name and optional
// AudioPlayer-context token (set via the context block, as Alexa does mid-play).
func intentReq(name, ctxToken string, slots map[string]Slot) *Request {
	req := &Request{Request: ReqBody{
		Type:      TypeIntentRequest,
		RequestID: "rid",
		Intent:    Intent{Name: name, Slots: slots},
	}}
	req.Session.SessionID = "sess"
	req.Context.AudioPlayer.Token = ctxToken
	return req
}

// hasPlay returns the first Play directive's decoded token, asserting exactly
// one Play directive is present.
func hasPlay(t *testing.T, resp *Response) (QueueToken, Directive) {
	t.Helper()
	if len(resp.Body.Directives) != 1 {
		t.Fatalf("expected 1 directive, got %d (%+v)", len(resp.Body.Directives), resp.Body.Directives)
	}
	d := resp.Body.Directives[0]
	if d.Type != DirectivePlay {
		t.Fatalf("expected Play directive, got %s", d.Type)
	}
	tok, ok := DecodeToken(d.AudioItem.Stream.Token)
	if !ok {
		t.Fatalf("Play carried invalid token %q", d.AudioItem.Stream.Token)
	}
	return tok, d
}

// speaks asserts the response is a plain spoken response with no directives.
func speaks(t *testing.T, resp *Response) string {
	t.Helper()
	if len(resp.Body.Directives) != 0 {
		t.Fatalf("expected no directives, got %d", len(resp.Body.Directives))
	}
	if resp.Body.OutputSpeech == nil {
		t.Fatalf("expected spoken output, got none")
	}
	return resp.Body.OutputSpeech.Text
}

func TestPlayMusicIntent(t *testing.T) {
	h := newTestHandler(makeTracks(4))
	resp := h.route(context.Background(), intentReq("PlayMusicIntent", "", nil))
	tok, _ := hasPlay(t, resp)
	if tok.Mode != ModeAll {
		t.Fatalf("mode = %q want %q", tok.Mode, ModeAll)
	}
	if tok.Seed == 0 {
		t.Fatal("PlayMusicIntent should shuffle (non-zero seed)")
	}
}

func TestPlayAlbumIntent(t *testing.T) {
	lib := []music.Track{
		{ID: "1", Album: "Abbey Road"},
		{ID: "2", Album: "Nevermind"},
	}
	h := newTestHandler(lib)
	resp := h.route(context.Background(), intentReq("PlayAlbumIntent", "",
		map[string]Slot{"album": {Name: "album", Value: "abbey"}}))
	tok, _ := hasPlay(t, resp)
	if tok.Mode != ModeAlbum || tok.Key != "abbey" {
		t.Fatalf("unexpected token %+v", tok)
	}
}

func TestPlayArtistMissingSlotAsks(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	resp := h.route(context.Background(), intentReq("PlayArtistIntent", "", nil))
	if got := speaks(t, resp); got == "" {
		t.Fatal("expected a reprompt question for missing artist")
	}
	// Missing-slot reprompt should keep the session open.
	if resp.Body.ShouldEndSession == nil || *resp.Body.ShouldEndSession {
		t.Fatal("reprompt should not end the session")
	}
}

func TestPlayAlbumMissingSlotAsks(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	resp := h.route(context.Background(), intentReq("PlayAlbumIntent", "", nil))
	if got := speaks(t, resp); got == "" {
		t.Fatal("expected a reprompt question for missing album")
	}
}

func TestPlayArtistNoMatchSpeaks(t *testing.T) {
	lib := []music.Track{{ID: "1", Artist: "Queen"}}
	h := newTestHandler(lib)
	resp := h.route(context.Background(), intentReq("PlayArtistIntent", "",
		map[string]Slot{"artist": {Name: "artist", Value: "nobody"}}))
	if speaks(t, resp) == "" {
		t.Fatal("expected a 'nothing matching' spoken response")
	}
}

func TestPreviousIntentGoesBack(t *testing.T) {
	h := newTestHandler(makeTracks(5))
	cur := QueueToken{Mode: ModeAll, Seed: 0, Idx: 3}
	resp := h.route(context.Background(), intentReq("AMAZON.PreviousIntent", cur.Encode(), nil))
	tok, _ := hasPlay(t, resp)
	if tok.Idx != 2 {
		t.Fatalf("prev idx = %d want 2", tok.Idx)
	}
}

func TestPreviousIntentClampsAtZero(t *testing.T) {
	h := newTestHandler(makeTracks(5))
	cur := QueueToken{Mode: ModeAll, Seed: 0, Idx: 0}
	resp := h.route(context.Background(), intentReq("AMAZON.PreviousIntent", cur.Encode(), nil))
	tok, _ := hasPlay(t, resp)
	if tok.Idx != 0 {
		t.Fatalf("prev idx clamped = %d want 0", tok.Idx)
	}
}

func TestNextIntentAtEndSpeaks(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	cur := QueueToken{Mode: ModeAll, Seed: 0, Idx: 2}
	resp := h.route(context.Background(), intentReq("AMAZON.NextIntent", cur.Encode(), nil))
	if speaks(t, resp) == "" {
		t.Fatal("expected end-of-queue spoken response")
	}
}

func TestNextIntentNoTokenStartsLibrary(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	resp := h.route(context.Background(), intentReq("AMAZON.NextIntent", "", nil))
	tok, _ := hasPlay(t, resp)
	if tok.Mode != ModeAll {
		t.Fatalf("no-token Next should start library, mode = %q", tok.Mode)
	}
}

func TestStepRepoErrorSpeaks(t *testing.T) {
	h := newErrHandler()
	cur := QueueToken{Mode: ModeAll, Idx: 1}
	resp := h.route(context.Background(), intentReq("AMAZON.NextIntent", cur.Encode(), nil))
	if speaks(t, resp) == "" {
		t.Fatal("expected spoken error when repo fails")
	}
}

func TestStartOverReplaysCurrent(t *testing.T) {
	h := newTestHandler(makeTracks(5))
	cur := QueueToken{Mode: ModeAll, Seed: 0, Idx: 2}
	resp := h.route(context.Background(), intentReq("AMAZON.StartOverIntent", cur.Encode(), nil))
	tok, _ := hasPlay(t, resp)
	if tok.Idx != 2 {
		t.Fatalf("start-over idx = %d want 2 (same track)", tok.Idx)
	}
}

func TestStartOverNoTokenStartsLibrary(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	resp := h.route(context.Background(), intentReq("AMAZON.StartOverIntent", "", nil))
	tok, _ := hasPlay(t, resp)
	if tok.Mode != ModeAll {
		t.Fatalf("no-token StartOver should start library, mode = %q", tok.Mode)
	}
}

func TestResumeNoTokenStartsLibrary(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	resp := h.route(context.Background(), intentReq("AMAZON.ResumeIntent", "", nil))
	tok, _ := hasPlay(t, resp)
	if tok.Mode != ModeAll {
		t.Fatalf("no-token Resume should start library, mode = %q", tok.Mode)
	}
}

func TestResumeReplaysCurrent(t *testing.T) {
	h := newTestHandler(makeTracks(5))
	cur := QueueToken{Mode: ModeAll, Seed: 0, Idx: 4}
	resp := h.route(context.Background(), intentReq("AMAZON.ResumeIntent", cur.Encode(), nil))
	tok, d := hasPlay(t, resp)
	if tok.Idx != 4 {
		t.Fatalf("resume idx = %d want 4", tok.Idx)
	}
	if d.PlayBehavior != PlayReplaceAll {
		t.Fatalf("resume should REPLACE_ALL, got %s", d.PlayBehavior)
	}
}

func TestResumeOutOfRangeSpeaks(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	cur := QueueToken{Mode: ModeAll, Seed: 0, Idx: 99}
	resp := h.route(context.Background(), intentReq("AMAZON.ResumeIntent", cur.Encode(), nil))
	if speaks(t, resp) == "" {
		t.Fatal("expected spoken 'nothing to resume'")
	}
}

func TestPauseCancelStopAllStop(t *testing.T) {
	h := newTestHandler(makeTracks(5))
	for _, name := range []string{"AMAZON.PauseIntent", "AMAZON.CancelIntent", "AMAZON.StopIntent"} {
		resp := h.route(context.Background(), intentReq(name, "", nil))
		if len(resp.Body.Directives) != 1 || resp.Body.Directives[0].Type != DirectiveStop {
			t.Fatalf("%s: expected Stop directive, got %+v", name, resp.Body.Directives)
		}
	}
}

func TestShuffleOnReshuffles(t *testing.T) {
	h := newTestHandler(makeTracks(5))
	cur := QueueToken{Mode: ModeAll, Seed: 0, Idx: 3}
	resp := h.route(context.Background(), intentReq("AMAZON.ShuffleOnIntent", cur.Encode(), nil))
	tok, _ := hasPlay(t, resp)
	if tok.Seed == 0 {
		t.Fatal("ShuffleOn should set a non-zero seed")
	}
	if tok.Idx != 0 {
		t.Fatalf("ShuffleOn should reset to idx 0, got %d", tok.Idx)
	}
}

func TestShuffleOffClearsSeed(t *testing.T) {
	h := newTestHandler(makeTracks(5))
	cur := QueueToken{Mode: ModeAll, Seed: 12345, Idx: 3}
	resp := h.route(context.Background(), intentReq("AMAZON.ShuffleOffIntent", cur.Encode(), nil))
	tok, _ := hasPlay(t, resp)
	if tok.Seed != 0 {
		t.Fatalf("ShuffleOff should clear the seed, got %d", tok.Seed)
	}
}

func TestShuffleNoTokenDefaultsToAll(t *testing.T) {
	h := newTestHandler(makeTracks(4))
	resp := h.route(context.Background(), intentReq("AMAZON.ShuffleOnIntent", "", nil))
	tok, _ := hasPlay(t, resp)
	if tok.Mode != ModeAll {
		t.Fatalf("no-token reshuffle should default to ModeAll, got %q", tok.Mode)
	}
}

func TestLoopIntentsAcknowledge(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	for _, name := range []string{"AMAZON.LoopOnIntent", "AMAZON.LoopOffIntent"} {
		resp := h.route(context.Background(), intentReq(name, "", nil))
		if speaks(t, resp) == "" {
			t.Fatalf("%s: expected an acknowledgement", name)
		}
	}
}

func TestHelpAndFallbackSpeak(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	for _, name := range []string{"AMAZON.HelpIntent", "AMAZON.FallbackIntent"} {
		resp := h.route(context.Background(), intentReq(name, "", nil))
		if speaks(t, resp) == "" {
			t.Fatalf("%s: expected spoken help/fallback", name)
		}
	}
}

func TestUnknownIntentSpeaks(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	resp := h.route(context.Background(), intentReq("SomethingWeirdIntent", "", nil))
	if speaks(t, resp) == "" {
		t.Fatal("expected a polite 'can't do that' for unknown intent")
	}
}

func TestPlaybackEventsReturnEmpty(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	for _, typ := range []string{
		TypePlaybackStarted, TypePlaybackFinished, TypePlaybackStopped,
		TypePlaybackFailed, TypeSessionEndedRequest, "Totally.Unknown.Type",
	} {
		resp := h.route(context.Background(), &Request{Request: ReqBody{Type: typ}})
		if len(resp.Body.Directives) != 0 || resp.Body.OutputSpeech != nil {
			t.Fatalf("%s: expected empty no-op response, got %+v", typ, resp.Body)
		}
		if resp.Version != "1.0" {
			t.Fatalf("%s: expected version 1.0, got %q", typ, resp.Version)
		}
	}
}

func TestPlayFromEmptyFilteredModeSpeaks(t *testing.T) {
	// Non-empty library but the artist filter matches nothing → the "couldn't
	// find anything matching that" branch (distinct from empty-library).
	lib := []music.Track{{ID: "1", Artist: "Queen"}}
	h := newTestHandler(lib)
	resp := h.route(context.Background(), intentReq("PlayArtistIntent", "",
		map[string]Slot{"artist": {Name: "artist", Value: "zzz"}}))
	if speaks(t, resp) == "" {
		t.Fatal("expected spoken no-match response")
	}
}

func TestCurrentTokenPrefersRequestToken(t *testing.T) {
	reqTok := QueueToken{Mode: ModeAll, Idx: 1}.Encode()
	ctxTok := QueueToken{Mode: ModeAll, Idx: 9}.Encode()
	req := &Request{}
	req.Request.Token = reqTok
	req.Context.AudioPlayer.Token = ctxTok
	if got := currentToken(req); got != reqTok {
		t.Fatalf("currentToken should prefer request token, got %q", got)
	}
	req.Request.Token = ""
	if got := currentToken(req); got != ctxTok {
		t.Fatalf("currentToken should fall back to context token, got %q", got)
	}
}

func TestSlotValueNilAndTrim(t *testing.T) {
	req := &Request{}
	if got := slotValue(req, "artist"); got != "" {
		t.Fatalf("nil slots should yield empty, got %q", got)
	}
	req.Request.Intent.Slots = map[string]Slot{"artist": {Value: "  The Beatles  "}}
	if got := slotValue(req, "artist"); got != "The Beatles" {
		t.Fatalf("slotValue should trim, got %q", got)
	}
	if got := slotValue(req, "missing"); got != "" {
		t.Fatalf("missing slot should yield empty, got %q", got)
	}
}

func TestSpeakAndEmptyHelpers(t *testing.T) {
	s := speak("hi", true)
	if s.Body.OutputSpeech == nil || s.Body.OutputSpeech.Text != "hi" {
		t.Fatal("speak should set output text")
	}
	if s.Body.ShouldEndSession == nil || !*s.Body.ShouldEndSession {
		t.Fatal("speak(_, true) should end session")
	}
	e := empty()
	if e.Body.OutputSpeech != nil || len(e.Body.Directives) != 0 || e.Body.ShouldEndSession != nil {
		t.Fatalf("empty() should be a bare 200, got %+v", e.Body)
	}
	if *boolPtr(true) != true || *boolPtr(false) != false {
		t.Fatal("boolPtr broken")
	}
}

func TestStartOverRepoErrorSpeaks(t *testing.T) {
	h := newErrHandler()
	cur := QueueToken{Mode: ModeAll, Idx: 1}
	resp := h.route(context.Background(), intentReq("AMAZON.StartOverIntent", cur.Encode(), nil))
	if speaks(t, resp) == "" {
		t.Fatal("expected spoken error when repo fails on start-over")
	}
}

func TestStartOverOutOfRangeSpeaks(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	cur := QueueToken{Mode: ModeAll, Idx: 99}
	resp := h.route(context.Background(), intentReq("AMAZON.StartOverIntent", cur.Encode(), nil))
	if speaks(t, resp) == "" {
		t.Fatal("expected 'nothing is playing' spoken response")
	}
}

func TestResumeRepoErrorSpeaks(t *testing.T) {
	h := newErrHandler()
	cur := QueueToken{Mode: ModeAll, Idx: 0}
	resp := h.route(context.Background(), intentReq("AMAZON.ResumeIntent", cur.Encode(), nil))
	if speaks(t, resp) == "" {
		t.Fatal("expected spoken error when repo fails on resume")
	}
}

func TestNearlyFinishedNoTokenIsEmpty(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	req := &Request{Request: ReqBody{Type: TypePlaybackNearlyFinished, Token: ""}}
	resp := h.route(context.Background(), req)
	if len(resp.Body.Directives) != 0 {
		t.Fatalf("no-token nearly-finished should be empty, got %+v", resp.Body.Directives)
	}
}

func TestNearlyFinishedRepoErrorIsEmpty(t *testing.T) {
	h := newErrHandler()
	tok := QueueToken{Mode: ModeAll, Idx: 0}
	req := &Request{Request: ReqBody{Type: TypePlaybackNearlyFinished, Token: tok.Encode()}}
	resp := h.route(context.Background(), req)
	if len(resp.Body.Directives) != 0 {
		t.Fatalf("repo-error nearly-finished should be empty, got %+v", resp.Body.Directives)
	}
}

func TestLaunchRepoErrorSpeaks(t *testing.T) {
	h := newErrHandler()
	resp := h.route(context.Background(), &Request{Request: ReqBody{Type: TypeLaunchRequest}})
	if speaks(t, resp) == "" {
		t.Fatal("expected spoken error when repo fails on launch")
	}
}

func TestDecodeTokenBadJSON(t *testing.T) {
	// Valid base64url that decodes to bytes which are not valid JSON.
	enc := encodeRawURL([]byte("\xff\xfe not json"))
	if _, ok := DecodeToken(enc); ok {
		t.Fatal("DecodeToken should reject non-JSON payload")
	}
}

func TestPlayDirectiveBuildsSignedURL(t *testing.T) {
	h := newTestHandler(makeTracks(1))
	tok := QueueToken{Mode: ModeAll, Idx: 0}
	d := h.playDirective(music.Track{ID: "track-1"}, tok, PlayReplaceAll, 1500)
	if d.Type != DirectivePlay || d.PlayBehavior != PlayReplaceAll {
		t.Fatalf("unexpected directive %+v", d)
	}
	if d.AudioItem.Stream.OffsetInMilliseconds != 1500 {
		t.Fatalf("offset = %d want 1500", d.AudioItem.Stream.OffsetInMilliseconds)
	}
	if id, ok := StreamTrackID(stripQuery(d.AudioItem.Stream.URL)); !ok || id != "track-1" {
		t.Fatalf("stream URL did not embed track id: %q", d.AudioItem.Stream.URL)
	}
}

func stripQuery(u string) string {
	if i := indexByte(u, '?'); i >= 0 {
		u = u[:i]
	}
	// drop scheme+host so StreamTrackID sees a leading path
	if i := indexStr(u, "/api/"); i >= 0 {
		return u[i:]
	}
	return u
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

func indexStr(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
