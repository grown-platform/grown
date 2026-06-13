// Package orgsync transfers data (Drive files/folders, Contacts) from one org
// to another. The caller must be an admin of both the source and target orgs.
// Copies are synchronous — fine for interactive, hand-picked selections.
package orgsync

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"code.pick.haus/grown/grown/internal/contacts"
	"code.pick.haus/grown/grown/internal/drive"
	"code.pick.haus/grown/grown/internal/orgadmin"
	"code.pick.haus/grown/grown/internal/orgs"
)

// Service copies selected items between orgs.
type Service struct {
	drive    *drive.Repository
	blobs    *drive.Blobs
	contacts *contacts.Repository
	orgs     *orgs.Repository
	admin    *orgadmin.Repository
}

// NewService constructs a Service. Returns nil if any dependency is nil.
func NewService(d *drive.Repository, b *drive.Blobs, c *contacts.Repository, o *orgs.Repository, a *orgadmin.Repository) *Service {
	if d == nil || b == nil || c == nil || o == nil || a == nil {
		return nil
	}
	return &Service{drive: d, blobs: b, contacts: c, orgs: o, admin: a}
}

// Result summarizes a transfer.
type Result struct {
	CopiedFiles    int      `json:"copied_files"`
	CopiedFolders  int      `json:"copied_folders"`
	CopiedContacts int      `json:"copied_contacts"`
	Errors         int      `json:"errors"`
	TargetOrg      string   `json:"target_org"`
	Messages       []string `json:"messages,omitempty"`
}

// Transfer copies the selected Drive files/folders and contacts from srcOrgID to
// the org identified by targetSlug. The caller (userID) must be an admin of both.
func (s *Service) Transfer(ctx context.Context, srcOrgID, userID, targetSlug string, fileIDs, contactIDs []string) (Result, error) {
	var res Result
	target, err := s.orgs.GetBySlug(ctx, targetSlug)
	if err != nil {
		return res, fmt.Errorf("target org %q not found", targetSlug)
	}
	if target.ID == srcOrgID {
		return res, fmt.Errorf("source and target are the same org")
	}
	srcAdmin, _ := s.admin.IsAdmin(ctx, srcOrgID, userID)
	tgtAdmin, _ := s.admin.IsAdmin(ctx, target.ID, userID)
	if !srcAdmin || !tgtAdmin {
		return res, fmt.Errorf("you must be an admin of both the source and target orgs")
	}
	res.TargetOrg = target.DisplayName

	for _, fid := range fileIDs {
		f, gerr := s.drive.Get(ctx, srcOrgID, fid)
		if gerr != nil {
			res.Errors++
			res.Messages = append(res.Messages, "file "+fid+": "+gerr.Error())
			continue
		}
		if f.StorageKey == nil {
			s.copyFolder(ctx, srcOrgID, f, target.ID, userID, "", &res)
		} else if cerr := s.copyFile(ctx, f, target.ID, userID, ""); cerr != nil {
			res.Errors++
			res.Messages = append(res.Messages, "file "+f.Name+": "+cerr.Error())
		} else {
			res.CopiedFiles++
		}
	}

	for _, cid := range contactIDs {
		c, gerr := s.contacts.Get(ctx, srcOrgID, cid)
		if gerr != nil {
			res.Errors++
			continue
		}
		if _, cerr := s.contacts.Create(ctx, target.ID, userID, contacts.Fields{
			DisplayName: c.DisplayName, FirstName: c.FirstName, LastName: c.LastName,
			Company: c.Company, JobTitle: c.JobTitle, Emails: c.Emails, Phones: c.Phones,
			Labels: c.Labels, Notes: c.Notes, Starred: c.Starred,
		}); cerr != nil {
			res.Errors++
		} else {
			res.CopiedContacts++
		}
	}
	return res, nil
}

func (s *Service) copyFile(ctx context.Context, f drive.File, targetOrg, owner, parent string) error {
	body, _, size, err := s.blobs.Get(ctx, *f.StorageKey)
	if err != nil {
		return err
	}
	defer body.Close()
	key, err := randomKey()
	if err != nil {
		return err
	}
	if err := s.blobs.Put(ctx, key, f.MimeType, size, body); err != nil {
		return err
	}
	_, err = s.drive.CreateFile(ctx, targetOrg, owner, parent, f.Name, f.MimeType, key, size)
	return err
}

func (s *Service) copyFolder(ctx context.Context, srcOrg string, f drive.File, targetOrg, owner, parent string, res *Result) {
	nf, err := s.drive.CreateFolder(ctx, targetOrg, owner, parent, f.Name)
	if err != nil {
		res.Errors++
		return
	}
	res.CopiedFolders++
	children, _, lerr := s.drive.ListChildren(ctx, srcOrg, f.ID, false, 1000, "")
	if lerr != nil {
		return
	}
	for _, ch := range children {
		if ch.StorageKey == nil {
			s.copyFolder(ctx, srcOrg, ch, targetOrg, owner, nf.ID, res)
		} else if cerr := s.copyFile(ctx, ch, targetOrg, owner, nf.ID); cerr != nil {
			res.Errors++
		} else {
			res.CopiedFiles++
		}
	}
}

func randomKey() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "drive/" + hex.EncodeToString(b), nil
}
