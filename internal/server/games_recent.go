package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// recentGamesPath is the public, read-only endpoint that reports which bundled
// games' HTML files were updated recently. The /games frontend uses it to show
// a small "NEW" badge on freshly-updated games.
const recentGamesPath = "/api/v1/games/recent"

// recentGamesWindow bounds "recent" to the last 7 days; recentGamesMax caps how
// many games can carry the NEW badge at once (the newest few even if more
// changed in the window).
const (
	recentGamesWindow = 7 * 24 * time.Hour
	recentGamesMax    = 4
)

// recentGame is one entry in the /api/v1/games/recent response. id is the game
// id the catalog uses (the .html basename, e.g. "pong" for games/pong.html).
type recentGame struct {
	ID        string `json:"id"`
	UpdatedAt string `json:"updated_at"`
}

// recentGamesHandler stats <StaticDir>/games/*.html and returns the up-to-4
// most-recently-modified whose mtime falls within the last 7 days, newest
// first. It is public (no auth) — the games themselves are public too.
//
// Only top-level games/*.html files are considered, which is exactly how the
// arcade catalog maps a game id to its file (externalUrl: /games/<id>.html).
// Native ports (games/<id>/play.html) live in subdirectories and are skipped.
func recentGamesHandler(staticDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		out := struct {
			Recent []recentGame `json:"recent"`
		}{Recent: []recentGame{}}

		if staticDir != "" {
			matches, _ := filepath.Glob(filepath.Join(staticDir, "games", "*.html"))
			cutoff := time.Now().Add(-recentGamesWindow)
			for _, m := range matches {
				fi, err := os.Stat(m)
				if err != nil || fi.IsDir() {
					continue
				}
				if fi.ModTime().Before(cutoff) {
					continue
				}
				id := strings.TrimSuffix(filepath.Base(m), ".html")
				out.Recent = append(out.Recent, recentGame{
					ID:        id,
					UpdatedAt: fi.ModTime().UTC().Format(time.RFC3339),
				})
			}
			// Newest first, then keep only the freshest few.
			sort.Slice(out.Recent, func(i, j int) bool {
				return out.Recent[i].UpdatedAt > out.Recent[j].UpdatedAt
			})
			if len(out.Recent) > recentGamesMax {
				out.Recent = out.Recent[:recentGamesMax]
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(out)
	}
}
