package drive

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/users"
)

// Service implements grownv1.DriveServiceServer.
type Service struct {
	grownv1.UnimplementedDriveServiceServer
	repo   *Repository
	acl    *ACL
	blobs  *Blobs
	grants *sharing.Repository // nil disables per-user ACL grants
	notify Notifier            // best-effort grant notification; nil = no-op
}

// Notifier receives a best-effort callback when a per-user grant is created. It
// must not block; failures are ignored. nil disables notification.
type Notifier interface {
	NotifyGranted(ctx context.Context, granteeUserID, objectType, objectID, role string)
}

func NewService(repo *Repository, acl *ACL, blobs *Blobs) *Service {
	return &Service{repo: repo, acl: acl, blobs: blobs}
}

// WithSharing wires the per-user ACL grant repository (object_grants) and an
// optional notifier, enabling GrantAccess/ListGrants/RevokeAccess, the
// "Shared with me" view, and cross-org grant reads. Returns s for chaining.
func (s *Service) WithSharing(grants *sharing.Repository, notify Notifier) *Service {
	s.grants = grants
	s.notify = notify
	return s
}

// accessFile resolves a file the caller may read: an org member sees their org's
// files; otherwise a per-user grant (object_grants) is required. Returns the
// file, the caller's effective role ("owner"/"editor"/"commenter"/"viewer"), and
// a gRPC error (NotFound when neither path grants access — we never reveal the
// difference between "absent" and "forbidden"). This is the security-critical
// cross-org read gate.
func (s *Service) accessFile(ctx context.Context, org orgs.Org, user users.User, fileID string) (File, string, error) {
	// Org-member path: normal org-scoped fetch.
	if f, err := s.repo.Get(ctx, org.ID, fileID); err == nil {
		role := "editor" // org members have full access in V1
		if f.OwnerID == user.ID {
			role = "owner"
		}
		return f, role, nil
	} else if !errors.Is(err, ErrNotFound) {
		return File{}, "", status.Errorf(codes.Internal, "get: %v", err)
	}

	// Grant path: a per-user grant lets a non-org-member read this one file.
	if s.grants != nil {
		role, ok, err := s.grants.RoleFor(ctx, user.ID, sharing.TypeDriveFile, fileID)
		if err != nil {
			return File{}, "", status.Errorf(codes.Internal, "grant lookup: %v", err)
		}
		if ok {
			f, gerr := s.repo.GetByID(ctx, fileID)
			if errors.Is(gerr, ErrNotFound) {
				return File{}, "", status.Error(codes.NotFound, "file not found")
			}
			if gerr != nil {
				return File{}, "", status.Errorf(codes.Internal, "get: %v", gerr)
			}
			return f, role, nil
		}
	}
	return File{}, "", status.Error(codes.NotFound, "file not found")
}

// canManageGrants reports whether the caller may grant/revoke access on a file:
// org members (the file is in their org) qualify. Returns NotFound otherwise so
// non-members can't probe existence.
func (s *Service) canManageGrants(ctx context.Context, org orgs.Org, fileID string) (File, error) {
	f, err := s.repo.Get(ctx, org.ID, fileID)
	if errors.Is(err, ErrNotFound) {
		return File{}, status.Error(codes.NotFound, "file not found")
	}
	if err != nil {
		return File{}, status.Errorf(codes.Internal, "get: %v", err)
	}
	return f, nil
}

// requireAuth pulls the authenticated user + org from ctx, returning gRPC
// status errors on failure. Used by every method that mutates or reads
// org-scoped data.
func (s *Service) requireAuth(ctx context.Context) (orgs.Org, users.User, error) {
	user, uok := auth.UserFromContext(ctx)
	if !uok {
		return orgs.Org{}, users.User{}, status.Error(codes.Unauthenticated, "no session")
	}
	org, ook := auth.OrgFromContext(ctx)
	if !ook {
		return orgs.Org{}, user, status.Error(codes.PermissionDenied, "no org")
	}
	return org, user, nil
}

func (s *Service) ListFiles(ctx context.Context, req *grownv1.ListFilesRequest) (*grownv1.ListFilesResponse, error) {
	org, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	files, next, err := s.repo.ListChildren(ctx, org.ID, req.GetParent(), req.GetIncludeTrashed(), int(req.GetPageSize()), req.GetPageToken())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list: %v", err)
	}
	out := make([]*grownv1.File, 0, len(files))
	for _, f := range files {
		out = append(out, toProto(f))
	}
	return &grownv1.ListFilesResponse{Files: out, NextPageToken: next}, nil
}

func (s *Service) GetFile(ctx context.Context, req *grownv1.GetFileRequest) (*grownv1.GetFileResponse, error) {
	org, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	// Org member OR per-user grantee (cross-org). accessFile returns NotFound
	// for callers with neither path — no object leaks without a grant.
	f, _, aerr := s.accessFile(ctx, org, user, req.GetId())
	if aerr != nil {
		return nil, aerr
	}
	return &grownv1.GetFileResponse{File: toProto(f)}, nil
}

func (s *Service) CreateFolder(ctx context.Context, req *grownv1.CreateFolderRequest) (*grownv1.CreateFolderResponse, error) {
	org, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetName() == "" {
		return nil, status.Error(codes.InvalidArgument, "name required")
	}
	f, cerr := s.repo.CreateFolder(ctx, org.ID, user.ID, req.GetParent(), req.GetName())
	if cerr != nil {
		return nil, status.Errorf(codes.Internal, "create folder: %v", cerr)
	}
	return &grownv1.CreateFolderResponse{File: toProto(f)}, nil
}

func (s *Service) UpdateFile(ctx context.Context, req *grownv1.UpdateFileRequest) (*grownv1.UpdateFileResponse, error) {
	org, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetRestoreFromTrash() {
		if rerr := s.repo.Restore(ctx, org.ID, req.GetId()); rerr != nil && !errors.Is(rerr, ErrNotFound) {
			return nil, status.Errorf(codes.Internal, "restore: %v", rerr)
		}
	}
	var parentPtr *string
	if req.GetParent() != "" {
		p := req.GetParent()
		parentPtr = &p
	}
	f, uerr := s.repo.UpdateNameOrParent(ctx, org.ID, req.GetId(), req.GetName(), parentPtr)
	if errors.Is(uerr, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "file not found")
	}
	if uerr != nil {
		return nil, status.Errorf(codes.Internal, "update: %v", uerr)
	}
	return &grownv1.UpdateFileResponse{File: toProto(f)}, nil
}

// CopyFile duplicates a file's blob and metadata into the same parent folder.
// The copy gets a " (copy)" name suffix unless an explicit name is supplied.
// Folders are not copyable in V1.
func (s *Service) CopyFile(ctx context.Context, req *grownv1.CopyFileRequest) (*grownv1.CopyFileResponse, error) {
	org, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	src, gerr := s.repo.Get(ctx, org.ID, req.GetId())
	if errors.Is(gerr, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "file not found")
	}
	if gerr != nil {
		return nil, status.Errorf(codes.Internal, "get: %v", gerr)
	}
	if src.MimeType == FolderMimeType || src.StorageKey == nil {
		return nil, status.Error(codes.InvalidArgument, "only files can be copied")
	}

	name := req.GetName()
	if name == "" {
		name = copyName(src.Name)
	}

	parent := ""
	if src.ParentID != nil {
		parent = *src.ParentID
	}

	// Copy the blob to a fresh key so the two files have independent storage.
	newKey, kerr := newStorageKey()
	if kerr != nil {
		return nil, status.Errorf(codes.Internal, "key: %v", kerr)
	}
	body, mime, size, berr := s.blobs.Get(ctx, *src.StorageKey)
	if berr != nil {
		return nil, status.Errorf(codes.Internal, "read source blob: %v", berr)
	}
	defer body.Close()
	if size <= 0 {
		size = src.SizeBytes
	}
	if mime == "" {
		mime = src.MimeType
	}
	if perr := s.blobs.Put(ctx, newKey, mime, size, body); perr != nil {
		return nil, status.Errorf(codes.Internal, "write copy blob: %v", perr)
	}

	f, cerr := s.repo.CreateFile(ctx, org.ID, user.ID, parent, name, src.MimeType, newKey, src.SizeBytes)
	if cerr != nil {
		// Roll back the blob if metadata insert fails. Best-effort.
		_ = s.blobs.Delete(ctx, newKey)
		return nil, status.Errorf(codes.Internal, "copy metadata: %v", cerr)
	}
	return &grownv1.CopyFileResponse{File: toProto(f)}, nil
}

// copyName produces a "(copy)" variant of a filename, inserting the suffix
// before the extension so "report.pdf" becomes "report (copy).pdf".
func copyName(name string) string {
	dot := strings.LastIndex(name, ".")
	if dot <= 0 {
		return name + " (copy)"
	}
	return name[:dot] + " (copy)" + name[dot:]
}

func (s *Service) TrashFile(ctx context.Context, req *grownv1.TrashFileRequest) (*grownv1.TrashFileResponse, error) {
	org, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if terr := s.repo.Trash(ctx, org.ID, req.GetId()); terr != nil {
		if errors.Is(terr, ErrNotFound) {
			return nil, status.Error(codes.NotFound, "file not found")
		}
		return nil, status.Errorf(codes.Internal, "trash: %v", terr)
	}
	return &grownv1.TrashFileResponse{}, nil
}

func (s *Service) DeleteForever(ctx context.Context, req *grownv1.DeleteForeverRequest) (*grownv1.DeleteForeverResponse, error) {
	org, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	key, derr := s.repo.DeleteForever(ctx, org.ID, req.GetId())
	if errors.Is(derr, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "file not found")
	}
	if derr != nil {
		return nil, status.Errorf(codes.Internal, "delete: %v", derr)
	}
	if key != "" {
		if berr := s.blobs.Delete(ctx, key); berr != nil {
			// Metadata is gone; blob delete best-effort. Surface as DataLoss so
			// the operator can investigate orphan blobs.
			return nil, status.Errorf(codes.DataLoss, "blob delete: %v", berr)
		}
	}
	return &grownv1.DeleteForeverResponse{}, nil
}

func (s *Service) CreateShare(ctx context.Context, req *grownv1.CreateShareRequest) (*grownv1.CreateShareResponse, error) {
	_, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	role := req.GetRole()
	if role == "" {
		role = "viewer"
	}
	var exp time.Time
	if e := req.GetExpiresAt(); e > 0 {
		exp = time.Unix(e, 0)
	}
	tok, cerr := s.acl.CreateShare(ctx, req.GetFileId(), user.ID, role, exp)
	if cerr != nil {
		return nil, status.Errorf(codes.InvalidArgument, "create share: %v", cerr)
	}
	share, lerr := s.acl.LookupShare(ctx, tok)
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "lookup share: %v", lerr)
	}
	return &grownv1.CreateShareResponse{Share: shareToProto(share)}, nil
}

func (s *Service) ListShares(ctx context.Context, req *grownv1.ListSharesRequest) (*grownv1.ListSharesResponse, error) {
	_, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	shares, lerr := s.acl.ListSharesForFile(ctx, req.GetFileId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list shares: %v", lerr)
	}
	out := make([]*grownv1.Share, 0, len(shares))
	for _, sh := range shares {
		out = append(out, shareToProto(sh))
	}
	return &grownv1.ListSharesResponse{Shares: out}, nil
}

func (s *Service) RevokeShare(ctx context.Context, req *grownv1.RevokeShareRequest) (*grownv1.RevokeShareResponse, error) {
	_, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if rerr := s.acl.RevokeShare(ctx, req.GetToken()); rerr != nil {
		if errors.Is(rerr, ErrShareNotFound) {
			return nil, status.Error(codes.NotFound, "share not found")
		}
		return nil, status.Errorf(codes.Internal, "revoke: %v", rerr)
	}
	return &grownv1.RevokeShareResponse{}, nil
}

// GrantAccess grants a grown user a role on a file the caller's org owns.
func (s *Service) GrantAccess(ctx context.Context, req *grownv1.GrantAccessRequest) (*grownv1.GrantAccessResponse, error) {
	org, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return nil, status.Error(codes.Unimplemented, "sharing not enabled")
	}
	role := req.GetRole()
	if !sharing.ValidRole(role) {
		return nil, status.Error(codes.InvalidArgument, "role must be viewer, commenter, or editor")
	}
	if req.GetGranteeUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "grantee_user_id required")
	}
	if _, err := s.canManageGrants(ctx, org, req.GetFileId()); err != nil {
		return nil, err
	}
	if err := s.grants.GrantAccess(ctx, sharing.TypeDriveFile, req.GetFileId(), req.GetGranteeUserId(), role, user.ID); err != nil {
		return nil, status.Errorf(codes.Internal, "grant: %v", err)
	}
	if s.notify != nil {
		s.notify.NotifyGranted(ctx, req.GetGranteeUserId(), sharing.TypeDriveFile, req.GetFileId(), role)
	}
	// Return the resolved grant (with grantee name/email) for the UI.
	list, lerr := s.grants.ListGrantsForObject(ctx, sharing.TypeDriveFile, req.GetFileId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list grants: %v", lerr)
	}
	for _, g := range list {
		if g.GranteeUserID == req.GetGranteeUserId() {
			return &grownv1.GrantAccessResponse{Grant: grantToProto(g)}, nil
		}
	}
	return &grownv1.GrantAccessResponse{}, nil
}

// ListGrants returns the per-user ACL grants on a file in the caller's org.
func (s *Service) ListGrants(ctx context.Context, req *grownv1.ListGrantsRequest) (*grownv1.ListGrantsResponse, error) {
	org, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return &grownv1.ListGrantsResponse{}, nil
	}
	if _, err := s.canManageGrants(ctx, org, req.GetFileId()); err != nil {
		return nil, err
	}
	list, lerr := s.grants.ListGrantsForObject(ctx, sharing.TypeDriveFile, req.GetFileId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list grants: %v", lerr)
	}
	out := make([]*grownv1.ObjectGrant, 0, len(list))
	for _, g := range list {
		out = append(out, grantToProto(g))
	}
	return &grownv1.ListGrantsResponse{Grants: out}, nil
}

// RevokeAccess removes a user's per-user grant on a file in the caller's org.
func (s *Service) RevokeAccess(ctx context.Context, req *grownv1.RevokeAccessRequest) (*grownv1.RevokeAccessResponse, error) {
	org, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return nil, status.Error(codes.Unimplemented, "sharing not enabled")
	}
	if _, err := s.canManageGrants(ctx, org, req.GetFileId()); err != nil {
		return nil, err
	}
	if err := s.grants.RevokeAccess(ctx, sharing.TypeDriveFile, req.GetFileId(), req.GetGranteeUserId()); err != nil {
		return nil, status.Errorf(codes.Internal, "revoke: %v", err)
	}
	return &grownv1.RevokeAccessResponse{}, nil
}

// ListSharedWithMe returns files granted to the caller by a per-user ACL grant
// (possibly cross-org), excluding the caller's own org files.
// ListFileVersions returns the version history for a file.
func (s *Service) ListFileVersions(ctx context.Context, req *grownv1.ListFileVersionsRequest) (*grownv1.ListFileVersionsResponse, error) {
	org, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	// Ensure the file is accessible to the caller (org-scoped).
	if _, err := s.repo.Get(ctx, org.ID, req.GetFileId()); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, status.Error(codes.NotFound, "file not found")
		}
		return nil, status.Errorf(codes.Internal, "get: %v", err)
	}
	versions, lerr := s.repo.ListVersions(ctx, org.ID, req.GetFileId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list versions: %v", lerr)
	}
	out := make([]*grownv1.FileVersion, 0, len(versions))
	for _, v := range versions {
		out = append(out, versionToProto(v))
	}
	return &grownv1.ListFileVersionsResponse{Versions: out}, nil
}

// RestoreFileVersion makes a prior version the current blob of the file,
// first snapshotting the current blob as a new version so no history is lost.
func (s *Service) RestoreFileVersion(ctx context.Context, req *grownv1.RestoreFileVersionRequest) (*grownv1.RestoreFileVersionResponse, error) {
	org, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}

	// Fetch the version to restore.
	ver, verr := s.repo.GetVersion(ctx, org.ID, req.GetVersionId())
	if errors.Is(verr, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "version not found")
	}
	if verr != nil {
		return nil, status.Errorf(codes.Internal, "get version: %v", verr)
	}
	if ver.FileID != req.GetFileId() {
		return nil, status.Error(codes.NotFound, "version not found for this file")
	}

	// Snapshot the current blob as a version before overwriting.
	cur, gerr := s.repo.Get(ctx, org.ID, req.GetFileId())
	if errors.Is(gerr, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "file not found")
	}
	if gerr != nil {
		return nil, status.Errorf(codes.Internal, "get file: %v", gerr)
	}
	if cur.StorageKey == nil {
		return nil, status.Error(codes.InvalidArgument, "cannot restore versions of a folder")
	}

	// Snapshot current blob as a version.
	if _, serr := s.repo.CreateVersion(ctx, org.ID, req.GetFileId(), *cur.StorageKey, cur.MimeType, user.ID, cur.SizeBytes); serr != nil {
		return nil, status.Errorf(codes.Internal, "snapshot current: %v", serr)
	}

	// Overwrite the file row to point at the restored blob.
	if _, rerr := s.repo.ReplaceBlob(ctx, org.ID, req.GetFileId(), ver.BlobKey, ver.ContentType, ver.SizeBytes); rerr != nil {
		return nil, status.Errorf(codes.Internal, "replace blob: %v", rerr)
	}

	// Delete the now-restored version row from the history (it is now "current").
	if _, derr := s.repo.pool.Exec(ctx,
		`DELETE FROM grown.drive_file_versions WHERE org_id = $1 AND id = $2`,
		org.ID, ver.ID,
	); derr != nil {
		// Non-fatal: the blob was restored; the orphan version row is benign.
		_ = derr
	}

	updated, gerr := s.repo.Get(ctx, org.ID, req.GetFileId())
	if gerr != nil {
		return nil, status.Errorf(codes.Internal, "get updated: %v", gerr)
	}
	return &grownv1.RestoreFileVersionResponse{File: toProto(updated)}, nil
}

func (s *Service) ListSharedWithMe(ctx context.Context, _ *grownv1.ListSharedWithMeRequest) (*grownv1.ListSharedWithMeResponse, error) {
	org, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return &grownv1.ListSharedWithMeResponse{}, nil
	}
	ids, err := s.grants.ListObjectIDsGrantedToUser(ctx, user.ID, sharing.TypeDriveFile)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "shared ids: %v", err)
	}
	files, err := s.repo.GetByIDs(ctx, ids)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "shared files: %v", err)
	}
	out := make([]*grownv1.File, 0, len(files))
	for _, f := range files {
		// A grant to a file already in my org is redundant for this view.
		if f.OrgID == org.ID {
			continue
		}
		out = append(out, toProto(f))
	}
	return &grownv1.ListSharedWithMeResponse{Files: out}, nil
}

// StarFile marks a file as starred for the calling user.
func (s *Service) StarFile(ctx context.Context, req *grownv1.StarFileRequest) (*grownv1.StarFileResponse, error) {
	org, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	// Ensure the file is visible to the caller (org-scoped check).
	if _, _, aerr := s.accessFile(ctx, org, user, req.GetFileId()); aerr != nil {
		return nil, aerr
	}
	if serr := s.repo.StarFile(ctx, user.ID, req.GetFileId()); serr != nil {
		return nil, status.Errorf(codes.Internal, "star: %v", serr)
	}
	return &grownv1.StarFileResponse{}, nil
}

// UnstarFile removes the star from a file for the calling user.
func (s *Service) UnstarFile(ctx context.Context, req *grownv1.UnstarFileRequest) (*grownv1.UnstarFileResponse, error) {
	_, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	if serr := s.repo.UnstarFile(ctx, user.ID, req.GetFileId()); serr != nil {
		return nil, status.Errorf(codes.Internal, "unstar: %v", serr)
	}
	return &grownv1.UnstarFileResponse{}, nil
}

// ListStarred returns files starred by the calling user that are not trashed.
func (s *Service) ListStarred(ctx context.Context, req *grownv1.ListStarredRequest) (*grownv1.ListStarredResponse, error) {
	_, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	files, next, err := s.repo.ListStarred(ctx, user.ID, int(req.GetPageSize()), req.GetPageToken())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list starred: %v", err)
	}
	out := make([]*grownv1.File, 0, len(files))
	for _, f := range files {
		out = append(out, toProtoStarred(f, true))
	}
	return &grownv1.ListStarredResponse{Files: out, NextPageToken: next}, nil
}

// ListRecent returns the caller's org files ordered by last modification, most
// recent first, excluding trashed items.
func (s *Service) ListRecent(ctx context.Context, req *grownv1.ListRecentRequest) (*grownv1.ListRecentResponse, error) {
	org, user, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	files, next, err := s.repo.ListRecent(ctx, org.ID, int(req.GetPageSize()), req.GetPageToken())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list recent: %v", err)
	}
	// Annotate with star state for the caller.
	ids := make([]string, len(files))
	for i, f := range files {
		ids[i] = f.ID
	}
	starred, serr := s.repo.StarredFileIDs(ctx, user.ID, ids)
	if serr != nil {
		// Non-fatal: serve files without star annotation rather than failing.
		starred = nil
	}
	out := make([]*grownv1.File, 0, len(files))
	for _, f := range files {
		out = append(out, toProtoStarred(f, starred[f.ID]))
	}
	return &grownv1.ListRecentResponse{Files: out, NextPageToken: next}, nil
}

// ListTrash returns trashed files in the caller's org.
func (s *Service) ListTrash(ctx context.Context, req *grownv1.ListTrashRequest) (*grownv1.ListTrashResponse, error) {
	org, _, err := s.requireAuth(ctx)
	if err != nil {
		return nil, err
	}
	files, next, err := s.repo.ListTrash(ctx, org.ID, int(req.GetPageSize()), req.GetPageToken())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list trash: %v", err)
	}
	out := make([]*grownv1.File, 0, len(files))
	for _, f := range files {
		out = append(out, toProto(f))
	}
	return &grownv1.ListTrashResponse{Files: out, NextPageToken: next}, nil
}

func grantToProto(g sharing.Grant) *grownv1.ObjectGrant {
	return &grownv1.ObjectGrant{
		GranteeUserId: g.GranteeUserID,
		GranteeName:   g.GranteeName,
		GranteeEmail:  g.GranteeEmail,
		Role:          g.Role,
		GrantedBy:     g.GrantedBy,
	}
}

func toProto(f File) *grownv1.File {
	return toProtoStarred(f, false)
}

func toProtoStarred(f File, starred bool) *grownv1.File {
	parent := ""
	if f.ParentID != nil {
		parent = *f.ParentID
	}
	trashed := f.TrashedAt != nil
	return &grownv1.File{
		Id:        f.ID,
		OrgId:     f.OrgID,
		OwnerId:   f.OwnerID,
		ParentId:  parent,
		Name:      f.Name,
		MimeType:  f.MimeType,
		SizeBytes: f.SizeBytes,
		Trashed:   trashed,
		Starred:   starred,
		CreatedAt: f.CreatedAt.Unix(),
		UpdatedAt: f.UpdatedAt.Unix(),
	}
}

func shareToProto(s Share) *grownv1.Share {
	exp := int64(0)
	if s.ExpiresAt != nil {
		exp = s.ExpiresAt.Unix()
	}
	return &grownv1.Share{
		Token:     s.Token,
		FileId:    s.FileID,
		Role:      s.Role,
		CreatedBy: s.CreatedBy,
		CreatedAt: s.CreatedAt.Unix(),
		ExpiresAt: exp,
	}
}

// NewStorageKey returns a fresh blob key. Format: blobs/<8-hex>/<8-hex>.
// Exported so other packages (e.g. cloudimport) can allocate keys without
// going through the HTTP upload handler.
func NewStorageKey() (string, error) { return newStorageKey() }

// newStorageKey returns a fresh blob key. Format: blobs/<8-hex>/<8-hex>. Used
// by Task 10's Upload HTTP handler — exported as a function rather than baked
// into the handler so unit tests can construct keys deterministically.
func newStorageKey() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "blobs/" + hex.EncodeToString(buf[:8]) + "/" + hex.EncodeToString(buf[8:]), nil
}

// UploadHandler accepts a multipart upload at POST /api/v1/drive/files/upload.
// Form fields:
//   - file (required) — the blob
//   - parent (optional) — folder id for new files
//   - file_id (optional) — when present, replaces the content of an existing
//     file and snapshots its current blob as a version
//
// V1 cap is 100 MB; ParseMultipartForm holds 10 MB in memory and spills the
// rest to a temp file.
func (s *Service) UploadHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user, uok := auth.UserFromContext(ctx)
		org, ook := auth.OrgFromContext(ctx)
		if !uok || !ook {
			http.Error(w, "no session", http.StatusUnauthorized)
			return
		}
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			http.Error(w, "parse multipart: "+err.Error(), http.StatusBadRequest)
			return
		}
		parent := r.FormValue("parent")
		fileID := r.FormValue("file_id") // non-empty = replace existing file content
		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "missing file part", http.StatusBadRequest)
			return
		}
		defer file.Close()

		key, kerr := newStorageKey()
		if kerr != nil {
			http.Error(w, "internal", http.StatusInternalServerError)
			return
		}

		mime := header.Header.Get("Content-Type")
		if mime == "" {
			mime = "application/octet-stream"
		}
		if perr := s.blobs.Put(ctx, key, mime, header.Size, file); perr != nil {
			http.Error(w, "blob put: "+perr.Error(), http.StatusInternalServerError)
			return
		}

		if fileID != "" {
			// Replace-content path: snapshot the current blob as a version, then
			// swap the file row's storage_key to the newly uploaded blob.
			cur, gerr := s.repo.Get(ctx, org.ID, fileID)
			if errors.Is(gerr, ErrNotFound) {
				_ = s.blobs.Delete(ctx, key)
				http.Error(w, "file not found", http.StatusNotFound)
				return
			}
			if gerr != nil {
				_ = s.blobs.Delete(ctx, key)
				http.Error(w, "get file: "+gerr.Error(), http.StatusInternalServerError)
				return
			}
			if cur.StorageKey != nil && *cur.StorageKey != "" {
				// Snapshot current blob as a version before overwriting.
				if _, serr := s.repo.CreateVersion(ctx, org.ID, fileID, *cur.StorageKey, cur.MimeType, user.ID, cur.SizeBytes); serr != nil {
					// Non-fatal: still proceed with the replace; log as best-effort.
					_ = serr
				}
			}
			if _, rerr := s.repo.ReplaceBlob(ctx, org.ID, fileID, key, mime, header.Size); rerr != nil {
				_ = s.blobs.Delete(ctx, key)
				http.Error(w, "replace blob: "+rerr.Error(), http.StatusInternalServerError)
				return
			}
			updated, gerr := s.repo.Get(ctx, org.ID, fileID)
			if gerr != nil {
				http.Error(w, "get updated: "+gerr.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = writeFileJSON(w, updated)
			return
		}

		// New-file path.
		f, cerr := s.repo.CreateFile(ctx, org.ID, user.ID, parent, header.Filename, mime, key, header.Size)
		if cerr != nil {
			// Roll back the blob if we can't record metadata. Best-effort.
			_ = s.blobs.Delete(ctx, key)
			http.Error(w, "metadata: "+cerr.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = writeFileJSON(w, f)
	})
}

// DownloadHandler streams the blob for a file the caller can access.
// GET /api/v1/drive/files/{id}/content
func (s *Service) DownloadHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		const prefix = "/api/v1/drive/files/"
		const suffix = "/content"
		path := r.URL.Path
		if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
			http.NotFound(w, r)
			return
		}
		id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
		org, ook := auth.OrgFromContext(ctx)
		if !ook {
			http.Error(w, "no org", http.StatusUnauthorized)
			return
		}
		user, uok := auth.UserFromContext(ctx)
		if !uok {
			http.Error(w, "no session", http.StatusUnauthorized)
			return
		}
		// Same access gate as GetFile: org member OR per-user grantee.
		f, _, aerr := s.accessFile(ctx, org, user, id)
		if aerr != nil {
			// accessFile returns gRPC NotFound for both absent and forbidden.
			http.NotFound(w, r)
			return
		}
		if f.StorageKey == nil {
			http.Error(w, "not a file", http.StatusBadRequest)
			return
		}
		body, mime, size, gerr := s.blobs.Get(ctx, *f.StorageKey)
		if gerr != nil {
			http.Error(w, "blob get: "+gerr.Error(), http.StatusInternalServerError)
			return
		}
		defer body.Close()
		w.Header().Set("Content-Type", mime)
		if size > 0 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		}
		// Inline content-disposition so browsers preview rather than download.
		// Escape quotes in the filename to keep the header well-formed.
		w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", strings.ReplaceAll(f.Name, "\"", "\\\"")))
		_, _ = io.Copy(w, body)
	})
}

func versionToProto(v FileVersion) *grownv1.FileVersion {
	return &grownv1.FileVersion{
		Id:          v.ID,
		FileId:      v.FileID,
		BlobKey:     v.BlobKey,
		SizeBytes:   v.SizeBytes,
		ContentType: v.ContentType,
		UploadedBy:  v.UploadedBy,
		CreatedAt:   v.CreatedAt.Unix(),
	}
}

// VersionDownloadHandler streams the blob for a specific file version.
// GET /api/v1/drive/files/{id}/versions/{vid}/content
func (s *Service) VersionDownloadHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		// Parse /api/v1/drive/files/{id}/versions/{vid}/content
		const prefix = "/api/v1/drive/files/"
		const suffix = "/content"
		path := r.URL.Path
		if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
			http.NotFound(w, r)
			return
		}
		trimmed := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
		// trimmed = "{id}/versions/{vid}"
		parts := strings.SplitN(trimmed, "/versions/", 2)
		if len(parts) != 2 {
			http.NotFound(w, r)
			return
		}
		fileID, versionID := parts[0], parts[1]

		org, ook := auth.OrgFromContext(ctx)
		if !ook {
			http.Error(w, "no org", http.StatusUnauthorized)
			return
		}
		user, uok := auth.UserFromContext(ctx)
		if !uok {
			http.Error(w, "no session", http.StatusUnauthorized)
			return
		}
		// Verify the caller can access the file.
		f, _, aerr := s.accessFile(ctx, org, user, fileID)
		if aerr != nil {
			http.NotFound(w, r)
			return
		}

		ver, verr := s.repo.GetVersion(ctx, org.ID, versionID)
		if errors.Is(verr, ErrNotFound) {
			http.NotFound(w, r)
			return
		}
		if verr != nil {
			http.Error(w, "version lookup: "+verr.Error(), http.StatusInternalServerError)
			return
		}
		if ver.FileID != fileID {
			http.NotFound(w, r)
			return
		}

		body, mime, size, gerr := s.blobs.Get(ctx, ver.BlobKey)
		if gerr != nil {
			http.Error(w, "blob get: "+gerr.Error(), http.StatusInternalServerError)
			return
		}
		defer body.Close()
		if mime == "" {
			mime = ver.ContentType
		}
		w.Header().Set("Content-Type", mime)
		if size > 0 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", strings.ReplaceAll(f.Name, "\"", "\\\"")))
		_, _ = io.Copy(w, body)
	})
}

// writeFileJSON serializes a File row as snake_case JSON matching the gRPC-gateway shape.
func writeFileJSON(w http.ResponseWriter, f File) error {
	p := toProto(f)
	enc := json.NewEncoder(w)
	return enc.Encode(map[string]interface{}{
		"id":         p.GetId(),
		"org_id":     p.GetOrgId(),
		"owner_id":   p.GetOwnerId(),
		"parent_id":  p.GetParentId(),
		"name":       p.GetName(),
		"mime_type":  p.GetMimeType(),
		"size_bytes": p.GetSizeBytes(),
		"trashed":    p.GetTrashed(),
		"created_at": p.GetCreatedAt(),
		"updated_at": p.GetUpdatedAt(),
	})
}
