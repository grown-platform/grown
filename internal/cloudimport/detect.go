package cloudimport

import (
	"path"
	"strings"
)

// DataKind is one of the recognized data types extracted from an import archive.
type DataKind string

const (
	KindContacts DataKind = "contacts"
	KindCalendar DataKind = "calendar"
	KindDrive    DataKind = "drive"
	KindPhotos   DataKind = "photos"
	KindMail     DataKind = "mail"
)

// ArchiveSource describes the detected origin of an uploaded archive.
type ArchiveSource string

const (
	SourceGoogleTakeout ArchiveSource = "google_takeout"
	SourceApple         ArchiveSource = "apple"
	SourceFile          ArchiveSource = "file"
)

// EntryInfo is a minimal description of one entry inside an archive (or a
// single-file upload).
type EntryInfo struct {
	// Path is the archive-relative path, forward-slash separated.
	Path string
	// Size is the uncompressed size in bytes (0 = unknown).
	Size int64
}

// DetectionResult summarises what was found inside an archive.
type DetectionResult struct {
	Source ArchiveSource
	ByKind map[DataKind][]EntryInfo
	// AllEntries holds every entry seen (used for Drive upload).
	AllEntries []EntryInfo
}

// detectSource infers the ArchiveSource from the list of paths.
func detectSource(paths []string) ArchiveSource {
	for _, p := range paths {
		low := strings.ToLower(p)
		if strings.Contains(low, "takeout/") || strings.Contains(low, "/takeout/") {
			return SourceGoogleTakeout
		}
		// Apple Health export has Library.sqlite or apple_health_export
		if strings.Contains(low, "apple_health") || strings.Contains(low, "library.sqlite") {
			return SourceApple
		}
	}
	return SourceFile
}

// DetectEntries analyses a flat list of archive entries and classifies each
// into data kinds.  Rules are heuristic (Google Takeout structure + file
// extensions) and intentionally simple.
func DetectEntries(entries []EntryInfo) DetectionResult {
	paths := make([]string, 0, len(entries))
	for _, e := range entries {
		paths = append(paths, e.Path)
	}
	source := detectSource(paths)
	byKind := map[DataKind][]EntryInfo{}

	for _, e := range entries {
		kind := classifyEntry(e.Path)
		if kind != "" {
			byKind[kind] = append(byKind[kind], e)
		}
	}

	return DetectionResult{
		Source:     source,
		ByKind:     byKind,
		AllEntries: entries,
	}
}

// classifyEntry returns the DataKind for a single archive path, or "" when
// the entry doesn't map to a recognised kind (e.g. metadata JSON, index HTML).
func classifyEntry(p string) DataKind {
	low := strings.ToLower(p)
	base := strings.ToLower(path.Base(p))
	dir := strings.ToLower(p)

	// Skip directory entries.
	if strings.HasSuffix(p, "/") {
		return ""
	}

	// ---- Contacts ----
	if strings.HasSuffix(base, ".vcf") {
		return KindContacts
	}
	// Google Takeout: Contacts/ folder; Google CSV contacts export
	if strings.Contains(dir, "/contacts/") {
		ext := path.Ext(base)
		if ext == ".csv" || ext == ".vcf" || ext == ".json" {
			return KindContacts
		}
	}
	if base == "contacts.csv" {
		return KindContacts
	}

	// ---- Calendar ----
	if strings.HasSuffix(base, ".ics") {
		return KindCalendar
	}
	if strings.Contains(dir, "/calendar/") && (strings.HasSuffix(base, ".ics") || strings.HasSuffix(base, ".ical")) {
		return KindCalendar
	}

	// ---- Mail ----
	if strings.HasSuffix(base, ".mbox") || strings.HasSuffix(base, ".eml") {
		return KindMail
	}
	if strings.Contains(dir, "/mail/") && (strings.HasSuffix(base, ".mbox") || strings.HasSuffix(base, ".eml")) {
		return KindMail
	}

	// ---- Photos ----
	// Google Photos folder
	if strings.Contains(low, "google photos/") || strings.Contains(low, "google photos\\") {
		return KindPhotos
	}
	// Media file extensions anywhere in a Photos subfolder
	if strings.Contains(dir, "/photos/") {
		if isMediaExt(base) {
			return KindPhotos
		}
	}

	// ---- Drive ----
	// Google Drive folder
	if strings.Contains(low, "/drive/") || strings.HasPrefix(low, "drive/") {
		return KindDrive
	}

	return ""
}

func isMediaExt(name string) bool {
	switch path.Ext(name) {
	case ".jpg", ".jpeg", ".png", ".gif", ".heic", ".heif", ".mp4", ".mov", ".avi", ".mkv", ".webm":
		return true
	}
	return false
}
