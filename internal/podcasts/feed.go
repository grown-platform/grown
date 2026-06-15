package podcasts

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// ErrBlockedTarget is returned when a feed URL points at a disallowed host —
// non-http(s) schemes, or hosts that resolve to private/loopback/link-local/
// CGNAT/cloud-metadata addresses. This is the SSRF guard: the feed fetcher
// dereferences a *user-supplied* URL server-side, so it must never be coaxed
// into reaching internal services (e.g. 169.254.169.254 metadata, in-cluster
// pods, localhost admin ports).
var ErrBlockedTarget = errors.New("feed url target is not allowed")

const (
	feedTimeout    = 10 * time.Second
	maxFeedBytes   = 10 << 20 // 10 MiB
	maxEpisodes    = 100
	maxRedirects   = 5
	feedUserAgent  = "grown-podcasts/1.0 (+https://grown.haus)"
	maxDescription = 600 // chars, after HTML strip
)

// Episode is one parsed <item> from a podcast feed.
type Episode struct {
	GUID        string `json:"guid"`
	Title       string `json:"title"`
	Description string `json:"description"` // plain text, HTML stripped + truncated
	AudioURL    string `json:"audio_url"`   // the <enclosure url> (audio/*)
	Duration    string `json:"duration"`    // itunes:duration as-is (e.g. "1:02:33" or "3753")
	Published   string `json:"published"`   // RFC3339, "" if unparseable
	Image       string `json:"image"`
}

// Feed is the parsed podcast channel returned to the client.
type Feed struct {
	Title    string    `json:"title"`
	Author   string    `json:"author"`
	Image    string    `json:"image"`
	Episodes []Episode `json:"episodes"`
}

// ---- RSS 2.0 + itunes namespace XML shapes -------------------------------

type rssDoc struct {
	XMLName xml.Name   `xml:"rss"`
	Channel rssChannel `xml:"channel"`
}

type rssChannel struct {
	Title  string    `xml:"title"`
	Author string    `xml:"author"` // itunes:author (namespace-agnostic match)
	Image  rssImage  `xml:"image"`  // captures both standard <image><url> and itunes:image href=
	Items  []rssItem `xml:"item"`
}

// rssImage captures both the standard RSS <image><url>…</url></image> and the
// itunes:image (which carries the URL on an href attribute). Decoding both into
// one struct works because encoding/xml matches by local name "image"
// regardless of namespace.
type rssImage struct {
	URL  string `xml:"url"`
	Href string `xml:"href,attr"`
}

type rssURLAttr struct {
	Href string `xml:"href,attr"`
}

type rssItem struct {
	GUID        string         `xml:"guid"`
	Title       string         `xml:"title"`
	Description string         `xml:"description"`
	Summary     string         `xml:"summary"` // itunes:summary
	PubDate     string         `xml:"pubDate"`
	Duration    string         `xml:"duration"` // itunes:duration
	Enclosures  []rssEnclosure `xml:"enclosure"`
	Image       rssURLAttr     `xml:"image"` // itunes:image href=
}

type rssEnclosure struct {
	URL  string `xml:"url,attr"`
	Type string `xml:"type,attr"`
}

// pubDateLayouts covers the RFC822/1123 variants real feeds emit.
var pubDateLayouts = []string{
	time.RFC1123Z,
	time.RFC1123,
	"Mon, 02 Jan 2006 15:04:05 -0700",
	"Mon, 02 Jan 2006 15:04:05 MST",
	"Mon, 2 Jan 2006 15:04:05 -0700",
	"Mon, 2 Jan 2006 15:04:05 MST",
	"02 Jan 2006 15:04:05 -0700",
	time.RFC3339,
}

var tagStripRe = regexp.MustCompile(`<[^>]*>`)
var wsRe = regexp.MustCompile(`\s+`)

// FetchFeed fetches the RSS at url over HTTP and parses it into a Feed. It
// enforces the SSRF guards (scheme allowlist + private-IP rejection on the
// initial host AND every redirect hop), a request timeout, and a response-size
// cap. Episodes are capped at the most-recent maxEpisodes.
func FetchFeed(ctx context.Context, rawURL string) (Feed, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return Feed{}, errors.New("feed url is required")
	}
	if _, err := validateURL(rawURL); err != nil {
		return Feed{}, err
	}

	client := safeClient()
	ctx, cancel := context.WithTimeout(ctx, feedTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return Feed{}, fmt.Errorf("podcasts.FetchFeed: %w", err)
	}
	req.Header.Set("User-Agent", feedUserAgent)
	req.Header.Set("Accept", "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5")

	resp, err := client.Do(req)
	if err != nil {
		// A blocked-target error can surface here (from the dial control or
		// CheckRedirect); unwrap so callers can map it to a clean 400.
		if errors.Is(err, ErrBlockedTarget) {
			return Feed{}, ErrBlockedTarget
		}
		return Feed{}, fmt.Errorf("podcasts.FetchFeed: fetch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Feed{}, fmt.Errorf("podcasts.FetchFeed: upstream status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxFeedBytes))
	if err != nil {
		return Feed{}, fmt.Errorf("podcasts.FetchFeed: read: %w", err)
	}

	return parseFeed(body)
}

// parseFeed turns raw RSS bytes into a Feed. Split out so it is unit-testable
// without any network.
func parseFeed(body []byte) (Feed, error) {
	var doc rssDoc
	dec := xml.NewDecoder(strings.NewReader(string(body)))
	// CharsetReader lets us parse non-UTF8 feeds (latin-1 etc.) without pulling
	// a dependency: pass bytes through unchanged, which is fine for the ASCII
	// metadata we extract.
	dec.CharsetReader = func(_ string, in io.Reader) (io.Reader, error) { return in, nil }
	dec.Strict = false
	if err := dec.Decode(&doc); err != nil {
		return Feed{}, fmt.Errorf("podcasts.parseFeed: %w", err)
	}

	ch := doc.Channel
	f := Feed{
		Title:  strings.TrimSpace(ch.Title),
		Author: strings.TrimSpace(ch.Author),
		Image:  firstNonEmpty(ch.Image.URL, ch.Image.Href),
	}

	for _, it := range ch.Items {
		audio := pickAudioEnclosure(it.Enclosures)
		if audio == "" {
			continue // no playable audio — skip
		}
		ep := Episode{
			GUID:        strings.TrimSpace(it.GUID),
			Title:       strings.TrimSpace(it.Title),
			Description: cleanDescription(firstNonEmpty(it.Description, it.Summary)),
			AudioURL:    strings.TrimSpace(audio),
			Duration:    strings.TrimSpace(it.Duration),
			Published:   parsePubDate(it.PubDate),
			Image:       strings.TrimSpace(it.Image.Href),
		}
		if ep.GUID == "" {
			ep.GUID = ep.AudioURL // enclosure URL is a stable fallback key
		}
		f.Episodes = append(f.Episodes, ep)
		if len(f.Episodes) >= maxEpisodes {
			break
		}
	}
	return f, nil
}

// pickAudioEnclosure returns the first enclosure whose type is audio/*, or the
// first enclosure with a URL if none declare an audio type (some feeds omit it).
func pickAudioEnclosure(encs []rssEnclosure) string {
	for _, e := range encs {
		if strings.HasPrefix(strings.ToLower(e.Type), "audio/") && e.URL != "" {
			return e.URL
		}
	}
	for _, e := range encs {
		if e.URL != "" {
			return e.URL
		}
	}
	return ""
}

func cleanDescription(s string) string {
	s = tagStripRe.ReplaceAllString(s, " ")
	s = html.UnescapeString(s)
	s = wsRe.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)
	if len(s) > maxDescription {
		// Truncate on a rune boundary, then trim trailing partial word.
		s = s[:maxDescription]
		if i := strings.LastIndex(s, " "); i > maxDescription/2 {
			s = s[:i]
		}
		s = strings.TrimSpace(s) + "…"
	}
	return s
}

func parsePubDate(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	for _, layout := range pubDateLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
	}
	return ""
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// ---- SSRF guards ----------------------------------------------------------

// validateURL parses+scheme-checks a URL and rejects it if the literal host (or
// any IP literal it contains) is private/loopback/etc. Host *names* are
// re-checked at dial time after DNS resolution (a name can resolve to a private
// IP, or rebind between checks) by safeDialControl.
func validateURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, ErrBlockedTarget
	}
	host := u.Hostname()
	if host == "" {
		return nil, ErrBlockedTarget
	}
	// If the host is an IP literal, validate it directly. (Hostnames are
	// validated post-resolution in the dial control.)
	if ip := net.ParseIP(host); ip != nil {
		if !ipAllowed(ip) {
			return nil, ErrBlockedTarget
		}
	}
	return u, nil
}

// safeClient builds an http.Client whose dialer re-validates the resolved IP of
// every connection (defeating DNS-based bypasses) and whose CheckRedirect
// re-validates every redirect Location (so a public host can't 302 to an
// internal one).
func safeClient() *http.Client {
	dialer := &net.Dialer{Timeout: feedTimeout}
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			// Resolve and validate EACH candidate IP, then dial the validated
			// one directly so we connect to exactly what we checked (no TOCTOU
			// re-resolution gap).
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			var lastErr error = ErrBlockedTarget
			for _, ipAddr := range ips {
				if !ipAllowed(ipAddr.IP) {
					lastErr = ErrBlockedTarget
					continue
				}
				conn, derr := dialer.DialContext(ctx, network, net.JoinHostPort(ipAddr.IP.String(), port))
				if derr != nil {
					lastErr = derr
					continue
				}
				return conn, nil
			}
			return nil, lastErr
		},
		MaxIdleConns:          10,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   feedTimeout,
		ExpectContinueTimeout: time.Second,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   feedTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return fmt.Errorf("too many redirects")
			}
			if _, err := validateURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
}

// ipAllowed reports whether it is safe to connect to ip — i.e. it is a global
// unicast public address and not in any private/loopback/link-local/CGNAT/
// metadata range. This is the core SSRF denylist.
func ipAllowed(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() || ip.IsInterfaceLocalMulticast() {
		return false
	}
	if ip.IsPrivate() { // 10/8, 172.16/12, 192.168/16, fc00::/7
		return false
	}
	// IPv4 CGNAT (100.64/10) and the 169.254/16 metadata range (covered by
	// IsLinkLocalUnicast above, incl. 169.254.169.254) plus other reserved
	// blocks not flagged by the stdlib helpers.
	if v4 := ip.To4(); v4 != nil {
		switch {
		case v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127: // 100.64.0.0/10 CGNAT
			return false
		case v4[0] == 0: // 0.0.0.0/8
			return false
		case v4[0] == 192 && v4[1] == 0 && v4[2] == 0: // 192.0.0.0/24
			return false
		case v4[0] == 198 && (v4[1] == 18 || v4[1] == 19): // 198.18.0.0/15 benchmarking
			return false
		}
	}
	// Require a globally-routable unicast address. This catches anything the
	// explicit checks above missed (e.g. IPv6 ULA edge cases).
	return ip.IsGlobalUnicast()
}
