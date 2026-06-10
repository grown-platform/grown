package admin

import (
	"testing"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
)

// TestValidateExternalURL exercises the URL validation guard that is called by
// SetServiceSettings for each service entry.
func TestValidateExternalURL(t *testing.T) {
	cases := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{"empty clears", "", false},
		{"valid https", "https://immich.example.com", false},
		{"valid http", "http://immich.internal", false},
		{"valid https with path", "https://immich.example.com/photos", false},
		{"ftp scheme", "ftp://example.com", true},
		{"no scheme", "example.com", true},
		{"just scheme no host", "https://", true},
		{"not a url", "not a url at all", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateExternalURL("testservice", tc.url)
			if tc.wantErr && err == nil {
				t.Errorf("expected error for %q, got nil", tc.url)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error for %q: %v", tc.url, err)
			}
		})
	}
}

// TestToProtoExternalURL ensures toProto propagates ExternalURL correctly.
func TestToProtoExternalURL(t *testing.T) {
	m := map[string]Setting{
		"photos": {ServiceID: "photos", Enabled: true, ExternalURL: "https://immich.example.com"},
		"music":  {ServiceID: "music", Enabled: false, ExternalURL: ""},
	}
	out := toProto("org1", m)
	byID := make(map[string]*grownv1.ServiceSetting)
	for _, s := range out.Settings {
		byID[s.ServiceId] = s
	}
	if byID["photos"].ExternalUrl != "https://immich.example.com" {
		t.Errorf("photos external URL: want %q got %q", "https://immich.example.com", byID["photos"].ExternalUrl)
	}
	if byID["music"].ExternalUrl != "" {
		t.Errorf("music external URL should be empty, got %q", byID["music"].ExternalUrl)
	}
}
