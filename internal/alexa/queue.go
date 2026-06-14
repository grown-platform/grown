package alexa

import (
	"encoding/base64"
	"encoding/json"
	"sort"
	"strings"

	"code.pick.haus/grown/grown/internal/music"
)

// Queue mode constants. The mode plus key (artist/album value) determine which
// subset of the library is played; idx is the cursor; seed drives the shuffle.
const (
	ModeAll    = "all"
	ModeArtist = "artist"
	ModeAlbum  = "album"
)

// QueueToken is the entire playback state, serialized into the AudioPlayer
// `token`. It carries NO server-side handle: the ordered track list is
// reconstructed deterministically from (mode, key, seed) on every request, and
// idx is the cursor into that list. seed != 0 means "shuffled"; the same seed
// always reproduces the same order, so Next/Previous and the gapless enqueue are
// reproducible without any storage.
type QueueToken struct {
	Mode string `json:"m"`
	Key  string `json:"k"`
	Idx  int    `json:"i"`
	Seed uint64 `json:"s"`
}

// Encode serializes the token to a compact base64url (no padding) string safe
// to embed in an AudioPlayer stream token.
func (q QueueToken) Encode() string {
	b, _ := json.Marshal(q)
	return base64.RawURLEncoding.EncodeToString(b)
}

// DecodeToken parses a base64url token back into a QueueToken. A malformed token
// yields ok=false so the caller can fall back gracefully.
func DecodeToken(s string) (QueueToken, bool) {
	if s == "" {
		return QueueToken{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return QueueToken{}, false
	}
	var q QueueToken
	if err := json.Unmarshal(raw, &q); err != nil {
		return QueueToken{}, false
	}
	if q.Mode != ModeAll && q.Mode != ModeArtist && q.Mode != ModeAlbum {
		return QueueToken{}, false
	}
	return q, true
}

// At returns a copy of the token with the cursor set to i.
func (q QueueToken) At(i int) QueueToken {
	q.Idx = i
	return q
}

// filterTracks selects the subset of tracks that the (mode, key) describe.
// Artist/Album matching is case-insensitive "contains" so "play the beatles"
// matches an artist stored as "The Beatles". Album mode matches the Album field
// (radio stations live there for the music library).
func filterTracks(all []music.Track, mode, key string) []music.Track {
	if mode == ModeAll || key == "" {
		return all
	}
	needle := strings.ToLower(strings.TrimSpace(key))
	out := make([]music.Track, 0, len(all))
	for _, t := range all {
		var hay string
		switch mode {
		case ModeArtist:
			hay = strings.ToLower(t.Artist)
		case ModeAlbum:
			hay = strings.ToLower(t.Album)
		}
		if needle != "" && strings.Contains(hay, needle) {
			out = append(out, t)
		}
	}
	return out
}

// orderedTracks reconstructs the deterministic, ordered track list for a token.
// It filters by mode/key, sorts into a STABLE base order (by ID, which is a
// stable UUID — independent of created_at so re-uploads don't reshuffle an
// existing queue), then — if seed != 0 — applies a deterministic Fisher-Yates
// shuffle seeded by the token's seed. The same token always yields the same
// slice, which is the whole point: Next/Prev/enqueue are reproducible.
func orderedTracks(all []music.Track, q QueueToken) []music.Track {
	tracks := filterTracks(all, q.Mode, q.Key)
	// Stable base order by ID so the unshuffled order is deterministic and the
	// shuffle has a fixed starting permutation.
	sort.Slice(tracks, func(i, j int) bool { return tracks[i].ID < tracks[j].ID })
	if q.Seed != 0 && len(tracks) > 1 {
		shuffle(tracks, q.Seed)
	}
	return tracks
}
