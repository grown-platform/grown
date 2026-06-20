package desktops

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreateVirtualMachine_Ephemeral(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/namespaces/grown-desktops/virtualmachines") {
			_ = json.NewDecoder(r.Body).Decode(&body)
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{}`))
			return
		}
		t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	k := newKubeClient(srv.URL, "tok", "grown-desktops", srv.Client())
	if err := k.CreateVirtualMachine(context.Background(), VMParams{
		Name: "vm1", OSImage: "quay.io/x/ubuntu:22.04", Persistent: false,
		CPU: "2", Memory: "4Gi", CloudInit: "#cloud-config",
	}); err != nil {
		t.Fatalf("CreateVirtualMachine: %v", err)
	}
	if body["kind"] != "VirtualMachine" || body["apiVersion"] != "kubevirt.io/v1" {
		t.Fatalf("kind/apiVersion wrong: %v / %v", body["kind"], body["apiVersion"])
	}
	spec := body["spec"].(map[string]any)
	if spec["running"] != true {
		t.Errorf("running != true")
	}
	if _, hasDV := spec["dataVolumeTemplates"]; hasDV {
		t.Errorf("ephemeral VM must not have dataVolumeTemplates")
	}
	// volumes include a containerDisk root + cloudinit
	vols := spec["template"].(map[string]any)["spec"].(map[string]any)["volumes"].([]any)
	if len(vols) != 2 {
		t.Fatalf("volumes=%d want 2", len(vols))
	}
	if _, ok := vols[0].(map[string]any)["containerDisk"]; !ok {
		t.Errorf("ephemeral root must be a containerDisk")
	}
}

func TestCreateVirtualMachine_PersistentUsesDataVolume(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	k := newKubeClient(srv.URL, "tok", "grown-desktops", srv.Client())
	if err := k.CreateVirtualMachine(context.Background(), VMParams{
		Name: "vm1", OSImage: "quay.io/x/ubuntu:22.04", Persistent: true,
		DiskSize: "20Gi", StorageClass: "ceph-block", CPU: "1", Memory: "2Gi",
	}); err != nil {
		t.Fatalf("CreateVirtualMachine: %v", err)
	}
	spec := body["spec"].(map[string]any)
	dvs, ok := spec["dataVolumeTemplates"].([]any)
	if !ok || len(dvs) != 1 {
		t.Fatalf("persistent VM must have one dataVolumeTemplate, got %v", spec["dataVolumeTemplates"])
	}
}

func TestGetVMIPhase(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/virtualmachineinstances/vm1") {
			_, _ = w.Write([]byte(`{"status":{"phase":"Running","interfaces":[{"ipAddress":"10.1.2.3"}]}}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	k := newKubeClient(srv.URL, "tok", "grown-desktops", srv.Client())
	phase, ip, err := k.GetVMIPhase(context.Background(), "vm1")
	if err != nil || phase != "Running" || ip != "10.1.2.3" {
		t.Fatalf("phase=%q ip=%q err=%v want Running/10.1.2.3/nil", phase, ip, err)
	}
	// 404 → empty, no error
	phase, _, err = k.GetVMIPhase(context.Background(), "missing")
	if err != nil || phase != "" {
		t.Fatalf("404 should be empty/no-error, got phase=%q err=%v", phase, err)
	}
}

func TestDeleteVirtualMachine(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/virtualmachines/gone") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	k := newKubeClient(srv.URL, "tok", "grown-desktops", srv.Client())
	if err := k.DeleteVirtualMachine(context.Background(), "vm1"); err != nil {
		t.Errorf("delete: %v", err)
	}
	if err := k.DeleteVirtualMachine(context.Background(), "gone"); err != nil {
		t.Errorf("404 delete should succeed: %v", err)
	}
}
