package cloudimport

import (
	"context"
	"io"
	"time"
)

// ContactFields is the minimal contact data needed for import.
// It mirrors contacts.Fields without importing that package.
type ContactFields struct {
	DisplayName string
	FirstName   string
	LastName    string
	Company     string
	JobTitle    string
	Emails      []string
	Phones      []string
	Labels      []string
	Notes       string
}

// EventFields is the minimal event data needed for import.
// It mirrors calendar.Fields without importing that package.
type EventFields struct {
	Title       string
	Description string
	Location    string
	StartAt     time.Time
	EndAt       time.Time
	AllDay      bool
	Recurrence  string
}

// ContactImporter imports a single contact into the org.
type ContactImporter interface {
	ImportContact(ctx context.Context, orgID, userID string, f ContactFields) error
}

// EventImporter imports a single calendar event into the org.
type EventImporter interface {
	ImportEvent(ctx context.Context, orgID, userID string, f EventFields) error
}

// FileImporter imports a single file blob into the org's Drive.
type FileImporter interface {
	// ImportFile uploads the content of r as a Drive file.
	// parent is the Drive folder id (empty = root), name is the display name.
	ImportFile(ctx context.Context, orgID, userID, parent, name, mimeType string, size int64, r io.Reader) error
}
