package visits

import "testing"

func TestCountablePath(t *testing.T) {
	countable := []string{"/games", "/games/", "/", "/admin", "/games/arcade"}
	for _, p := range countable {
		if !countablePath(p) {
			t.Errorf("expected countable: %q", p)
		}
	}
	skip := []string{
		"/api/v1/games/recent", "/healthz", "/.well-known/security.txt",
		"/bolo-mp/x", "/assemble/y", "/git/repo",
		"/assets/index.js", "/style.css", "/logo.png", "/index.html",
		"/games-updated.json",
	}
	for _, p := range skip {
		if countablePath(p) {
			t.Errorf("did not expect countable: %q", p)
		}
	}
}

func TestIsBot(t *testing.T) {
	bots := []string{
		"", "Googlebot/2.1", "curl/8.4", "python-requests/2.31",
		"Go-http-client/1.1", "sqlmap/1.5", "SomeCrawler",
	}
	for _, ua := range bots {
		if !isBot(ua) {
			t.Errorf("expected bot UA: %q", ua)
		}
	}
	humans := []string{
		"Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
	}
	for _, ua := range humans {
		if isBot(ua) {
			t.Errorf("did not expect bot UA: %q", ua)
		}
	}
}

func TestHashIPIsStableAndSalted(t *testing.T) {
	a := &Store{salt: "s1"}
	b := &Store{salt: "s2"}
	if a.hashIP("1.2.3.4") != a.hashIP("1.2.3.4") {
		t.Error("hash not stable for same IP+salt")
	}
	if a.hashIP("1.2.3.4") == b.hashIP("1.2.3.4") {
		t.Error("different salts produced the same hash")
	}
	if a.hashIP("1.2.3.4") == a.hashIP("5.6.7.8") {
		t.Error("different IPs produced the same hash")
	}
	// The raw IP must never appear in the hash output.
	if h := a.hashIP("1.2.3.4"); len(h) != 64 {
		t.Errorf("expected 64-hex-char sha256, got %d chars", len(h))
	}
}
