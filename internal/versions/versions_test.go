package versions

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// memStore is an in-memory Store for the policy tests.
type memStore struct {
	mu   sync.Mutex
	rows []Version
	seq  int
	now  func() time.Time
}

func (s *memStore) Insert(_ context.Context, v Version) (Version, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	v.ID = fmt.Sprintf("00000000-0000-0000-0000-%012d", s.seq)
	v.CreatedAt = s.now()
	v.AuthorName = "user-" + v.AuthorID
	s.rows = append(s.rows, v)
	out := v
	out.Data = ""
	return out, nil
}

func (s *memStore) sorted(objectType, objectID string) []Version {
	var out []Version
	for _, v := range s.rows {
		if v.ObjectType == objectType && v.ObjectID == objectID {
			out = append(out, v)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID > out[j].ID
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out
}

func (s *memStore) Latest(_ context.Context, t, id string) (Version, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	l := s.sorted(t, id)
	if len(l) == 0 {
		return Version{}, false, nil
	}
	v := l[0]
	v.Data = ""
	return v, true, nil
}

func (s *memStore) List(_ context.Context, t, id string) ([]Version, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	l := s.sorted(t, id)
	for i := range l {
		l[i].Data = ""
	}
	return l, nil
}

func (s *memStore) Get(_ context.Context, t, id, vid string) (Version, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, v := range s.rows {
		if v.ObjectType == t && v.ObjectID == id && v.ID == vid {
			return v, nil
		}
	}
	return Version{}, ErrNotFound
}

func (s *memStore) SetLabel(_ context.Context, t, id, vid, label string, isAuto bool) (Version, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, v := range s.rows {
		if v.ObjectType == t && v.ObjectID == id && v.ID == vid {
			s.rows[i].Label, s.rows[i].IsAuto = label, isAuto
			out := s.rows[i]
			out.Data = ""
			return out, nil
		}
	}
	return Version{}, ErrNotFound
}

func (s *memStore) CountNamed(_ context.Context, t, id string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, v := range s.rows {
		if v.ObjectType == t && v.ObjectID == id && v.Label != "" {
			n++
		}
	}
	return n, nil
}

func (s *memStore) PruneAuto(_ context.Context, t, id string, keep int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	drop := map[string]bool{}
	kept := 0
	for _, v := range s.sorted(t, id) {
		if !v.IsAuto {
			continue
		}
		if kept < keep {
			kept++
			continue
		}
		drop[v.ID] = true
	}
	var rows []Version
	for _, v := range s.rows {
		if !drop[v.ID] {
			rows = append(rows, v)
		}
	}
	s.rows = rows
	return nil
}

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }
func newTestManager(p Policy) (*Manager, *memStore, *clock) {
	c := &clock{t: time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)}
	st := &memStore{now: c.now}
	m := NewManager(st, p)
	m.now = c.now
	return m, st, c
}

const sheet = "sheets"
const docID = "11111111-1111-1111-1111-111111111111"

func TestAutoSnapshotThrottle(t *testing.T) {
	m, st, c := newTestManager(DefaultPolicy)
	ctx := context.Background()
	must := func(want bool, data string) {
		t.Helper()
		got, err := m.AutoSnapshot(ctx, sheet, docID, "u1", data)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("AutoSnapshot(%q) at %s = %v, want %v", data, c.t.Format(time.Kitchen), got, want)
		}
	}
	must(true, `{"a":1}`)  // first save always snapshots
	c.advance(time.Minute) //
	must(false, `{"a":2}`) // inside the 10-minute window
	c.advance(9 * time.Minute)
	must(true, `{"a":3}`) // window elapsed
	c.advance(11 * time.Minute)
	must(false, `{"a":3}`) // identical content is never stored twice
	must(false, "")        // empty documents are skipped
	if n := len(st.rows); n != 2 {
		t.Fatalf("rows = %d, want 2", n)
	}
	due, err := m.Due(ctx, sheet, docID)
	if err != nil || !due {
		t.Fatalf("Due = %v, %v; want true", due, err)
	}
	// Another document has its own throttle.
	if ok, _ := m.AutoSnapshot(ctx, sheet, "22222222-2222-2222-2222-222222222222", "u1", `{}`); !ok {
		t.Fatal("other document throttled")
	}
	// ... and so does another kind with the same id.
	if ok, _ := m.AutoSnapshot(ctx, "slides", docID, "u1", `{"a":4}`); !ok {
		t.Fatal("other kind throttled")
	}
}

func TestSessionEndUsesShorterGap(t *testing.T) {
	m, _, c := newTestManager(DefaultPolicy)
	ctx := context.Background()
	if ok, _ := m.AutoSnapshot(ctx, sheet, docID, "u1", "v1"); !ok {
		t.Fatal("first snapshot")
	}
	c.advance(30 * time.Second)
	if ok, _ := m.SessionEnd(ctx, sheet, docID, "u1", "v2"); ok {
		t.Fatal("session end inside SessionGap should be skipped")
	}
	c.advance(time.Minute)
	if ok, _ := m.SessionEnd(ctx, sheet, docID, "u1", "v2"); !ok {
		t.Fatal("session end after SessionGap should snapshot (AutoInterval not elapsed)")
	}
	c.advance(time.Hour)
	if ok, _ := m.SessionEnd(ctx, sheet, docID, "u1", "v2"); ok {
		t.Fatal("unchanged content should not be snapshotted")
	}
}

func TestRetentionPrunesOnlyAuto(t *testing.T) {
	p := DefaultPolicy
	p.MaxAuto = 3
	m, st, c := newTestManager(p)
	ctx := context.Background()
	if _, err := m.NameCurrent(ctx, sheet, docID, "u1", "Keep me", "named"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 6; i++ {
		c.advance(11 * time.Minute)
		if _, err := m.AutoSnapshot(ctx, sheet, docID, "u1", fmt.Sprintf("auto-%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	list, _ := m.List(ctx, sheet, docID)
	if len(list) != 4 {
		t.Fatalf("versions = %d, want 3 auto + 1 named", len(list))
	}
	if list[len(list)-1].Label != "Keep me" {
		t.Fatalf("named version pruned: %+v", list)
	}
	// The newest three auto snapshots survive.
	got := []string{}
	for _, v := range st.sorted(sheet, docID) {
		if v.IsAuto {
			got = append(got, v.Data)
		}
	}
	if strings.Join(got, ",") != "auto-5,auto-4,auto-3" {
		t.Fatalf("kept %v", got)
	}

	// Named versions are capped.
	p.MaxNamed = 2
	m2, _, _ := newTestManager(p)
	for i := 0; i < 2; i++ {
		if _, err := m2.NameCurrent(ctx, sheet, docID, "u1", "n", fmt.Sprint(i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := m2.NameCurrent(ctx, sheet, docID, "u1", "n", "x"); err != ErrTooManyNamed {
		t.Fatalf("third named version: err = %v", err)
	}
	// Oversized blobs are refused (named) / skipped (auto).
	p.MaxBytes = 4
	m3, _, _ := newTestManager(p)
	if _, err := m3.NameCurrent(ctx, sheet, docID, "u1", "big", "12345"); err != ErrTooLarge {
		t.Fatalf("oversized named: err = %v", err)
	}
	if ok, err := m3.AutoSnapshot(ctx, sheet, docID, "u1", "12345"); ok || err != nil {
		t.Fatalf("oversized auto: %v %v", ok, err)
	}
}

func TestNameCurrentPromotesIdenticalAuto(t *testing.T) {
	m, st, _ := newTestManager(DefaultPolicy)
	ctx := context.Background()
	if _, err := m.AutoSnapshot(ctx, sheet, docID, "u1", "same"); err != nil {
		t.Fatal(err)
	}
	v, err := m.NameCurrent(ctx, sheet, docID, "u2", "Final", "same")
	if err != nil {
		t.Fatal(err)
	}
	if len(st.rows) != 1 || v.Label != "Final" || v.IsAuto {
		t.Fatalf("expected the auto snapshot to be promoted, rows=%d v=%+v", len(st.rows), v)
	}
	if _, err := m.NameCurrent(ctx, sheet, docID, "u2", "", "x"); err == nil {
		t.Fatal("empty label accepted")
	}
	// Different content → new row.
	if _, err := m.NameCurrent(ctx, sheet, docID, "u2", "Second", "other"); err != nil || len(st.rows) != 2 {
		t.Fatalf("second named: %v rows=%d", err, len(st.rows))
	}
}

func TestRenameAutoKeepsIt(t *testing.T) {
	p := DefaultPolicy
	p.MaxAuto = 1
	m, _, c := newTestManager(p)
	ctx := context.Background()
	m.AutoSnapshot(ctx, sheet, docID, "u1", "a")
	list, _ := m.List(ctx, sheet, docID)
	v, err := m.Rename(ctx, sheet, docID, list[0].ID, "Milestone")
	if err != nil || v.Label != "Milestone" || v.IsAuto {
		t.Fatalf("rename: %+v %v", v, err)
	}
	c.advance(time.Hour)
	m.AutoSnapshot(ctx, sheet, docID, "u1", "b")
	c.advance(time.Hour)
	m.AutoSnapshot(ctx, sheet, docID, "u1", "c")
	list, _ = m.List(ctx, sheet, docID)
	if len(list) != 2 || list[1].Label != "Milestone" {
		t.Fatalf("renamed version pruned: %+v", list)
	}
	if _, err := m.Rename(ctx, sheet, docID, "00000000-0000-0000-0000-999999999999", "x"); err != ErrNotFound {
		t.Fatalf("rename missing: %v", err)
	}
}

func TestRestoreAppendsAndKeepsCurrent(t *testing.T) {
	m, _, c := newTestManager(DefaultPolicy)
	ctx := context.Background()
	named, err := m.NameCurrent(ctx, sheet, docID, "u1", "Good", "good")
	if err != nil {
		t.Fatal(err)
	}
	c.advance(time.Minute)
	live := "bad" // edited since, inside the auto window: not yet snapshotted
	var applied string
	v, err := m.Restore(ctx, sheet, docID, "u2", named.ID, live, func(d string) error {
		applied = d
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if applied != "good" || v.Data != "good" || v.RestoredFrom != named.ID || !strings.Contains(v.Label, "Good") {
		t.Fatalf("restore: applied=%q v=%+v", applied, v)
	}
	list, _ := m.List(ctx, sheet, docID)
	// restore version, snapshot of "bad", the original named version
	if len(list) != 3 {
		t.Fatalf("versions = %d, want 3: %+v", len(list), list)
	}
	pre, _ := m.Get(ctx, sheet, docID, list[1].ID)
	if pre.Data != "bad" || !pre.IsAuto {
		t.Fatalf("state before restore not kept: %+v", pre)
	}
	orig, _ := m.Get(ctx, sheet, docID, named.ID)
	if orig.Data != "good" || orig.Label != "Good" {
		t.Fatalf("source version changed: %+v", orig)
	}

	// A failed apply records nothing new.
	n := len(list)
	if _, err := m.Restore(ctx, sheet, docID, "u2", named.ID, "good", func(string) error {
		return fmt.Errorf("boom")
	}); err == nil {
		t.Fatal("apply error swallowed")
	}
	list, _ = m.List(ctx, sheet, docID)
	if len(list) != n {
		t.Fatalf("failed restore added versions: %d → %d", n, len(list))
	}
	// Unknown version / other document.
	if _, err := m.Restore(ctx, sheet, "22222222-2222-2222-2222-222222222222", "u2", named.ID, "", func(string) error { return nil }); err != ErrNotFound {
		t.Fatalf("cross-document restore: %v", err)
	}
}

func TestConcurrentSavesSnapshotOnce(t *testing.T) {
	m, st, _ := newTestManager(DefaultPolicy)
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _ = m.AutoSnapshot(ctx, sheet, docID, "u1", fmt.Sprint(i))
		}(i)
	}
	wg.Wait()
	if len(st.rows) != 1 {
		t.Fatalf("concurrent saves created %d snapshots", len(st.rows))
	}
}
