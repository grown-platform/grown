// Package alexa implements a self-hosted Amazon Alexa custom skill endpoint
// that plays the grown Music library on an Echo device. It is mounted INSIDE
// the grown server (no AWS Lambda): Alexa POSTs signed requests to /alexa, and
// the Echo fetches audio bytes from a signed, session-free stream URL.
//
// Queue state is encoded entirely in the AudioPlayer `token` (see queue.go), so
// the skill is fully stateless: every request reconstructs the ordered track
// list deterministically from the token, which makes Next/Previous and the
// PlaybackNearlyFinished gapless-enqueue work without any server-side storage.
package alexa

// Request is the envelope Alexa POSTs to the skill endpoint. Only the fields the
// skill needs are modeled; unknown fields are ignored on decode.
type Request struct {
	Version string  `json:"version"`
	Session Session `json:"session"`
	Context Context `json:"context"`
	Request ReqBody `json:"request"`
}

// Session carries per-session metadata (new flag, ids). The skill is stateless
// so it is largely informational.
type Session struct {
	New       bool   `json:"new"`
	SessionID string `json:"sessionId"`
}

// Context carries device/system + AudioPlayer state. The AudioPlayer block is
// present on AudioPlayer.* events and intent requests issued mid-playback; its
// Token is the queue token of the currently/ last playing item.
type Context struct {
	System      System           `json:"System"`
	AudioPlayer AudioPlayerState `json:"AudioPlayer"`
}

// System identifies the device/application making the request.
type System struct {
	Application Application `json:"application"`
	Device      Device      `json:"device"`
}

// Application carries the skill's applicationId (used for optional skill-id
// pinning during verification).
type Application struct {
	ApplicationID string `json:"applicationId"`
}

// Device identifies the Echo. Unused by v1 (single configured org).
type Device struct {
	DeviceID string `json:"deviceId"`
}

// AudioPlayerState is the player state Alexa reports on every request: the
// token of the active stream and the playback offset in milliseconds.
type AudioPlayerState struct {
	Token                string `json:"token"`
	OffsetInMilliseconds int64  `json:"offsetInMilliseconds"`
	PlayerActivity       string `json:"playerActivity"`
}

// ReqBody is the polymorphic request payload. Type discriminates between
// LaunchRequest, IntentRequest, SessionEndedRequest, and the AudioPlayer.*
// playback events.
type ReqBody struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	Timestamp string `json:"timestamp"`
	Locale    string `json:"locale"`

	// IntentRequest only.
	Intent Intent `json:"intent"`

	// AudioPlayer.* events only: the token of the affected stream and the
	// offset at the time of the event.
	Token                string `json:"token"`
	OffsetInMilliseconds int64  `json:"offsetInMilliseconds"`

	// PlaybackFailed only.
	Error PlaybackError `json:"error"`

	// SessionEndedRequest only.
	Reason string `json:"reason"`
}

// PlaybackError is the error body of a PlaybackFailed event.
type PlaybackError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// Intent is the matched intent of an IntentRequest, with its resolved slots.
type Intent struct {
	Name  string          `json:"name"`
	Slots map[string]Slot `json:"slots"`
}

// Slot is a single resolved slot value (the spoken/recognized value).
type Slot struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Response is the skill's reply. Only OutputSpeech and Directives are used by
// the music skill; Card/Reprompt are intentionally omitted.
type Response struct {
	Version           string                 `json:"version"`
	SessionAttributes map[string]interface{} `json:"sessionAttributes,omitempty"`
	Body              ResponseBody           `json:"response"`
}

// ResponseBody is the inner response object.
type ResponseBody struct {
	OutputSpeech     *OutputSpeech `json:"outputSpeech,omitempty"`
	Directives       []Directive   `json:"directives,omitempty"`
	ShouldEndSession *bool         `json:"shouldEndSession,omitempty"`
}

// OutputSpeech is what Alexa says. Only plain text is used.
type OutputSpeech struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// Directive is an AudioPlayer directive (Play / Stop / ClearQueue). Fields not
// relevant to a given directive type are omitted via omitempty.
type Directive struct {
	Type          string     `json:"type"`
	PlayBehavior  string     `json:"playBehavior,omitempty"`
	AudioItem     *AudioItem `json:"audioItem,omitempty"`
	ClearBehavior string     `json:"clearBehavior,omitempty"`
}

// AudioItem wraps the stream to play.
type AudioItem struct {
	Stream Stream `json:"stream"`
}

// Stream is a single playable audio stream. URL is the signed, session-free
// grown stream URL; Token is the queue token (see queue.go); ExpectedPreviousToken
// is set on ENQUEUE directives so Alexa rejects a stale enqueue.
type Stream struct {
	URL                   string `json:"url"`
	Token                 string `json:"token"`
	ExpectedPreviousToken string `json:"expectedPreviousToken,omitempty"`
	OffsetInMilliseconds  int64  `json:"offsetInMilliseconds"`
}

// Request type constants.
const (
	TypeLaunchRequest       = "LaunchRequest"
	TypeIntentRequest       = "IntentRequest"
	TypeSessionEndedRequest = "SessionEndedRequest"

	TypePlaybackStarted        = "AudioPlayer.PlaybackStarted"
	TypePlaybackFinished       = "AudioPlayer.PlaybackFinished"
	TypePlaybackStopped        = "AudioPlayer.PlaybackStopped"
	TypePlaybackNearlyFinished = "AudioPlayer.PlaybackNearlyFinished"
	TypePlaybackFailed         = "AudioPlayer.PlaybackFailed"
)

// Directive type + behavior constants.
const (
	DirectivePlay       = "AudioPlayer.Play"
	DirectiveStop       = "AudioPlayer.Stop"
	DirectiveClearQueue = "AudioPlayer.ClearQueue"

	PlayReplaceAll = "REPLACE_ALL"
	PlayEnqueue    = "ENQUEUE"

	ClearEnqueued = "CLEAR_ENQUEUED"
	ClearAll      = "CLEAR_ALL"

	speechPlain = "PlainText"
)

// boolPtr is a tiny helper for the *bool ShouldEndSession field.
func boolPtr(b bool) *bool { return &b }

// speak builds a response that just talks (no directive), optionally ending the
// session.
func speak(text string, endSession bool) *Response {
	return &Response{
		Version: "1.0",
		Body: ResponseBody{
			OutputSpeech:     &OutputSpeech{Type: speechPlain, Text: text},
			ShouldEndSession: boolPtr(endSession),
		},
	}
}

// empty builds a no-op 200 response (used for AudioPlayer.* events that need no
// directive). ShouldEndSession is omitted, as required for AudioPlayer events.
func empty() *Response {
	return &Response{Version: "1.0", Body: ResponseBody{}}
}
