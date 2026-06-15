package music

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRadioStationID(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		wantID     string
		wantAction string
		wantOK     bool
	}{
		{"id only", "/api/v1/music/radio/abc", "abc", "", true},
		{"id with action", "/api/v1/music/radio/abc/play", "abc", "play", true},
		{"id with stream action", "/api/v1/music/radio/abc/stream", "abc", "stream", true},
		{"trailing slash", "/api/v1/music/radio/abc/", "abc", "", true},
		{"nested action kept", "/api/v1/music/radio/abc/a/b", "abc", "a/b", true},
		{"missing prefix", "/music/radio/abc", "", "", false},
		{"prefix only", "/api/v1/music/radio/", "", "", false},
		{"prefix no slash", "/api/v1/music/radio", "", "", false},
		{"leading slash trimmed to id", "/api/v1/music/radio//play", "play", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, action, ok := RadioStationID(tt.path)
			if id != tt.wantID || action != tt.wantAction || ok != tt.wantOK {
				t.Errorf("RadioStationID(%q) = (%q, %q, %v), want (%q, %q, %v)",
					tt.path, id, action, ok, tt.wantID, tt.wantAction, tt.wantOK)
			}
		})
	}
}

func TestStationToJSON(t *testing.T) {
	s := Station{
		ID:            "s1",
		OrgID:         "org1",
		Name:          "K-LOVE",
		StreamURL:     "https://example.com/stream",
		Genre:         "Christian",
		LogoURL:       "https://example.com/logo.png",
		RetentionMode: RetentionDays,
		RetentionDays: 30,
		TrackCount:    7,
	}
	j := stationToJSON(s)
	if j.ID != "s1" || j.OrgID != "org1" || j.Name != "K-LOVE" {
		t.Errorf("base fields mismatch: %+v", j)
	}
	if j.StreamURL != "https://example.com/stream" || j.Genre != "Christian" {
		t.Errorf("stream/genre mismatch: %+v", j)
	}
	if j.RetentionMode != RetentionDays || j.RetentionDays != 30 || j.TrackCount != 7 {
		t.Errorf("retention/count mismatch: %+v", j)
	}
	// PlayURL points at the same-origin proxy, derived from the station id.
	if j.PlayURL != "/api/v1/music/radio/s1/stream" {
		t.Errorf("play_url = %q, want proxy path", j.PlayURL)
	}
}

func TestStationToJSON_MarshalSnakeCase(t *testing.T) {
	s := Station{ID: "s1", Name: "N", StreamURL: "https://x/y", RetentionMode: RetentionKeep}
	b, err := json.Marshal(stationToJSON(s))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(b)
	for _, key := range []string{
		`"id":`, `"org_id":`, `"name":`, `"stream_url":`,
		`"genre":`, `"logo_url":`, `"retention_mode":`,
		`"retention_days":`, `"track_count":`, `"play_url":`,
	} {
		if !strings.Contains(got, key) {
			t.Errorf("marshaled JSON missing key %s: %s", key, got)
		}
	}
}
