package radio

import (
	"context"
	"errors"
	"io"
	"reflect"
	"sort"
	"sync"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/music"
)

var t0 = time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

func cand(id string, size int64, ageDays int, saved bool) music.RadioCacheCandidate {
	return music.RadioCacheCandidate{ID: id, Size: size, CreatedAt: t0.AddDate(0, 0, -ageDays), Saved: saved}
}

func TestSelectEvictions_OldestFirstUntilUnderCap(t *testing.T) {
	// Deliberately unsorted input: the policy must order by recording time.
	cands := []music.RadioCacheCandidate{
		cand("new", 100, 1, false),
		cand("oldest", 100, 9, false),
		cand("mid", 100, 5, false),
		cand("older", 100, 7, false),
	}
	ev := SelectEvictions(cands, music.RadioCacheLimits{MaxBytes: 250}, t0)
	// total 400, cap 250 → must free ≥150 → the two oldest (200 bytes).
	if want := []string{"oldest", "older"}; !reflect.DeepEqual(ev.IDs, want) {
		t.Fatalf("IDs = %v, want %v", ev.IDs, want)
	}
	if ev.Bytes != 200 || ev.BySize != 2 || ev.ByAge != 0 {
		t.Fatalf("bad accounting: %+v", ev)
	}
}

func TestSelectEvictions_ExactlyAtCapEvictsNothing(t *testing.T) {
	cands := []music.RadioCacheCandidate{cand("a", 100, 3, false), cand("b", 150, 2, false)}
	if ev := SelectEvictions(cands, music.RadioCacheLimits{MaxBytes: 250}, t0); len(ev.IDs) != 0 {
		t.Fatalf("at cap should evict nothing, got %v", ev.IDs)
	}
	if ev := SelectEvictions(cands, music.RadioCacheLimits{MaxBytes: 249}, t0); !reflect.DeepEqual(ev.IDs, []string{"a"}) {
		t.Fatalf("one byte over should evict oldest, got %v", ev.IDs)
	}
}

func TestSelectEvictions_SavedProtectedButCounted(t *testing.T) {
	cands := []music.RadioCacheCandidate{
		cand("saved-oldest", 500, 10, true),
		cand("a", 100, 8, false),
		cand("b", 100, 6, false),
		cand("c", 100, 4, false),
	}
	// Saved bytes (500) alone exceed the cap: every unsaved track goes, the
	// saved one never does.
	ev := SelectEvictions(cands, music.RadioCacheLimits{MaxBytes: 300, MaxDays: 5}, t0)
	got := append([]string(nil), ev.IDs...)
	sort.Strings(got)
	if want := []string{"a", "b", "c"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("IDs = %v, want %v", got, want)
	}
	for _, id := range ev.IDs {
		if id == "saved-oldest" {
			t.Fatal("saved track selected for eviction")
		}
	}
}

func TestSelectEvictions_MaxDays(t *testing.T) {
	cands := []music.RadioCacheCandidate{
		cand("old", 10, 40, false),
		cand("old-saved", 10, 40, true),
		cand("fresh", 10, 2, false),
	}
	ev := SelectEvictions(cands, music.RadioCacheLimits{MaxDays: 30}, t0)
	if !reflect.DeepEqual(ev.IDs, []string{"old"}) || ev.ByAge != 1 {
		t.Fatalf("got %+v", ev)
	}
	// Age evictions reduce the total before the byte cap is applied.
	ev = SelectEvictions(cands, music.RadioCacheLimits{MaxDays: 30, MaxBytes: 20}, t0)
	if !reflect.DeepEqual(ev.IDs, []string{"old"}) || ev.BySize != 0 {
		t.Fatalf("age eviction should satisfy the cap, got %+v", ev)
	}
}

func TestSelectEvictions_Unlimited(t *testing.T) {
	cands := []music.RadioCacheCandidate{cand("a", 1<<40, 999, false)}
	if ev := SelectEvictions(cands, music.RadioCacheLimits{}, t0); len(ev.IDs) != 0 {
		t.Fatalf("zero limits must evict nothing, got %v", ev.IDs)
	}
}

func TestSelectEvictions_TieBreakByID(t *testing.T) {
	cands := []music.RadioCacheCandidate{cand("b", 10, 1, false), cand("a", 10, 1, false)}
	ev := SelectEvictions(cands, music.RadioCacheLimits{MaxBytes: 10}, t0)
	if !reflect.DeepEqual(ev.IDs, []string{"a"}) {
		t.Fatalf("got %v", ev.IDs)
	}
}

// --- janitor with in-memory fakes -----------------------------------------

type memTrack struct {
	id, key string
	size    int64
	created time.Time
	saved   bool
	trashed bool
}

// memRepo is an in-memory CacheRepo.
type memRepo struct {
	mu     sync.Mutex
	tracks map[string]*memTrack
	// stationExpired: ids the per-station sweep trashes.
	stationExpired []string
}

func (m *memRepo) SweepExpiredRadioTracks(context.Context) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, id := range m.stationExpired {
		if t := m.tracks[id]; t != nil && !t.trashed && !t.saved {
			t.trashed = true
			n++
		}
	}
	return n, nil
}

func (m *memRepo) ListRadioCacheCandidates(context.Context) ([]music.RadioCacheCandidate, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []music.RadioCacheCandidate
	for _, t := range m.tracks {
		if !t.trashed {
			out = append(out, music.RadioCacheCandidate{ID: t.id, Size: t.size, CreatedAt: t.created, Saved: t.saved})
		}
	}
	return out, nil
}

func (m *memRepo) TrashRadioTracks(_ context.Context, ids []string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, id := range ids {
		if t := m.tracks[id]; t != nil && !t.trashed && !t.saved {
			t.trashed = true
			n++
		}
	}
	return n, nil
}

func (m *memRepo) ListTrashedRadioTracks(_ context.Context, limit int) ([]music.TrashedRadioTrack, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []music.TrashedRadioTrack
	for _, t := range m.tracks {
		if t.trashed {
			out = append(out, music.TrashedRadioTrack{ID: t.id, BlobKey: t.key, Size: t.size})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *memRepo) DeleteRadioTrackRows(_ context.Context, ids []string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, id := range ids {
		if t := m.tracks[id]; t != nil && t.trashed {
			delete(m.tracks, id)
			n++
		}
	}
	return n, nil
}

func (m *memRepo) RadioBlobKeysExist(_ context.Context, keys []string) (map[string]bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]bool{}
	for _, t := range m.tracks {
		out[t.key] = true
	}
	res := map[string]bool{}
	for _, k := range keys {
		if out[k] {
			res[k] = true
		}
	}
	return res, nil
}

// memStore is an in-memory blob store that also lists (ObjectLister).
type memStore struct {
	mu      sync.Mutex
	objs    map[string]memObj
	failDel map[string]bool
}

type memObj struct {
	size int64
	mod  time.Time
}

func newMemStore() *memStore {
	return &memStore{objs: map[string]memObj{}, failDel: map[string]bool{}}
}

func (s *memStore) Put(_ context.Context, key, _ string, size int64, _ io.Reader) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.objs[key] = memObj{size: size, mod: t0}
	return nil
}

func (s *memStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failDel[key] {
		return errors.New("boom")
	}
	delete(s.objs, key)
	return nil
}

func (s *memStore) ListObjects(_ context.Context, prefix string, fn func(string, int64, time.Time) error) error {
	s.mu.Lock()
	var keys []string
	objs := map[string]memObj{}
	for k, o := range s.objs {
		keys = append(keys, k)
		objs[k] = o
	}
	s.mu.Unlock()
	sort.Strings(keys)
	for _, k := range keys {
		if len(k) >= len(prefix) && k[:len(prefix)] == prefix {
			if err := fn(k, objs[k].size, objs[k].mod); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *memStore) has(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.objs[key]
	return ok
}

// fixture builds n radio tracks "t00".."tNN", one day apart (t00 oldest),
// each 100 bytes with a stored object.
func fixture(n int) (*memRepo, *memStore) {
	repo := &memRepo{tracks: map[string]*memTrack{}}
	store := newMemStore()
	for i := 0; i < n; i++ {
		id := string(rune('a' + i))
		key := blobPrefix + id
		repo.tracks[id] = &memTrack{id: id, key: key, size: 100, created: t0.AddDate(0, 0, -(n - i))}
		_ = store.Put(context.Background(), key, "audio/mpeg", 100, nil)
	}
	return repo, store
}

func newTestJanitor(repo CacheRepo, store Store, l music.RadioCacheLimits) *Janitor {
	j := NewJanitor(repo, store, l, time.Hour)
	j.now = func() time.Time { return t0.Add(48 * time.Hour) }
	return j
}

func TestJanitor_CapEvictsAndDeletesObjectsAndRows(t *testing.T) {
	repo, store := fixture(6) // a..f, a oldest; 600 bytes
	repo.tracks["a"].saved = true
	j := newTestJanitor(repo, store, music.RadioCacheLimits{MaxBytes: 300})

	rep, err := j.RunOnce(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	// 600 > 300: need to free 300 → b, c, d (a is saved and protected).
	if rep.CapEvicted != 3 || rep.Purged != 3 || rep.PurgedBytes != 300 {
		t.Fatalf("report = %+v", rep)
	}
	for _, id := range []string{"b", "c", "d"} {
		if _, ok := repo.tracks[id]; ok {
			t.Errorf("row %s not deleted", id)
		}
		if store.has(blobPrefix + id) {
			t.Errorf("object %s not deleted", id)
		}
	}
	for _, id := range []string{"a", "e", "f"} {
		if _, ok := repo.tracks[id]; !ok || !store.has(blobPrefix+id) {
			t.Errorf("%s should be kept", id)
		}
	}

	// Idempotent: a second pass has nothing to do.
	rep, err = j.RunOnce(context.Background(), false)
	if err != nil || rep != (SweepReport{}) {
		t.Fatalf("second pass = %+v, %v", rep, err)
	}
}

func TestJanitor_FailedObjectDeleteKeepsRowForRetry(t *testing.T) {
	repo, store := fixture(3)
	for _, tr := range repo.tracks {
		tr.trashed = true // e.g. legacy trashed tracks with surviving objects
	}
	store.failDel[blobPrefix+"b"] = true
	j := newTestJanitor(repo, store, music.RadioCacheLimits{})

	rep, err := j.RunOnce(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Purged != 2 || rep.PurgeFailures != 1 {
		t.Fatalf("report = %+v", rep)
	}
	if _, ok := repo.tracks["b"]; !ok {
		t.Fatal("row b must survive a failed object delete")
	}
	delete(store.failDel, blobPrefix+"b")
	rep, _ = j.RunOnce(context.Background(), false)
	if rep.Purged != 1 || store.has(blobPrefix+"b") {
		t.Fatalf("retry did not purge b: %+v", rep)
	}
}

func TestJanitor_PurgePaginates(t *testing.T) {
	repo := &memRepo{tracks: map[string]*memTrack{}}
	store := newMemStore()
	const n = purgeBatch*2 + 17
	for i := 0; i < n; i++ {
		id := string(rune(0x4e00 + i)) // distinct, sortable ids
		key := blobPrefix + id
		repo.tracks[id] = &memTrack{id: id, key: key, size: 1, created: t0, trashed: true}
		_ = store.Put(context.Background(), key, "", 1, nil)
	}
	// One failing key must not stall pagination.
	store.failDel[blobPrefix+string(rune(0x4e00))] = true
	rep, err := newTestJanitor(repo, store, music.RadioCacheLimits{}).RunOnce(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Purged != n-1 || len(repo.tracks) != 1 {
		t.Fatalf("purged %d (want %d), %d rows left", rep.Purged, n-1, len(repo.tracks))
	}
}

func TestJanitor_StationRetentionIsPurged(t *testing.T) {
	repo, store := fixture(2)
	repo.stationExpired = []string{"a"}
	rep, err := newTestJanitor(repo, store, music.RadioCacheLimits{}).RunOnce(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if rep.StationExpired != 1 || rep.Purged != 1 || store.has(blobPrefix+"a") {
		t.Fatalf("report = %+v", rep)
	}
}

func TestJanitor_OrphanSweep(t *testing.T) {
	repo, store := fixture(1)
	_ = store.Put(context.Background(), blobPrefix+"orphan", "", 55, nil)
	_ = store.Put(context.Background(), "music/user-upload", "", 1, nil) // outside prefix
	store.objs[blobPrefix+"fresh-orphan"] = memObj{size: 1, mod: t0.Add(48 * time.Hour)}

	j := newTestJanitor(repo, store, music.RadioCacheLimits{})
	rep, err := j.RunOnce(context.Background(), false)
	if err != nil || rep.Orphans != 0 || !store.has(blobPrefix+"orphan") {
		t.Fatalf("light pass must not sweep orphans: %+v %v", rep, err)
	}
	rep, err = j.RunOnce(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Orphans != 1 || rep.OrphanBytes != 55 || store.has(blobPrefix+"orphan") {
		t.Fatalf("report = %+v", rep)
	}
	if !store.has(blobPrefix+"a") || !store.has("music/user-upload") || !store.has(blobPrefix+"fresh-orphan") {
		t.Fatal("referenced / non-radio / in-grace objects must be kept")
	}
}

func TestJanitor_KickRunsPass(t *testing.T) {
	repo, store := fixture(3)
	j := newTestJanitor(repo, store, music.RadioCacheLimits{MaxBytes: 100})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	j.Start(ctx)
	j.Kick()
	j.Kick() // coalesces, never blocks
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		repo.mu.Lock()
		n := len(repo.tracks)
		repo.mu.Unlock()
		if n == 1 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("kick did not trigger an eviction pass")
}
