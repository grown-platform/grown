package desktops

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

const testNS = "grown-desktops"

func TestEnsurePVC(t *testing.T) {
	var gotPath, gotMethod string
	var gotBody map[string]any

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotMethod = r.Method
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	k := newKubeClient(srv.URL, "tok", testNS, srv.Client())
	err := k.EnsurePVC(context.Background(), PVCParams{
		Name:         "home-alice",
		StorageClass: "fast",
		Size:         "10Gi",
		Labels:       map[string]string{"app": "desktop"},
	})
	if err != nil {
		t.Fatalf("EnsurePVC: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	wantPath := "/api/v1/namespaces/" + testNS + "/persistentvolumeclaims"
	if gotPath != wantPath {
		t.Errorf("path = %q, want %q", gotPath, wantPath)
	}

	meta, _ := gotBody["metadata"].(map[string]any)
	if meta["name"] != "home-alice" {
		t.Errorf("metadata.name = %v, want home-alice", meta["name"])
	}
	spec, _ := gotBody["spec"].(map[string]any)
	if spec["storageClassName"] != "fast" {
		t.Errorf("spec.storageClassName = %v, want fast", spec["storageClassName"])
	}
	res, _ := spec["resources"].(map[string]any)
	reqs, _ := res["requests"].(map[string]any)
	if reqs["storage"] != "10Gi" {
		t.Errorf("spec.resources.requests.storage = %v, want 10Gi", reqs["storage"])
	}
}

func TestEnsurePVC_Conflict(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
	}))
	defer srv.Close()

	k := newKubeClient(srv.URL, "tok", testNS, srv.Client())
	if err := k.EnsurePVC(context.Background(), PVCParams{Name: "x", Size: "1Gi"}); err != nil {
		t.Fatalf("EnsurePVC on 409 should be nil, got %v", err)
	}
}

func TestCreatePod(t *testing.T) {
	var gotPath string
	var gotBody map[string]any

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	k := newKubeClient(srv.URL, "tok", testNS, srv.Client())
	err := k.CreatePod(context.Background(), PodParams{
		Name:       "desk-alice",
		Labels:     map[string]string{"app": "desktop"},
		Image:      "ghcr.io/grown/desktop:latest",
		Ports:      []ContainerPort{{Name: "vnc", Port: 5901}},
		Env:        map[string]string{"USER": "alice"},
		CPURequest: "250m",
		CPULimit:   "1",
		MemRequest: "256Mi",
		MemLimit:   "1Gi",
		PVCName:    "home-alice",
		MountPath:  "/home/alice",
	})
	if err != nil {
		t.Fatalf("CreatePod: %v", err)
	}

	wantPath := "/api/v1/namespaces/" + testNS + "/pods"
	if gotPath != wantPath {
		t.Errorf("path = %q, want %q", gotPath, wantPath)
	}

	spec, _ := gotBody["spec"].(map[string]any)
	if spec["restartPolicy"] != "Never" {
		t.Errorf("spec.restartPolicy = %v, want Never", spec["restartPolicy"])
	}
	containers, _ := spec["containers"].([]any)
	if len(containers) != 1 {
		t.Fatalf("containers len = %d, want 1", len(containers))
	}
	c, _ := containers[0].(map[string]any)
	if c["image"] != "ghcr.io/grown/desktop:latest" {
		t.Errorf("container.image = %v", c["image"])
	}

	ports, _ := c["ports"].([]any)
	if len(ports) != 1 {
		t.Fatalf("ports len = %d, want 1", len(ports))
	}
	p0, _ := ports[0].(map[string]any)
	if p0["containerPort"] != float64(5901) {
		t.Errorf("containerPort = %v, want 5901", p0["containerPort"])
	}

	res, _ := c["resources"].(map[string]any)
	reqs, _ := res["requests"].(map[string]any)
	if reqs["cpu"] != "250m" || reqs["memory"] != "256Mi" {
		t.Errorf("resources.requests = %v", reqs)
	}
	lims, _ := res["limits"].(map[string]any)
	if lims["cpu"] != "1" || lims["memory"] != "1Gi" {
		t.Errorf("resources.limits = %v", lims)
	}

	// volumeMount on the container
	mounts, _ := c["volumeMounts"].([]any)
	if len(mounts) != 1 {
		t.Fatalf("volumeMounts len = %d, want 1", len(mounts))
	}
	m0, _ := mounts[0].(map[string]any)
	if m0["mountPath"] != "/home/alice" {
		t.Errorf("volumeMount.mountPath = %v", m0["mountPath"])
	}

	// volume on the pod spec
	vols, _ := spec["volumes"].([]any)
	if len(vols) != 1 {
		t.Fatalf("volumes len = %d, want 1", len(vols))
	}
	v0, _ := vols[0].(map[string]any)
	pvc, _ := v0["persistentVolumeClaim"].(map[string]any)
	if pvc["claimName"] != "home-alice" {
		t.Errorf("volume.persistentVolumeClaim.claimName = %v, want home-alice", pvc["claimName"])
	}
	if v0["name"] != m0["name"] {
		t.Errorf("volume name %v != volumeMount name %v", v0["name"], m0["name"])
	}
}

func TestCreateService(t *testing.T) {
	var gotPath string
	var gotBody map[string]any

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	k := newKubeClient(srv.URL, "tok", testNS, srv.Client())
	err := k.CreateService(context.Background(), ServiceParams{
		Name:       "desk-alice",
		Selector:   map[string]string{"app": "desktop", "user": "alice"},
		Port:       5901,
		TargetPort: 5901,
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}

	wantPath := "/api/v1/namespaces/" + testNS + "/services"
	if gotPath != wantPath {
		t.Errorf("path = %q, want %q", gotPath, wantPath)
	}

	spec, _ := gotBody["spec"].(map[string]any)
	if spec["type"] != "ClusterIP" {
		t.Errorf("spec.type = %v, want ClusterIP", spec["type"])
	}
	sel, _ := spec["selector"].(map[string]any)
	if sel["app"] != "desktop" || sel["user"] != "alice" {
		t.Errorf("spec.selector = %v", sel)
	}
	ports, _ := spec["ports"].([]any)
	if len(ports) != 1 {
		t.Fatalf("ports len = %d, want 1", len(ports))
	}
	p0, _ := ports[0].(map[string]any)
	if p0["port"] != float64(5901) || p0["targetPort"] != float64(5901) {
		t.Errorf("port = %v", p0)
	}
}

func TestGetPodPhase(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %q, want GET", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":{"phase":"Running","podIP":"10.1.2.3"}}`))
	}))
	defer srv.Close()

	k := newKubeClient(srv.URL, "tok", testNS, srv.Client())
	phase, ip, err := k.GetPodPhase(context.Background(), "desk-alice")
	if err != nil {
		t.Fatalf("GetPodPhase: %v", err)
	}
	if phase != "Running" {
		t.Errorf("phase = %q, want Running", phase)
	}
	if ip != "10.1.2.3" {
		t.Errorf("podIP = %q, want 10.1.2.3", ip)
	}
}

func TestGetPodPhase_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	k := newKubeClient(srv.URL, "tok", testNS, srv.Client())
	phase, ip, err := k.GetPodPhase(context.Background(), "missing")
	if err != nil {
		t.Fatalf("GetPodPhase on 404 should be nil err, got %v", err)
	}
	if phase != "" || ip != "" {
		t.Errorf("GetPodPhase 404 = (%q, %q), want empty", phase, ip)
	}
}

func TestDeletePod(t *testing.T) {
	for _, code := range []int{http.StatusOK, http.StatusNotFound} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodDelete {
				t.Errorf("method = %q, want DELETE", r.Method)
			}
			w.WriteHeader(code)
		}))
		k := newKubeClient(srv.URL, "tok", testNS, srv.Client())
		if err := k.DeletePod(context.Background(), "desk-alice"); err != nil {
			t.Errorf("DeletePod (status %d): %v", code, err)
		}
		srv.Close()
	}
}

func TestDeleteService(t *testing.T) {
	for _, code := range []int{http.StatusOK, http.StatusNotFound} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodDelete {
				t.Errorf("method = %q, want DELETE", r.Method)
			}
			w.WriteHeader(code)
		}))
		k := newKubeClient(srv.URL, "tok", testNS, srv.Client())
		if err := k.DeleteService(context.Background(), "desk-alice"); err != nil {
			t.Errorf("DeleteService (status %d): %v", code, err)
		}
		srv.Close()
	}
}
