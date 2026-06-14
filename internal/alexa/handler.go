package alexa

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"code.pick.haus/grown/grown/internal/music"
)

// streamTTL is how long a signed stream URL stays valid. Generous so a queued
// (enqueued-ahead) track is still fetchable when the previous one ends, and so a
// paused/resumed track still plays. The Echo re-fetches on each play, and Next/
// Prev mint fresh URLs, so a long TTL is low-risk for a single-user homelab.
const streamTTL = 12 * time.Hour

// Repository is the subset of music.Repository the skill needs: list the org's
// tracks (to build the queue) and fetch one by id (to stream it).
type Repository interface {
	ListTracks(ctx context.Context, orgID string) ([]music.Track, error)
	GetTrack(ctx context.Context, orgID, id string) (music.Track, error)
}

// BlobStore is the subset of the Drive blob store the stream handler needs.
type BlobStore interface {
	Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error)
}

// Handler is the self-hosted Alexa skill endpoint. It is stateless: all queue
// state rides in the AudioPlayer token, audio is served from a signed URL, and
// for v1 it serves a single configured org (no account-linking yet).
type Handler struct {
	repo    Repository
	blobs   BlobStore
	orgID   string
	secret  []byte
	baseURL string // public origin, e.g. https://pick.haus

	// verifier validates inbound Alexa request signatures. nil = skip (dev).
	verifier *verifier
}

// Options configures the handler.
type Options struct {
	Repo    Repository
	Blobs   BlobStore
	OrgID   string
	Secret  []byte
	BaseURL string
	// SkipVerify bypasses Alexa request-signature validation (local dev). In
	// production leave false so every request is cryptographically verified.
	SkipVerify bool
}

// New constructs the Alexa skill handler.
func New(o Options) *Handler {
	h := &Handler{
		repo:    o.Repo,
		blobs:   o.Blobs,
		orgID:   o.OrgID,
		secret:  o.Secret,
		baseURL: strings.TrimRight(o.BaseURL, "/"),
	}
	if !o.SkipVerify {
		h.verifier = newVerifier()
	}
	return h
}

// Handler is the POST /alexa entry point. It is mounted PUBLIC (before grown's
// auth wall): Alexa signs its own requests, which we verify here.
func (h *Handler) Handler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 256<<10))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	// Verify the Alexa request signature over the RAW body before parsing.
	if h.verifier != nil {
		if err := h.verifier.verify(r.Header, body); err != nil {
			http.Error(w, "invalid signature: "+err.Error(), http.StatusBadRequest)
			return
		}
	}

	var req Request
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "bad request json", http.StatusBadRequest)
		return
	}

	resp := h.route(r.Context(), &req)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// route dispatches a parsed request to the right behavior and returns the
// response. Pure (ctx + req in, response out) so it is straightforward to test.
func (h *Handler) route(ctx context.Context, req *Request) *Response {
	switch req.Request.Type {
	case TypeLaunchRequest:
		return h.onLaunch(ctx, req)
	case TypeIntentRequest:
		return h.onIntent(ctx, req)
	case TypePlaybackNearlyFinished:
		return h.onNearlyFinished(ctx, req)
	case TypePlaybackStarted, TypePlaybackFinished, TypePlaybackStopped, TypePlaybackFailed:
		// Nothing to do: acknowledge with an empty 200. (Stopped's offset would be
		// remembered for resume if we kept state; we are stateless, so we ignore it
		// and AMAZON.ResumeIntent restarts the current track from 0.)
		return empty()
	case TypeSessionEndedRequest:
		return empty()
	default:
		return empty()
	}
}

// onLaunch greets and starts the whole library shuffled.
func (h *Handler) onLaunch(ctx context.Context, req *Request) *Response {
	seed := newSeed(req.Request.RequestID + req.Session.SessionID)
	tok := QueueToken{Mode: ModeAll, Seed: seed, Idx: 0}
	return h.playFrom(ctx, tok, "Playing your music library, shuffled.", PlayReplaceAll, 0)
}

// onIntent routes the custom + built-in intents.
func (h *Handler) onIntent(ctx context.Context, req *Request) *Response {
	name := req.Request.Intent.Name
	switch name {
	case "PlayMusicIntent":
		seed := newSeed(req.Request.RequestID + req.Session.SessionID)
		tok := QueueToken{Mode: ModeAll, Seed: seed}
		return h.playFrom(ctx, tok, "Playing your music library, shuffled.", PlayReplaceAll, 0)

	case "PlayArtistIntent":
		artist := slotValue(req, "artist")
		if artist == "" {
			return speak("Which artist would you like to hear?", false)
		}
		seed := newSeed(req.Request.RequestID + artist)
		tok := QueueToken{Mode: ModeArtist, Key: artist, Seed: seed}
		return h.playFrom(ctx, tok, "Playing "+artist+".", PlayReplaceAll, 0)

	case "PlayAlbumIntent":
		album := slotValue(req, "album")
		if album == "" {
			return speak("Which album or station would you like to hear?", false)
		}
		seed := newSeed(req.Request.RequestID + album)
		tok := QueueToken{Mode: ModeAlbum, Key: album, Seed: seed}
		return h.playFrom(ctx, tok, "Playing "+album+".", PlayReplaceAll, 0)

	case "AMAZON.NextIntent":
		return h.step(ctx, req, +1)
	case "AMAZON.PreviousIntent":
		return h.step(ctx, req, -1)

	case "AMAZON.StartOverIntent":
		return h.restartCurrent(ctx, req)

	case "AMAZON.PauseIntent", "AMAZON.CancelIntent", "AMAZON.StopIntent":
		// Stop playback (keeps nothing — stateless). ClearQueue clears the enqueued
		// next track so it doesn't auto-resume.
		return stopResponse()

	case "AMAZON.ResumeIntent":
		// Stateless: re-play the current token's track from offset 0. (We don't
		// persist the paused offset.) If there's no token, start the library.
		return h.resume(ctx, req)

	case "AMAZON.ShuffleOnIntent":
		// Reshuffle the current mode/key with a fresh seed from the current track.
		return h.reshuffle(ctx, req, true)
	case "AMAZON.ShuffleOffIntent":
		return h.reshuffle(ctx, req, false)

	case "AMAZON.LoopOnIntent", "AMAZON.LoopOffIntent":
		// Best-effort: looping is not modeled in the stateless token. Acknowledge.
		return speak("Looping isn't supported yet.", false)

	case "AMAZON.HelpIntent":
		return speak("You can say: play my music, play music by an artist, play an album, next, previous, pause, or resume.", false)

	case "AMAZON.FallbackIntent":
		return speak("Sorry, I didn't catch that. Try saying: play my music.", false)

	default:
		return speak("Sorry, I can't do that yet.", false)
	}
}

// onNearlyFinished enqueues the NEXT track (ENQUEUE) so playback is gapless. The
// enqueued stream's ExpectedPreviousToken is the just-finishing token, so Alexa
// rejects a stale enqueue if the user skipped meanwhile.
func (h *Handler) onNearlyFinished(ctx context.Context, req *Request) *Response {
	cur, ok := DecodeToken(req.Request.Token)
	if !ok {
		return empty()
	}
	tracks, err := h.loadTracks(ctx)
	if err != nil {
		return empty()
	}
	ordered := orderedTracks(tracks, cur)
	next := cur.Idx + 1
	if next >= len(ordered) {
		return empty() // end of queue, nothing to enqueue
	}
	nextTok := cur.At(next)
	d := h.playDirective(ordered[next], nextTok, PlayEnqueue, 0)
	d.AudioItem.Stream.ExpectedPreviousToken = req.Request.Token
	return &Response{Version: "1.0", Body: ResponseBody{Directives: []Directive{d}}}
}

// step moves the cursor by delta (+1 next, -1 prev) and plays that track.
func (h *Handler) step(ctx context.Context, req *Request, delta int) *Response {
	cur, ok := DecodeToken(currentToken(req))
	if !ok {
		// No active queue: treat Next as "start the library".
		seed := newSeed(req.Request.RequestID + req.Session.SessionID)
		return h.playFrom(ctx, QueueToken{Mode: ModeAll, Seed: seed}, "Playing your music library.", PlayReplaceAll, 0)
	}
	tracks, err := h.loadTracks(ctx)
	if err != nil {
		return speak("I couldn't reach your music library.", true)
	}
	ordered := orderedTracks(tracks, cur)
	if len(ordered) == 0 {
		return speak("Your music library is empty.", true)
	}
	idx := cur.Idx + delta
	if idx < 0 {
		idx = 0
	}
	if idx >= len(ordered) {
		return speak("You've reached the end.", true)
	}
	tok := cur.At(idx)
	return h.playOrdered(ordered, tok, "", PlayReplaceAll, 0)
}

// restartCurrent replays the current track from the start.
func (h *Handler) restartCurrent(ctx context.Context, req *Request) *Response {
	cur, ok := DecodeToken(currentToken(req))
	if !ok {
		return h.step(ctx, req, 0)
	}
	tracks, err := h.loadTracks(ctx)
	if err != nil {
		return speak("I couldn't reach your music library.", true)
	}
	ordered := orderedTracks(tracks, cur)
	if cur.Idx < 0 || cur.Idx >= len(ordered) {
		return speak("Nothing is playing.", true)
	}
	return h.playOrdered(ordered, cur, "", PlayReplaceAll, 0)
}

// resume re-plays the current token's track (offset 0 — we don't persist offset).
func (h *Handler) resume(ctx context.Context, req *Request) *Response {
	cur, ok := DecodeToken(currentToken(req))
	if !ok {
		seed := newSeed(req.Request.RequestID + req.Session.SessionID)
		return h.playFrom(ctx, QueueToken{Mode: ModeAll, Seed: seed}, "Playing your music library.", PlayReplaceAll, 0)
	}
	tracks, err := h.loadTracks(ctx)
	if err != nil {
		return speak("I couldn't reach your music library.", true)
	}
	ordered := orderedTracks(tracks, cur)
	if cur.Idx < 0 || cur.Idx >= len(ordered) {
		return speak("Nothing to resume.", true)
	}
	return h.playOrdered(ordered, cur, "", PlayReplaceAll, 0)
}

// reshuffle restarts the current mode/key, optionally with a fresh seed (on) or
// in stable order (off), from the top.
func (h *Handler) reshuffle(ctx context.Context, req *Request, on bool) *Response {
	cur, ok := DecodeToken(currentToken(req))
	if !ok {
		cur = QueueToken{Mode: ModeAll}
	}
	cur.Idx = 0
	if on {
		cur.Seed = newSeed(req.Request.RequestID + req.Session.SessionID)
	} else {
		cur.Seed = 0
	}
	msg := "Shuffle on."
	if !on {
		msg = "Shuffle off."
	}
	return h.playFrom(ctx, cur, msg, PlayReplaceAll, 0)
}

// playFrom loads the library, builds the ordered queue for tok, and plays the
// track at tok.Idx. speech may be empty (then no OutputSpeech).
func (h *Handler) playFrom(ctx context.Context, tok QueueToken, speech, behavior string, offset int64) *Response {
	tracks, err := h.loadTracks(ctx)
	if err != nil {
		return speak("I couldn't reach your music library.", true)
	}
	ordered := orderedTracks(tracks, tok)
	if len(ordered) == 0 {
		if tok.Mode == ModeAll {
			return speak("Your music library is empty.", true)
		}
		return speak("I couldn't find anything matching that.", true)
	}
	if tok.Idx < 0 || tok.Idx >= len(ordered) {
		tok.Idx = 0
	}
	return h.playOrdered(ordered, tok, speech, behavior, offset)
}

// playOrdered builds a Play response for ordered[tok.Idx].
func (h *Handler) playOrdered(ordered []music.Track, tok QueueToken, speech, behavior string, offset int64) *Response {
	d := h.playDirective(ordered[tok.Idx], tok, behavior, offset)
	resp := &Response{
		Version: "1.0",
		Body: ResponseBody{
			Directives:       []Directive{d},
			ShouldEndSession: boolPtr(true),
		},
	}
	if speech != "" {
		resp.Body.OutputSpeech = &OutputSpeech{Type: speechPlain, Text: speech}
	}
	return resp
}

// playDirective builds a single AudioPlayer.Play directive for a track, with a
// freshly-signed stream URL and the queue token at this position.
func (h *Handler) playDirective(t music.Track, tok QueueToken, behavior string, offset int64) Directive {
	return Directive{
		Type:         DirectivePlay,
		PlayBehavior: behavior,
		AudioItem: &AudioItem{
			Stream: Stream{
				URL:                  streamURL(h.baseURL, h.secret, t.ID, streamTTL),
				Token:                tok.Encode(),
				OffsetInMilliseconds: offset,
			},
		},
	}
}

// stopResponse stops playback and clears the enqueued next track.
func stopResponse() *Response {
	return &Response{
		Version: "1.0",
		Body: ResponseBody{
			Directives:       []Directive{{Type: DirectiveStop}},
			ShouldEndSession: boolPtr(true),
		},
	}
}

// currentToken returns the token of the active stream, preferring the request
// body token (set on AudioPlayer events) then the AudioPlayer context token
// (set on intents issued mid-playback).
func currentToken(req *Request) string {
	if req.Request.Token != "" {
		return req.Request.Token
	}
	return req.Context.AudioPlayer.Token
}

// slotValue reads a slot's spoken value (trimmed), or "" if absent.
func slotValue(req *Request, name string) string {
	if req.Request.Intent.Slots == nil {
		return ""
	}
	return strings.TrimSpace(req.Request.Intent.Slots[name].Value)
}
