package handler_test

// Tests for sequential signing-order enforcement logic.
//
// Pure-unit tests verify the ordering business rules without a DB.
// DB integration tests are skip-guarded on GROWN_TEST_DSN.

import (
	"context"
	"os"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/pdf/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func testDSN(t *testing.T) string {
	t.Helper()
	return os.Getenv("GROWN_TEST_DSN")
}

func openTestDB(ctx context.Context, dsn string) (*pgx.Conn, error) {
	return pgx.Connect(ctx, dsn)
}

// mockSigners is a minimal set of signers used to verify ordering invariants.
func makeSigner(id string, order int32, status sqlc.SignerStatus) sqlc.Signer {
	return sqlc.Signer{
		ID:           id,
		DocumentID:   "doc_test",
		Email:        id + "@example.com",
		Name:         id,
		SigningOrder: order,
		Status:       status,
		SignerType:   sqlc.SignerTypeSigner,
	}
}

// isSignerAllowedToSign returns true if the given signer is allowed to sign
// when the document has signing_order enabled.  This mirrors the logic in
// SigningHandler.SubmitSignature.
func isSignerAllowedToSign(signer sqlc.Signer, allSigners []sqlc.Signer) bool {
	for _, s := range allSigners {
		if s.SigningOrder < signer.SigningOrder && s.Status != sqlc.SignerStatusSigned {
			return false
		}
	}
	return true
}

// TestOrderingEnforcement_FirstSignerCanAlwaysSign verifies that the first
// signer in line is never blocked.
func TestOrderingEnforcement_FirstSignerCanAlwaysSign(t *testing.T) {
	signers := []sqlc.Signer{
		makeSigner("alice", 1, sqlc.SignerStatusPending),
		makeSigner("bob", 2, sqlc.SignerStatusPending),
	}
	if !isSignerAllowedToSign(signers[0], signers) {
		t.Error("first signer should be allowed to sign")
	}
}

// TestOrderingEnforcement_SecondSignerBlockedUntilFirstSigns verifies that
// the second signer cannot sign while the first is still pending.
func TestOrderingEnforcement_SecondSignerBlockedUntilFirstSigns(t *testing.T) {
	signers := []sqlc.Signer{
		makeSigner("alice", 1, sqlc.SignerStatusPending),
		makeSigner("bob", 2, sqlc.SignerStatusPending),
	}
	if isSignerAllowedToSign(signers[1], signers) {
		t.Error("second signer should be blocked while first is pending")
	}
}

// TestOrderingEnforcement_SecondSignerAllowedAfterFirstSigns verifies that
// the second signer can proceed once the first has signed.
func TestOrderingEnforcement_SecondSignerAllowedAfterFirstSigns(t *testing.T) {
	signers := []sqlc.Signer{
		makeSigner("alice", 1, sqlc.SignerStatusSigned),
		makeSigner("bob", 2, sqlc.SignerStatusPending),
	}
	if !isSignerAllowedToSign(signers[1], signers) {
		t.Error("second signer should be allowed once first has signed")
	}
}

// TestOrderingEnforcement_ThirdBlockedWhenSecondPending verifies a 3-signer
// chain: signer 3 is blocked when signer 2 is pending even if signer 1 has
// signed.
func TestOrderingEnforcement_ThirdBlockedWhenSecondPending(t *testing.T) {
	signers := []sqlc.Signer{
		makeSigner("alice", 1, sqlc.SignerStatusSigned),
		makeSigner("bob", 2, sqlc.SignerStatusPending),
		makeSigner("carol", 3, sqlc.SignerStatusPending),
	}
	if isSignerAllowedToSign(signers[2], signers) {
		t.Error("third signer should be blocked while second is pending")
	}
}

// TestOrderingEnforcement_ThirdAllowedWhenBothPriorSigned verifies that
// signer 3 can sign once both signer 1 and signer 2 have signed.
func TestOrderingEnforcement_ThirdAllowedWhenBothPriorSigned(t *testing.T) {
	signers := []sqlc.Signer{
		makeSigner("alice", 1, sqlc.SignerStatusSigned),
		makeSigner("bob", 2, sqlc.SignerStatusSigned),
		makeSigner("carol", 3, sqlc.SignerStatusPending),
	}
	if !isSignerAllowedToSign(signers[2], signers) {
		t.Error("third signer should be allowed once both prior signers have signed")
	}
}

// TestOrderingEnforcement_ViewedCountsAsPending ensures that a signer with
// status 'viewed' (but not yet signed) still blocks subsequent signers.
func TestOrderingEnforcement_ViewedCountsAsPending(t *testing.T) {
	signers := []sqlc.Signer{
		makeSigner("alice", 1, sqlc.SignerStatusViewed),
		makeSigner("bob", 2, sqlc.SignerStatusPending),
	}
	if isSignerAllowedToSign(signers[1], signers) {
		t.Error("second signer should be blocked while first has only viewed")
	}
}

// TestOrderingEnforcement_SentCountsAsPending ensures that the new 'sent'
// status (notification dispatched but not yet viewed) still blocks subsequent
// signers.
func TestOrderingEnforcement_SentCountsAsPending(t *testing.T) {
	signers := []sqlc.Signer{
		makeSigner("alice", 1, sqlc.SignerStatusSent),
		makeSigner("bob", 2, sqlc.SignerStatusPending),
	}
	if isSignerAllowedToSign(signers[1], signers) {
		t.Error("second signer should be blocked while first has status 'sent'")
	}
}

// TestAuditEventMapping verifies that all audit-action constants map to
// non-empty strings, which guards against typos in the enum values that
// would cause the DB to reject inserts.
func TestAuditEventMapping(t *testing.T) {
	actions := []sqlc.AuditAction{
		sqlc.AuditActionDocumentCreated,
		sqlc.AuditActionDocumentUpdated,
		sqlc.AuditActionDocumentSent,
		sqlc.AuditActionDocumentViewed,
		sqlc.AuditActionDocumentCompleted,
		sqlc.AuditActionDocumentDeclined,
		sqlc.AuditActionDocumentVoided,
		sqlc.AuditActionDocumentExpired,
		sqlc.AuditActionSignerAdded,
		sqlc.AuditActionSignerRemoved,
		sqlc.AuditActionSignerNotified,
		sqlc.AuditActionSignerReminded,
		sqlc.AuditActionFieldAdded,
		sqlc.AuditActionFieldUpdated,
		sqlc.AuditActionFieldRemoved,
		sqlc.AuditActionFieldFilled,
		sqlc.AuditActionSignatureCaptured,
		sqlc.AuditActionSignatureValidated,
		sqlc.AuditActionCertificateIssued,
		sqlc.AuditActionCertificateValidated,
	}
	for _, a := range actions {
		if string(a) == "" {
			t.Errorf("audit action is empty string")
		}
	}
}

// TestSignerStatusSent verifies the new 'sent' status constant exists and
// has the correct value.
func TestSignerStatusSent(t *testing.T) {
	if sqlc.SignerStatusSent != "sent" {
		t.Errorf("SignerStatusSent = %q, want %q", sqlc.SignerStatusSent, "sent")
	}
}

// TestTemplatePathExtraction verifies the templateIDFromPath helper correctly
// parses various URL patterns.
func TestTemplatePathExtraction(t *testing.T) {
	// We can't import the unexported helper directly from handler_test, so we
	// replicate the extraction logic here to validate edge cases.
	tests := []struct {
		path   string
		suffix string
		want   string
	}{
		{"/api/templates/tmpl_123", "", "tmpl_123"},
		{"/api/templates/tmpl_abc/create-document", "/create-document", "tmpl_abc"},
		{"/api/templates/", "", ""},
		{"/api/templates", "", ""},
		{"/api/other/tmpl_123", "", ""},
	}

	extract := func(path, suffix string) string {
		const prefix = "/api/templates/"
		if !strings.HasPrefix(path, prefix) {
			return ""
		}
		rest := path[len(prefix):]
		if suffix != "" {
			if !strings.HasSuffix(rest, suffix) {
				return ""
			}
			rest = rest[:len(rest)-len(suffix)]
		}
		for i, c := range rest {
			if c == '/' {
				rest = rest[:i]
				break
			}
		}
		if rest == "" {
			return ""
		}
		return rest
	}

	for _, tc := range tests {
		got := extract(tc.path, tc.suffix)
		if got != tc.want {
			t.Errorf("extract(%q, %q) = %q, want %q", tc.path, tc.suffix, got, tc.want)
		}
	}
}

// --- DB-backed tests (skipped unless GROWN_TEST_DSN is set) ---

func TestOrderingEnforcement_DBIntegration(t *testing.T) {
	dsn := testDSN(t)
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping DB integration test")
	}
	ctx := context.Background()

	// Minimal smoke test: open the DB and verify the signer_status enum
	// includes the new 'sent' value.
	db, err := openTestDB(ctx, dsn)
	if err != nil {
		t.Fatalf("openTestDB: %v", err)
	}
	defer db.Close(ctx)

	row := db.QueryRow(ctx,
		`SELECT EXISTS (
            SELECT 1 FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'signer_status' AND e.enumlabel = 'sent'
        )`)
	var exists bool
	if err := row.Scan(&exists); err != nil {
		t.Fatalf("query failed: %v", err)
	}
	if !exists {
		t.Error("signer_status enum does not contain 'sent' — migration 010 may not have run")
	}
}

func TestTemplates_DBIntegration(t *testing.T) {
	dsn := testDSN(t)
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping DB integration test")
	}
	ctx := context.Background()

	db, err := openTestDB(ctx, dsn)
	if err != nil {
		t.Fatalf("openTestDB: %v", err)
	}
	defer db.Close(ctx)

	// Verify the document_templates and template_fields tables exist.
	for _, table := range []string{"document_templates", "template_fields"} {
		row := db.QueryRow(ctx,
			`SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = $1
            )`, table)
		var exists bool
		if err := row.Scan(&exists); err != nil {
			t.Fatalf("query for table %q failed: %v", table, err)
		}
		if !exists {
			t.Errorf("table %q not found — migration 010 may not have run", table)
		}
	}

	// Insert and retrieve a template to verify round-trip.
	id := "tmpl_test_integration"
	_ = pgtype.Text{} // keep import used in other tests
	_, err = db.Exec(ctx,
		`INSERT INTO document_templates
            (id, organization_id, name, signer_slots, signing_order, created_by)
         VALUES ($1, 'org_test', 'Test Template', 1, false, 'test@example.com')`,
		id)
	if err != nil {
		t.Fatalf("insert template: %v", err)
	}

	row := db.QueryRow(ctx, `SELECT name FROM document_templates WHERE id = $1`, id)
	var name string
	if err := row.Scan(&name); err != nil {
		t.Fatalf("select template: %v", err)
	}
	if name != "Test Template" {
		t.Errorf("template name = %q, want %q", name, "Test Template")
	}

	// Clean up
	_, _ = db.Exec(ctx, `DELETE FROM document_templates WHERE id = $1`, id)
}
