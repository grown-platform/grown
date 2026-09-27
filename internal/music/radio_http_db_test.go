package music

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

func dbCtx(ctx context.Context, orgID, userID string) context.Context {
	ctx = auth.WithUser(ctx, users.User{ID: userID, OrgID: orgID})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default"})
}

// Recording is tied to the /stream proxy connection: the listener registered
// when audio starts is released when the connection ends, and /play no longer
// registers a listener that could leak when a tab closes without /stop.
func TestStreamProxy_RecordingLeaseFollowsConnection(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("audio-bytes"))
	}))
	defer up.Close()
	st, err := repo.UpsertStation(context.Background(), orgID, StationFields{Name: "FM", StreamURL: up.URL})
	if err != nil {
		t.Fatal(err)
	}
	rc := &fakeRadio{}
	h := NewHTTP(repo, &fakeBlobs{}).WithRadio(rc)
	ctx := dbCtx(context.Background(), orgID, userID)

	rr := serve(h.PlayHandler(), httptest.NewRequest(http.MethodPost, "/api/v1/music/radio/"+st.ID+"/play", nil).WithContext(ctx))
	if rr.Code != http.StatusOK || len(rc.started) != 0 {
		t.Fatalf("/play: code %d, starts %v (must not start recording)", rr.Code, rc.started)
	}

	rr = serve(h.StreamProxyHandler(), httptest.NewRequest(http.MethodGet, "/api/v1/music/radio/"+st.ID+"/stream", nil).WithContext(ctx))
	if rr.Code != http.StatusOK || rr.Body.String() != "audio-bytes" {
		t.Fatalf("stream: %d %q", rr.Code, rr.Body.String())
	}
	if len(rc.started) != 1 || len(rc.stopped) != 1 {
		t.Fatalf("starts %v stops %v", rc.started, rc.stopped)
	}
	s, stp := rc.started[0], rc.stopped[0]
	if s[0] != orgID || s[1] != st.ID || s[3] != userID || !strings.HasPrefix(s[2], "stream:") {
		t.Fatalf("start = %v", s)
	}
	if stp[0] != st.ID || stp[1] != s[2] {
		t.Fatalf("stop %v does not release listener %q", stp, s[2])
	}
}

func TestListStations_ReportsCacheUsage(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	st, err := repo.UpsertStation(context.Background(), orgID, StationFields{Name: "FM", StreamURL: "http://x/fm"})
	if err != nil {
		t.Fatal(err)
	}
	radioTrack(t, repo, orgID, userID, st.ID, "music/radio/a", 1500, 1)
	ctx := dbCtx(context.Background(), orgID, userID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/music/radio/stations", nil).WithContext(ctx)

	// Without limits configured, no cache block.
	var plain map[string]json.RawMessage
	_ = json.Unmarshal(serve(NewHTTP(repo, &fakeBlobs{}).ListStationsHandler(), req).Body.Bytes(), &plain)
	if _, ok := plain["cache"]; ok {
		t.Fatal("unexpected cache block without limits")
	}

	h := NewHTTP(repo, &fakeBlobs{}).WithRadioCacheLimits(RadioCacheLimits{MaxBytes: 5 << 30, MaxDays: 30})
	var body struct {
		Stations []radioStationJSON `json:"stations"`
		Cache    radioCacheJSON     `json:"cache"`
	}
	if err := json.Unmarshal(serve(h.ListStationsHandler(), req).Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Cache.UsedBytes != 1500 || body.Cache.Songs != 1 || body.Cache.MaxBytes != 5<<30 || body.Cache.MaxDays != 30 {
		t.Fatalf("cache = %+v", body.Cache)
	}
	if len(body.Stations) != 1 || body.Stations[0].RetentionMode != RetentionDays || body.Stations[0].RetentionDays != DefaultStationRetentionDays {
		t.Fatalf("stations = %+v", body.Stations)
	}
}
