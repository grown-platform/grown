package radio

import (
	"context"
	"log/slog"
	"time"
)

// Sweeper is the subset of *music.Repository the retention cleanup needs.
type Sweeper interface {
	SweepExpiredRadioTracks(ctx context.Context) ([]string, error)
}

// StartRetentionSweeper launches a background ticker that trashes radio-source
// tracks past their station's retention window ('days' mode). It returns
// immediately; the loop runs until ctx is cancelled. Errors are logged, never
// fatal — retention is a best-effort storage cap.
func StartRetentionSweeper(ctx context.Context, sweep Sweeper, store Store, interval time.Duration) {
	if interval <= 0 {
		interval = time.Hour
	}
	go func() {
		// Run once shortly after boot, then on the interval.
		t := time.NewTimer(time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
			keys, err := sweep.SweepExpiredRadioTracks(ctx)
			if err != nil {
				slog.Warn("radio: retention sweep failed", "err", err)
			} else if len(keys) > 0 {
				for _, k := range keys {
					if store != nil && k != "" {
						_ = store.Delete(ctx, k)
					}
				}
				slog.Info("radio: retention swept expired tracks", "count", len(keys))
			}
			t.Reset(interval)
		}
	}()
}
