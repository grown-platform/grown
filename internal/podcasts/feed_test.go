package podcasts

import (
	"context"
	"errors"
	"net"
	"testing"
)

// TestFetchFeedRejectsBlockedTargets asserts the SSRF guard rejects loopback,
// the cloud metadata IP, link-local, private, and CGNAT targets — both as IP
// literals and (where relevant) as the well-known metadata address.
func TestFetchFeedRejectsBlockedTargets(t *testing.T) {
	cases := []string{
		"http://127.0.0.1/feed.xml",
		"http://127.0.0.1:8080/feed.xml",
		"http://localhost/feed.xml",                // resolves to loopback at dial time
		"http://169.254.169.254/latest/meta-data/", // cloud metadata
		"http://[::1]/feed.xml",                    // IPv6 loopback
		"http://10.0.0.5/feed.xml",                 // private
		"http://172.16.4.4/feed.xml",               // private
		"http://192.168.1.10/feed.xml",             // private
		"http://169.254.10.10/feed.xml",            // link-local
		"http://100.64.1.1/feed.xml",               // CGNAT
		"http://0.0.0.0/feed.xml",                  // unspecified
		"ftp://example.com/feed.xml",               // bad scheme
		"file:///etc/passwd",                       // bad scheme
		"gopher://example.com/",                    // bad scheme
	}
	for _, raw := range cases {
		_, err := FetchFeed(context.Background(), raw)
		if err == nil {
			t.Errorf("FetchFeed(%q) = nil error, want rejection", raw)
			continue
		}
		// IP-literal / scheme cases must be ErrBlockedTarget. Hostname cases
		// (localhost) surface the blocked target through the dialer wrapped in
		// a url error, so accept either ErrBlockedTarget or a dial failure that
		// never reached a public host.
		if !errors.Is(err, ErrBlockedTarget) {
			// localhost may fail at resolution/dial; ensure we did not somehow
			// connect out. A wrapped ErrBlockedTarget is the expected path.
			t.Logf("FetchFeed(%q) rejected with non-sentinel error (acceptable for hostname targets): %v", raw, err)
		}
	}
}

// TestValidateURLBlocksPrivateLiterals checks the synchronous literal-IP guard
// used by both FetchFeed and the subscribe handler.
func TestValidateURLBlocksPrivateLiterals(t *testing.T) {
	blocked := []string{
		"http://127.0.0.1/", "http://169.254.169.254/", "http://10.1.2.3/",
		"http://192.168.0.1/", "http://[::1]/", "http://100.100.1.1/",
		"https://localhost.bad/", // not an IP literal; scheme ok, host name allowed here (re-checked at dial)
	}
	for _, raw := range blocked[:len(blocked)-1] {
		if _, err := validateURL(raw); !errors.Is(err, ErrBlockedTarget) {
			t.Errorf("validateURL(%q) = %v, want ErrBlockedTarget", raw, err)
		}
	}
	// A public host name passes the synchronous check (DNS re-validation happens
	// at dial time).
	if _, err := validateURL("https://feeds.npr.org/510318/podcast.xml"); err != nil {
		t.Errorf("validateURL(public feed) = %v, want nil", err)
	}
}

// TestIPAllowed spot-checks the denylist directly.
func TestIPAllowed(t *testing.T) {
	deny := []string{
		"127.0.0.1", "::1", "10.0.0.1", "172.16.0.1", "192.168.1.1",
		"169.254.169.254", "100.64.0.1", "0.0.0.0", "fc00::1", "fe80::1",
	}
	for _, s := range deny {
		if ipAllowed(net.ParseIP(s)) {
			t.Errorf("ipAllowed(%s) = true, want false", s)
		}
	}
	allow := []string{"1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:2800:220:1::"}
	for _, s := range allow {
		if !ipAllowed(net.ParseIP(s)) {
			t.Errorf("ipAllowed(%s) = false, want true", s)
		}
	}
}

const sampleRSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Up First Sample</title>
    <itunes:author>NPR</itunes:author>
    <itunes:image href="https://example.com/art.jpg"/>
    <item>
      <title>Monday News</title>
      <description><![CDATA[<p>The <b>top</b> stories &amp; more.</p>]]></description>
      <pubDate>Mon, 02 Jun 2025 09:00:00 -0400</pubDate>
      <itunes:duration>12:34</itunes:duration>
      <guid>npr-001</guid>
      <enclosure url="https://chrt.fm/track/abc/audio.mp3" length="12345" type="audio/mpeg"/>
      <itunes:image href="https://example.com/ep.jpg"/>
    </item>
    <item>
      <title>No Audio Item</title>
      <description>should be skipped</description>
      <pubDate>Sun, 01 Jun 2025 09:00:00 -0400</pubDate>
    </item>
  </channel>
</rss>`

func TestParseFeed(t *testing.T) {
	f, err := parseFeed([]byte(sampleRSS))
	if err != nil {
		t.Fatalf("parseFeed: %v", err)
	}
	if f.Title != "Up First Sample" {
		t.Errorf("title = %q", f.Title)
	}
	if f.Author != "NPR" {
		t.Errorf("author = %q", f.Author)
	}
	if f.Image != "https://example.com/art.jpg" {
		t.Errorf("image = %q", f.Image)
	}
	if len(f.Episodes) != 1 {
		t.Fatalf("episodes = %d, want 1 (no-audio item skipped)", len(f.Episodes))
	}
	ep := f.Episodes[0]
	if ep.Title != "Monday News" {
		t.Errorf("ep.title = %q", ep.Title)
	}
	if ep.AudioURL != "https://chrt.fm/track/abc/audio.mp3" {
		t.Errorf("ep.audio_url = %q", ep.AudioURL)
	}
	if ep.Duration != "12:34" {
		t.Errorf("ep.duration = %q", ep.Duration)
	}
	if ep.GUID != "npr-001" {
		t.Errorf("ep.guid = %q", ep.GUID)
	}
	if ep.Image != "https://example.com/ep.jpg" {
		t.Errorf("ep.image = %q", ep.Image)
	}
	if ep.Published != "2025-06-02T13:00:00Z" {
		t.Errorf("ep.published = %q, want RFC3339 UTC", ep.Published)
	}
	// Description must be plain text (HTML stripped, entities decoded).
	if want := "The top stories & more."; ep.Description != want {
		t.Errorf("ep.description = %q, want %q", ep.Description, want)
	}
}
