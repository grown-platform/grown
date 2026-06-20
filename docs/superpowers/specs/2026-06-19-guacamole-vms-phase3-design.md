# Guacamole VMs — Phase 3 Design (KubeVirt virtual machines)

**Status:** approved 2026-06-19. Phase 3 of the Guacamole effort.
**Depends on Phase 1** (gateway) **and reuses Phase 2** (`internal/desktops`).
**Hard prerequisite:** the **KubeVirt + CDI operators** must be installed on the
cluster (node KVM virtualization). They are NOT present today — installing them
is a significant, hardware-gated cluster change (see _Prerequisite_).

**Goal:** Let a member launch a real **virtual machine** (any OS) from the same
Access-page Desktops UI, connected over VNC/SSH through Guacamole. A VM is modeled
as just another desktop **flavor** whose backing is a KubeVirt `VirtualMachine`
instead of a Pod — so it reuses Phase 2's session/service/reaper/Guacamole flow.

## Decisions (locked)

- **VM flavors:** `vm-ubuntu` (Ubuntu 22.04 cloud image, VNC desktop) and
  `vm-fedora` (Fedora cloud image, SSH). Windows is supported by the same
  machinery — add a flavor with a Windows DataVolume later; out of scope now.
- **Modes (both):** ephemeral (a `containerDisk` ephemeral root) and persistent
  (a CDI `DataVolume`/PVC root that survives stop/relaunch).
- **Connection:** the guest runs a VNC or SSH server (enabled via cloud-init); a
  ClusterIP Service fronts the VMI's port; grown registers a Guacamole connection
  to it — identical to Phase 2's pod connection flow.
- **Gating:** `GROWN_DESKTOP_VMS_ENABLED=true`. When off (or KubeVirt absent), VM
  flavors are filtered out of the catalog and the rest of the suite is unaffected.

## Prerequisite — KubeVirt + CDI (your step)

Phase 3 cannot run until the cluster has:
- **KubeVirt** operator (`kubevirt.io`) — provides `VirtualMachine` /
  `VirtualMachineInstance` CRDs; requires **hardware virtualization on nodes**
  (bare-metal KVM, or nested virt). On a Pi cluster this needs arm64 KVM support;
  on the amd64 homelab, bare-metal KVM.
- **CDI** (Containerized Data Importer, `cdi.kubevirt.io`) — provides
  `DataVolume` for importing cloud images into PVCs.

Both install via their own released operator manifests (pinned versions) in the
gitops repo. grown does not install them.

## Architecture (delta from Phase 2)

```
Desktops UI ──launch(vm-*, mode)──> /api/v1/desktops  (same handler/service)
                                       │  flavor.Kind == "vm"
                                       ▼
                              kube REST (SA token)
                              create VirtualMachine (+ DataVolume if persistent)
                              + Service to the VMI's VNC/SSH port
                                       │
                                       ▼
                              KubeVirt VMI ──guacd── Guacamole ──> browser
```

The session model, reaper, Guacamole client, and UI are **unchanged** — a VM
flavor flows through the same `Service.Launch` → `provision` path, which branches
on `flavor.Kind`.

## Code changes (extend `internal/desktops`)

1. **`catalog.go`** — add a `Kind` field to `Flavor` (`"pod"` default, `"vm"` for
   VMs) plus the VM-specific fields: `OSImage` (containerDisk image or CDI source
   URL), `CloudInit` (user-data that enables the VNC/SSH server + a login user),
   `DiskSize`. Add the two VM flavors. `Flavors()` stays the full list;
   filtering by enablement happens in the service.
2. **`kube.go`** — add KubeVirt REST methods (same in-cluster client, new
   apiGroups):
   - `CreateVirtualMachine(ctx, VMParams)` → POST
     `/apis/kubevirt.io/v1/namespaces/{ns}/virtualmachines` (running:true), with
     an inline `containerDisk` or a `dataVolumeTemplate` (CDI) for the root, the
     cloud-init `cloudInitNoCloud` user-data, CPU/mem, and a label for the
     Service selector.
   - `GetVMIPhase(ctx, name)` → GET
     `/apis/kubevirt.io/v1/namespaces/{ns}/virtualmachineinstances/{name}` →
     `status.phase` (e.g. "Running") + the guest IP.
   - `DeleteVirtualMachine(ctx, name)` → DELETE the VirtualMachine (cascades to
     the VMI; the DataVolume/PVC is kept for persistent mode unless explicitly
     removed).
   All as hand-built JSON, 404 → success, mirroring the existing methods.
3. **`service.go` / `provisioner.go`** — in `provision`, branch on `flavor.Kind`:
   - `"pod"` → the existing Phase 2 path.
   - `"vm"` → `provisionVM`: (persistent) the DataVolume is part of the VM
     template; create the VirtualMachine, wait for the VMI `Running`, create the
     Service (selector on the VMI label, port = flavor VNC/SSH port), then the
     same Guacamole `CreateConnection` + grant + `SetRunning`. `teardown` for a VM
     deletes the VirtualMachine + Service + connection.
   - Add `VMsEnabled bool` to `Config`; `ListFlavors` filters out `Kind == "vm"`
     when false.
4. **`handler.go` / UI** — no change. VM flavors appear in the existing Desktops
   picker (the UI is flavor-driven). A small "VM" hint can be added to the
   flavor's display name.

## Cluster manifests — `deploy/vms/`

- `00-operators.md` — pinned install pointers for the KubeVirt + CDI operator
  releases (URLs + versions) to add to gitops. (Not vendored — they're large
  upstream operator bundles.)
- `10-rbac.yaml` — extend grown's `grown-desktops` Role with
  `kubevirt.io: virtualmachines, virtualmachineinstances` and
  `cdi.kubevirt.io: datavolumes` (get/list/watch/create/delete).
- `20-templates.md` — the cloud-init recipes per flavor (enable VNC/SSH, create
  the login user) and the cloud-image sources, confirmed at deploy time.

## Security

- VMs run in the same isolated `grown-desktops` namespace, under the same
  ResourceQuota / LimitRange / NetworkPolicy as Phase 2 (ingress from guacd only,
  egress to internet but not RFC1918).
- KubeVirt VMs are stronger isolation than containers (hardware boundary), which
  is desirable for "any OS / untrusted workload" desktops.
- grown's RBAC is still scoped to `grown-desktops` (now including the kubevirt/cdi
  resources there) — no cluster-wide power.
- Per-user cap + namespace quota bound cost; VMs are heavier, so the quota should
  account for VM memory/CPU.

## Testing

- **`catalog_test.go`** — VM flavors present with `Kind=="vm"`, required VM fields
  set; `ListFlavors` filtering by `VMsEnabled`.
- **`kube_test.go`** — KubeVirt methods against an httptest fake API server:
  CreateVirtualMachine body (running, disk/dataVolume, cloud-init, resources),
  GetVMIPhase parsing, DeleteVirtualMachine (+404).
- **`provisioner_test.go`** — `provision` with a `vm` flavor drives the VM path
  (CreateVirtualMachine + Service + guac connection) using the fakes; failure
  cleanup deletes the VM; reaper tears a VM session down.
- **Live (after KubeVirt is installed):** launch each VM flavor → boots → VNC/SSH
  opens in Guacamole; stop deletes the VM; persistent relaunch re-attaches the
  DataVolume.

## Out of scope (Phase 3)

- Installing/operating KubeVirt + CDI (operator-level, your gitops).
- Windows flavor + licensing, GPU passthrough, live migration, snapshots.
- VM templating UI / custom images in-app (catalog-defined only).
- Deep-linking straight to the connection (shared Phase 2 follow-up).

## Implementation order

1. `catalog.go` — `Kind` + VM fields + two VM flavors + `ListFlavors` filter (+test).
2. `kube.go` — KubeVirt CRD methods (+httptest test).
3. `service.go`/`provisioner.go` — `provisionVM` branch + `VMsEnabled` + teardown
   (+provisioner test with a vm flavor).
4. Wiring — `GROWN_DESKTOP_VMS_ENABLED` in main.go → `Config.VMsEnabled`.
5. `deploy/vms/` — RBAC extension + operator/template pointers.
6. Build/test green; live verification deferred to post-KubeVirt-install.
