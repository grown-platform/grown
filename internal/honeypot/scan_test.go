package honeypot

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestIsProbePath(t *testing.T) {
	probes := []string{
		"/.env", "/.env.local", "/.git/config", "/wp-login.php",
		"/wp-admin/", "/phpmyadmin/index.php", "/actuator/health",
		"/swagger-ui.html", "/vendor/phpunit/phpunit.php",
		"/backup.zip", "/config.json", "/app/config.php.bak",
		"/api/v1/secret/.env",
	}
	for _, p := range probes {
		if !isProbePath(p) {
			t.Errorf("expected probe path: %q", p)
		}
	}
	legit := []string{
		"/", "/api/v1/admin/analytics", "/games/pong.html",
		"/.well-known/security.txt", // explicitly excluded
		"/.well-known/acme-challenge/x",
		"/assets/index.js", "/docs/index.html",
	}
	for _, p := range legit {
		if isProbePath(p) {
			t.Errorf("did not expect probe path: %q", p)
		}
	}
}

func TestClassifyScan(t *testing.T) {
	cases := []struct {
		name string
		path string
		rawq string
		ua   string
		want string
	}{
		{"traversal in path", "/api/v1/../../etc/passwd", "", "curl/8", KindPathTraversal},
		{"traversal encoded query", "/x", "f=..%2f..%2fetc", "Mozilla", KindPathTraversal},
		{"null byte", "/x%00.png", "", "Mozilla", KindPathTraversal},
		{"scanner ua", "/", "", "sqlmap/1.5", KindBadUA},
		{"nikto ua", "/", "", "Mozilla Nikto/2.1", KindBadUA},
		{"probe path", "/wp-login.php", "", "Mozilla", KindAPIScan},
		{"empty ua on api", "/api/v1/users", "", "", KindBadUA},
		{"legit request", "/api/v1/admin/analytics", "", "Mozilla/5.0", ""},
		{"legit well-known", "/.well-known/security.txt", "", "Mozilla", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "http://x"+c.path+func() string {
				if c.rawq != "" {
					return "?" + c.rawq
				}
				return ""
			}(), nil)
			r.Header.Set("User-Agent", c.ua)
			got, _ := classifyScan(r)
			if got != c.want {
				t.Errorf("classifyScan(%q ua=%q) = %q, want %q", c.path, c.ua, got, c.want)
			}
		})
	}
}

func TestBurstTracker(t *testing.T) {
	bt := newBurstTracker()
	now := time.Now()
	// First (threshold-1) 404s should not trip.
	for i := 0; i < burstThreshold-1; i++ {
		if bt.record404("1.2.3.4", now) {
			t.Fatalf("tripped early at i=%d", i)
		}
	}
	// The threshold-th 404 trips exactly once.
	if !bt.record404("1.2.3.4", now) {
		t.Fatal("expected burst trip at threshold")
	}
	// Subsequent 404s in the same window do NOT re-trip.
	if bt.record404("1.2.3.4", now) {
		t.Fatal("re-tripped within same window")
	}
	// A different IP is independent.
	if bt.record404("5.6.7.8", now) {
		t.Fatal("unrelated IP tripped")
	}
	// Empty IP never trips.
	if bt.record404("", now) {
		t.Fatal("empty IP tripped")
	}
	// After the window rolls, the IP can trip again.
	later := now.Add(burstWindow + time.Second)
	for i := 0; i < burstThreshold-1; i++ {
		bt.record404("1.2.3.4", later)
	}
	if !bt.record404("1.2.3.4", later) {
		t.Fatal("expected burst trip in new window")
	}
}
