// Package radio ports Spacelight's radio-recorder to Go: while a station is
// being listened to, it taps the ICY/Shoutcast stream, parses the StreamTitle
// metadata, buffers the audio between title changes, and persists each complete
// song (≥30s) to the blob store as a grown.music_tracks row (source='radio').
//
// Recording is best-effort and fully isolated: a stream failure logs and stops
// that one station's recorder; it never panics the process or blocks playback.
// Reference-counted listeners per station mean the tap runs once regardless of
// how many users are listening, and stops when the last listener leaves.
package radio

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"code.pick.haus/grown/grown/internal/music"
)

const (
	// minSongDuration is the Spacelight threshold: shorter clips (jingles, the
	// partial song straddling a connect/disconnect) are discarded.
	minSongDuration = 30 * time.Second
	// maxSongBytes caps a single buffered song so a stream stuck on one title
	// (or with no metadata interval) can't balloon memory. ~30 MiB ≈ 30 min at
	// 128kbps, comfortably longer than any real track.
	maxSongBytes = 30 << 20
	// dedupeWindow: skip re-saving the same station+artist+title seen recently.
	dedupeWindow = 6 * time.Hour
	// defaultBitrate (kbps) when the stream omits icy-br, for duration estimate.
	defaultBitrate = 128
	// connectTimeout bounds the initial dial; the stream read itself is open-ended.
	connectTimeout = 15 * time.Second
)

// Store is the subset of the blob store the recorder needs (a superset of what
// music.BlobStore Put provides). Satisfied by the Drive blob store.
type Store interface {
	Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error
	Delete(ctx context.Context, key string) error
}

// Repo is the subset of *music.Repository the recorder needs.
type Repo interface {
	GetStation(ctx context.Context, orgID, id string) (music.Station, error)
	CreateRadioTrack(ctx context.Context, orgID, ownerID string, p music.CreateRadioTrackParams) (music.Track, error)
	RadioTrackExists(ctx context.Context, stationID, artist, title string, within time.Duration) (bool, error)
}

// streamTitleRe extracts the StreamTitle value from an ICY metadata block.
var streamTitleRe = regexp.MustCompile(`StreamTitle='([^']*)'`)

// vonRe matches the German "Title von Artist" form Spacelight also handles.
var vonRe = regexp.MustCompile(`(?i)^(.+?)\s+von\s+(.+)$`)

// parseStreamTitle mirrors radio-recorder.ts parseStreamTitle: pulls
// StreamTitle, then splits into artist/title on " - " (or German "von").
func parseStreamTitle(raw string) (artist, title string) {
	m := streamTitleRe.FindStringSubmatch(raw)
	if m == nil {
		return "", ""
	}
	st := strings.TrimSpace(m[1])
	if st == "" {
		return "", ""
	}
	if v := vonRe.FindStringSubmatch(st); v != nil {
		return strings.TrimSpace(v[2]), strings.TrimSpace(v[1])
	}
	if parts := strings.SplitN(st, " - ", 2); len(parts) == 2 {
		return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	}
	return "", st
}

// recording is the per-station live tap + buffering state.
type recording struct {
	station   music.Station
	orgID     string
	ownerID   string
	listeners map[string]struct{}
	cancel    context.CancelFunc
	running   bool
}

// Recorder owns all live station taps for the process. Methods are safe for
// concurrent use.
type Recorder struct {
	repo  Repo
	store Store
	hc    *http.Client

	mu         sync.Mutex
	recordings map[string]*recording // keyed by station id
}

// NewRecorder constructs a Recorder. The retention sweep runs separately via
// StartRetentionSweeper.
func NewRecorder(repo Repo, store Store) *Recorder {
	return &Recorder{
		repo:       repo,
		store:      store,
		hc:         &http.Client{Timeout: 0}, // streams are long-lived; no overall timeout
		recordings: make(map[string]*recording),
	}
}

// Start registers a listener for the station and, if this is the first
// listener, opens the live tap + recording goroutine. Idempotent per listener.
func (r *Recorder) Start(orgID, stationID, listenerID, ownerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	rec, ok := r.recordings[stationID]
	if !ok {
		station, err := r.repo.GetStation(context.Background(), orgID, stationID)
		if err != nil {
			slog.Warn("radio: start unknown station", "station", stationID, "err", err)
			return
		}
		rec = &recording{
			station:   station,
			orgID:     orgID,
			ownerID:   ownerID,
			listeners: make(map[string]struct{}),
		}
		r.recordings[stationID] = rec
	}
	rec.listeners[listenerID] = struct{}{}

	if !rec.running {
		ctx, cancel := context.WithCancel(context.Background())
		rec.cancel = cancel
		rec.running = true
		go r.run(ctx, rec)
	}
}

// Stop removes a listener; when the last listener leaves, the tap is closed and
// the in-flight (partial) song discarded.
func (r *Recorder) Stop(stationID, listenerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	rec, ok := r.recordings[stationID]
	if !ok {
		return
	}
	delete(rec.listeners, listenerID)
	if len(rec.listeners) == 0 {
		if rec.cancel != nil {
			rec.cancel()
		}
		delete(r.recordings, stationID)
	}
}

// run holds the live connection for one station and reconnects with backoff
// while listeners remain. It exits when the context is cancelled (last listener
// left) — the in-flight song is intentionally dropped.
func (r *Recorder) run(ctx context.Context, rec *recording) {
	defer func() {
		if p := recover(); p != nil {
			slog.Error("radio: recorder panic recovered", "station", rec.station.Name, "panic", p)
		}
	}()
	backoff := 2 * time.Second
	for ctx.Err() == nil {
		err := r.tap(ctx, rec)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			slog.Warn("radio: tap ended", "station", rec.station.Name, "err", err)
		}
		// Reconnect after a short delay (the stream closed or had no metadata).
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

// tap opens the ICY stream once and reads until the connection ends or ctx is
// cancelled. It returns nil on a clean close, or an error to trigger reconnect.
func (r *Recorder) tap(ctx context.Context, rec *recording) error {
	url := rec.station.StreamURL
	dialCtx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(dialCtx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Icy-MetaData", "1")
	req.Header.Set("User-Agent", "grown-music/1.0")

	resp, err := r.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}

	metaint, _ := strconv.Atoi(resp.Header.Get("icy-metaint"))
	if metaint <= 0 {
		// No ICY metadata: playback still works (the proxy serves bytes), but we
		// can't delimit songs, so we don't record. Don't hammer-reconnect.
		slog.Info("radio: stream has no icy-metaint, recording disabled", "station", rec.station.Name)
		<-ctx.Done()
		return nil
	}

	bitrate := defaultBitrate
	if br, e := strconv.Atoi(strings.TrimSpace(resp.Header.Get("icy-br"))); e == nil && br > 0 {
		bitrate = br
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "audio/mpeg"
	}

	slog.Info("radio: tapping stream", "station", rec.station.Name, "metaint", metaint, "bitrate", bitrate)
	return r.readStream(ctx, rec, bufio.NewReaderSize(resp.Body, 1<<16), metaint, bitrate, contentType)
}

// songBuf accumulates one song's audio bytes between title changes.
type songBuf struct {
	artist  string
	title   string
	buf     bytes.Buffer
	started time.Time
	dropped bool // true once we exceeded maxSongBytes (save is suppressed)
}

// readStream runs the ICY state machine (audio → meta-length → meta-data →
// audio), accumulating each song and flushing on title change. Mirrors the
// byte-walking loop in radio-recorder.ts.
func (r *Recorder) readStream(ctx context.Context, rec *recording, br *bufio.Reader, metaint, bitrate int, contentType string) error {
	var (
		currentTitle   string
		cur            *songBuf
		firstDiscarded bool
		audioBytesRead int
		readErr        error
	)

	audio := make([]byte, 0, metaint)

	for ctx.Err() == nil {
		// Read exactly metaint audio bytes.
		audio = audio[:0]
		need := metaint
		for need > 0 {
			if ctx.Err() != nil {
				return nil
			}
			chunk := make([]byte, need)
			n, err := br.Read(chunk)
			if n > 0 {
				audio = append(audio, chunk[:n]...)
				need -= n
				audioBytesRead += n
				if cur != nil && !cur.dropped {
					cur.buf.Write(chunk[:n])
					if cur.buf.Len() > maxSongBytes {
						cur.dropped = true
						cur.buf.Reset()
					}
				}
			}
			if err != nil {
				readErr = err
				break
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return nil
			}
			return readErr
		}
		audioBytesRead = 0

		// Read the 1-byte metadata length (in 16-byte units).
		lenByte, err := br.ReadByte()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		metaLen := int(lenByte) * 16
		if metaLen == 0 {
			continue
		}
		metaRaw := make([]byte, metaLen)
		if _, err := io.ReadFull(br, metaRaw); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		metaStr := strings.TrimRight(string(metaRaw), "\x00")

		artist, title := parseStreamTitle(metaStr)
		newTitle := title
		if artist != "" && title != "" {
			newTitle = artist + " - " + title
		} else if artist != "" {
			newTitle = artist
		}
		if newTitle == "" || newTitle == currentTitle {
			continue
		}

		// Title changed. Flush the previous song only once we're past the first
		// (partial) one — we joined mid-track, so the song in progress when the
		// first title change arrives is incomplete and must be discarded.
		if cur != nil {
			if firstDiscarded {
				r.saveSong(ctx, rec, cur, bitrate, contentType)
			} else {
				firstDiscarded = true // discard the partial join song
			}
		}

		currentTitle = newTitle
		cur = &songBuf{artist: artist, title: title, started: time.Now()}
		slog.Debug("radio: now playing", "station", rec.station.Name, "title", newTitle)
	}
	return nil
}

// saveSong persists a buffered song to the blob store + a music_tracks row,
// applying the 30s minimum, dedupe, and size cap. Best-effort; logs on failure.
func (r *Recorder) saveSong(ctx context.Context, rec *recording, song *songBuf, bitrate int, contentType string) {
	if song.dropped || song.artist == "" || song.title == "" {
		return
	}
	size := song.buf.Len()
	if size == 0 {
		return
	}
	durationSeconds := float64(size*8) / float64(bitrate*1000)
	if durationSeconds < minSongDuration.Seconds() {
		slog.Debug("radio: skip short clip", "station", rec.station.Name,
			"artist", song.artist, "title", song.title, "dur", durationSeconds)
		return
	}

	// Dedupe against recently-cached songs on this station.
	if exists, err := r.repo.RadioTrackExists(ctx, rec.station.ID, song.artist, song.title, dedupeWindow); err == nil && exists {
		slog.Debug("radio: already cached, skipping", "station", rec.station.Name,
			"artist", song.artist, "title", song.title)
		return
	}

	key := blobKey()
	data := song.buf.Bytes()
	if err := r.store.Put(ctx, key, contentType, int64(len(data)), bytes.NewReader(data)); err != nil {
		slog.Warn("radio: blob put failed", "station", rec.station.Name, "err", err)
		return
	}

	t, err := r.repo.CreateRadioTrack(ctx, rec.orgID, rec.ownerID, music.CreateRadioTrackParams{
		Title:           song.title,
		Artist:          song.artist,
		Album:           rec.station.Name,
		ContentType:     contentType,
		Size:            int64(len(data)),
		DurationSeconds: durationSeconds,
		BlobKey:         key,
		StationID:       rec.station.ID,
	})
	if err != nil {
		_ = r.store.Delete(ctx, key) // roll back the orphaned blob
		slog.Warn("radio: create track failed", "station", rec.station.Name, "err", err)
		return
	}
	slog.Info("radio: cached song", "station", rec.station.Name, "artist", song.artist,
		"title", song.title, "dur", int(durationSeconds), "track", t.ID)
}

func blobKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return "music/radio/" + hex.EncodeToString(b)
}
