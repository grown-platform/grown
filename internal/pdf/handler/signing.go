package handler

import (
	"bytes"
	"context"
	gocrypto "crypto"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"code.pick.haus/grown/grown/internal/pdf/config"
	"code.pick.haus/grown/grown/internal/pdf/crypto"
	"code.pick.haus/grown/grown/internal/pdf/database"
	"code.pick.haus/grown/grown/internal/pdf/email"
	"code.pick.haus/grown/grown/internal/pdf/mtls"
	"code.pick.haus/grown/grown/internal/pdf/pdf"
	"code.pick.haus/grown/grown/internal/pdf/sig"
	"code.pick.haus/grown/grown/internal/pdf/sqlc"
	"code.pick.haus/grown/grown/internal/pdf/storage"
	pb "code.pick.haus/grown/grown/internal/pdf/proto/signing"
)

type SigningHandler struct {
	pb.UnimplementedSigningServiceServer
	db        *database.DB
	cfg       *config.Config
	storage   *storage.Client
	pdf       *pdf.Generator
	email     *email.Sender
	ca        crypto.CertificateAuthority
	pdfSigner *crypto.PDFSigner

	// trustedCAPool is the root pool for verifying browser-extension-supplied
	// signer certificates. Nil unless cfg.Signing.BrowserExtensionEnabled=true.
	trustedCAPool *x509.CertPool

	// pendingSignatures stores prepared hashes for browser extension signing
	pendingSignatures sync.Map // map[signatureId]*pendingSignature
}

// pendingSignature holds data for a signature that's being prepared for external signing
type pendingSignature struct {
	Token       string
	SignerID    string
	DocumentID  string
	Hash        []byte
	Algorithm   string
	FieldValues []*pb.FieldValue
	ExpiresAt   time.Time
}

func NewSigningHandler(db *database.DB, cfg *config.Config, storage *storage.Client, pdfGen *pdf.Generator, emailSender *email.Sender, ca crypto.CertificateAuthority, trustedCAPool *x509.CertPool) *SigningHandler {
	var pdfSigner *crypto.PDFSigner
	if ca != nil {
		pdfSigner = crypto.NewPDFSigner(ca)
	}
	return &SigningHandler{
		db:            db,
		cfg:           cfg,
		storage:       storage,
		pdf:           pdfGen,
		email:         emailSender,
		ca:            ca,
		pdfSigner:     pdfSigner,
		trustedCAPool: trustedCAPool,
	}
}

func (h *SigningHandler) GetSigningSession(ctx context.Context, req *pb.GetSigningSessionRequest) (*pb.GetSigningSessionResponse, error) {
	signer, err := h.db.Queries.GetSignerByToken(ctx, textFromString(req.Token))
	if err != nil {
		slog.Warn("Invalid signing token", "token", req.Token[:8]+"...")
		return nil, status.Error(codes.NotFound, "invalid or expired signing link")
	}

	doc, err := h.db.Queries.GetDocument(ctx, signer.DocumentID)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to get document")
	}

	if doc.Status == sqlc.DocumentStatusVoided {
		return nil, status.Error(codes.FailedPrecondition, "document has been voided")
	}

	if doc.Status == sqlc.DocumentStatusCompleted {
		return nil, status.Error(codes.FailedPrecondition, "document has already been completed")
	}

	fields, err := h.db.Queries.GetSignatureFieldsBySigner(ctx, signer.ID)
	if err != nil {
		slog.Error("Failed to get signature fields", "error", err)
	}

	// Generate presigned download URL (valid for 1 hour)
	// If signer has signed, try to return the signed PDF (if document is completed) or original
	storageKey := doc.StorageKey
	if doc.SignedStorageKey.Valid && doc.SignedStorageKey.String != "" {
		storageKey = doc.SignedStorageKey.String
	}
	downloadURL, err := h.storage.GetPresignedURL(ctx, storageKey, time.Hour)
	if err != nil {
		slog.Error("Failed to generate presigned URL", "error", err, "key", storageKey)
		downloadURL = "" // Will show error in frontend
	}

	var signingFields []*pb.SigningField
	for _, f := range fields {
		signingFields = append(signingFields, &pb.SigningField{
			Id:         f.ID,
			FieldType:  string(f.FieldType),
			PageNumber: f.PageNumber,
			X:          float64FromNumeric(f.X),
			Y:          float64FromNumeric(f.Y),
			Width:      float64FromNumeric(f.Width),
			Height:     float64FromNumeric(f.Height),
			Required:   f.Required,
			Label:      stringFromText(f.Label),
			Value:      stringFromText(f.Value),
			IsFilled:   f.Value.Valid,
		})
	}

	return &pb.GetSigningSessionResponse{
		Session: &pb.SigningSession{
			SignerId:            signer.ID,
			SignerName:          signer.Name,
			SignerEmail:         signer.Email,
			DocumentId:          doc.ID,
			DocumentName:        doc.Name,
			DocumentDownloadUrl: downloadURL,
			TotalPages:          doc.TotalPages,
			Fields:              signingFields,
			ExpiresAt:           timestamppb.New(signer.AccessTokenExpiresAt.Time),
			IsSigned:            signer.Status == sqlc.SignerStatusSigned,
		},
	}, nil
}

func (h *SigningHandler) RecordView(ctx context.Context, req *pb.RecordViewRequest) (*pb.RecordViewResponse, error) {
	signer, err := h.db.Queries.GetSignerByToken(ctx, textFromString(req.Token))
	if err != nil {
		return nil, status.Error(codes.NotFound, "invalid or expired signing link")
	}

	// Update signer status to viewed
	_, err = h.db.Queries.UpdateSignerViewed(ctx, signer.ID)
	if err != nil {
		slog.Error("Failed to update signer viewed status", "error", err)
	}

	// Get IP and user agent for audit
	ipAddr, userAgent := extractRequestMetadata(ctx)

	// Create audit entry
	_, err = h.db.Queries.CreateAuditEntry(ctx, sqlc.CreateAuditEntryParams{
		ID:         "aud_" + generateShortID(),
		DocumentID: signer.DocumentID,
		SignerID:   textFromString(signer.ID),
		Action:     sqlc.AuditActionDocumentViewed,
		IpAddress:  ipAddr,
		UserAgent:  textFromString(userAgent),
	})
	if err != nil {
		slog.Error("Failed to create audit entry", "error", err)
	}

	return &pb.RecordViewResponse{Success: true}, nil
}

func (h *SigningHandler) SubmitSignature(ctx context.Context, req *pb.SubmitSignatureRequest) (*pb.SubmitSignatureResponse, error) {
	if !req.ConsentGiven {
		return nil, status.Error(codes.InvalidArgument, "consent is required to sign")
	}

	signer, err := h.db.Queries.GetSignerByToken(ctx, textFromString(req.Token))
	if err != nil {
		return nil, status.Error(codes.NotFound, "invalid or expired signing link")
	}

	if signer.Status == sqlc.SignerStatusSigned {
		return nil, status.Error(codes.FailedPrecondition, "document already signed")
	}

	// Enforce sequential signing order: if the document has signing_order
	// enabled, the signer may only proceed when all signers with a lower
	// signing_order have already signed.
	doc, err := h.db.Queries.GetDocument(ctx, signer.DocumentID)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to get document")
	}
	if doc.SigningOrder {
		signers, err := h.db.Queries.GetSignersByDocument(ctx, signer.DocumentID)
		if err != nil {
			return nil, status.Error(codes.Internal, "failed to check signing order")
		}
		for _, s := range signers {
			if s.SigningOrder < signer.SigningOrder && s.Status != sqlc.SignerStatusSigned {
				return nil, status.Error(codes.FailedPrecondition,
					"you cannot sign yet — a previous signer has not completed their signature")
			}
		}
	}

	// Check for CAC/mTLS identity
	var cacIdentity *mtls.ClientIdentity
	if identity := mtls.GetClientIdentity(ctx); identity != nil {
		cacIdentity = identity
		slog.Info("CAC certificate detected for signing",
			"email", identity.Email,
			"cn", identity.CommonName,
			"org", identity.Organization,
			"serial", identity.SerialNumber)
	}

	// Log annotations submitted with this signature. The stored document
	// annotations (document.annotations JSONB, populated via the PUT
	// /api/documents/{id}/annotations endpoint by the author) are what
	// gets baked into the signed PDF inside generateSignedPDF below.
	// Signer-submitted annotations on the SubmitSignature request itself
	// are currently informational only — the proto shape is lossy
	// relative to the editor's full Annotation type, so we don't merge
	// them back into doc.annotations here.
	if len(req.Annotations) > 0 {
		slog.Info("SubmitSignature: annotations received on submit request (informational only)",
			"count", len(req.Annotations),
			"signer_id", signer.ID)
	}

	// Fill signature fields
	for _, fv := range req.FieldValues {
		_, err := h.db.Queries.FillSignatureField(ctx, sqlc.FillSignatureFieldParams{
			ID:    fv.FieldId,
			Value: textFromString(fv.Value),
		})
		if err != nil {
			slog.Error("Failed to fill signature field", "field_id", fv.FieldId, "error", err)
			return nil, status.Error(codes.Internal, "failed to save signature")
		}
	}

	// Check if all required fields are filled
	unfilled, _ := h.db.Queries.CountRequiredUnfilledFields(ctx, signer.ID)
	if unfilled > 0 {
		return nil, status.Error(codes.InvalidArgument, "all required fields must be filled")
	}

	// Get IP and user agent
	ipAddr, userAgent := extractRequestMetadata(ctx)

	// Update signer status to signed
	_, err = h.db.Queries.UpdateSignerSigned(ctx, sqlc.UpdateSignerSignedParams{
		ID:               signer.ID,
		SigningIpAddress: ipAddr,
		SigningUserAgent: textFromString(userAgent),
	})
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to update signer status")
	}

	// Create audit entry for signature with CAC info if present
	auditDetails := []byte("{}")
	if cacIdentity != nil {
		auditDetails = []byte(fmt.Sprintf(`{"method": "cac_mtls", "cac_subject": %q, "cac_serial": %q}`,
			cacIdentity.Subject, cacIdentity.SerialNumber))
	}
	_, err = h.db.Queries.CreateAuditEntry(ctx, sqlc.CreateAuditEntryParams{
		ID:            "aud_" + generateShortID(),
		DocumentID:    signer.DocumentID,
		SignerID:      textFromString(signer.ID),
		Action:        sqlc.AuditActionSignatureCaptured,
		ActionDetails: auditDetails,
		IpAddress:     ipAddr,
		UserAgent:     textFromString(userAgent),
	})
	if err != nil {
		slog.Error("Failed to create audit entry", "error", err)
	}

	// Store CAC identity reference if present (used during PDF signing)
	if cacIdentity != nil {
		h.pendingSignatures.Store("cac_"+signer.ID, cacIdentity)
	}

	// Refresh document state after signing (doc was already fetched above for order check)
	// Use a fresh copy to pick up any concurrent updates.
	doc, _ = h.db.Queries.GetDocument(ctx, signer.DocumentID)
	signedCount, _ := h.db.Queries.CountSignedSigners(ctx, doc.ID)
	totalSigners, _ := h.db.Queries.CountTotalSigners(ctx, doc.ID)

	// Always generate signed PDF after each signature so signers can see their signatures
	signedKey := doc.StorageKey[:len(doc.StorageKey)-4] + "-signed.pdf"
	if err := h.generateSignedPDF(ctx, doc); err != nil {
		slog.Error("Failed to generate signed PDF", "error", err)
	} else {
		// Update document with signed storage key
		_, err = h.db.Queries.UpdateDocumentSignedKey(ctx, sqlc.UpdateDocumentSignedKeyParams{
			ID:               doc.ID,
			SignedStorageKey: textFromString(signedKey),
		})
		if err != nil {
			slog.Error("Failed to update signed storage key", "error", err)
		}
	}

	if signedCount == totalSigners {
		// All signers have signed - mark document as completed
		_, err = h.db.Queries.UpdateDocumentCompleted(ctx, sqlc.UpdateDocumentCompletedParams{
			ID:               doc.ID,
			SignedStorageKey: textFromString(signedKey),
		})
		if err != nil {
			slog.Error("Failed to complete document", "error", err)
		}

		// Create completion audit entry
		_, err = h.db.Queries.CreateAuditEntry(ctx, sqlc.CreateAuditEntryParams{
			ID:         "aud_" + generateShortID(),
			DocumentID: doc.ID,
			Action:     sqlc.AuditActionDocumentCompleted,
			IpAddress:  ipAddr,
			UserAgent:  textFromString(userAgent),
		})
		if err != nil {
			slog.Error("Failed to create completion audit entry", "error", err)
		}

		// Send completion emails to all signers
		go h.sendCompletionEmails(context.Background(), doc)
	} else if doc.SigningOrder {
		// Sequential signing: notify the next signer in line.
		go h.notifyNextSigner(context.Background(), doc)
	}

	return &pb.SubmitSignatureResponse{
		Success: true,
		Message: "Document signed successfully",
	}, nil
}

// generateSignedPDF downloads the original PDF, applies cryptographic and visual signatures, and uploads
func (h *SigningHandler) generateSignedPDF(ctx context.Context, doc sqlc.Document) error {
	// Download original PDF
	pdfReader, err := h.storage.Download(ctx, doc.StorageKey)
	if err != nil {
		return fmt.Errorf("failed to download PDF: %w", err)
	}
	defer pdfReader.Close()

	// Read PDF into memory
	pdfBytes, err := io.ReadAll(pdfReader)
	if err != nil {
		return fmt.Errorf("failed to read PDF: %w", err)
	}

	// Get all signers and their filled signature fields
	signers, err := h.db.Queries.GetSignersByDocument(ctx, doc.ID)
	if err != nil {
		return fmt.Errorf("failed to get signers: %w", err)
	}

	var visualSignatures []pdf.SignatureField
	var textFields []pdf.TextField
	var signedSigners []sqlc.Signer // Track signers who have signed for crypto signatures

	for _, s := range signers {
		if s.Status == sqlc.SignerStatusSigned {
			signedSigners = append(signedSigners, s)
		}

		fields, err := h.db.Queries.GetSignatureFieldsBySigner(ctx, s.ID)
		if err != nil {
			continue
		}
		for _, f := range fields {
			if !f.Value.Valid {
				continue
			}
			// Only signature and initials are image-based fields
			if f.FieldType == sqlc.FieldTypeSignature || f.FieldType == sqlc.FieldTypeInitials {
				visualSignatures = append(visualSignatures, pdf.SignatureField{
					PageNumber: int(f.PageNumber),
					X:          float64FromNumeric(f.X),
					Y:          float64FromNumeric(f.Y),
					Width:      float64FromNumeric(f.Width),
					Height:     float64FromNumeric(f.Height),
					ImageData:  f.Value.String,
					SignerName: s.Name,
					SignedAt:   s.SignedAt.Time.Format("2006-01-02 15:04:05"),
				})
			} else {
				// Date, text, and other fields are text-based
				fontSize := int32FromInt4(f.FontSize)
				if fontSize <= 0 {
					fontSize = 12 // Default font size
				}
				textFields = append(textFields, pdf.TextField{
					PageNumber: int(f.PageNumber),
					X:          float64FromNumeric(f.X),
					Y:          float64FromNumeric(f.Y),
					Width:      float64FromNumeric(f.Width),
					Height:     float64FromNumeric(f.Height),
					Text:       f.Value.String,
					FontSize:   int(fontSize),
				})
			}
		}
	}

	// Step 1: Embed visual signatures and text fields FIRST (pdfcpu rewrites PDF structure)
	visualPDF, err := h.pdf.EmbedSignatures(ctx, bytes.NewReader(pdfBytes), visualSignatures, textFields)
	if err != nil {
		return fmt.Errorf("failed to embed visual signatures: %w", err)
	}

	// Read watermarked PDF
	var watermarkedBuf bytes.Buffer
	if _, err := watermarkedBuf.ReadFrom(visualPDF); err != nil {
		return fmt.Errorf("failed to read watermarked PDF: %w", err)
	}
	pdfBytes = watermarkedBuf.Bytes()

	// Step 2: Bake document-level annotations (freehand, shapes, text,
	// highlights) into the PDF BEFORE the cryptographic signature so the
	// signature covers them. Anything added after signing would break the
	// signature.
	if len(doc.Annotations) > 0 {
		slog.Info("generateSignedPDF: baking annotations",
			"documentId", doc.ID,
			"annotationsBytes", len(doc.Annotations))
		bakedBytes, err := h.pdf.BakeAnnotations(pdfBytes, doc.Annotations)
		if err != nil {
			// Non-fatal: log and continue with un-baked PDF. The original
			// signing flow should not be blocked by an annotation parse
			// error.
			slog.Error("generateSignedPDF: failed to bake annotations, continuing without",
				"documentId", doc.ID, "error", err)
		} else {
			pdfBytes = bakedBytes
		}
	}

	// Step 3: Apply cryptographic signatures AFTER visual watermarks and
	// annotation baking (must be last to preserve signature).
	if h.pdfSigner != nil && h.ca != nil {
		for _, signer := range signedSigners {
			// Check if this signer used CAC authentication
			var cacIdentity *mtls.ClientIdentity
			if val, ok := h.pendingSignatures.LoadAndDelete("cac_" + signer.ID); ok {
				cacIdentity = val.(*mtls.ClientIdentity)
			}

			// Get or create certificate for this signer
			cert, key, err := h.ca.GetOrCreateSignerCertificate(ctx, h.cfg.Crypto.OrganizationID, signer.Email, signer.Name)
			if err != nil {
				slog.Error("Failed to get signer certificate", "signer", signer.Email, "error", err)
				continue
			}

			// Apply cryptographic signature with CAC info if available
			signerName := signer.Name
			reason := "Document Signature"
			if cacIdentity != nil {
				signerName = fmt.Sprintf("%s (CAC: %s)", signer.Name, cacIdentity.CommonName)
				reason = fmt.Sprintf("Document Signature - Authenticated via CAC (Serial: %s)", cacIdentity.SerialNumber)
			}

			signOpts := crypto.SignOptions{
				Name:     signerName,
				Location: "Pdf",
				Reason:   reason,
			}

			// Add TSA if configured
			if h.cfg.Crypto.TSAUrl != "" {
				signOpts.TSAUrl = h.cfg.Crypto.TSAUrl
			}

			keySigner, ok := key.(gocrypto.Signer)
			if !ok {
				slog.Error("Private key does not implement crypto.Signer", "signer", signer.Email)
				continue
			}

			signedPDFBytes, sigInfo, err := h.pdfSigner.SignPDF(pdfBytes, cert, keySigner, signOpts)
			if err != nil {
				slog.Error("Failed to apply cryptographic signature", "signer", signer.Email, "error", err)
				continue
			}

			// Store signature record in database
			sigID := "sig_" + uuid.New().String()
			_, err = h.db.Queries.CreateSignature(ctx, sqlc.CreateSignatureParams{
				ID:                    sigID,
				DocumentID:            doc.ID,
				SignerID:              signer.ID,
				SignatureData:         sigInfo.SignatureData,
				SignatureAlgorithm:    sqlc.SignatureAlgorithmRSASHA256,
				CertificateChain:      sigInfo.CertificateChain,
				SigningTimestamp:      pgtype.Timestamptz{Time: sigInfo.SigningTimestamp, Valid: true},
				DocumentHash:          sigInfo.DocumentHash,
				DocumentHashAlgorithm: sigInfo.HashAlgorithm,
				CertificateIssuer:     textFromString(sigInfo.Issuer),
				CertificateSerial:     textFromString(sigInfo.SerialNumber),
				CertificateValidFrom:  pgtype.Timestamptz{Time: sigInfo.ValidFrom, Valid: true},
				CertificateValidTo:    pgtype.Timestamptz{Time: sigInfo.ValidTo, Valid: true},
			})
			if err != nil {
				slog.Error("Failed to store signature record", "signer", signer.Email, "error", err)
			}

			// Use the cryptographically signed PDF for next iteration
			pdfBytes = signedPDFBytes
			slog.Info("Applied cryptographic signature", "signer", signer.Name, "docId", doc.ID)
		}
	}

	// Final PDF bytes
	finalBuf := bytes.NewBuffer(pdfBytes)

	// Upload signed PDF
	signedKey := doc.StorageKey[:len(doc.StorageKey)-4] + "-signed.pdf"
	if err := h.storage.Upload(ctx, signedKey, bytes.NewReader(finalBuf.Bytes()), "application/pdf"); err != nil {
		return fmt.Errorf("failed to upload signed PDF: %w", err)
	}

	slog.Info("Signed PDF generated", "documentId", doc.ID, "signedKey", signedKey, "cryptoEnabled", h.pdfSigner != nil)
	return nil
}

// notifyNextSigner sends the signing invitation to the next unsigned signer
// in a sequentially-ordered document. Called after one signer completes.
func (h *SigningHandler) notifyNextSigner(ctx context.Context, doc sqlc.Document) {
	nextSigner, err := h.db.Queries.GetNextSigner(ctx, doc.ID)
	if err != nil {
		// No more pending signers (all done or declined).
		return
	}

	// Generate (or refresh) the access token for the next signer.
	token, expiry, err := GenerateAccessTokenWithExpiry(30)
	if err != nil {
		slog.Error("notifyNextSigner: failed to generate token", "signer", nextSigner.Email, "error", err)
		return
	}

	_, err = h.db.Queries.SetSignerAccessToken(ctx, sqlc.SetSignerAccessTokenParams{
		ID:                   nextSigner.ID,
		AccessToken:          textFromString(token),
		AccessTokenExpiresAt: pgtype.Timestamptz{Time: expiry, Valid: true},
	})
	if err != nil {
		slog.Error("notifyNextSigner: failed to set access token", "signer", nextSigner.Email, "error", err)
		return
	}

	// Mark as sent so the frontend can distinguish "waiting" from "notified".
	if _, err := h.db.Queries.UpdateSignerSent(ctx, nextSigner.ID); err != nil {
		slog.Error("notifyNextSigner: failed to mark signer sent", "signer", nextSigner.Email, "error", err)
	}

	signingURL := fmt.Sprintf("%s/sign/%s", h.cfg.Server.FrontendURL, token)
	err = h.email.SendSigningInvitation(ctx, email.SigningInvitation{
		RecipientEmail: nextSigner.Email,
		RecipientName:  nextSigner.Name,
		SenderName:     "Document Owner",
		DocumentName:   doc.Name,
		SigningURL:     signingURL,
		ExpiresAt:      expiry.Format("January 2, 2006"),
	})
	if err != nil {
		slog.Error("notifyNextSigner: failed to send email", "signer", nextSigner.Email, "error", err)
	}

	// Audit
	_, _ = h.db.Queries.CreateAuditEntry(ctx, sqlc.CreateAuditEntryParams{
		ID:         "aud_" + generateShortID(),
		DocumentID: doc.ID,
		SignerID:   textFromString(nextSigner.ID),
		Action:     sqlc.AuditActionSignerNotified,
	})

	slog.Info("notifyNextSigner: notified next signer", "signer", nextSigner.Email, "docId", doc.ID)
}

// sendCompletionEmails sends completion notification to all signers
func (h *SigningHandler) sendCompletionEmails(ctx context.Context, doc sqlc.Document) {
	signers, err := h.db.Queries.GetSignersByDocument(ctx, doc.ID)
	if err != nil {
		slog.Error("Failed to get signers for completion email", "error", err)
		return
	}

	signedKey := doc.StorageKey[:len(doc.StorageKey)-4] + "-signed.pdf"
	downloadURL, err := h.storage.GetPresignedURL(ctx, signedKey, 24*time.Hour)
	if err != nil {
		slog.Error("Failed to generate download URL for completion email", "error", err)
		return
	}

	for _, s := range signers {
		err := h.email.SendSigningComplete(ctx, email.SigningComplete{
			RecipientEmail: s.Email,
			RecipientName:  s.Name,
			DocumentName:   doc.Name,
			DownloadURL:    downloadURL,
			SignedAt:       s.SignedAt.Time.Format("January 2, 2006"),
		})
		if err != nil {
			slog.Error("Failed to send completion email", "email", s.Email, "error", err)
		}
	}
}

func (h *SigningHandler) DeclineSigning(ctx context.Context, req *pb.DeclineSigningRequest) (*pb.DeclineSigningResponse, error) {
	signer, err := h.db.Queries.GetSignerByToken(ctx, textFromString(req.Token))
	if err != nil {
		return nil, status.Error(codes.NotFound, "invalid or expired signing link")
	}

	_, err = h.db.Queries.UpdateSignerDeclined(ctx, sqlc.UpdateSignerDeclinedParams{
		ID:            signer.ID,
		DeclineReason: textFromString(req.Reason),
	})
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to decline signing")
	}

	// Get IP and user agent
	ipAddr, userAgent := extractRequestMetadata(ctx)

	// Create audit entry
	_, err = h.db.Queries.CreateAuditEntry(ctx, sqlc.CreateAuditEntryParams{
		ID:            "aud_" + generateShortID(),
		DocumentID:    signer.DocumentID,
		SignerID:      textFromString(signer.ID),
		Action:        sqlc.AuditActionDocumentDeclined,
		ActionDetails: []byte(fmt.Sprintf(`{"reason": %q}`, req.Reason)),
		IpAddress:     ipAddr,
		UserAgent:     textFromString(userAgent),
	})
	if err != nil {
		slog.Error("Failed to create decline audit entry", "error", err)
	}

	// Update document status to declined
	doc, err := h.db.Queries.UpdateDocumentStatus(ctx, sqlc.UpdateDocumentStatusParams{
		ID:     signer.DocumentID,
		Status: sqlc.DocumentStatusDeclined,
	})
	if err != nil {
		slog.Error("Failed to update document status", "error", err)
	}

	// Notify document owner (in background). doc.CreatedBy is the verified
	// caller email captured at create time (see CreateDocument), so use it
	// directly as the recipient.
	go func() {
		if err := h.email.SendDeclineNotification(
			context.Background(),
			doc.CreatedBy,
			"Document Owner",
			signer.Name,
			doc.Name,
			req.Reason,
		); err != nil {
			slog.Error("Failed to send decline notification", "error", err)
		}
	}()

	return &pb.DeclineSigningResponse{Success: true}, nil
}

// GenerateAccessToken creates a secure random token for guest signing
func GenerateAccessToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(bytes), nil
}

// GenerateAccessTokenWithExpiry creates a token and returns the expiry time
func GenerateAccessTokenWithExpiry(days int) (string, time.Time, error) {
	token, err := GenerateAccessToken()
	if err != nil {
		return "", time.Time{}, err
	}
	expiry := time.Now().AddDate(0, 0, days)
	return token, expiry, nil
}

func extractRequestMetadata(ctx context.Context) (*netip.Addr, string) {
	var ipAddr *netip.Addr
	var userAgent string

	// Get metadata from context
	if md, ok := metadata.FromIncomingContext(ctx); ok {
		// Check X-Forwarded-For header first (set by reverse proxy/gateway)
		if xff := md.Get("x-forwarded-for"); len(xff) > 0 {
			// X-Forwarded-For can contain multiple IPs, take the first (original client)
			ips := strings.Split(xff[0], ",")
			if len(ips) > 0 {
				clientIP := strings.TrimSpace(ips[0])
				if addr, err := netip.ParseAddr(clientIP); err == nil {
					ipAddr = &addr
				}
			}
		}

		// Get user agent from metadata
		if ua := md.Get("user-agent"); len(ua) > 0 {
			userAgent = ua[0]
		}
		// Also check grpcgateway-user-agent which is set by grpc-gateway
		if userAgent == "" || strings.HasPrefix(userAgent, "grpc-go") {
			if ua := md.Get("grpcgateway-user-agent"); len(ua) > 0 {
				userAgent = ua[0]
			}
		}
	}

	// Fallback to peer info for IP if X-Forwarded-For not available
	if ipAddr == nil {
		if p, ok := peer.FromContext(ctx); ok {
			if tcpAddr, ok := p.Addr.(*net.TCPAddr); ok {
				addr, ok := netip.AddrFromSlice(tcpAddr.IP)
				if ok {
					ipAddr = &addr
				}
			}
		}
	}

	return ipAddr, userAgent
}

// generateShortID generates a short random ID for audit entries
func generateShortID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)[:11]
}

// GetSigningOptions returns available signing methods based on configuration
func (h *SigningHandler) GetSigningOptions(ctx context.Context, req *pb.GetSigningOptionsRequest) (*pb.GetSigningOptionsResponse, error) {
	signer, err := h.db.Queries.GetSignerByToken(ctx, textFromString(req.Token))
	if err != nil {
		return nil, status.Error(codes.NotFound, "invalid or expired signing link")
	}

	// Check if CAC certificate is present via mTLS
	var cacDetected bool
	var cacSubject string
	if identity := mtls.GetClientIdentity(ctx); identity != nil {
		cacDetected = true
		cacSubject = identity.Subject
	}

	methods := []*pb.SigningMethod{
		{
			Id:          "typed",
			Name:        "Type Signature",
			Description: "Type your name to create a signature",
			Enabled:     true,
		},
		{
			Id:          "drawn",
			Name:        "Draw Signature",
			Description: "Draw your signature using mouse or touch",
			Enabled:     true,
		},
	}

	// Add CAC mTLS option if enabled
	if h.cfg.Signing.CACMTLSEnabled {
		methods = append(methods, &pb.SigningMethod{
			Id:               "cac_mtls",
			Name:             "Sign with CAC/PIV",
			Description:      "Sign using your CAC or PIV smart card certificate",
			Enabled:          true,
			RequiresRedirect: true,
			RedirectUrl:      h.cfg.Signing.CACMTLSEndpoint + "/api/sign/" + req.Token + "/submit?method=cac",
		})
	}

	// Add browser extension option if enabled
	if h.cfg.Signing.BrowserExtensionEnabled {
		methods = append(methods, &pb.SigningMethod{
			Id:          "cac_extension",
			Name:        "Sign with Hardware Token",
			Description: "Sign using browser extension with CAC/YubiKey (private key signing)",
			Enabled:     true,
		})
	}

	_ = signer // Used for future per-signer options

	return &pb.GetSigningOptionsResponse{
		Methods:       methods,
		DefaultMethod: h.cfg.Signing.DefaultMethod,
		CacDetected:   cacDetected,
		CacSubject:    cacSubject,
	}, nil
}

// PrepareSignature prepares a document hash for external signing (browser extension)
func (h *SigningHandler) PrepareSignature(ctx context.Context, req *pb.PrepareSignatureRequest) (*pb.PrepareSignatureResponse, error) {
	if !h.cfg.Signing.BrowserExtensionEnabled {
		return nil, status.Error(codes.Unavailable, "browser extension signing is not enabled")
	}

	signer, err := h.db.Queries.GetSignerByToken(ctx, textFromString(req.Token))
	if err != nil {
		return nil, status.Error(codes.NotFound, "invalid or expired signing link")
	}

	if signer.Status == sqlc.SignerStatusSigned {
		return nil, status.Error(codes.FailedPrecondition, "document already signed")
	}

	doc, err := h.db.Queries.GetDocument(ctx, signer.DocumentID)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to get document")
	}

	// Download the PDF to calculate hash
	pdfReader, err := h.storage.Download(ctx, doc.StorageKey)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to download document")
	}
	defer pdfReader.Close()

	pdfBytes, err := io.ReadAll(pdfReader)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to read document")
	}

	// Calculate SHA-256 hash of the PDF
	hash := gocrypto.SHA256.New()
	hash.Write(pdfBytes)
	hashBytes := hash.Sum(nil)

	// Generate signature ID and store pending signature
	sigID := "pending_" + uuid.New().String()
	expiresAt := time.Now().Add(10 * time.Minute)

	h.pendingSignatures.Store(sigID, &pendingSignature{
		Token:       req.Token,
		SignerID:    signer.ID,
		DocumentID:  doc.ID,
		Hash:        hashBytes,
		Algorithm:   "SHA256",
		FieldValues: req.FieldValues,
		ExpiresAt:   expiresAt,
	})

	return &pb.PrepareSignatureResponse{
		SignatureId:   sigID,
		Hash:          base64.StdEncoding.EncodeToString(hashBytes),
		HashAlgorithm: "SHA256",
		ExpiresAt:     expiresAt.Unix(),
	}, nil
}

// CompleteSignature completes a signature with an externally-provided signature
func (h *SigningHandler) CompleteSignature(ctx context.Context, req *pb.CompleteSignatureRequest) (*pb.CompleteSignatureResponse, error) {
	if !h.cfg.Signing.BrowserExtensionEnabled {
		return nil, status.Error(codes.Unavailable, "browser extension signing is not enabled")
	}

	// Get pending signature
	val, ok := h.pendingSignatures.LoadAndDelete(req.SignatureId)
	if !ok {
		return nil, status.Error(codes.NotFound, "signature session not found or expired")
	}

	pending := val.(*pendingSignature)
	if time.Now().After(pending.ExpiresAt) {
		return nil, status.Error(codes.DeadlineExceeded, "signature session expired")
	}

	if pending.Token != req.Token {
		return nil, status.Error(codes.PermissionDenied, "token mismatch")
	}

	if !req.ConsentGiven {
		return nil, status.Error(codes.InvalidArgument, "consent is required to sign")
	}

	// Decode the signature and certificate
	signatureBytes, err := base64.StdEncoding.DecodeString(req.Signature)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid signature encoding")
	}

	certBytes, err := base64.StdEncoding.DecodeString(req.Certificate)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid certificate encoding")
	}

	// Vuln 4 fix: parse cert, validate chain to trusted roots, bind to signer
	// email, and verify the signature actually validates the prepared hash.
	if h.trustedCAPool == nil {
		return nil, status.Error(codes.FailedPrecondition, "trusted CA pool not configured")
	}
	cert, err := x509.ParseCertificate(certBytes)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "certificate could not be parsed")
	}

	// Look up the signer row so we can bind the cert to the signer's email.
	signer, err := h.db.Queries.GetSigner(ctx, pending.SignerID)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to look up signer")
	}

	if err := sig.VerifyClientSignature(sig.VerifyParams{
		Cert:          cert,
		Signature:     signatureBytes,
		Hash:          pending.Hash,
		HashAlgorithm: pending.Algorithm,
		ExpectedEmail: signer.Email,
		Roots:         h.trustedCAPool,
		Now:           time.Now(),
	}); err != nil {
		slog.Warn("CompleteSignature: signature verification failed",
			"signerId", pending.SignerID,
			"documentId", pending.DocumentID,
			"error", err)
		return nil, status.Error(codes.PermissionDenied, "signature verification failed")
	}

	slog.Info("CompleteSignature: signature verified",
		"signerId", pending.SignerID,
		"documentId", pending.DocumentID,
		"certSubject", cert.Subject.String(),
		"certSerial", cert.SerialNumber.String())

	// Fill signature fields
	for _, fv := range pending.FieldValues {
		_, err := h.db.Queries.FillSignatureField(ctx, sqlc.FillSignatureFieldParams{
			ID:    fv.FieldId,
			Value: textFromString(fv.Value),
		})
		if err != nil {
			slog.Error("Failed to fill signature field", "field_id", fv.FieldId, "error", err)
		}
	}

	// Get IP and user agent
	ipAddr, userAgent := extractRequestMetadata(ctx)

	// Update signer status
	_, err = h.db.Queries.UpdateSignerSigned(ctx, sqlc.UpdateSignerSignedParams{
		ID:               pending.SignerID,
		SigningIpAddress: ipAddr,
		SigningUserAgent: textFromString(userAgent),
	})
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to update signer status")
	}

	// Create audit entry
	_, err = h.db.Queries.CreateAuditEntry(ctx, sqlc.CreateAuditEntryParams{
		ID:            "aud_" + generateShortID(),
		DocumentID:    pending.DocumentID,
		SignerID:      textFromString(pending.SignerID),
		Action:        sqlc.AuditActionSignatureCaptured,
		ActionDetails: []byte(`{"method": "browser_extension"}`),
		IpAddress:     ipAddr,
		UserAgent:     textFromString(userAgent),
	})
	if err != nil {
		slog.Error("Failed to create audit entry", "error", err)
	}

	// Store the signature record with the external certificate
	sigID := "sig_" + uuid.New().String()
	_, err = h.db.Queries.CreateSignature(ctx, sqlc.CreateSignatureParams{
		ID:                    sigID,
		DocumentID:            pending.DocumentID,
		SignerID:              pending.SignerID,
		SignatureData:         signatureBytes,
		SignatureAlgorithm:    sqlc.SignatureAlgorithmRSASHA256,
		CertificateChain:      string(certBytes),
		SigningTimestamp:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
		DocumentHash:          base64.StdEncoding.EncodeToString(pending.Hash),
		DocumentHashAlgorithm: pending.Algorithm,
		CertificateIssuer:     pgtype.Text{String: cert.Issuer.String(), Valid: true},
		CertificateSerial:     pgtype.Text{String: cert.SerialNumber.String(), Valid: true},
		CertificateValidFrom:  pgtype.Timestamptz{Time: cert.NotBefore, Valid: true},
		CertificateValidTo:    pgtype.Timestamptz{Time: cert.NotAfter, Valid: true},
	})
	if err != nil {
		slog.Error("Failed to store signature record", "error", err)
	}

	// Generate signed PDF (TODO: embed the external signature)
	doc, _ := h.db.Queries.GetDocument(ctx, pending.DocumentID)
	if err := h.generateSignedPDF(ctx, doc); err != nil {
		slog.Error("Failed to generate signed PDF", "error", err)
	}

	return &pb.CompleteSignatureResponse{
		Success: true,
		Message: "Document signed successfully with hardware token",
	}, nil
}

// textFromString and float64FromNumeric are defined in documents.go
