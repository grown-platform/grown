package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHealthzReturnsJSON(t *testing.T) {
	srv := New(Config{
		Version:   "test",
		Commit:    "deadbeef",
		StartedAt: time.Now(),
	})

	ts := httptest.NewServer(srv.HTTPHandler())
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status: got %d, want 200", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("not valid JSON: %v\nbody: %s", err, body)
	}
	if out["version"] != "test" {
		t.Errorf("version field: got %v, want test", out["version"])
	}
	if out["commit"] != "deadbeef" {
		t.Errorf("commit field: got %v, want deadbeef", out["commit"])
	}
	// Field name must be snake_case (proto convention), not lowerCamelCase.
	if _, ok := out["uptime_seconds"]; !ok {
		t.Errorf("expected snake_case field uptime_seconds, got keys: %v", keysOf(out))
	}
}

func keysOf(m map[string]any) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	return ks
}
