package music

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"code.pick.haus/grown/grown/internal/auth"
)

// radioStationJSON is the wire shape of a station (snake_case to match the
// gateway-style track/playlist JSON the frontend already consumes).
type radioStationJSON struct {
	ID            string `json:"id"`
	OrgID         string `json:"org_id"`
	Name          string `json:"name"`
	StreamURL     string `json:"stream_url"`
	Genre         string `json:"genre"`
	LogoURL       string `json:"logo_url"`
	RetentionMode string `json:"retention_mode"`
	RetentionDays int    `json:"retention_days"`
	TrackCount    int    `json:"track_count"`
	// PlayURL is grown's same-origin proxy the browser <audio> plays, so the
	// external (possibly http://) stream isn't fetched cross-origin/mixed.
	PlayURL string `json:"play_url"`
}

func stationToJSON(s Station) radioStationJSON {
	return radioStationJSON{
		ID:            s.ID,
		OrgID:         s.OrgID,
		Name:          s.Name,
		StreamURL:     s.StreamURL,
		Genre:         s.Genre,
		LogoURL:       s.LogoURL,
		RetentionMode: s.RetentionMode,
		RetentionDays: s.RetentionDays,
		TrackCount:    s.TrackCount,
		PlayURL:       "/api/v1/music/radio/" + s.ID + "/stream",
	}
}

// RadioStationID extracts {id} and the trailing action from radio paths of the
// form /api/v1/music/radio/{id}/{action}. action is "" for /radio/{id}.
func RadioStationID(path string) (id, action string, ok bool) {
	const prefix = "/api/v1/music/radio/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	rest := strings.Trim(strings.TrimPrefix(path, prefix), "/")
	if rest == "" {
		return "", "", false
	}
	parts := strings.SplitN(rest, "/", 2)
	id = parts[0]
	if id == "" {
		return "", "", false
	}
	if len(parts) == 2 {
		action = parts[1]
	}
	return id, action, true
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// ListStationsHandler returns the org's radio stations with cached-track counts.
func (h *HTTP) ListStationsHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		list, err := h.repo.ListStations(r.Context(), o.ID)
		if err != nil {
			http.Error(w, "list stations", http.StatusInternalServerError)
			return
		}
		out := make([]radioStationJSON, 0, len(list))
		for _, s := range list {
			out = append(out, stationToJSON(s))
		}
		writeJSON(w, map[string]any{"stations": out})
	})
}

// CreateStationHandler adds a custom radio station for the caller's org.
// POST /api/v1/music/radio/stations  body: {name, stream_url, genre, logo_url}.
// Idempotent on (org, stream_url) — re-adding the same URL just refreshes the
// name (see UpsertStation), so a user can paste any internet-radio stream.
func (h *HTTP) CreateStationHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var body struct {
			Name      string `json:"name"`
			StreamURL string `json:"stream_url"`
			Genre     string `json:"genre"`
			LogoURL   string `json:"logo_url"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		name := strings.TrimSpace(body.Name)
		stream := strings.TrimSpace(body.StreamURL)
		if name == "" || stream == "" {
			http.Error(w, "name and stream_url are required", http.StatusBadRequest)
			return
		}
		if !strings.HasPrefix(stream, "http://") && !strings.HasPrefix(stream, "https://") {
			http.Error(w, "stream_url must be an http(s) URL", http.StatusBadRequest)
			return
		}
		s, err := h.repo.UpsertStation(r.Context(), o.ID, StationFields{
			Name:      name,
			StreamURL: stream,
			Genre:     strings.TrimSpace(body.Genre),
			LogoURL:   strings.TrimSpace(body.LogoURL),
		})
		if err != nil {
			http.Error(w, "create station", http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"station": stationToJSON(s)})
	})
}

// PlayHandler starts the live tap + recording for the caller (reference-counted
// per station) and returns the station so the client can begin playback.
// POST /api/v1/music/radio/{id}/play
func (h *HTTP) PlayHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := auth.UserFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "no org context", http.StatusInternalServerError)
			return
		}
		id, _, ok := RadioStationID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		station, err := h.repo.GetStation(r.Context(), o.ID, id)
		if err != nil {
			http.Error(w, "station not found", http.StatusNotFound)
			return
		}
		if h.radio != nil {
			// Listener id is per-user; recording is reference-counted per station.
			h.radio.Start(o.ID, station.ID, u.ID, u.ID)
		}
		writeJSON(w, stationToJSON(station))
	})
}

// StopHandler drops the caller as a listener; the tap closes when the last
// listener leaves. POST /api/v1/music/radio/{id}/stop
func (h *HTTP) StopHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := auth.UserFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, _, ok := RadioStationID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		if h.radio != nil {
			h.radio.Stop(id, u.ID)
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// retentionInput is the PUT body for a station's retention policy.
type retentionInput struct {
	RetentionMode string `json:"retention_mode"`
	RetentionDays int    `json:"retention_days"`
}

// RetentionHandler serves GET (read) and PUT (update) of a station's retention.
// GET/PUT /api/v1/music/radio/{id}/retention
func (h *HTTP) RetentionHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, _, ok := RadioStationID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		switch r.Method {
		case http.MethodGet:
			s, err := h.repo.GetStation(r.Context(), o.ID, id)
			if err != nil {
				http.Error(w, "station not found", http.StatusNotFound)
				return
			}
			writeJSON(w, stationToJSON(s))
		case http.MethodPut, http.MethodPatch:
			var in retentionInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				http.Error(w, "bad body", http.StatusBadRequest)
				return
			}
			mode := in.RetentionMode
			if mode != RetentionKeep && mode != RetentionDays {
				http.Error(w, "invalid retention_mode", http.StatusBadRequest)
				return
			}
			s, err := h.repo.SetRetention(r.Context(), o.ID, id, mode, in.RetentionDays)
			if err != nil {
				http.Error(w, "set retention", http.StatusInternalServerError)
				return
			}
			writeJSON(w, stationToJSON(s))
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
}

// proxyClient streams long-lived radio connections; no overall timeout.
var proxyClient = &http.Client{}

// StreamProxyHandler proxies the station's live audio to the browser from
// grown's own origin (so an http:// upstream isn't mixed-content on the https
// SPA, and no cross-origin/auth issues). It requests the stream WITHOUT
// Icy-MetaData so the browser receives clean audio; the server-side recorder
// holds the separate metadata-bearing tap. GET /api/v1/music/radio/{id}/stream
func (h *HTTP) StreamProxyHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, _, ok := RadioStationID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		station, err := h.repo.GetStation(r.Context(), o.ID, id)
		if err != nil {
			http.Error(w, "station not found", http.StatusNotFound)
			return
		}

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		upReq, err := http.NewRequestWithContext(ctx, http.MethodGet, station.StreamURL, nil)
		if err != nil {
			http.Error(w, "bad stream url", http.StatusBadGateway)
			return
		}
		// No Icy-MetaData header: the browser gets a clean audio byte stream.
		upReq.Header.Set("User-Agent", "grown-music/1.0")
		upResp, err := proxyClient.Do(upReq)
		if err != nil {
			http.Error(w, "upstream unreachable", http.StatusBadGateway)
			return
		}
		defer upResp.Body.Close()
		if upResp.StatusCode < 200 || upResp.StatusCode >= 300 {
			http.Error(w, "upstream error", http.StatusBadGateway)
			return
		}

		ct := upResp.Header.Get("Content-Type")
		if ct == "" {
			ct = "audio/mpeg"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "no-cache, no-store")
		w.Header().Set("Connection", "close")
		w.WriteHeader(http.StatusOK)

		flusher, _ := w.(http.Flusher)
		buf := make([]byte, 32<<10)
		for {
			n, rerr := upResp.Body.Read(buf)
			if n > 0 {
				if _, werr := w.Write(buf[:n]); werr != nil {
					return // client disconnected
				}
				if flusher != nil {
					flusher.Flush()
				}
			}
			if rerr != nil {
				if rerr != io.EOF {
					return
				}
				return
			}
		}
	})
}
