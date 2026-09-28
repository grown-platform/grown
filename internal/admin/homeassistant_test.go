package admin

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// TestValidateExternalURL_HomeAssistant covers the URL shapes admins paste for
// a bring-your-own Home Assistant instance.
func TestValidateExternalURL_HomeAssistant(t *testing.T) {
	cases := []struct {
		url     string
		wantErr bool
	}{
		{"", false}, // clears the org override
		{"http://homeassistant.local:8123", false},
		{"https://ha.example.com", false},
		{"https://ha.example.com/lovelace/0", false},
		{"http://192.168.1.10:8123", false},
		{"homeassistant.local:8123", true}, // parsed as scheme "homeassistant.local"
		{"ws://homeassistant.local:8123/api/websocket", true},
		{"javascript:alert(1)", true},
	}
	for _, tc := range cases {
		err := validateExternalURL(ServiceHomeAssistant, tc.url)
		if (err != nil) != tc.wantErr {
			t.Errorf("validateExternalURL(%q): err=%v wantErr=%v", tc.url, err, tc.wantErr)
		}
		if err != nil && status.Code(err) != codes.InvalidArgument {
			t.Errorf("validateExternalURL(%q): code=%v want InvalidArgument", tc.url, status.Code(err))
		}
	}
}

func TestWithDefaultExternalURLs_FiltersBlankAndInvalid(t *testing.T) {
	s, rejected := NewService(nil, "").WithDefaultExternalURLs(map[string]string{
		ServiceHomeAssistant: "  https://ha.example.com  ",
		"blank":              "   ",
		"bad":                "ftp://nope",
	})
	if got := s.defaultURLs[ServiceHomeAssistant]; got != "https://ha.example.com" {
		t.Errorf("homeassistant default: got %q", got)
	}
	if _, ok := s.defaultURLs["blank"]; ok {
		t.Errorf("blank default should be skipped")
	}
	if _, ok := s.defaultURLs["bad"]; ok {
		t.Errorf("invalid default should be skipped")
	}
	if len(rejected) != 1 || rejected[0] != "bad" {
		t.Errorf("rejected: got %v want [bad]", rejected)
	}
}

func TestWithDefaults(t *testing.T) {
	const def = "https://ha.example.com"
	s, _ := NewService(nil, "").WithDefaultExternalURLs(map[string]string{ServiceHomeAssistant: def})

	// No row: default reported as an enabled entry.
	got := s.withDefaults(map[string]Setting{})
	if h := got[ServiceHomeAssistant]; !h.Enabled || h.ExternalURL != def {
		t.Errorf("no row: got %+v", h)
	}

	// Row with an org URL: org URL wins.
	in := map[string]Setting{ServiceHomeAssistant: {ServiceID: ServiceHomeAssistant, Enabled: true, ExternalURL: "http://my-ha:8123"}}
	got = s.withDefaults(in)
	if h := got[ServiceHomeAssistant]; h.ExternalURL != "http://my-ha:8123" {
		t.Errorf("org URL should win, got %q", h.ExternalURL)
	}

	// Disabled row with no URL: keeps disabled, gains the default URL.
	in = map[string]Setting{ServiceHomeAssistant: {ServiceID: ServiceHomeAssistant, Enabled: false}}
	got = s.withDefaults(in)
	if h := got[ServiceHomeAssistant]; h.Enabled || h.ExternalURL != def {
		t.Errorf("disabled row: got %+v", h)
	}
	// Input map is not mutated.
	if in[ServiceHomeAssistant].ExternalURL != "" {
		t.Errorf("withDefaults mutated its input")
	}

	// No defaults configured: passthrough, nothing synthesized.
	plain := NewService(nil, "")
	if got := plain.withDefaults(map[string]Setting{}); len(got) != 0 {
		t.Errorf("no defaults: expected empty map, got %v", got)
	}
}

// adminCtx builds a request context for an allowlisted admin in orgID.
func adminCtx(orgID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: orgID, Email: "admin@example.com"})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default"})
}

func settingByID(out *grownv1.ServiceSettings, id string) *grownv1.ServiceSetting {
	for _, s := range out.GetSettings() {
		if s.GetServiceId() == id {
			return s
		}
	}
	return nil
}

// TestService_HomeAssistantURL_DB exercises the full Get/Set path against a real
// database: deployment default -> org override -> clear falls back to default.
func TestService_HomeAssistantURL_DB(t *testing.T) {
	pool, orgID := setupDB(t)
	ctx := adminCtx(orgID)

	// Without a default and without an org URL, homeassistant is absent: the
	// frontend hides the tile.
	bare := NewService(NewRepository(pool), "admin@example.com")
	out, err := bare.GetServiceSettings(ctx, &grownv1.GetServiceSettingsRequest{})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if settingByID(out, ServiceHomeAssistant) != nil {
		t.Fatalf("expected no homeassistant entry without default or org URL")
	}

	svc, _ := NewService(NewRepository(pool), "admin@example.com").
		WithDefaultExternalURLs(map[string]string{ServiceHomeAssistant: "https://ha.chart.example"})

	out, err = svc.GetServiceSettings(ctx, &grownv1.GetServiceSettingsRequest{})
	if err != nil {
		t.Fatalf("Get with default: %v", err)
	}
	if h := settingByID(out, ServiceHomeAssistant); h == nil || h.GetExternalUrl() != "https://ha.chart.example" || !h.GetEnabled() {
		t.Fatalf("default not reported: %+v", h)
	}

	// Org sets its own (bring-your-own) URL.
	out, err = svc.SetServiceSettings(ctx, &grownv1.SetServiceSettingsRequest{Settings: []*grownv1.ServiceSetting{
		{ServiceId: ServiceHomeAssistant, Enabled: true, ExternalUrl: " http://homeassistant.local:8123 "},
	}})
	if err != nil {
		t.Fatalf("Set: %v", err)
	}
	if h := settingByID(out, ServiceHomeAssistant); h.GetExternalUrl() != "http://homeassistant.local:8123" {
		t.Fatalf("org URL not stored/trimmed: %+v", h)
	}

	// Invalid URL rejected.
	_, err = svc.SetServiceSettings(ctx, &grownv1.SetServiceSettingsRequest{Settings: []*grownv1.ServiceSetting{
		{ServiceId: ServiceHomeAssistant, Enabled: true, ExternalUrl: "homeassistant.local"},
	}})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("invalid URL: code=%v want InvalidArgument", status.Code(err))
	}

	// Clearing the org URL falls back to the deployment default.
	out, err = svc.SetServiceSettings(ctx, &grownv1.SetServiceSettingsRequest{Settings: []*grownv1.ServiceSetting{
		{ServiceId: ServiceHomeAssistant, Enabled: true, ExternalUrl: ""},
	}})
	if err != nil {
		t.Fatalf("Set clear: %v", err)
	}
	if h := settingByID(out, ServiceHomeAssistant); h.GetExternalUrl() != "https://ha.chart.example" {
		t.Fatalf("clear should fall back to default: %+v", h)
	}

	// The default is never persisted: the repo still holds an empty URL.
	m, err := NewRepository(pool).GetSettings(context.Background(), orgID)
	if err != nil {
		t.Fatalf("repo Get: %v", err)
	}
	if m[ServiceHomeAssistant].ExternalURL != "" {
		t.Fatalf("default leaked into storage: %q", m[ServiceHomeAssistant].ExternalURL)
	}

	// Non-admins can't set it.
	member := auth.WithOrg(auth.WithUser(context.Background(), users.User{ID: "u2", OrgID: orgID, Email: "member@example.com"}), orgs.Org{ID: orgID})
	_, err = svc.SetServiceSettings(member, &grownv1.SetServiceSettingsRequest{Settings: []*grownv1.ServiceSetting{
		{ServiceId: ServiceHomeAssistant, Enabled: true, ExternalUrl: "https://evil.example"},
	}})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("member set: code=%v want PermissionDenied", status.Code(err))
	}
}
