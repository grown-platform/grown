// Package desktops provisions per-user "desktop" workloads on the in-cluster
// Kubernetes API. kube.go is a deliberately thin REST client over the mounted
// ServiceAccount credentials — standard library only, no client-go.
//
// It mirrors grown's other thin-HTTP-client conventions (see
// internal/forgejo/client.go): a small struct holding base URL, bearer token
// and an *http.Client; a single do() helper that returns (status, body, err)
// without treating non-2xx as a transport error so each method can implement
// its own idempotency rules (e.g. 409 already-exists → success).
package desktops

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Standard in-cluster ServiceAccount mount paths.
const (
	saTokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
	saCAPath    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
)

// KubeClient is a minimal Kubernetes core/v1 REST client scoped to a single
// namespace, authenticated with the mounted ServiceAccount bearer token.
type KubeClient struct {
	base       string // API server base, e.g. "https://10.0.0.1:443" — no trailing slash
	token      string // ServiceAccount bearer token
	namespace  string // namespace all objects are created in
	httpClient *http.Client
}

// NewInClusterKube builds a KubeClient from the mounted ServiceAccount. It
// reads the API server host/port from the KUBERNETES_SERVICE_HOST/PORT env
// vars, the bearer token and CA certificate from the standard mount paths, and
// configures a TLS transport that trusts the cluster CA. It returns an error if
// any of these are absent (i.e. the process is not running in-cluster).
func NewInClusterKube(namespace string) (*KubeClient, error) {
	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	port := os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" || port == "" {
		return nil, fmt.Errorf("desktops: not running in-cluster (KUBERNETES_SERVICE_HOST/PORT unset)")
	}
	tokenBytes, err := os.ReadFile(saTokenPath)
	if err != nil {
		return nil, fmt.Errorf("desktops: read serviceaccount token: %w", err)
	}
	token := strings.TrimSpace(string(tokenBytes))
	if token == "" {
		return nil, fmt.Errorf("desktops: empty serviceaccount token")
	}
	caBytes, err := os.ReadFile(saCAPath)
	if err != nil {
		return nil, fmt.Errorf("desktops: read serviceaccount CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caBytes) {
		return nil, fmt.Errorf("desktops: parse serviceaccount CA cert")
	}
	hc := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				RootCAs:    pool,
				MinVersion: tls.VersionTLS12,
			},
		},
	}
	base := fmt.Sprintf("https://%s:%s", host, port)
	return newKubeClient(base, token, namespace, hc), nil
}

// newKubeClient is the unexported constructor used by both NewInClusterKube and
// the tests (which point base at an httptest server and supply that server's
// client). It performs no I/O.
func newKubeClient(base, token, namespace string, hc *http.Client) *KubeClient {
	return &KubeClient{
		base:       strings.TrimRight(base, "/"),
		token:      token,
		namespace:  namespace,
		httpClient: hc,
	}
}

// PVCParams describes a PersistentVolumeClaim to ensure.
type PVCParams struct {
	Name, StorageClass, Size string
	Labels                   map[string]string
}

// EnsurePVC creates the PVC if it does not already exist. A 409 (already
// exists) from the API server is treated as success so the call is idempotent.
func (k *KubeClient) EnsurePVC(ctx context.Context, p PVCParams) error {
	spec := map[string]any{
		"accessModes": []string{"ReadWriteOnce"},
		"resources": map[string]any{
			"requests": map[string]any{
				"storage": p.Size,
			},
		},
	}
	if p.StorageClass != "" {
		spec["storageClassName"] = p.StorageClass
	}
	body := map[string]any{
		"apiVersion": "v1",
		"kind":       "PersistentVolumeClaim",
		"metadata":   k.metadata(p.Name, p.Labels),
		"spec":       spec,
	}
	path := fmt.Sprintf("/api/v1/namespaces/%s/persistentvolumeclaims", k.namespace)
	status, _, err := k.do(ctx, http.MethodPost, path, body)
	if err != nil {
		return fmt.Errorf("desktops.EnsurePVC: %w", err)
	}
	if status == http.StatusCreated || status == http.StatusOK || status == http.StatusConflict {
		return nil // 201/200 created, 409 already exists → success
	}
	return fmt.Errorf("desktops.EnsurePVC: unexpected status %d", status)
}

// ContainerPort is a named container port.
type ContainerPort struct {
	Name string
	Port int
}

// PodParams describes a single-container Pod to create.
type PodParams struct {
	Name                                       string
	Labels                                     map[string]string
	Image                                      string
	Ports                                      []ContainerPort
	Env                                        map[string]string
	CPURequest, CPULimit, MemRequest, MemLimit string
	PVCName                                    string // if set, mount it at MountPath
	MountPath                                  string
	RunAsNonRoot                               bool
}

// CreatePod creates a single-container Pod. A 409 (already exists) is treated
// as success so the call is idempotent.
func (k *KubeClient) CreatePod(ctx context.Context, p PodParams) error {
	container := map[string]any{
		"name":  p.Name,
		"image": p.Image,
	}

	if len(p.Ports) > 0 {
		ports := make([]map[string]any, 0, len(p.Ports))
		for _, cp := range p.Ports {
			port := map[string]any{"containerPort": cp.Port}
			if cp.Name != "" {
				port["name"] = cp.Name
			}
			ports = append(ports, port)
		}
		container["ports"] = ports
	}

	if len(p.Env) > 0 {
		env := make([]map[string]any, 0, len(p.Env))
		for name, val := range p.Env {
			env = append(env, map[string]any{"name": name, "value": val})
		}
		container["env"] = env
	}

	requests := map[string]any{}
	if p.CPURequest != "" {
		requests["cpu"] = p.CPURequest
	}
	if p.MemRequest != "" {
		requests["memory"] = p.MemRequest
	}
	limits := map[string]any{}
	if p.CPULimit != "" {
		limits["cpu"] = p.CPULimit
	}
	if p.MemLimit != "" {
		limits["memory"] = p.MemLimit
	}
	resources := map[string]any{}
	if len(requests) > 0 {
		resources["requests"] = requests
	}
	if len(limits) > 0 {
		resources["limits"] = limits
	}
	if len(resources) > 0 {
		container["resources"] = resources
	}

	if p.RunAsNonRoot {
		container["securityContext"] = map[string]any{
			"runAsNonRoot": true,
		}
	}

	spec := map[string]any{
		"restartPolicy": "Never",
	}

	if p.PVCName != "" {
		const volName = "data"
		container["volumeMounts"] = []map[string]any{
			{"name": volName, "mountPath": p.MountPath},
		}
		spec["volumes"] = []map[string]any{
			{
				"name": volName,
				"persistentVolumeClaim": map[string]any{
					"claimName": p.PVCName,
				},
			},
		}
	}

	spec["containers"] = []map[string]any{container}

	body := map[string]any{
		"apiVersion": "v1",
		"kind":       "Pod",
		"metadata":   k.metadata(p.Name, p.Labels),
		"spec":       spec,
	}
	path := fmt.Sprintf("/api/v1/namespaces/%s/pods", k.namespace)
	status, _, err := k.do(ctx, http.MethodPost, path, body)
	if err != nil {
		return fmt.Errorf("desktops.CreatePod: %w", err)
	}
	if status == http.StatusCreated || status == http.StatusOK || status == http.StatusConflict {
		return nil
	}
	return fmt.Errorf("desktops.CreatePod: unexpected status %d", status)
}

// ServiceParams describes a ClusterIP Service to create.
type ServiceParams struct {
	Name       string
	Selector   map[string]string
	Port       int
	TargetPort int
}

// CreateService creates a ClusterIP Service. A 409 (already exists) is treated
// as success.
func (k *KubeClient) CreateService(ctx context.Context, s ServiceParams) error {
	body := map[string]any{
		"apiVersion": "v1",
		"kind":       "Service",
		"metadata":   k.metadata(s.Name, nil),
		"spec": map[string]any{
			"type":     "ClusterIP",
			"selector": s.Selector,
			"ports": []map[string]any{
				{
					"port":       s.Port,
					"targetPort": s.TargetPort,
				},
			},
		},
	}
	path := fmt.Sprintf("/api/v1/namespaces/%s/services", k.namespace)
	status, _, err := k.do(ctx, http.MethodPost, path, body)
	if err != nil {
		return fmt.Errorf("desktops.CreateService: %w", err)
	}
	if status == http.StatusCreated || status == http.StatusOK || status == http.StatusConflict {
		return nil
	}
	return fmt.Errorf("desktops.CreateService: unexpected status %d", status)
}

// GetPodPhase returns the pod's status.phase and status.podIP. A 404 (the pod
// does not exist yet) returns ("", "", nil) so callers can poll for readiness
// without special-casing the error.
func (k *KubeClient) GetPodPhase(ctx context.Context, name string) (phase, podIP string, err error) {
	path := fmt.Sprintf("/api/v1/namespaces/%s/pods/%s", k.namespace, name)
	status, body, err := k.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return "", "", fmt.Errorf("desktops.GetPodPhase: %w", err)
	}
	if status == http.StatusNotFound {
		return "", "", nil
	}
	if status != http.StatusOK {
		return "", "", fmt.Errorf("desktops.GetPodPhase: unexpected status %d", status)
	}
	var pod struct {
		Status struct {
			Phase string `json:"phase"`
			PodIP string `json:"podIP"`
		} `json:"status"`
	}
	if err := json.Unmarshal(body, &pod); err != nil {
		return "", "", fmt.Errorf("desktops.GetPodPhase: decode: %w", err)
	}
	return pod.Status.Phase, pod.Status.PodIP, nil
}

// DeletePod removes the named Pod. A 404 (already gone) is treated as success.
func (k *KubeClient) DeletePod(ctx context.Context, name string) error {
	path := fmt.Sprintf("/api/v1/namespaces/%s/pods/%s", k.namespace, name)
	return k.delete(ctx, "DeletePod", path)
}

// DeleteService removes the named Service. A 404 (already gone) is treated as
// success.
func (k *KubeClient) DeleteService(ctx context.Context, name string) error {
	path := fmt.Sprintf("/api/v1/namespaces/%s/services/%s", k.namespace, name)
	return k.delete(ctx, "DeleteService", path)
}

// delete issues a DELETE and treats 404 as success.
func (k *KubeClient) delete(ctx context.Context, op, path string) error {
	status, _, err := k.do(ctx, http.MethodDelete, path, nil)
	if err != nil {
		return fmt.Errorf("desktops.%s: %w", op, err)
	}
	if status == http.StatusOK || status == http.StatusAccepted || status == http.StatusNotFound {
		return nil
	}
	return fmt.Errorf("desktops.%s: unexpected status %d", op, status)
}

// metadata builds a core/v1 ObjectMeta with the object name (and the client's
// namespace) plus optional labels.
func (k *KubeClient) metadata(name string, labels map[string]string) map[string]any {
	m := map[string]any{
		"name":      name,
		"namespace": k.namespace,
	}
	if len(labels) > 0 {
		m["labels"] = labels
	}
	return m
}

// do executes an authenticated JSON request against the Kubernetes API server.
// It returns the HTTP status code, the raw response body, and any transport or
// encoding error. A non-2xx status is NOT returned as an error; callers inspect
// the status themselves so they can implement their own idempotency rules.
func (k *KubeClient) do(ctx context.Context, method, path string, bodyData any) (int, []byte, error) {
	var reqBody io.Reader
	if bodyData != nil {
		buf, err := json.Marshal(bodyData)
		if err != nil {
			return 0, nil, fmt.Errorf("marshal body: %w", err)
		}
		reqBody = bytes.NewReader(buf)
	}
	req, err := http.NewRequestWithContext(ctx, method, k.base+path, reqBody)
	if err != nil {
		return 0, nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+k.token)
	req.Header.Set("Accept", "application/json")
	if bodyData != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := k.httpClient.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1 MiB cap
	return resp.StatusCode, respBody, nil
}
