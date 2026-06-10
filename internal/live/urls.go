package live

import "strings"

// URLConfig holds the public bases used to build a stream's ingest/playback
// URLs. These come from env (set in cmd/server/main.go) and describe how the
// browser and streaming software reach MediaMTX:
//
//   - HLSBase / WHEPBase are playback origins under grown's own host, served by
//     grown's reverse proxy (e.g. "/live-hls" and "/live-webrtc"), so the
//     browser uses a single origin. They may be relative ("/live-hls") or
//     absolute ("https://grown.example/live-hls").
//   - WHIPBase is the browser publish (WHIP) origin; also grown-proxied
//     ("/live-webrtc").
//   - RTMPHost is the host:port streaming software dials for RTMP ingest, e.g.
//     "localhost:1935". RTMP cannot be proxied through grown's HTTP origin, so
//     this is MediaMTX's RTMP listener reachable from the publisher.
type URLConfig struct {
	HLSBase  string // e.g. "/live-hls"
	WHEPBase string // e.g. "/live-webrtc"
	WHIPBase string // e.g. "/live-webrtc"
	RTMPHost string // e.g. "localhost:1935"
}

func trimSlash(s string) string { return strings.TrimRight(s, "/") }

// IngestRTMP returns the RTMP publish URL for a path, e.g.
// "rtmp://localhost:1935/<path>". The stream key is the RTMP password, supplied
// separately by the publisher (OBS: Server = this URL, Stream Key = the key).
func (c URLConfig) IngestRTMP(path string) string {
	host := c.RTMPHost
	if host == "" {
		host = "localhost:1935"
	}
	return "rtmp://" + host + "/" + path
}

// IngestWHIP returns the WebRTC/WHIP publish endpoint for a path, proxied under
// grown's origin, e.g. "/live-webrtc/<path>/whip".
func (c URLConfig) IngestWHIP(path string) string {
	base := trimSlash(c.WHIPBase)
	if base == "" {
		base = "/live-webrtc"
	}
	return base + "/" + path + "/whip"
}

// HLS returns the HLS playlist URL for a path, e.g.
// "/live-hls/<path>/index.m3u8".
func (c URLConfig) HLS(path string) string {
	base := trimSlash(c.HLSBase)
	if base == "" {
		base = "/live-hls"
	}
	return base + "/" + path + "/index.m3u8"
}

// WHEP returns the WebRTC/WHEP read endpoint for a path, e.g.
// "/live-webrtc/<path>/whep".
func (c URLConfig) WHEP(path string) string {
	base := trimSlash(c.WHEPBase)
	if base == "" {
		base = "/live-webrtc"
	}
	return base + "/" + path + "/whep"
}
