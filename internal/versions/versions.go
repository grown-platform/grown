// Package versions is the version history for documents whose whole model is
// one stored JSON blob: Sheets workbooks, Slides decks and Whiteboard scenes
// (Docs has its own, see internal/docs). A version is an immutable copy of that
// blob; see migration 0095 for the table.
//
// Manager holds the policy (auto-snapshot throttling, de-duplication,
// retention, restore-as-new-version) over a Store; PGStore is the Postgres
// Store and Handler is the JSON HTTP API. Access control belongs to the
// document: Handler asks the app's Kind to resolve the document for the caller
// before touching any version.
package versions

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ErrNotFound is returned when no version matches (within the object).
var ErrNotFound = errors.New("version not found")

// ErrTooManyNamed is returned when naming another version would exceed
// Policy.MaxNamed.
var ErrTooManyNamed = errors.New("too many named versions")

// ErrTooLarge is returned when a document is bigger than Policy.MaxBytes.
var ErrTooLarge = errors.New("document too large to version")

// ErrForbidden is returned by a Kind's Save when the caller may not write the
// restored content (e.g. it changes cells protected against them).
var ErrForbidden = errors.New("the version changes content you cannot edit")

// Version is one grown.object_versions row. Data is only filled by Get.
type Version struct {
	ID           string
	ObjectType   string
	ObjectID     string
	AuthorID     string
	AuthorName   string
	Label        string
	Data         string
	DataHash     string
	SizeBytes    int
	IsAuto       bool
	RestoredFrom string
	CreatedAt    time.Time
}

// Store persists versions. List and Latest return metadata only (no Data).
type Store interface {
	Insert(ctx context.Context, v Version) (Version, error)
	Latest(ctx context.Context, objectType, objectID string) (Version, bool, error)
	List(ctx context.Context, objectType, objectID string) ([]Version, error)
	Get(ctx context.Context, objectType, objectID, versionID string) (Version, error)
	SetLabel(ctx context.Context, objectType, objectID, versionID, label string, isAuto bool) (Version, error)
	CountNamed(ctx context.Context, objectType, objectID string) (int, error)
	// PruneAuto deletes the object's auto snapshots beyond the newest keep.
	PruneAuto(ctx context.Context, objectType, objectID string, keep int) error
}

// Policy tunes snapshotting and retention.
type Policy struct {
	// AutoInterval is the minimum gap between two auto snapshots taken on save.
	AutoInterval time.Duration
	// SessionGap is the minimum gap for the snapshot taken when an editing
	// session ends (usually much shorter than AutoInterval).
	SessionGap time.Duration
	// MaxAuto is how many auto snapshots are kept per document.
	MaxAuto int
	// MaxNamed caps named versions per document.
	MaxNamed int
	// MaxBytes skips (auto) or refuses (named) documents larger than this.
	MaxBytes int
	// MaxLabel caps a label's length in bytes.
	MaxLabel int
}

// DefaultPolicy: at most one save snapshot per 10 minutes, one per session end
// per minute, 100 auto snapshots and 200 named versions kept, 25 MiB per blob.
var DefaultPolicy = Policy{
	AutoInterval: 10 * time.Minute,
	SessionGap:   time.Minute,
	MaxAuto:      100,
	MaxNamed:     200,
	MaxBytes:     25 << 20,
	MaxLabel:     200,
}

// Manager applies Policy over a Store.
type Manager struct {
	store  Store
	policy Policy
	now    func() time.Time

	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

// NewManager constructs a Manager. A zero Policy means DefaultPolicy.
func NewManager(store Store, policy Policy) *Manager {
	if policy == (Policy{}) {
		policy = DefaultPolicy
	}
	return &Manager{store: store, policy: policy, now: time.Now, locks: map[string]*sync.Mutex{}}
}

// Policy returns the manager's policy.
func (m *Manager) Policy() Policy { return m.policy }

// lock serializes snapshot decisions per object so two concurrent saves can't
// both pass the throttle.
func (m *Manager) lock(objectType, objectID string) func() {
	key := objectType + "/" + objectID
	m.mu.Lock()
	l, ok := m.locks[key]
	if !ok {
		l = &sync.Mutex{}
		m.locks[key] = l
	}
	m.mu.Unlock()
	l.Lock()
	return l.Unlock
}

// Hash is the data_hash of a blob.
func Hash(data string) string {
	s := sha256.Sum256([]byte(data))
	return hex.EncodeToString(s[:])
}

func (m *Manager) insert(ctx context.Context, v Version) (Version, error) {
	v.DataHash = Hash(v.Data)
	v.SizeBytes = len(v.Data)
	out, err := m.store.Insert(ctx, v)
	if err != nil {
		return Version{}, err
	}
	if v.IsAuto && m.policy.MaxAuto > 0 {
		if err := m.store.PruneAuto(ctx, v.ObjectType, v.ObjectID, m.policy.MaxAuto); err != nil {
			return out, fmt.Errorf("prune: %w", err)
		}
	}
	return out, nil
}

// snapshotIfDue inserts an auto snapshot of data unless it is empty, too
// large, identical to the latest version, or the latest version is younger
// than gap. Reports whether a version was created.
func (m *Manager) snapshotIfDue(ctx context.Context, objectType, objectID, authorID, data string, gap time.Duration) (bool, error) {
	if data == "" || (m.policy.MaxBytes > 0 && len(data) > m.policy.MaxBytes) {
		return false, nil
	}
	unlock := m.lock(objectType, objectID)
	defer unlock()
	latest, ok, err := m.store.Latest(ctx, objectType, objectID)
	if err != nil {
		return false, err
	}
	if ok {
		if latest.DataHash == Hash(data) {
			return false, nil
		}
		if m.now().Sub(latest.CreatedAt) < gap {
			return false, nil
		}
	}
	if _, err := m.insert(ctx, Version{
		ObjectType: objectType, ObjectID: objectID, AuthorID: authorID,
		Data: data, IsAuto: true,
	}); err != nil {
		return false, err
	}
	return true, nil
}

// AutoSnapshot is called after a document save. It snapshots at most once per
// Policy.AutoInterval per document, and never twice for the same content.
func (m *Manager) AutoSnapshot(ctx context.Context, objectType, objectID, authorID, data string) (bool, error) {
	return m.snapshotIfDue(ctx, objectType, objectID, authorID, data, m.policy.AutoInterval)
}

// Due reports whether an AutoSnapshot now could create a version, judged on
// time alone. It lets callers skip loading a large document on most saves.
func (m *Manager) Due(ctx context.Context, objectType, objectID string) (bool, error) {
	latest, ok, err := m.store.Latest(ctx, objectType, objectID)
	if err != nil || !ok {
		return err == nil, err
	}
	return m.now().Sub(latest.CreatedAt) >= m.policy.AutoInterval, nil
}

// SessionEnd snapshots the final state of an editing session (throttled by the
// shorter Policy.SessionGap), so the last edits before everyone leaves are
// kept even inside an AutoInterval window.
func (m *Manager) SessionEnd(ctx context.Context, objectType, objectID, authorID, data string) (bool, error) {
	return m.snapshotIfDue(ctx, objectType, objectID, authorID, data, m.policy.SessionGap)
}

func (m *Manager) cleanLabel(label string) string {
	if m.policy.MaxLabel > 0 && len(label) > m.policy.MaxLabel {
		label = label[:m.policy.MaxLabel]
	}
	return label
}

// NameCurrent records data as a named version. When the latest version already
// holds exactly this content it is labelled in place (an auto snapshot is
// promoted) instead of storing a duplicate.
func (m *Manager) NameCurrent(ctx context.Context, objectType, objectID, authorID, label, data string) (Version, error) {
	label = m.cleanLabel(label)
	if label == "" {
		return Version{}, errors.New("label required")
	}
	if m.policy.MaxBytes > 0 && len(data) > m.policy.MaxBytes {
		return Version{}, ErrTooLarge
	}
	unlock := m.lock(objectType, objectID)
	defer unlock()
	if m.policy.MaxNamed > 0 {
		n, err := m.store.CountNamed(ctx, objectType, objectID)
		if err != nil {
			return Version{}, err
		}
		if n >= m.policy.MaxNamed {
			return Version{}, ErrTooManyNamed
		}
	}
	latest, ok, err := m.store.Latest(ctx, objectType, objectID)
	if err != nil {
		return Version{}, err
	}
	if ok && latest.DataHash == Hash(data) && latest.Label == "" {
		return m.store.SetLabel(ctx, objectType, objectID, latest.ID, label, false)
	}
	return m.insert(ctx, Version{
		ObjectType: objectType, ObjectID: objectID, AuthorID: authorID,
		Label: label, Data: data,
	})
}

// Rename relabels a version. An empty label turns a named version back into an
// unnamed one (it stays a non-auto version, so it is never pruned).
func (m *Manager) Rename(ctx context.Context, objectType, objectID, versionID, label string) (Version, error) {
	v, err := m.store.Get(ctx, objectType, objectID, versionID)
	if err != nil {
		return Version{}, err
	}
	label = m.cleanLabel(label)
	if label != "" && v.Label == "" && m.policy.MaxNamed > 0 {
		n, err := m.store.CountNamed(ctx, objectType, objectID)
		if err != nil {
			return Version{}, err
		}
		if n >= m.policy.MaxNamed {
			return Version{}, ErrTooManyNamed
		}
	}
	// Naming an auto snapshot keeps it: it stops being prunable.
	return m.store.SetLabel(ctx, objectType, objectID, versionID, label, v.IsAuto && label == "")
}

// Restore puts version versionID back as the document's content. It first
// snapshots current (so the state being replaced stays in history), calls
// apply with the old content to write it to the live document, then appends a
// new version recording the restore. Nothing is deleted or rewritten.
func (m *Manager) Restore(ctx context.Context, objectType, objectID, authorID, versionID, current string, apply func(data string) error) (Version, error) {
	src, err := m.store.Get(ctx, objectType, objectID, versionID)
	if err != nil {
		return Version{}, err
	}
	// Keep what is about to be overwritten (ignores the throttle).
	if _, err := m.snapshotIfDue(ctx, objectType, objectID, authorID, current, 0); err != nil {
		return Version{}, fmt.Errorf("snapshot current: %w", err)
	}
	if err := apply(src.Data); err != nil {
		return Version{}, fmt.Errorf("apply: %w", err)
	}
	label := "Restored " + src.CreatedAt.UTC().Format("Jan 2, 2006 3:04 PM") + " UTC"
	if src.Label != "" {
		label = "Restored “" + src.Label + "”"
	}
	unlock := m.lock(objectType, objectID)
	defer unlock()
	v, err := m.insert(ctx, Version{
		ObjectType: objectType, ObjectID: objectID, AuthorID: authorID,
		Label: m.cleanLabel(label), Data: src.Data, RestoredFrom: src.ID,
	})
	if err != nil {
		return Version{}, err
	}
	v.Data = src.Data
	return v, nil
}

// List returns the object's versions newest first (metadata only).
func (m *Manager) List(ctx context.Context, objectType, objectID string) ([]Version, error) {
	return m.store.List(ctx, objectType, objectID)
}

// Get returns one version with its data.
func (m *Manager) Get(ctx context.Context, objectType, objectID, versionID string) (Version, error) {
	return m.store.Get(ctx, objectType, objectID, versionID)
}
