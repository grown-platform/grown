// Package vpn provides a best-effort HTTP handler that reports Tailscale
// tailnet integration status and, when a Tailscale API key is configured,
// lists devices on the tailnet.
//
// The handler is entirely no-op / graceful-degradation when the env vars are
// absent: GET /api/v1/vpn/status returns a JSON payload indicating the
// integration is unconfigured rather than an error.
//
// Configuration (via environment variables — read by NewHandlerFromEnv):
//
//	GROWN_TAILSCALE_TAILNET  — tailnet domain (e.g. "pick-haus.ts.net").
//	                           When absent the integration is "unconfigured".
//	GROWN_TAILSCALE_API_KEY  — Tailscale API key (read-only is sufficient).
//	                           When absent, device listing is skipped.
//
// Routes (all GET, JSON):
//
//	GET /api/v1/vpn/status  — configured/unconfigured + optional device list.
package vpn

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const tailscaleAPIBase = "https://api.tailscale.com/api/v2"

// Config holds runtime configuration for the VPN handler.
type Config struct {
	// Tailnet is the tailnet domain (e.g. "pick-haus.ts.net" or the org slug).
	// Empty means the Tailscale integration is unconfigured.
	Tailnet string
	// APIKey is a Tailscale API key used to list devices.  Read-only scopes
	// are sufficient.  Empty means device listing is disabled.
	APIKey string
	// HTTPClient is the HTTP client used to call the Tailscale API.
	// Defaults to a 10-second timeout client when nil.
	HTTPClient *http.Client
}

// ConfigFromEnv builds a Config from the standard env vars.
func ConfigFromEnv() Config {
	return Config{
		Tailnet: os.Getenv("GROWN_TAILSCALE_TAILNET"),
		APIKey:  os.Getenv("GROWN_TAILSCALE_API_KEY"),
	}
}

// Handler serves the VPN status endpoint.
type Handler struct {
	cfg    Config
	client *http.Client
}

// NewHandler constructs a Handler from cfg.
func NewHandler(cfg Config) *Handler {
	c := cfg.HTTPClient
	if c == nil {
		c = &http.Client{Timeout: 10 * time.Second}
	}
	return &Handler{cfg: cfg, client: c}
}

// NewHandlerFromEnv constructs a Handler from environment variables.
func NewHandlerFromEnv() *Handler {
	return NewHandler(ConfigFromEnv())
}

// Configured reports whether the Tailscale integration is configured (i.e.
// GROWN_TAILSCALE_TAILNET is set).
func (h *Handler) Configured() bool {
	return h.cfg.Tailnet != ""
}

// ServeHTTP routes GET /api/v1/vpn/status.  Any other method or path returns
// 404 / 405 respectively.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	status, err := h.status(r.Context())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(status)
}

// StatusResponse is the JSON shape returned by GET /api/v1/vpn/status.
type StatusResponse struct {
	// Configured is true when GROWN_TAILSCALE_TAILNET is set.
	Configured bool `json:"configured"`
	// Tailnet is the tailnet domain, or "" when unconfigured.
	Tailnet string `json:"tailnet,omitempty"`
	// DevicesConfigured is true when an API key is set (device list available).
	DevicesConfigured bool `json:"devices_configured"`
	// Devices is the list of tailnet devices (populated when APIKey is set).
	// nil when the API key is absent or the call fails.
	Devices []Device `json:"devices,omitempty"`
	// Error carries a non-fatal diagnostic message (e.g. API call failed).
	Error string `json:"error,omitempty"`
}

// Device is a minimal view of a Tailscale tailnet device.
type Device struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Hostname  string   `json:"hostname"`
	Addresses []string `json:"addresses"`
	OS        string   `json:"os"`
	Online    bool     `json:"online"`
	LastSeen  string   `json:"last_seen,omitempty"`
}

func (h *Handler) status(ctx context.Context) (StatusResponse, error) {
	if !h.Configured() {
		return StatusResponse{Configured: false}, nil
	}
	resp := StatusResponse{
		Configured:        true,
		Tailnet:           h.cfg.Tailnet,
		DevicesConfigured: h.cfg.APIKey != "",
	}
	if h.cfg.APIKey == "" {
		return resp, nil
	}
	devices, err := h.listDevices(ctx)
	if err != nil {
		// Non-fatal: return partial status with an error note.
		resp.Error = fmt.Sprintf("device list unavailable: %v", err)
		return resp, nil
	}
	resp.Devices = devices
	return resp, nil
}

// tailscaleDevicesResponse is the raw JSON from the Tailscale API.
type tailscaleDevicesResponse struct {
	Devices []struct {
		ID        string   `json:"id"`
		Name      string   `json:"name"`
		Hostname  string   `json:"hostname"`
		Addresses []string `json:"addresses"`
		OS        string   `json:"os"`
		LastSeen  string   `json:"lastSeen"`
		// clientConnectivity.connected is not always present; we keep this simple.
	} `json:"devices"`
}

func (h *Handler) listDevices(ctx context.Context) ([]Device, error) {
	url := fmt.Sprintf("%s/tailnet/%s/devices", tailscaleAPIBase, h.cfg.Tailnet)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+h.cfg.APIKey)
	req.Header.Set("Accept", "application/json")

	res, err := h.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return nil, fmt.Errorf("Tailscale API returned %d: %s", res.StatusCode, body)
	}

	var raw tailscaleDevicesResponse
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		return nil, err
	}

	out := make([]Device, 0, len(raw.Devices))
	for _, d := range raw.Devices {
		out = append(out, Device{
			ID:        d.ID,
			Name:      d.Name,
			Hostname:  d.Hostname,
			Addresses: d.Addresses,
			OS:        d.OS,
			// Tailscale reports lastSeen; we surface it as-is (RFC 3339 string).
			LastSeen: d.LastSeen,
		})
	}
	return out, nil
}
