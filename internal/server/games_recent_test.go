package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestRecentGames_PrefersManifest verifies the endpoint uses the build-generated
// games-updated.json (git commit times) over filesystem mtime, and applies the
// 7-day window + 4-game cap to it.
func TestRecentGames_PrefersManifest(t *testing.T) {
	dir := t.TempDir()
	gdir := filepath.Join(dir, "games")
	if err := os.MkdirAll(gdir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Six game files; their mtimes are all "now" (as in a container build).
	for _, id := range []string{"pong", "snake", "tetris", "asteroids", "maze", "old"} {
		if err := os.WriteFile(filepath.Join(gdir, id+".html"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UTC()
	iso := func(d time.Duration) string { return now.Add(d).Format(time.RFC3339) }
	manifest := map[string]string{
		"pong":      iso(-1 * time.Hour),       // newest
		"snake":     iso(-2 * 24 * time.Hour),  // recent
		"tetris":    iso(-3 * 24 * time.Hour),  // recent
		"asteroids": iso(-4 * 24 * time.Hour),  // recent
		"maze":      iso(-5 * 24 * time.Hour),  // recent (but beyond top-4)
		"old":       iso(-30 * 24 * time.Hour), // outside 7-day window
	}
	b, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(dir, gamesUpdatedManifest), b, 0o644); err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	recentGamesHandler(dir)(rr, httptest.NewRequest(http.MethodGet, "/api/v1/games/recent", nil))

	var resp struct {
		Recent []recentGame `json:"recent"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Recent) != recentGamesMax {
		t.Fatalf("want %d recent, got %d: %+v", recentGamesMax, len(resp.Recent), resp.Recent)
	}
	// Newest-first ordering from the manifest, capped at 4, "old" excluded.
	want := []string{"pong", "snake", "tetris", "asteroids"}
	for i, id := range want {
		if resp.Recent[i].ID != id {
			t.Errorf("position %d: want %q, got %q", i, id, resp.Recent[i].ID)
		}
	}
	for _, g := range resp.Recent {
		if g.ID == "old" {
			t.Error("game outside the 7-day window must not appear")
		}
	}
}
