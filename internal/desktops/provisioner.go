package desktops

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// provision launches one desktop: (persistent) ensure the PVC, create the pod +
// service, wait for Ready, register + grant a Guacamole connection, and flip the
// session to "running". Any failure cleans up partial resources and marks the
// session "error". Runs in its own goroutine (see Launch).
func (s *Service) provision(ctx context.Context, sess Session, flavor Flavor, u User) {
	if flavor.IsVM() {
		s.provisionVM(ctx, sess, flavor, u)
		return
	}
	base := "desk-" + shortID(sess.ID)

	pvcName := ""
	if sess.Mode == "persistent" && flavor.PersistentPath != "" {
		pvcName = "desk-" + shortID(u.ID) + "-" + flavor.ID
		if err := s.kube.EnsurePVC(ctx, PVCParams{
			Name: pvcName, StorageClass: s.cfg.StorageClass, Size: "10Gi",
			Labels: map[string]string{"grown-desktop-user": u.ID},
		}); err != nil {
			s.fail(ctx, sess.ID, base, "", "ensure pvc: "+err.Error())
			return
		}
	}

	password := randomPassword()
	env, params := connAuth(flavor, password)

	if err := s.kube.CreatePod(ctx, PodParams{
		Name:       base,
		Labels:     map[string]string{"grown-desktop-session": sess.ID, "app": base},
		Image:      flavor.Image,
		Ports:      []ContainerPort{{Name: "conn", Port: flavor.Port}},
		Env:        env,
		CPURequest: flavor.CPURequest, CPULimit: flavor.CPULimit,
		MemRequest: flavor.MemRequest, MemLimit: flavor.MemLimit,
		PVCName: pvcName, MountPath: flavor.PersistentPath,
	}); err != nil {
		s.fail(ctx, sess.ID, base, "", "create pod: "+err.Error())
		return
	}

	if err := s.kube.CreateService(ctx, ServiceParams{
		Name:     base,
		Selector: map[string]string{"grown-desktop-session": sess.ID},
		Port:     flavor.Port, TargetPort: flavor.Port,
	}); err != nil {
		s.fail(ctx, sess.ID, base, "", "create service: "+err.Error())
		return
	}

	if err := s.waitReady(ctx, base); err != nil {
		s.fail(ctx, sess.ID, base, "", err.Error())
		return
	}

	// guacd reaches the desktop via the stable Service DNS name.
	host := base + "." + s.cfg.Namespace + ".svc.cluster.local"
	connID, err := s.guac.CreateConnection(ctx, ConnSpec{
		Name: base, Protocol: string(flavor.Protocol), Host: host, Port: flavor.Port,
		Parameters: params,
	})
	if err != nil {
		s.fail(ctx, sess.ID, base, "", "guac connection: "+err.Error())
		return
	}
	if err := s.guac.GrantConnectionToUser(ctx, connID, guacUsername(u.Email)); err != nil {
		s.fail(ctx, sess.ID, base, connID, "guac grant: "+err.Error())
		return
	}

	// open_url points at the gateway home; the granted connection appears there.
	// (A deep-link straight to the connection is a Phase 2 follow-up.)
	if err := s.store.SetRunning(ctx, sess.ID, base, pvcName, connID, s.cfg.GuacOpenBaseURL); err != nil {
		slog.WarnContext(ctx, "desktops: SetRunning failed (pod is up)", "session", sess.ID, "err", err)
	}
}

// waitReady polls the pod until it reports Running, fails, or the deadline hits.
func (s *Service) waitReady(ctx context.Context, podName string) error {
	deadline := s.now().Add(2 * time.Minute)
	for s.now().Before(deadline) {
		phase, _, err := s.kube.GetPodPhase(ctx, podName)
		if err != nil {
			return fmt.Errorf("pod status: %w", err)
		}
		switch phase {
		case "Running":
			return nil
		case "Failed":
			return errors.New("pod failed to start")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return errors.New("pod did not become ready in time")
}

// fail cleans up partial resources and records the error on the session.
func (s *Service) fail(ctx context.Context, id, base, connID, detail string) {
	s.cleanup(ctx, base, connID, s.isVMSession(ctx, id))
	if err := s.store.SetState(ctx, id, "error", detail); err != nil {
		slog.WarnContext(ctx, "desktops: SetState(error) failed", "session", id, "err", err)
	}
}

// teardown removes a running session's workload/service/connection (a persistent
// PVC / DataVolume is kept).
func (s *Service) teardown(ctx context.Context, sess Session) {
	isVM := false
	if f, ok := FlavorByID(sess.Flavor); ok {
		isVM = f.IsVM()
	}
	s.cleanup(ctx, sess.PodName, sess.GuacConnID, isVM)
}

// isVMSession reports whether a session's flavor is VM-backed (used by fail()).
func (s *Service) isVMSession(ctx context.Context, id string) bool {
	sess, err := s.store.Get(ctx, id)
	if err != nil {
		return false
	}
	f, ok := FlavorByID(sess.Flavor)
	return ok && f.IsVM()
}

// cleanup best-effort removes the connection (if any) and the workload + service
// named base. Idempotent: the underlying clients treat 404 as success.
func (s *Service) cleanup(ctx context.Context, base, connID string, isVM bool) {
	if connID != "" {
		_ = s.guac.DeleteConnection(ctx, connID)
	}
	if base != "" {
		if isVM {
			_ = s.kube.DeleteVirtualMachine(ctx, base)
		} else {
			_ = s.kube.DeletePod(ctx, base)
		}
		_ = s.kube.DeleteService(ctx, base)
	}
}

// connAuth returns the container env and the Guacamole connection parameters for
// a flavor, wiring a generated password. The env KEY NAMES are image-specific
// (linuxserver/Kasm differ) and are confirmed against the chosen images at deploy
// time; we set the common conventions.
func connAuth(f Flavor, password string) (env, params map[string]string) {
	switch f.Protocol {
	case ProtoSSH:
		// linuxserver/openssh-server conventions.
		return map[string]string{
				"PUID": "1000", "PGID": "1000",
				"USER_NAME": "user", "USER_PASSWORD": password,
				"PASSWORD_ACCESS": "true", "SUDO_ACCESS": "false",
			}, map[string]string{
				"username": "user", "password": password,
			}
	default: // VNC
		return map[string]string{
				"PUID": "1000", "PGID": "1000",
				"PASSWORD": password, "VNC_PW": password,
			}, map[string]string{
				"password": password,
			}
	}
}

// provisionVM is the KubeVirt (Phase 3) counterpart of provision: create a
// VirtualMachine, wait for the VMI to run, then the same Service + Guacamole
// connection flow. Cleanup-on-failure deletes the VM (the DataVolume is kept for
// persistent flavors).
func (s *Service) provisionVM(ctx context.Context, sess Session, flavor Flavor, u User) {
	base := "desk-" + shortID(sess.ID)
	password := randomPassword()

	if err := s.kube.CreateVirtualMachine(ctx, VMParams{
		Name:         base,
		Labels:       map[string]string{"grown-desktop-session": sess.ID, "app": base},
		OSImage:      flavor.OSImage,
		Persistent:   sess.Mode == "persistent",
		DiskSize:     flavor.DiskSize,
		StorageClass: s.cfg.StorageClass,
		CloudInit:    vmCloudInit(flavor, password),
		CPU:          flavor.CPULimit,
		Memory:       flavor.MemLimit,
	}); err != nil {
		s.fail(ctx, sess.ID, base, "", "create vm: "+err.Error())
		return
	}

	if err := s.kube.CreateService(ctx, ServiceParams{
		Name:     base,
		Selector: map[string]string{"grown-desktop-session": sess.ID},
		Port:     flavor.Port, TargetPort: flavor.Port,
	}); err != nil {
		s.fail(ctx, sess.ID, base, "", "create service: "+err.Error())
		return
	}

	if err := s.waitVMIReady(ctx, base); err != nil {
		s.fail(ctx, sess.ID, base, "", err.Error())
		return
	}

	host := base + "." + s.cfg.Namespace + ".svc.cluster.local"
	_, params := connAuth(flavor, password)
	connID, err := s.guac.CreateConnection(ctx, ConnSpec{
		Name: base, Protocol: string(flavor.Protocol), Host: host, Port: flavor.Port,
		Parameters: params,
	})
	if err != nil {
		s.fail(ctx, sess.ID, base, "", "guac connection: "+err.Error())
		return
	}
	if err := s.guac.GrantConnectionToUser(ctx, connID, guacUsername(u.Email)); err != nil {
		s.fail(ctx, sess.ID, base, connID, "guac grant: "+err.Error())
		return
	}

	pvc := "" // persistent VMs keep a DataVolume named <base>-root
	if sess.Mode == "persistent" {
		pvc = base + "-root"
	}
	if err := s.store.SetRunning(ctx, sess.ID, base, pvc, connID, s.cfg.GuacOpenBaseURL); err != nil {
		slog.WarnContext(ctx, "desktops: SetRunning failed (vm up)", "session", sess.ID, "err", err)
	}
}

// waitVMIReady polls the VirtualMachineInstance until it is Running (VMs boot
// slower than pods, so a longer deadline).
func (s *Service) waitVMIReady(ctx context.Context, name string) error {
	deadline := s.now().Add(4 * time.Minute)
	for s.now().Before(deadline) {
		phase, _, err := s.kube.GetVMIPhase(ctx, name)
		if err != nil {
			return fmt.Errorf("vmi status: %w", err)
		}
		switch phase {
		case "Running":
			return nil
		case "Failed":
			return errors.New("vm failed to start")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
	return errors.New("vm did not become ready in time")
}

// vmCloudInit builds cloud-init user-data that wires the generated credentials
// into the guest. The guest image is expected to provide the VNC/SSH server; the
// exact VNC-password mechanism is image-specific and confirmed at deploy time.
func vmCloudInit(f Flavor, password string) string {
	const user = "user"
	switch f.Protocol {
	case ProtoSSH:
		return "#cloud-config\n" +
			"users:\n" +
			"  - name: " + user + "\n" +
			"    sudo: ALL=(ALL) NOPASSWD:ALL\n" +
			"    lock_passwd: false\n" +
			"ssh_pwauth: true\n" +
			"chpasswd:\n  expire: false\n  list: |\n    " + user + ":" + password + "\n"
	default: // VNC
		return "#cloud-config\n" +
			"users:\n" +
			"  - name: " + user + "\n" +
			"    lock_passwd: false\n" +
			"chpasswd:\n  expire: false\n  list: |\n    " + user + ":" + password + "\n"
	}
}
