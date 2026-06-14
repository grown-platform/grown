package alexa

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"code.pick.haus/grown/grown/internal/music"
)

// streamPathPrefix is the public, session-free audio stream path. The Echo
// fetches bytes from here using a signed URL; there is NO grown session on this
// request, so the signature (HMAC over trackID+expiry) is what authorizes it.
const streamPathPrefix = "/api/v1/music/alexa/stream/"

// signStream computes the URL signature: hex(HMAC-SHA256(secret, trackID|e)).
// e is the unix-seconds expiry. The same function validates inbound requests.
func signStream(secret []byte, trackID string, e int64) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(trackID))
	mac.Write([]byte("|"))
	mac.Write([]byte(strconv.FormatInt(e, 10)))
	return hex.EncodeToString(mac.Sum(nil))
}

// streamURL builds an absolute, signed, session-free HTTPS URL the Echo can GET
// to stream a track's bytes. base is the public origin (e.g.
// https://pick.haus); ttl is how long the signature stays valid.
func streamURL(base string, secret []byte, trackID string, ttl time.Duration) string {
	e := time.Now().Add(ttl).Unix()
	sig := signStream(secret, trackID, e)
	b := strings.TrimRight(base, "/")
	return fmt.Sprintf("%s%s%s?e=%d&s=%s", b, streamPathPrefix, trackID, e, sig)
}

// StreamTrackID extracts the {trackID} from the signed stream path, or ok=false
// if the path doesn't match the prefix.
func StreamTrackID(path string) (string, bool) {
	if !strings.HasPrefix(path, streamPathPrefix) {
		return "", false
	}
	id := strings.TrimPrefix(path, streamPathPrefix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// StreamHandler returns the public (NO auth-wall) handler that validates the
// signed URL and streams the track's bytes with Range support. It mirrors
// internal/music/http.go's StreamHandler: it buffers the blob body and uses
// http.ServeContent so the Echo's Range requests (seek / resume) work.
//
// The track row carries its own org_id, so we look it up scoped to the
// configured default org; a track outside that org 404s.
func (h *Handler) StreamHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := StreamTrackID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		// Validate signature + expiry before touching the database.
		eStr := r.URL.Query().Get("e")
		sig := r.URL.Query().Get("s")
		e, err := strconv.ParseInt(eStr, 10, 64)
		if err != nil || eStr == "" || sig == "" {
			http.Error(w, "bad signature", http.StatusForbidden)
			return
		}
		if time.Now().Unix() > e {
			http.Error(w, "link expired", http.StatusForbidden)
			return
		}
		want := signStream(h.secret, id, e)
		if !hmac.Equal([]byte(want), []byte(sig)) {
			http.Error(w, "bad signature", http.StatusForbidden)
			return
		}

		t, err := h.repo.GetTrack(r.Context(), h.orgID, id)
		if err != nil {
			http.Error(w, "track not found", http.StatusNotFound)
			return
		}
		body, ct, _, err := h.blobs.Get(r.Context(), t.BlobKey)
		if err != nil {
			http.Error(w, "fetch blob", http.StatusInternalServerError)
			return
		}
		defer body.Close()
		// Prefer the blob's own Content-Type, but fall back to the track's
		// recorded type when missing or non-audio (mirrors music.StreamHandler).
		if ct == "" || !strings.HasPrefix(ct, "audio/") {
			ct = t.ContentType
		}
		if ct == "" {
			ct = "audio/mpeg"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Accept-Ranges", "bytes")
		// Buffer into a ReadSeeker so ServeContent can satisfy Range requests
		// (the S3 body is not seekable). Acceptable at homelab library scale.
		data, err := io.ReadAll(body)
		if err != nil {
			http.Error(w, "read blob", http.StatusInternalServerError)
			return
		}
		http.ServeContent(w, r, "", t.UpdatedAt, bytes.NewReader(data))
	})
}

// loadTracks loads the default org's full library. Centralized so the handler +
// tests share one path. Returns an empty slice (never nil-panics) on error.
func (h *Handler) loadTracks(ctx context.Context) ([]music.Track, error) {
	return h.repo.ListTracks(ctx, h.orgID)
}
