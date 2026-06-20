package desktops

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ── Injected dependencies (interfaces so the service is unit-testable) ────────

// store is the persistence the service needs (satisfied by *Repository).
type store interface {
	Create(ctx context.Context, s Session) (Session, error)
	GetForUser(ctx context.Context, userID, id string) (Session, error)
	Get(ctx context.Context, id string) (Session, error)
	ListByUser(ctx context.Context, userID string) ([]Session, error)
	CountActiveByUser(ctx context.Context, userID string) (int, error)
	SetRunning(ctx context.Context, id, podName, pvcName, guacConnID, openURL string) error
	SetState(ctx context.Context, id, state, detail string) error
	Touch(ctx context.Context, id string) error
	ListIdle(ctx context.Context, cutoff time.Time) ([]Session, error)
}

// orchestrator is the Kubernetes surface (satisfied by *KubeClient). The VM*
// methods (Phase 3 / KubeVirt) are only exercised for vm flavors.
type orchestrator interface {
	EnsurePVC(ctx context.Context, p PVCParams) error
	CreatePod(ctx context.Context, p PodParams) error
	CreateService(ctx context.Context, s ServiceParams) error
	GetPodPhase(ctx context.Context, name string) (phase, podIP string, err error)
	DeletePod(ctx context.Context, name string) error
	DeleteService(ctx context.Context, name string) error
	CreateVirtualMachine(ctx context.Context, p VMParams) error
	GetVMIPhase(ctx context.Context, name string) (phase, ip string, err error)
	DeleteVirtualMachine(ctx context.Context, name string) error
}

// gateway is the Guacamole surface (satisfied by *GuacClient).
type gateway interface {
	CreateConnection(ctx context.Context, spec ConnSpec) (string, error)
	GrantConnectionToUser(ctx context.Context, connID, username string) error
	DeleteConnection(ctx context.Context, connID string) error
}

// ── Config + service ─────────────────────────────────────────────────────────

// Config is the desktops runtime configuration. When Enabled is false the whole
// subsystem is inert (handler 404s, no Access section).
type Config struct {
	Enabled         bool
	VMsEnabled      bool          // expose KubeVirt VM flavors (Phase 3)
	Namespace       string        // grown-desktops
	StorageClass    string        // PVC storage class (persistent mode)
	IdleTTL         time.Duration // reap sessions idle longer than this
	MaxPerUser      int           // per-user live-session cap
	GuacOpenBaseURL string        // e.g. https://guac.pick.haus (deep-link base)
}

// User is the launching caller.
type User struct {
	ID    string
	OrgID string
	Email string
}

// Service ties the store, orchestrator and gateway together.
type Service struct {
	cfg   Config
	store store
	kube  orchestrator
	guac  gateway
	// now is injectable for tests; defaults to time.Now.
	now func() time.Time
}

// NewService constructs the service. Any of kube/guac may be nil only when
// cfg.Enabled is false (the handler guards on Enabled before provisioning).
func NewService(cfg Config, st store, kube orchestrator, guac gateway) *Service {
	if cfg.Namespace == "" {
		cfg.Namespace = "grown-desktops"
	}
	if cfg.IdleTTL <= 0 {
		cfg.IdleTTL = 30 * time.Minute
	}
	if cfg.MaxPerUser <= 0 {
		cfg.MaxPerUser = 2
	}
	return &Service{cfg: cfg, store: st, kube: kube, guac: guac, now: time.Now}
}

// Enabled reports whether the subsystem is active.
func (s *Service) Enabled() bool { return s != nil && s.cfg.Enabled }

// ListFlavors returns the launchable catalog — VM flavors are filtered out
// unless VMs are enabled (KubeVirt installed).
func (s *Service) ListFlavors() []Flavor {
	all := Flavors()
	if s.cfg.VMsEnabled {
		return all
	}
	out := make([]Flavor, 0, len(all))
	for _, f := range all {
		if !f.IsVM() {
			out = append(out, f)
		}
	}
	return out
}

// ListSessions returns the user's live sessions.
func (s *Service) ListSessions(ctx context.Context, u User) ([]Session, error) {
	return s.store.ListByUser(ctx, u.ID)
}

// Touch refreshes a session's idle heartbeat (caller must own it).
func (s *Service) Touch(ctx context.Context, u User, id string) error {
	if _, err := s.store.GetForUser(ctx, u.ID, id); err != nil {
		return err
	}
	return s.store.Touch(ctx, id)
}

var (
	// ErrDisabled is returned when desktops are not enabled on this instance.
	ErrDisabled = errors.New("desktops are not enabled on this instance")
	// ErrAtCapacity is returned when the user is at their live-session cap.
	ErrAtCapacity = errors.New("you have reached your desktop session limit")
	// ErrBadRequest is returned for an unknown flavor / invalid mode.
	ErrBadRequest = errors.New("invalid desktop request")
)

// Launch creates a session row and provisions the desktop asynchronously,
// returning the (starting) session immediately. The UI polls ListSessions for
// the state transition to "running" (with open_url) or "error".
func (s *Service) Launch(ctx context.Context, u User, flavorID, mode string) (Session, error) {
	if !s.cfg.Enabled {
		return Session{}, ErrDisabled
	}
	flavor, ok := FlavorByID(flavorID)
	if !ok {
		return Session{}, fmt.Errorf("%w: unknown flavor %q", ErrBadRequest, flavorID)
	}
	if flavor.IsVM() && !s.cfg.VMsEnabled {
		return Session{}, fmt.Errorf("%w: VMs are not enabled on this instance", ErrBadRequest)
	}
	if mode != "ephemeral" && mode != "persistent" {
		return Session{}, fmt.Errorf("%w: mode must be ephemeral|persistent", ErrBadRequest)
	}
	if mode == "persistent" && flavor.PersistentPath == "" {
		mode = "ephemeral" // this flavor has no persistent home; degrade gracefully
	}
	n, err := s.store.CountActiveByUser(ctx, u.ID)
	if err != nil {
		return Session{}, err
	}
	if n >= s.cfg.MaxPerUser {
		return Session{}, ErrAtCapacity
	}
	sess, err := s.store.Create(ctx, Session{
		OrgID: u.OrgID, UserID: u.ID, Flavor: flavor.ID, Mode: mode, State: "starting",
	})
	if err != nil {
		return Session{}, err
	}
	// Provision out of band; the request returns the "starting" row immediately.
	go s.provision(context.WithoutCancel(ctx), sess, flavor, u)
	return sess, nil
}

// Stop tears a session down (caller must own it). Persistent PVCs are kept.
func (s *Service) Stop(ctx context.Context, u User, id string) error {
	sess, err := s.store.GetForUser(ctx, u.ID, id)
	if err != nil {
		return err
	}
	s.teardown(ctx, sess)
	return s.store.SetState(ctx, id, "stopped", "")
}

// guacUsername maps a grown user to the Guacamole account the OIDC extension
// creates — the email local-part, matching the Phase 1 username convention.
func guacUsername(email string) string {
	if i := strings.IndexByte(email, '@'); i > 0 {
		return email[:i]
	}
	return email
}

// shortID returns the first 8 hex chars of a UUID (dashes stripped) for naming.
func shortID(id string) string {
	id = strings.ReplaceAll(id, "-", "")
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

// randomPassword returns a short random hex secret for VNC/SSH auth.
func randomPassword() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
