# VM flavor images + guest setup (confirmed at deploy time)

The VM flavors are defined in `internal/desktops/catalog.go`. grown builds each
VM from the flavor's `OSImage` (a containerDisk for ephemeral, or a CDI registry
source for persistent) and injects per-launch credentials via cloud-init
(`internal/desktops/provisioner.go:vmCloudInit`).

## What grown sets up

- A `VirtualMachine` (running) with the root disk + a `cloudInitNoCloud` disk.
- cloud-init creates a `user` account with a generated password and (for SSH
  flavors) enables password auth.
- A ClusterIP Service to the guest's VNC/SSH port; a Guacamole connection to it.

## What the image must provide (confirm per image)

- **VNC flavors** (`vm-ubuntu`): the guest must run a VNC server on the flavor's
  `Port` (5900) bound so the Service can reach it, using the cloud-init `user`
  password. The stock cloud image does **not** include a desktop/VNC server —
  either use a desktop-enabled cloud image, or extend `vmCloudInit` to install
  one on first boot (slow). Confirm the password mechanism (`.vnc/passwd`, PAM,
  etc.) for the chosen image.
- **SSH flavors** (`vm-fedora`): stock cloud images include sshd; cloud-init's
  password + `ssh_pwauth: true` is enough.

## Tunables

- Flavor images, ports, CPU/memory, and disk size live in `catalog.go`.
- `quay.io/containerdisks/*` provides ready containerDisk images; swap for your
  own registry/images as needed.
- Windows: add a flavor with a Windows DataVolume source + virtio drivers +
  in-guest RDP; the same provisioning path applies (out of scope for now).
