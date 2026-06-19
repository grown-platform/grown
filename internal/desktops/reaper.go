package desktops

import (
	"context"
	"log/slog"
	"time"
)

// Reap stops every live session whose idle heartbeat is older than IdleTTL,
// tearing down its pod/service/connection (persistent PVCs are kept). Idempotent
// and safe to call concurrently with launches. Returns the number reaped.
func (s *Service) Reap(ctx context.Context) (int, error) {
	if s == nil || !s.cfg.Enabled {
		return 0, nil
	}
	cutoff := s.now().Add(-s.cfg.IdleTTL)
	idle, err := s.store.ListIdle(ctx, cutoff)
	if err != nil {
		return 0, err
	}
	for _, sess := range idle {
		s.teardown(ctx, sess)
		if err := s.store.SetState(ctx, sess.ID, "stopped", "idle-reaped"); err != nil {
			slog.WarnContext(ctx, "desktops: reap SetState failed", "session", sess.ID, "err", err)
		}
	}
	return len(idle), nil
}

// RunReaper reaps on a fixed interval until ctx is cancelled. Start it once at
// server boot when the subsystem is enabled.
func (s *Service) RunReaper(ctx context.Context, interval time.Duration) {
	if s == nil || !s.cfg.Enabled {
		return
	}
	if interval <= 0 {
		interval = time.Minute
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, err := s.Reap(ctx); err != nil {
				slog.WarnContext(ctx, "desktops: reap cycle failed", "err", err)
			}
		}
	}
}
