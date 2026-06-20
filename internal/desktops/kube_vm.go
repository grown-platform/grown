package desktops

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

// kube_vm.go adds the KubeVirt (Phase 3) surface to the thin Kubernetes client:
// create/get/delete VirtualMachine + VirtualMachineInstance via the
// kubevirt.io/v1 (and cdi.kubevirt.io for DataVolumes) REST APIs. Same do()/
// delete() helpers and idempotency rules as the core/v1 methods in kube.go.

// VMParams describes a KubeVirt VirtualMachine to create.
type VMParams struct {
	Name         string
	Labels       map[string]string // also applied to the VMI/launcher pod (Service selector)
	OSImage      string            // containerDisk image (ephemeral) / CDI registry source (persistent)
	Persistent   bool
	DiskSize     string // persistent root size, e.g. "20Gi"
	StorageClass string
	CloudInit    string // cloud-init user-data
	CPU          string // cpu cores, e.g. "2"
	Memory       string // guest memory, e.g. "4Gi"
}

// CreateVirtualMachine creates a running KubeVirt VirtualMachine. A 409 (already
// exists) is treated as success.
func (k *KubeClient) CreateVirtualMachine(ctx context.Context, p VMParams) error {
	cores := 1
	if n, err := strconv.Atoi(p.CPU); err == nil && n > 0 {
		cores = n
	}

	// Root volume: persistent → a DataVolume imported from the image; ephemeral →
	// an inline containerDisk.
	volumes := []map[string]any{}
	body := map[string]any{
		"apiVersion": "kubevirt.io/v1",
		"kind":       "VirtualMachine",
		"metadata":   k.metadata(p.Name, p.Labels),
	}
	dvName := p.Name + "-root"
	if p.Persistent {
		pvcSpec := map[string]any{
			"accessModes": []string{"ReadWriteOnce"},
			"resources":   map[string]any{"requests": map[string]any{"storage": p.DiskSize}},
		}
		if p.StorageClass != "" {
			pvcSpec["storageClassName"] = p.StorageClass
		}
		body["spec"] = map[string]any{
			"running": true,
			"dataVolumeTemplates": []map[string]any{{
				"metadata": map[string]any{"name": dvName},
				"spec": map[string]any{
					"source": map[string]any{
						"registry": map[string]any{"url": "docker://" + p.OSImage},
					},
					"pvc": pvcSpec,
				},
			}},
		}
		volumes = append(volumes, map[string]any{
			"name": "root", "dataVolume": map[string]any{"name": dvName},
		})
	} else {
		body["spec"] = map[string]any{"running": true}
		volumes = append(volumes, map[string]any{
			"name": "root", "containerDisk": map[string]any{"image": p.OSImage},
		})
	}
	volumes = append(volumes, map[string]any{
		"name":             "cloudinit",
		"cloudInitNoCloud": map[string]any{"userData": p.CloudInit},
	})

	template := map[string]any{
		"metadata": map[string]any{"labels": p.Labels}, // propagated to the launcher pod
		"spec": map[string]any{
			"domain": map[string]any{
				"cpu":       map[string]any{"cores": cores},
				"resources": map[string]any{"requests": map[string]any{"memory": p.Memory}},
				"devices": map[string]any{
					"disks": []map[string]any{
						{"name": "root", "disk": map[string]any{"bus": "virtio"}},
						{"name": "cloudinit", "disk": map[string]any{"bus": "virtio"}},
					},
					"interfaces": []map[string]any{
						{"name": "default", "masquerade": map[string]any{}},
					},
				},
			},
			"networks": []map[string]any{{"name": "default", "pod": map[string]any{}}},
			"volumes":  volumes,
		},
	}
	spec := body["spec"].(map[string]any)
	spec["template"] = template

	path := fmt.Sprintf("/apis/kubevirt.io/v1/namespaces/%s/virtualmachines", k.namespace)
	status, _, err := k.do(ctx, http.MethodPost, path, body)
	if err != nil {
		return fmt.Errorf("desktops.CreateVirtualMachine: %w", err)
	}
	if status == http.StatusCreated || status == http.StatusOK || status == http.StatusConflict {
		return nil
	}
	return fmt.Errorf("desktops.CreateVirtualMachine: unexpected status %d", status)
}

// GetVMIPhase returns the VirtualMachineInstance's status.phase and its first
// reported guest IP. A 404 (not started yet) returns ("", "", nil) so callers
// can poll for readiness.
func (k *KubeClient) GetVMIPhase(ctx context.Context, name string) (phase, ip string, err error) {
	path := fmt.Sprintf("/apis/kubevirt.io/v1/namespaces/%s/virtualmachineinstances/%s", k.namespace, name)
	status, body, err := k.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return "", "", fmt.Errorf("desktops.GetVMIPhase: %w", err)
	}
	if status == http.StatusNotFound {
		return "", "", nil
	}
	if status != http.StatusOK {
		return "", "", fmt.Errorf("desktops.GetVMIPhase: unexpected status %d", status)
	}
	var vmi struct {
		Status struct {
			Phase      string `json:"phase"`
			Interfaces []struct {
				IPAddress string `json:"ipAddress"`
			} `json:"interfaces"`
		} `json:"status"`
	}
	if err := json.Unmarshal(body, &vmi); err != nil {
		return "", "", fmt.Errorf("desktops.GetVMIPhase: decode: %w", err)
	}
	if len(vmi.Status.Interfaces) > 0 {
		ip = vmi.Status.Interfaces[0].IPAddress
	}
	return vmi.Status.Phase, ip, nil
}

// DeleteVirtualMachine removes the named VirtualMachine (cascading to its VMI).
// The DataVolume/PVC is retained for persistent flavors. 404 → success.
func (k *KubeClient) DeleteVirtualMachine(ctx context.Context, name string) error {
	path := fmt.Sprintf("/apis/kubevirt.io/v1/namespaces/%s/virtualmachines/%s", k.namespace, name)
	return k.delete(ctx, "DeleteVirtualMachine", path)
}
