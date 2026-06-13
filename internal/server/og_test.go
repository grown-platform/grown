package server

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOGForRoutes(t *testing.T) {
	cases := []struct{ path, site, wantTitle, wantImg string }{
		{"/", "Grown", "Grown", defaultOGImage},
		{"/", "Grown Platform", "Grown Platform", defaultOGImage},
		{"/games", "Grown", "Games", "/games-og.png"},
		{"/games/snake.html", "Grown", "Games", "/games-og.png"},
		{"/drive", "Grown", "Drive", "/icon-512.png"},
		{"/unknown-route", "Grown", "Grown", defaultOGImage},
	}
	for _, c := range cases {
		gotTitle, gotImg := ogFor(c.path, c.site)
		if gotTitle != c.wantTitle || gotImg != c.wantImg {
			t.Errorf("ogFor(%q,%q) = (%q,%q), want (%q,%q)",
				c.path, c.site, gotTitle, gotImg, c.wantTitle, c.wantImg)
		}
	}
}

func TestInjectOGMeta(t *testing.T) {
	shell := []byte("<!doctype html><html><head><title>Workspace</title></head><body></body></html>")

	// Homepage on grown.haus uses the configured site name as the og:title.
	r := httptest.NewRequest("GET", "https://grown.haus/", nil)
	out := string(injectOGMeta(shell, r, "Grown Platform"))
	for _, want := range []string{
		`<title>Grown Platform</title>`,
		`property="og:title" content="Grown Platform"`,
		`property="og:site_name" content="Grown Platform"`,
		`content="Grow your own platform and own what you grow."`,
		`property="og:url" content="https://grown.haus/"`,
		`property="og:image" content="https://grown.haus/icon-512.png"`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("homepage injection missing %q in:\n%s", want, out)
		}
	}
	if strings.Contains(out, "<title>Workspace</title>") {
		t.Error("original <title> not replaced")
	}

	// /games gets the Games title + game image, with the site appended.
	r2 := httptest.NewRequest("GET", "https://pick.haus/games", nil)
	out2 := string(injectOGMeta(shell, r2, "Grown"))
	for _, want := range []string{
		`<title>Games · Grown</title>`,
		`property="og:title" content="Games · Grown"`,
		`property="og:image" content="https://pick.haus/games-og.png"`,
	} {
		if !strings.Contains(out2, want) {
			t.Errorf("/games injection missing %q in:\n%s", want, out2)
		}
	}
}
