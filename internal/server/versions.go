package server

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/sheets"
	"code.pick.haus/grown/grown/internal/slides"
	"code.pick.haus/grown/grown/internal/versions"
	"code.pick.haus/grown/grown/internal/whiteboards"
)

// Version history for Sheets, Slides and Whiteboards (CC7). The apps' own
// packages are untouched: saves are observed by wrapping each gRPC service's
// Save method, session ends by the collab WebSocket returning, and the
// /api/v1/versions/ API resolves documents with the same rules as the collab
// sockets (org member = read+write; per-user grantee = read, write only with an
// editor grant).

// Object types, as used in the API path and grown.object_versions.object_type.
const (
	versionsSheets      = "sheets"
	versionsSlides      = "slides"
	versionsWhiteboards = "whiteboards"
)

// versionsWiring bundles the manager, the per-app loaders and the HTTP handler.
type versionsWiring struct {
	m       *versions.Manager
	handler *versions.Handler
	// load returns a document's current stored data (no access check: only
	// called after one, or for the session-end snapshot of a socket that was
	// authorized).
	load map[string]func(ctx context.Context, id string) (string, error)
}

func callerUserID(r *http.Request) (string, bool) {
	u, ok := auth.UserFromContext(r.Context())
	return u.ID, ok
}

// newVersionsWiring returns nil when there is no database pool.
func newVersionsWiring(cfg Config) *versionsWiring {
	if cfg.Pool == nil {
		return nil
	}
	w := &versionsWiring{
		m:    versions.NewManager(versions.NewPGStore(cfg.Pool), versions.Policy{}),
		load: map[string]func(context.Context, string) (string, error){},
	}
	kinds := map[string]versions.Kind{}
	grants := cfg.SharingRepo

	if repo := cfg.SheetsRepo; repo != nil {
		kinds[versionsSheets] = versions.Kind{
			Resolve: func(r *http.Request, id string) (versions.Doc, bool, error) {
				ctx := r.Context()
				u, _ := auth.UserFromContext(ctx)
				if org, ok := auth.OrgFromContext(ctx); ok {
					if sh, err := repo.Get(ctx, org.ID, id); err == nil {
						return versions.Doc{OrgID: sh.OrgID, Data: sh.Data, CanWrite: true}, true, nil
					}
				}
				if grants != nil {
					if role, ok, err := grants.RoleFor(ctx, u.ID, sharing.TypeSheetsSheet, id); err == nil && ok {
						if sh, err := repo.GetByID(ctx, id); err == nil {
							return versions.Doc{OrgID: sh.OrgID, Data: sh.Data, CanWrite: sharing.CanWrite(role)}, true, nil
						}
					}
				}
				return versions.Doc{}, false, nil
			},
			Save: repo.Save,
		}
		w.load[versionsSheets] = func(ctx context.Context, id string) (string, error) {
			sh, err := repo.GetByID(ctx, id)
			return sh.Data, err
		}
	}
	if repo := cfg.SlidesRepo; repo != nil {
		kinds[versionsSlides] = versions.Kind{
			Resolve: func(r *http.Request, id string) (versions.Doc, bool, error) {
				read, write := slidesDeckAccess(r, id, repo, grants)
				if !read {
					return versions.Doc{}, false, nil
				}
				d, err := repo.GetByID(r.Context(), id)
				if err != nil {
					return versions.Doc{}, false, nil
				}
				return versions.Doc{OrgID: d.OrgID, Data: d.Data, CanWrite: write}, true, nil
			},
			Save: repo.Save,
		}
		w.load[versionsSlides] = func(ctx context.Context, id string) (string, error) {
			d, err := repo.GetByID(ctx, id)
			return d.Data, err
		}
	}
	if repo := cfg.WhiteboardsRepo; repo != nil {
		kinds[versionsWhiteboards] = versions.Kind{
			Resolve: func(r *http.Request, id string) (versions.Doc, bool, error) {
				ctx := r.Context()
				u, _ := auth.UserFromContext(ctx)
				if org, ok := auth.OrgFromContext(ctx); ok {
					if b, err := repo.Get(ctx, org.ID, id); err == nil {
						return versions.Doc{OrgID: b.OrgID, Data: b.Data, CanWrite: true}, true, nil
					}
				}
				if grants != nil {
					if role, ok, err := grants.RoleFor(ctx, u.ID, sharing.TypeWhiteboardBoard, id); err == nil && ok {
						if b, err := repo.GetByID(ctx, id); err == nil {
							return versions.Doc{OrgID: b.OrgID, Data: b.Data, CanWrite: sharing.CanWrite(role)}, true, nil
						}
					}
				}
				return versions.Doc{}, false, nil
			},
			Save: repo.Save,
		}
		w.load[versionsWhiteboards] = func(ctx context.Context, id string) (string, error) {
			b, err := repo.GetByID(ctx, id)
			return b.Data, err
		}
	}
	w.handler = &versions.Handler{M: w.m, Kinds: kinds, UserID: callerUserID}
	return w
}

// afterSave takes a throttled auto snapshot after a successful save. data is
// the saved content, or "" to load it (sheets recompute before storing).
// Failures are logged, never surfaced: versioning must not break saving.
func (w *versionsWiring) afterSave(ctx context.Context, kind, id, data string) {
	if w == nil {
		return
	}
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return
	}
	ctx = context.WithoutCancel(ctx)
	due, err := w.m.Due(ctx, kind, id)
	if err != nil || !due {
		if err != nil {
			slog.Warn("versions: due check", "kind", kind, "id", id, "err", err)
		}
		return
	}
	if data == "" {
		if data, err = w.load[kind](ctx, id); err != nil {
			return
		}
	}
	if _, err := w.m.AutoSnapshot(ctx, kind, id, u.ID, data); err != nil {
		slog.Warn("versions: auto snapshot", "kind", kind, "id", id, "err", err)
	}
}

// sessionEndDelay lets the client's final debounced autosave land before the
// session-end snapshot reads the document.
const sessionEndDelay = 3 * time.Second

// sessionEnded snapshots a document shortly after a collab socket closes, so
// the last edits of a session are kept even inside the auto-snapshot window.
func (w *versionsWiring) sessionEnded(r *http.Request, kind, id string) {
	if w == nil || w.load[kind] == nil {
		return
	}
	u, ok := auth.UserFromContext(r.Context())
	if !ok {
		return
	}
	go func() {
		time.Sleep(sessionEndDelay)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		data, err := w.load[kind](ctx, id)
		if err != nil {
			return
		}
		if _, err := w.m.SessionEnd(ctx, kind, id, u.ID, data); err != nil {
			slog.Warn("versions: session-end snapshot", "kind", kind, "id", id, "err", err)
		}
	}()
}

// The service wrappers embed the app service and only override Save.

type versionedSheets struct {
	*sheets.Service
	v *versionsWiring
}

func (s versionedSheets) SaveSheet(ctx context.Context, req *grownv1.SaveSheetRequest) (*grownv1.SaveSheetResponse, error) {
	resp, err := s.Service.SaveSheet(ctx, req)
	if err == nil {
		s.v.afterSave(ctx, versionsSheets, req.GetId(), "")
	}
	return resp, err
}

type versionedSlides struct {
	*slides.Service
	v *versionsWiring
}

func (s versionedSlides) SaveDeck(ctx context.Context, req *grownv1.SaveDeckRequest) (*grownv1.SaveDeckResponse, error) {
	resp, err := s.Service.SaveDeck(ctx, req)
	if err == nil {
		s.v.afterSave(ctx, versionsSlides, req.GetId(), req.GetData())
	}
	return resp, err
}

type versionedWhiteboards struct {
	*whiteboards.Service
	v *versionsWiring
}

func (s versionedWhiteboards) SaveWhiteboard(ctx context.Context, req *grownv1.SaveWhiteboardRequest) (*grownv1.SaveWhiteboardResponse, error) {
	resp, err := s.Service.SaveWhiteboard(ctx, req)
	if err == nil {
		s.v.afterSave(ctx, versionsWhiteboards, req.GetId(), req.GetData())
	}
	return resp, err
}

// sheetsServer / slidesServer / whiteboardsServer return the service to
// register: wrapped for versioning when it is enabled.
func (w *versionsWiring) sheetsServer(s *sheets.Service) grownv1.SheetsServiceServer {
	if w == nil {
		return s
	}
	return versionedSheets{s, w}
}

func (w *versionsWiring) slidesServer(s *slides.Service) grownv1.SlidesServiceServer {
	if w == nil {
		return s
	}
	return versionedSlides{s, w}
}

func (w *versionsWiring) whiteboardsServer(s *whiteboards.Service) grownv1.WhiteboardsServiceServer {
	if w == nil {
		return s
	}
	return versionedWhiteboards{s, w}
}
