package radio

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"sync"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/music"
)

func TestParseStreamTitle(t *testing.T) {
	cases := []struct {
		raw, artist, title string
	}{
		{"StreamTitle='Queen - Bohemian Rhapsody';", "Queen", "Bohemian Rhapsody"},
		{"StreamTitle='Artist - A - Long Title';", "Artist", "A - Long Title"},
		{"StreamTitle='Just A Title';", "", "Just A Title"},
		{"StreamTitle='';", "", ""},
		{"StreamTitle='Mein Lied von Nena';", "Nena", "Mein Lied"},
		{"NoStreamTitleHere", "", ""},
	}
	for _, c := range cases {
		a, ti := parseStreamTitle(c.raw)
		if a != c.artist || ti != c.title {
			t.Errorf("parseStreamTitle(%q) = (%q,%q), want (%q,%q)", c.raw, a, ti, c.artist, c.title)
		}
	}
}

// --- ICY stream synthesis + fakes ----------------------------------------

// buildICYStream interleaves audio blocks with ICY metadata at metaint
// boundaries. titles is the sequence of StreamTitle values; blocksPerTitle
// audio blocks of metaint bytes are emitted between each title change.
func buildICYStream(metaint int, titles []string, blocksPerTitle int) []byte {
	var out bytes.Buffer
	audioBlock := bytes.Repeat([]byte{0xAB}, metaint)
	writeMeta := func(title string) {
		meta := []byte("StreamTitle='" + title + "';")
		// pad to a 16-byte multiple
		for len(meta)%16 != 0 {
			meta = append(meta, 0)
		}
		out.WriteByte(byte(len(meta) / 16))
		out.Write(meta)
	}
	first := true
	for _, title := range titles {
		for i := 0; i < blocksPerTitle; i++ {
			out.Write(audioBlock)
			if i == 0 {
				// Emit the new title right after the first audio block of the run.
				writeMeta(title)
				first = false
			} else {
				out.WriteByte(0) // zero-length meta block
			}
		}
	}
	_ = first
	return out.Bytes()
}

type fakeRepo struct {
	mu      sync.Mutex
	created []music.CreateRadioTrackParams
}

func (f *fakeRepo) GetStation(_ context.Context, _, _ string) (music.Station, error) {
	return music.Station{ID: "st1", Name: "Test FM"}, nil
}
func (f *fakeRepo) CreateRadioTrack(_ context.Context, _, _ string, p music.CreateRadioTrackParams) (music.Track, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.created = append(f.created, p)
	return music.Track{ID: "t1"}, nil
}
func (f *fakeRepo) RadioTrackExists(_ context.Context, _, _, _ string, _ time.Duration) (bool, error) {
	return false, nil
}

type fakeStore struct {
	mu   sync.Mutex
	puts int
}

func (f *fakeStore) Put(_ context.Context, _, _ string, _ int64, body io.Reader) error {
	_, _ = io.Copy(io.Discard, body)
	f.mu.Lock()
	f.puts++
	f.mu.Unlock()
	return nil
}
func (f *fakeStore) Delete(_ context.Context, _ string) error { return nil }

func TestReadStreamSavesCompleteSongs(t *testing.T) {
	const metaint = 4000
	// 3 titles. With a high bitrate-derived duration, each full song should
	// clear the 30s minimum. Use a low bitrate so a few blocks exceed 30s.
	// duration = bytes*8/(bitrate*1000). For ~30s at bitrate=8 we need
	// bytes ≈ 30*8*1000/8 = 30000 → ~8 blocks of 4000. Use 10 blocks/title.
	titles := []string{"A - One", "B - Two", "C - Three"}
	stream := buildICYStream(metaint, titles, 10)

	repo := &fakeRepo{}
	store := &fakeStore{}
	rec := NewRecorder(repo, store)
	recState := &recording{station: music.Station{ID: "st1", Name: "Test FM"}, orgID: "org", ownerID: "u1"}

	ctx := context.Background()
	br := bufio.NewReader(bytes.NewReader(stream))
	// bitrate=8 kbps → ~40s per 10-block (40000 byte) song, clears the minimum.
	_ = rec.readStream(ctx, recState, br, metaint, 8, "audio/mpeg")

	// First song ("A - One") is the partial-join discard. Last song ("C - Three")
	// never flushes (no following title change). So exactly "B - Two" saves.
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if len(repo.created) != 1 {
		t.Fatalf("expected 1 saved song, got %d: %+v", len(repo.created), repo.created)
	}
	got := repo.created[0]
	if got.Artist != "B" || got.Title != "Two" {
		t.Errorf("saved song = %q/%q, want B/Two", got.Artist, got.Title)
	}
	if got.Album != "Test FM" {
		t.Errorf("album = %q, want station name Test FM", got.Album)
	}
	if got.DurationSeconds < minSongDuration.Seconds() {
		t.Errorf("duration %.1f below minimum", got.DurationSeconds)
	}
}

func TestReadStreamDropsShortClips(t *testing.T) {
	const metaint = 4000
	titles := []string{"A - One", "B - Short", "C - Three"}
	// Only 1 block per title → each song ~ (4000*8)/(128*1000) = 0.25s, well
	// under the 30s minimum, so nothing should save.
	stream := buildICYStream(metaint, titles, 1)
	repo := &fakeRepo{}
	store := &fakeStore{}
	rec := NewRecorder(repo, store)
	recState := &recording{station: music.Station{ID: "st1", Name: "Test FM"}}
	_ = rec.readStream(context.Background(), recState, bufio.NewReader(bytes.NewReader(stream)), metaint, 128, "audio/mpeg")
	if len(repo.created) != 0 {
		t.Errorf("expected no saves for short clips, got %d", len(repo.created))
	}
}
