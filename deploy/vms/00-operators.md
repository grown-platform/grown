# Phase 3 prerequisite — install KubeVirt + CDI (your gitops step)

VMs require two upstream operators on the cluster. They are large, separately
versioned operator bundles — **install them via gitops** (pin the versions),
grown does not install them. **Node hardware virtualization (KVM) is required.**

## KubeVirt (provides VirtualMachine / VirtualMachineInstance)

```sh
VER=v1.2.0   # pin a current release
kubectl apply -f https://github.com/kubevirt/kubevirt/releases/download/$VER/kubevirt-operator.yaml
kubectl apply -f https://github.com/kubevirt/kubevirt/releases/download/$VER/kubevirt-cr.yaml
# On clusters without bare-metal KVM (e.g. nested), enable software emulation:
#   kubectl -n kubevirt patch kubevirt kubevirt --type merge \
#     -p '{"spec":{"configuration":{"developerConfiguration":{"useEmulation":true}}}}'
kubectl -n kubevirt wait kv kubevirt --for condition=Available --timeout=10m
```

## CDI (Containerized Data Importer — provides DataVolume for persistent roots)

```sh
CDIVER=v1.58.0
kubectl apply -f https://github.com/kubevirt/containerized-data-importer/releases/download/$CDIVER/cdi-operator.yaml
kubectl apply -f https://github.com/kubevirt/containerized-data-importer/releases/download/$CDIVER/cdi-cr.yaml
```

## Then

- Apply `deploy/vms/10-rbac.yaml` (grown's SA gains kubevirt/cdi verbs in
  `grown-desktops`).
- Set `GROWN_DESKTOP_VMS_ENABLED=true` on the grown deployment (plus the Phase 2
  desktops env). VM flavors then appear in the Access-page Desktops picker.
- Confirm the per-flavor image + guest VNC/SSH setup (`20-templates.md`).

## Feasibility note

KubeVirt needs KVM on the nodes. On the amd64 homelab this is bare-metal KVM; on
a Raspberry-Pi cluster it needs arm64 KVM support (or emulation, which is slow).
Validate node virtualization before enabling.
