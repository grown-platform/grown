package live

import "testing"

func TestTrimSlash(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"/live-hls", "/live-hls"},
		{"/live-hls/", "/live-hls"},
		{"/live-hls///", "/live-hls"},
		{"", ""},
		{"/", ""},
		{"https://x.example/live", "https://x.example/live"},
	}
	for _, c := range cases {
		if got := trimSlash(c.in); got != c.want {
			t.Errorf("trimSlash(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestIngestRTMP(t *testing.T) {
	cases := []struct {
		name string
		cfg  URLConfig
		path string
		want string
	}{
		{"configured host", URLConfig{RTMPHost: "media.example:1935"}, "abc", "rtmp://media.example:1935/abc"},
		{"empty host falls back to default", URLConfig{}, "abc", "rtmp://localhost:1935/abc"},
		{"empty path", URLConfig{RTMPHost: "h:1"}, "", "rtmp://h:1/"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.cfg.IngestRTMP(c.path); got != c.want {
				t.Errorf("IngestRTMP(%q) = %q, want %q", c.path, got, c.want)
			}
		})
	}
}

func TestIngestWHIP(t *testing.T) {
	cases := []struct {
		name string
		cfg  URLConfig
		path string
		want string
	}{
		{"configured base", URLConfig{WHIPBase: "/live-webrtc"}, "abc", "/live-webrtc/abc/whip"},
		{"base with trailing slash", URLConfig{WHIPBase: "/live-webrtc/"}, "abc", "/live-webrtc/abc/whip"},
		{"empty base falls back to default", URLConfig{}, "abc", "/live-webrtc/abc/whip"},
		{"absolute base", URLConfig{WHIPBase: "https://m.example/wr"}, "p", "https://m.example/wr/p/whip"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.cfg.IngestWHIP(c.path); got != c.want {
				t.Errorf("IngestWHIP(%q) = %q, want %q", c.path, got, c.want)
			}
		})
	}
}

func TestHLS(t *testing.T) {
	cases := []struct {
		name string
		cfg  URLConfig
		path string
		want string
	}{
		{"configured base", URLConfig{HLSBase: "/live-hls"}, "abc", "/live-hls/abc/index.m3u8"},
		{"base with trailing slash", URLConfig{HLSBase: "/live-hls/"}, "abc", "/live-hls/abc/index.m3u8"},
		{"empty base falls back to default", URLConfig{}, "abc", "/live-hls/abc/index.m3u8"},
		{"absolute base", URLConfig{HLSBase: "https://m.example/h"}, "p", "https://m.example/h/p/index.m3u8"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.cfg.HLS(c.path); got != c.want {
				t.Errorf("HLS(%q) = %q, want %q", c.path, got, c.want)
			}
		})
	}
}

func TestWHEP(t *testing.T) {
	cases := []struct {
		name string
		cfg  URLConfig
		path string
		want string
	}{
		{"configured base", URLConfig{WHEPBase: "/live-webrtc"}, "abc", "/live-webrtc/abc/whep"},
		{"base with trailing slash", URLConfig{WHEPBase: "/live-webrtc/"}, "abc", "/live-webrtc/abc/whep"},
		{"empty base falls back to default", URLConfig{}, "abc", "/live-webrtc/abc/whep"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.cfg.WHEP(c.path); got != c.want {
				t.Errorf("WHEP(%q) = %q, want %q", c.path, got, c.want)
			}
		})
	}
}
