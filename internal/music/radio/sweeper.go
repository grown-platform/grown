package radio

import (
	"context"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"code.pick.haus/grown/grown/internal/music"
)

// blobPrefix is where the recorder writes cached songs (see blobKey).
const blobPrefix = "music/radio/"

const (
	// purgeBatch bounds how many trashed tracks are purged per DB round trip.
	purgeBatch = 200
	// orphanBatch bounds how many listed object keys are checked per query.
	orphanBatch = 500
	// orphanGrace protects objects that were just Put but whose track row is
	// not inserted yet (the recorder writes the blob first).
	orphanGrace = time.Hour
)

// CacheRepo is the subset of *music.Repository the cache janitor needs.
type CacheRepo interface {
	SweepExpiredRadioTracks(ctx context.Context) (int, error)
	ListRadioCacheCandidates(ctx context.Context) ([]music.RadioCacheCandidate, error)
	TrashRadioTracks(ctx context.Context, ids []string) (int, error)
	ListTrashedRadioTracks(ctx context.Context, limit int) ([]music.TrashedRadioTrack, error)
	DeleteRadioTrackRows(ctx context.Context, ids []string) (int, error)
	RadioBlobKeysExist(ctx context.Context, keys []string) (map[string]bool, error)
}

// ObjectLister is optionally implemented by the blob store to enumerate keys
// under a prefix; it enables the orphaned-object sweep.
type ObjectLister interface {
	ListObjects(ctx context.Context, prefix string, fn func(key string, size int64, modified time.Time) error) error
}

// Eviction is the outcome of SelectEvictions.
type Eviction struct {
	IDs    []string
	Bytes  int64 // bytes freed if every id is evicted
	ByAge  int   // evicted for exceeding MaxDays
	BySize int   // evicted to get under MaxBytes
}

// SelectEvictions applies the instance-wide cache limits to the live radio
// tracks. Saved tracks (liked / in a playlist) are never selected but still
// count toward the byte total. Tracks are evicted oldest-recorded first
// (there is no play history, so recording time is the LRU proxy):
//  1. every unsaved track older than MaxDays;
//  2. then, while the total exceeds MaxBytes, the oldest remaining unsaved.
func SelectEvictions(cands []music.RadioCacheCandidate, limits music.RadioCacheLimits, now time.Time) Eviction {
	sorted := make([]music.RadioCacheCandidate, len(cands))
	copy(sorted, cands)
	sort.SliceStable(sorted, func(i, j int) bool {
		if !sorted[i].CreatedAt.Equal(sorted[j].CreatedAt) {
			return sorted[i].CreatedAt.Before(sorted[j].CreatedAt)
		}
		return sorted[i].ID < sorted[j].ID
	})
	var total int64
	for _, c := range sorted {
		total += c.Size
	}
	var ev Eviction
	evicted := make([]bool, len(sorted))
	if maxAge := limits.MaxAge(); maxAge > 0 {
		cutoff := now.Add(-maxAge)
		for i, c := range sorted {
			if !c.Saved && c.CreatedAt.Before(cutoff) {
				evicted[i] = true
				ev.IDs = append(ev.IDs, c.ID)
				ev.Bytes += c.Size
				ev.ByAge++
				total -= c.Size
			}
		}
	}
	if limits.MaxBytes > 0 {
		for i, c := range sorted {
			if total <= limits.MaxBytes {
				break
			}
			if c.Saved || evicted[i] {
				continue
			}
			evicted[i] = true
			ev.IDs = append(ev.IDs, c.ID)
			ev.Bytes += c.Size
			ev.BySize++
			total -= c.Size
		}
	}
	return ev
}

// SweepReport summarises one janitor pass.
type SweepReport struct {
	StationExpired int   // trashed by per-station "days" retention
	CapEvicted     int   // trashed by the instance-wide cap
	Purged         int   // trashed rows hard-deleted (objects deleted first)
	PurgedBytes    int64 // bytes of the purged rows
	PurgeFailures  int   // objects whose delete failed (row kept for retry)
	Orphans        int   // unreferenced music/radio/ objects deleted
	OrphanBytes    int64
}

// Janitor enforces radio cache retention: per-station "days" retention, the
// instance-wide byte/age cap, and the purge of trashed tracks' S3 objects and
// rows. It runs periodically and can be kicked after each recording.
type Janitor struct {
	repo     CacheRepo
	store    Store
	limits   music.RadioCacheLimits
	interval time.Duration
	now      func() time.Time

	mu   sync.Mutex // serialises passes
	kick chan struct{}
}

// NewJanitor constructs a Janitor. interval <= 0 means hourly.
func NewJanitor(repo CacheRepo, store Store, limits music.RadioCacheLimits, interval time.Duration) *Janitor {
	if interval <= 0 {
		interval = time.Hour
	}
	return &Janitor{
		repo: repo, store: store, limits: limits, interval: interval,
		now:  time.Now,
		kick: make(chan struct{}, 1),
	}
}

// Limits returns the configured instance-wide limits.
func (j *Janitor) Limits() music.RadioCacheLimits { return j.limits }

// Kick requests an opportunistic (cap + purge, no orphan listing) pass. It
// never blocks; kicks coalesce while a pass is pending.
func (j *Janitor) Kick() {
	if j == nil {
		return
	}
	select {
	case j.kick <- struct{}{}:
	default:
	}
}

// Start runs the janitor loop until ctx is cancelled: a full pass shortly
// after boot and then every interval, plus a light pass on each Kick.
func (j *Janitor) Start(ctx context.Context) {
	go func() {
		t := time.NewTimer(time.Minute)
		defer t.Stop()
		for {
			full := false
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				full = true
			case <-j.kick:
			}
			rep, err := j.RunOnce(ctx, full)
			if err != nil {
				slog.Warn("radio: cache sweep failed", "err", err)
			}
			if rep != (SweepReport{}) {
				slog.Info("radio: cache sweep", "station_expired", rep.StationExpired,
					"cap_evicted", rep.CapEvicted, "purged", rep.Purged,
					"purged_bytes", rep.PurgedBytes, "purge_failures", rep.PurgeFailures,
					"orphans", rep.Orphans, "orphan_bytes", rep.OrphanBytes)
			}
			if full {
				t.Reset(j.interval)
			}
		}
	}()
}

// RunOnce performs one pass. withOrphans additionally lists the bucket prefix
// and deletes objects no track row references. Steps are independent: a
// failure in one is returned but the others still run. Idempotent.
func (j *Janitor) RunOnce(ctx context.Context, withOrphans bool) (SweepReport, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	var rep SweepReport
	var firstErr error
	keep := func(err error) {
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	n, err := j.repo.SweepExpiredRadioTracks(ctx)
	keep(err)
	rep.StationExpired = n

	if j.limits.MaxBytes > 0 || j.limits.MaxDays > 0 {
		cands, err := j.repo.ListRadioCacheCandidates(ctx)
		keep(err)
		if err == nil {
			ev := SelectEvictions(cands, j.limits, j.now())
			for start := 0; start < len(ev.IDs); start += purgeBatch {
				end := min(start+purgeBatch, len(ev.IDs))
				n, err := j.repo.TrashRadioTracks(ctx, ev.IDs[start:end])
				keep(err)
				rep.CapEvicted += n
			}
		}
	}

	keep(j.purge(ctx, &rep))
	if withOrphans {
		keep(j.sweepOrphans(ctx, &rep))
	}
	return rep, firstErr
}

// purge deletes the S3 object of every trashed radio track, then hard-deletes
// the rows whose object delete succeeded. A failed object delete keeps the
// row so the next pass retries (DeleteObject is idempotent).
func (j *Janitor) purge(ctx context.Context, rep *SweepReport) error {
	failed := map[string]bool{}
	for ctx.Err() == nil {
		// Failed rows stay trashed and sort first, so widen the page by them.
		limit := purgeBatch + len(failed)
		batch, err := j.repo.ListTrashedRadioTracks(ctx, limit)
		if err != nil {
			return err
		}
		var ids []string
		var bytes int64
		for _, t := range batch {
			if failed[t.ID] {
				continue
			}
			if t.BlobKey != "" && j.store != nil {
				if err := j.store.Delete(ctx, t.BlobKey); err != nil {
					failed[t.ID] = true
					rep.PurgeFailures++
					slog.Warn("radio: purge object delete failed", "key", t.BlobKey, "err", err)
					continue
				}
			}
			ids = append(ids, t.ID)
			bytes += t.Size
		}
		if len(ids) == 0 {
			return nil // nothing left, or only failures remain
		}
		n, err := j.repo.DeleteRadioTrackRows(ctx, ids)
		if err != nil {
			return err
		}
		rep.Purged += n
		rep.PurgedBytes += bytes
		if len(batch) < limit {
			return nil // that was the last page
		}
	}
	return ctx.Err()
}

// sweepOrphans deletes music/radio/ objects that no track row references and
// that are older than orphanGrace. No-op when the store can't list.
func (j *Janitor) sweepOrphans(ctx context.Context, rep *SweepReport) error {
	lister, ok := j.store.(ObjectLister)
	if !ok {
		return nil
	}
	cutoff := j.now().Add(-orphanGrace)
	type obj struct {
		key  string
		size int64
	}
	var pending []obj
	flush := func() error {
		if len(pending) == 0 {
			return nil
		}
		keys := make([]string, len(pending))
		for i, o := range pending {
			keys[i] = o.key
		}
		exists, err := j.repo.RadioBlobKeysExist(ctx, keys)
		if err != nil {
			return err
		}
		for _, o := range pending {
			if exists[o.key] {
				continue
			}
			if err := j.store.Delete(ctx, o.key); err != nil {
				slog.Warn("radio: orphan delete failed", "key", o.key, "err", err)
				continue
			}
			rep.Orphans++
			rep.OrphanBytes += o.size
		}
		pending = pending[:0]
		return nil
	}
	err := lister.ListObjects(ctx, blobPrefix, func(key string, size int64, modified time.Time) error {
		if !strings.HasPrefix(key, blobPrefix) || modified.After(cutoff) {
			return nil
		}
		pending = append(pending, obj{key, size})
		if len(pending) >= orphanBatch {
			return flush()
		}
		return nil
	})
	if err != nil {
		return err
	}
	return flush()
}
