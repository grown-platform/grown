package desktops

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// ── in-memory fakes ──────────────────────────────────────────────────────────

type memStore struct {
	mu       sync.Mutex
	seq      int
	sessions map[string]Session
	active   int // value returned by CountActiveByUser
}

func newMemStore() *memStore { return &memStore{sessions: map[string]Session{}} }

func (f *memStore) Create(_ context.Context, s Session) (Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seq++
	s.ID = "sess-" + string(rune('a'+f.seq))
	if s.State == "" {
		s.State = "starting"
	}
	f.sessions[s.ID] = s
	return s, nil
}
func (f *memStore) GetForUser(_ context.Context, userID, id string) (Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if s, ok := f.sessions[id]; ok && s.UserID == userID {
		return s, nil
	}
	return Session{}, ErrNotFound
}
func (f *memStore) Get(_ context.Context, id string) (Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if s, ok := f.sessions[id]; ok {
		return s, nil
	}
	return Session{}, ErrNotFound
}
func (f *memStore) ListByUser(_ context.Context, userID string) ([]Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []Session
	for _, s := range f.sessions {
		if s.UserID == userID && s.State != "stopped" {
			out = append(out, s)
		}
	}
	return out, nil
}
func (f *memStore) CountActiveByUser(context.Context, string) (int, error) {
	return f.active, nil
}
func (f *memStore) SetRunning(_ context.Context, id, pod, pvc, conn, url string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := f.sessions[id]
	s.PodName, s.PVCName, s.GuacConnID, s.OpenURL, s.State = pod, pvc, conn, url, "running"
	f.sessions[id] = s
	return nil
}
func (f *memStore) SetState(_ context.Context, id, state, detail string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := f.sessions[id]
	s.State, s.Detail = state, detail
	f.sessions[id] = s
	return nil
}
func (f *memStore) Touch(context.Context, string) error { return nil }
func (f *memStore) ListIdle(context.Context, time.Time) ([]Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []Session
	for _, s := range f.sessions {
		if s.State == "running" || s.State == "starting" {
			out = append(out, s)
		}
	}
	return out, nil
}

type memKube struct {
	pods, svcs           map[string]bool
	pvcs                 map[string]bool
	vms                  map[string]bool
	phase                string
	createConnErr        error // unused here; for symmetry
	failCreatePod        bool
	deletedPods, deleted []string
}

func newMemKube() *memKube {
	return &memKube{pods: map[string]bool{}, svcs: map[string]bool{}, pvcs: map[string]bool{}, vms: map[string]bool{}, phase: "Running"}
}
func (k *memKube) CreateVirtualMachine(_ context.Context, p VMParams) error {
	k.vms[p.Name] = true
	return nil
}
func (k *memKube) GetVMIPhase(context.Context, string) (string, string, error) {
	return k.phase, "10.0.0.2", nil
}
func (k *memKube) DeleteVirtualMachine(_ context.Context, n string) error {
	delete(k.vms, n)
	return nil
}
func (k *memKube) EnsurePVC(_ context.Context, p PVCParams) error { k.pvcs[p.Name] = true; return nil }
func (k *memKube) CreatePod(_ context.Context, p PodParams) error {
	if k.failCreatePod {
		return errors.New("boom")
	}
	k.pods[p.Name] = true
	return nil
}
func (k *memKube) CreateService(_ context.Context, s ServiceParams) error {
	k.svcs[s.Name] = true
	return nil
}
func (k *memKube) GetPodPhase(context.Context, string) (string, string, error) {
	return k.phase, "10.0.0.1", nil
}
func (k *memKube) DeletePod(_ context.Context, n string) error {
	delete(k.pods, n)
	k.deletedPods = append(k.deletedPods, n)
	return nil
}
func (k *memKube) DeleteService(_ context.Context, n string) error { delete(k.svcs, n); return nil }

type memGuac struct {
	conns     map[string]bool
	createErr error
	granted   []string
	deleted   []string
}

func newMemGuac() *memGuac { return &memGuac{conns: map[string]bool{}} }
func (g *memGuac) CreateConnection(context.Context, ConnSpec) (string, error) {
	if g.createErr != nil {
		return "", g.createErr
	}
	g.conns["C1"] = true
	return "C1", nil
}
func (g *memGuac) GrantConnectionToUser(_ context.Context, id, user string) error {
	g.granted = append(g.granted, id+":"+user)
	return nil
}
func (g *memGuac) DeleteConnection(_ context.Context, id string) error {
	delete(g.conns, id)
	g.deleted = append(g.deleted, id)
	return nil
}

func testSvc(t *testing.T) (*Service, *memStore, *memKube, *memGuac) {
	t.Helper()
	st, k, g := newMemStore(), newMemKube(), newMemGuac()
	s := NewService(Config{
		Enabled: true, Namespace: "grown-desktops", StorageClass: "ceph-block",
		IdleTTL: 30 * time.Minute, MaxPerUser: 2, GuacOpenBaseURL: "https://guac.example",
	}, st, k, g)
	return s, st, k, g
}

// ── tests ────────────────────────────────────────────────────────────────────

func TestProvision_HappyPath_SSH(t *testing.T) {
	s, st, k, g := testSvc(t)
	flavor, _ := FlavorByID("terminal")
	sess, _ := st.Create(context.Background(), Session{UserID: "u1", OrgID: "o1", Flavor: flavor.ID, Mode: "ephemeral"})

	s.provision(context.Background(), sess, flavor, User{ID: "u1", OrgID: "o1", Email: "alice@x.com"})

	got, _ := st.Get(context.Background(), sess.ID)
	if got.State != "running" {
		t.Fatalf("state=%q detail=%q want running", got.State, got.Detail)
	}
	if got.GuacConnID != "C1" || got.OpenURL != "https://guac.example" {
		t.Errorf("conn=%q url=%q", got.GuacConnID, got.OpenURL)
	}
	if len(g.granted) != 1 || g.granted[0] != "C1:alice" {
		t.Errorf("grants=%v want [C1:alice]", g.granted)
	}
	if len(k.pods) != 1 || len(k.svcs) != 1 {
		t.Errorf("pods=%d svcs=%d want 1/1", len(k.pods), len(k.svcs))
	}
}

func TestProvision_Persistent_EnsuresPVC(t *testing.T) {
	s, st, k, _ := testSvc(t)
	flavor, _ := FlavorByID("linux-desktop") // has PersistentPath
	sess, _ := st.Create(context.Background(), Session{UserID: "u1", OrgID: "o1", Flavor: flavor.ID, Mode: "persistent"})

	s.provision(context.Background(), sess, flavor, User{ID: "user1234", OrgID: "o1", Email: "bob@x.com"})

	if len(k.pvcs) != 1 {
		t.Fatalf("pvcs=%d want 1", len(k.pvcs))
	}
	if got, _ := st.Get(context.Background(), sess.ID); got.PVCName == "" || got.State != "running" {
		t.Errorf("pvc=%q state=%q", got.PVCName, got.State)
	}
}

func TestProvision_GuacFailure_CleansUp(t *testing.T) {
	s, st, k, g := testSvc(t)
	g.createErr = errors.New("guac down")
	flavor, _ := FlavorByID("browser")
	sess, _ := st.Create(context.Background(), Session{UserID: "u1", OrgID: "o1", Flavor: flavor.ID, Mode: "ephemeral"})

	s.provision(context.Background(), sess, flavor, User{ID: "u1", Email: "c@x.com"})

	got, _ := st.Get(context.Background(), sess.ID)
	if got.State != "error" {
		t.Fatalf("state=%q want error", got.State)
	}
	if len(k.pods) != 0 || len(k.svcs) != 0 {
		t.Errorf("partial pod/svc not cleaned: pods=%d svcs=%d", len(k.pods), len(k.svcs))
	}
}

func TestLaunch_RejectsAtCapacity(t *testing.T) {
	s, st, _, _ := testSvc(t)
	st.active = 2 // == MaxPerUser
	_, err := s.Launch(context.Background(), User{ID: "u1", OrgID: "o1", Email: "a@x.com"}, "terminal", "ephemeral")
	if !errors.Is(err, ErrAtCapacity) {
		t.Fatalf("err=%v want ErrAtCapacity", err)
	}
}

func TestLaunch_UnknownFlavor(t *testing.T) {
	s, _, _, _ := testSvc(t)
	_, err := s.Launch(context.Background(), User{ID: "u1", OrgID: "o1", Email: "a@x.com"}, "nope", "ephemeral")
	if !errors.Is(err, ErrBadRequest) {
		t.Fatalf("err=%v want ErrBadRequest", err)
	}
}

func TestProvision_VM(t *testing.T) {
	s, st, k, g := testSvc(t)
	s.cfg.VMsEnabled = true
	flavor, _ := FlavorByID("vm-ubuntu")
	sess, _ := st.Create(context.Background(), Session{UserID: "u1", OrgID: "o1", Flavor: flavor.ID, Mode: "ephemeral"})

	s.provision(context.Background(), sess, flavor, User{ID: "u1", Email: "a@x.com"})

	got, _ := st.Get(context.Background(), sess.ID)
	if got.State != "running" {
		t.Fatalf("state=%q detail=%q want running", got.State, got.Detail)
	}
	if len(k.vms) != 1 {
		t.Errorf("vms=%d want 1 (a VirtualMachine, not a Pod)", len(k.vms))
	}
	if len(k.pods) != 0 {
		t.Errorf("a VM flavor must not create a Pod (pods=%d)", len(k.pods))
	}
	if got.GuacConnID != "C1" || len(g.granted) != 1 {
		t.Errorf("conn=%q grants=%v", got.GuacConnID, g.granted)
	}
}

func TestListFlavors_VMFilter(t *testing.T) {
	s, _, _, _ := testSvc(t) // VMsEnabled false by default
	for _, f := range s.ListFlavors() {
		if f.IsVM() {
			t.Fatalf("VM flavor %q leaked while VMs disabled", f.ID)
		}
	}
	s.cfg.VMsEnabled = true
	hasVM := false
	for _, f := range s.ListFlavors() {
		if f.IsVM() {
			hasVM = true
		}
	}
	if !hasVM {
		t.Fatal("VM flavors missing while VMs enabled")
	}
}

func TestReap_StopsIdleSessions(t *testing.T) {
	s, st, _, g := testSvc(t)
	// a running session with a connection to tear down
	sess, _ := st.Create(context.Background(), Session{UserID: "u1", Flavor: "terminal", Mode: "ephemeral"})
	_ = st.SetRunning(context.Background(), sess.ID, "desk-x", "", "C1", "https://guac.example")

	n, err := s.Reap(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("reap n=%d err=%v want 1/nil", n, err)
	}
	got, _ := st.Get(context.Background(), sess.ID)
	if got.State != "stopped" {
		t.Errorf("state=%q want stopped", got.State)
	}
	if len(g.deleted) != 1 || g.deleted[0] != "C1" {
		t.Errorf("deleted conns=%v want [C1]", g.deleted)
	}
}
