package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"hash"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"code.pick.haus/grown/grown/internal/pdf/auth"
	"code.pick.haus/grown/grown/internal/pdf/config"
	"code.pick.haus/grown/grown/internal/pdf/database"
	"code.pick.haus/grown/grown/internal/pdf/email"
	"code.pick.haus/grown/grown/internal/pdf/mtls"
	"code.pick.haus/grown/grown/internal/pdf/pdf"
	"code.pick.haus/grown/grown/internal/pdf/sig"
	"code.pick.haus/grown/grown/internal/pdf/sqlc"
	"code.pick.haus/grown/grown/internal/pdf/storage"
	pb "code.pick.haus/grown/grown/internal/pdf/proto/documents"
)

type DocumentsHandler struct {
	pb.UnimplementedDocumentsServiceServer
	db      *database.DB
	cfg     *config.Config
	storage *storage.Client
	email   *email.Sender
	pdf     *pdf.Generator

	// trustedCAPool is used by VerifyDocument to re-verify stored signatures.
	// Nil disables read-side verification (signatures reported as unknown).
	trustedCAPool *x509.CertPool
}

func NewDocumentsHandler(db *database.DB, cfg *config.Config, storage *storage.Client, emailSender *email.Sender, pdfGen *pdf.Generator, trustedCAPool *x509.CertPool) *DocumentsHandler {
	return &DocumentsHandler{
		db:            db,
		cfg:           cfg,
		storage:       storage,
		email:         emailSender,
		pdf:           pdfGen,
		trustedCAPool: trustedCAPool,
	}
}

func (h *DocumentsHandler) CreateDocument(ctx context.Context, req *pb.CreateDocumentRequest) (*pb.CreateDocumentResponse, error) {
	// TODO: Extract org_id from context once multi-tenancy lands.
	orgID := "org_default" // Placeholder
	// Record the verified caller email as the document owner so non-admin
	// users only see their own documents. Falls back to "user_default" when
	// no identity is in context (dev / proxy_mode=false without OIDC).
	userID := auth.UserEmailFromContext(ctx)
	if userID == "" {
		userID = "user_default"
	}

	docID := "doc_" + uuid.New().String()
	// Vuln 5 fix: do not embed user-controlled filename in the S3 key. Use a
	// fixed server-generated name so a malicious client cannot craft a key
	// that lands outside this document's prefix (e.g., ../../org_victim/...).
	// The original filename is not security-relevant to the storage key and
	// is captured in req.Name for display purposes.
	storageKey := orgID + "/documents/" + docID + "/original.pdf"

	doc, err := h.db.Queries.CreateDocument(ctx, sqlc.CreateDocumentParams{
		ID:                    docID,
		OrganizationID:        orgID,
		Name:                  req.Name,
		Description:           textFromString(req.Description),
		Status:                sqlc.DocumentStatusDraft,
		StorageKey:            storageKey,
		TotalPages:            1,
		SigningOrder:          req.SigningOrder,
		ReminderFrequencyDays: int4FromInt32(req.ReminderFrequencyDays),
		CreatedBy:             userID,
	})
	if err != nil {
		slog.Error("Failed to create document", "error", err)
		return nil, status.Error(codes.Internal, "failed to create document")
	}

	// Generate presigned upload URL (valid for 15 minutes)
	uploadURL, err := h.storage.GetPresignedUploadURL(ctx, storageKey, 15*time.Minute, "application/pdf")
	if err != nil {
		slog.Error("Failed to generate upload URL", "error", err)
		return nil, status.Error(codes.Internal, "failed to generate upload URL")
	}

	return &pb.CreateDocumentResponse{
		Document:  documentToProto(doc),
		UploadUrl: uploadURL,
	}, nil
}

func (h *DocumentsHandler) GetDocument(ctx context.Context, req *pb.GetDocumentRequest) (*pb.GetDocumentResponse, error) {
	doc, err := h.db.Queries.GetDocument(ctx, req.Id)
	if err != nil {
		return nil, status.Error(codes.NotFound, "document not found")
	}

	// Update page count if it's still the default value of 1
	if doc.TotalPages == 1 && h.pdf != nil {
		pdfReader, err := h.storage.Download(ctx, doc.StorageKey)
		if err == nil {
			defer pdfReader.Close()
			pageCount, err := h.pdf.GetPageCount(pdfReader)
			if err == nil && pageCount > 1 {
				// Update the page count in the database
				doc, _ = h.db.Queries.UpdateDocumentPageCount(ctx, sqlc.UpdateDocumentPageCountParams{
					ID:         doc.ID,
					TotalPages: int32(pageCount),
				})
				slog.Info("Updated document page count", "documentId", doc.ID, "pageCount", pageCount)
			}
		}
	}

	signers, err := h.db.Queries.GetSignersByDocument(ctx, doc.ID)
	if err != nil {
		slog.Error("Failed to get signers", "error", err)
	}

	protoDoc := documentToProto(doc)
	for _, s := range signers {
		fields, _ := h.db.Queries.GetSignatureFieldsBySigner(ctx, s.ID)
		protoDoc.Signers = append(protoDoc.Signers, signerToProto(s, fields))
	}

	// Generate presigned download URL for original PDF
	downloadURL, err := h.storage.GetPresignedURL(ctx, doc.StorageKey, time.Hour)
	if err != nil {
		slog.Error("Failed to generate presigned URL", "error", err, "key", doc.StorageKey)
		downloadURL = ""
	}

	// Generate presigned download URL for signed PDF (if completed)
	var signedDownloadURL string
	if doc.Status == sqlc.DocumentStatusCompleted && doc.SignedStorageKey.Valid && doc.SignedStorageKey.String != "" {
		signedDownloadURL, err = h.storage.GetPresignedURL(ctx, doc.SignedStorageKey.String, time.Hour)
		if err != nil {
			slog.Error("Failed to generate signed presigned URL", "error", err, "key", doc.SignedStorageKey.String)
		}
	}

	return &pb.GetDocumentResponse{
		Document:          protoDoc,
		DownloadUrl:       downloadURL,
		SignedDownloadUrl: signedDownloadURL,
	}, nil
}

func (h *DocumentsHandler) UpdateDocument(ctx context.Context, req *pb.UpdateDocumentRequest) (*pb.UpdateDocumentResponse, error) {
	doc, err := h.db.Queries.UpdateDocument(ctx, sqlc.UpdateDocumentParams{
		ID:           req.Id,
		Name:         req.Name,
		Description:  textFromString(req.Description),
		SigningOrder: req.SigningOrder,
	})
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to update document")
	}

	return &pb.UpdateDocumentResponse{
		Document: documentToProto(doc),
	}, nil
}

func (h *DocumentsHandler) DeleteDocument(ctx context.Context, req *pb.DeleteDocumentRequest) (*pb.DeleteDocumentResponse, error) {
	// Fetch the document first to check its status
	doc, err := h.db.Queries.GetDocument(ctx, req.Id)
	if err != nil {
		return nil, status.Error(codes.NotFound, "document not found")
	}

	// Prevent deletion of completed (fully signed) documents
	if doc.Status == sqlc.DocumentStatusCompleted {
		return nil, status.Error(codes.FailedPrecondition, "cannot delete a completed document")
	}

	if err := h.db.Queries.DeleteDocument(ctx, req.Id); err != nil {
		return nil, status.Error(codes.Internal, "failed to delete document")
	}

	return &pb.DeleteDocumentResponse{Success: true}, nil
}

func (h *DocumentsHandler) ListDocuments(ctx context.Context, req *pb.ListDocumentsRequest) (*pb.ListDocumentsResponse, error) {
	pageSize := int32(20)
	if req.PageSize > 0 && req.PageSize <= 100 {
		pageSize = req.PageSize
	}
	offset := int32(0)

	callerEmail := auth.UserEmailFromContext(ctx)
	isAdmin := auth.IsSuperadmin(ctx, h.db.Queries, callerEmail)

	var docs []sqlc.Document
	var count int32
	if isAdmin {
		// Use the sqlc-generated query so schema changes (new columns like
		// `annotations`) don't silently break this path with column-count
		// mismatches in a hand-written Scan.
		got, err := h.db.Queries.ListAllDocuments(ctx, sqlc.ListAllDocumentsParams{
			Limit:  pageSize,
			Offset: offset,
		})
		if err != nil {
			slog.Error("Failed to list documents (admin)", "error", err)
			return nil, status.Error(codes.Internal, "failed to list documents")
		}
		docs = got
		total, _ := h.db.Queries.CountAllDocuments(ctx)
		count = int32(total)
	} else {
		if callerEmail == "" {
			// No identity in context — return empty list rather than leaking
			// everyone's documents. This path is hit when OIDC is disabled
			// (dev) or middleware ordering changes.
			return &pb.ListDocumentsResponse{Documents: nil, TotalCount: 0}, nil
		}
		got, err := h.db.Queries.ListDocumentsForUser(ctx, sqlc.ListDocumentsForUserParams{
			Lower:  callerEmail,
			Limit:  pageSize,
			Offset: offset,
		})
		if err != nil {
			slog.Error("Failed to list documents for user", "error", err, "email", callerEmail)
			return nil, status.Error(codes.Internal, "failed to list documents")
		}
		docs = got
		c, _ := h.db.Queries.CountDocumentsForUser(ctx, callerEmail)
		count = c
	}

	var protoDocs []*pb.Document
	for _, doc := range docs {
		protoDoc := documentToProto(doc)
		signers, err := h.db.Queries.GetSignersByDocument(ctx, doc.ID)
		if err == nil {
			for _, s := range signers {
				protoDoc.Signers = append(protoDoc.Signers, signerToProto(s, nil))
			}
		}
		protoDocs = append(protoDocs, protoDoc)
	}

	return &pb.ListDocumentsResponse{
		Documents:  protoDocs,
		TotalCount: count,
	}, nil
}

func (h *DocumentsHandler) SendDocument(ctx context.Context, req *pb.SendDocumentRequest) (*pb.SendDocumentResponse, error) {
	// Get document
	doc, err := h.db.Queries.GetDocument(ctx, req.Id)
	if err != nil {
		return nil, status.Error(codes.NotFound, "document not found")
	}

	// Get all signers for this document
	signers, err := h.db.Queries.GetSignersByDocument(ctx, req.Id)
	if err != nil {
		slog.Error("Failed to get signers", "error", err)
		return nil, status.Error(codes.Internal, "failed to get signers")
	}

	if len(signers) == 0 {
		return nil, status.Error(codes.FailedPrecondition, "document must have at least one signer")
	}

	// When signing_order is enabled, only generate a token for the first
	// signer (lowest signing_order). Subsequent signers are notified
	// automatically after the preceding signer completes.
	// When signing_order is disabled (parallel), all signers are notified now.
	firstOrder := int32(0)
	if doc.SigningOrder && len(signers) > 0 {
		firstOrder = signers[0].SigningOrder // signers are ordered by signing_order ASC
	}

	for _, signer := range signers {
		isFirstInOrder := doc.SigningOrder && signer.SigningOrder == firstOrder
		shouldNotifyNow := !doc.SigningOrder || isFirstInOrder

		// Generate access token (valid for 30 days)
		token, expiry, err := GenerateAccessTokenWithExpiry(30)
		if err != nil {
			slog.Error("Failed to generate access token", "error", err)
			continue
		}

		// Update signer with token
		_, err = h.db.Queries.SetSignerAccessToken(ctx, sqlc.SetSignerAccessTokenParams{
			ID:                   signer.ID,
			AccessToken:          textFromString(token),
			AccessTokenExpiresAt: pgtype.Timestamptz{Time: expiry, Valid: true},
		})
		if err != nil {
			slog.Error("Failed to update signer token", "error", err, "signerId", signer.ID)
			continue
		}

		if shouldNotifyNow {
			// Mark signer as sent before emailing
			if _, err := h.db.Queries.UpdateSignerSent(ctx, signer.ID); err != nil {
				slog.Error("Failed to mark signer sent", "error", err, "signerId", signer.ID)
			}
			// Send invitation email
			signingURL := fmt.Sprintf("%s/sign/%s", h.cfg.Server.FrontendURL, token)
			go func(s sqlc.Signer) {
				err := h.email.SendSigningInvitation(context.Background(), email.SigningInvitation{
					RecipientEmail: s.Email,
					RecipientName:  s.Name,
					SenderName:     "Document Owner", // In production, get from auth context
					DocumentName:   doc.Name,
					SigningURL:     signingURL,
					ExpiresAt:      expiry.Format("January 2, 2006"),
					Message:        req.Message,
				})
				if err != nil {
					slog.Error("Failed to send invitation email", "error", err, "email", s.Email)
				} else {
					slog.Info("Invitation email sent", "email", s.Email, "documentId", doc.ID)
				}
			}(signer)
		} else {
			slog.Info("Signer queued (will be notified after previous signer signs)",
				"email", signer.Email, "order", signer.SigningOrder, "documentId", doc.ID)
		}
	}

	// Update document status to pending
	updatedDoc, err := h.db.Queries.UpdateDocumentStatus(ctx, sqlc.UpdateDocumentStatusParams{
		ID:     req.Id,
		Status: sqlc.DocumentStatusPending,
	})
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to send document")
	}

	slog.Info("Document sent for signing", "documentId", req.Id, "signerCount", len(signers))
	return &pb.SendDocumentResponse{
		Document: documentToProto(updatedDoc),
	}, nil
}

func (h *DocumentsHandler) VoidDocument(ctx context.Context, req *pb.VoidDocumentRequest) (*pb.VoidDocumentResponse, error) {
	_, err := h.db.Queries.UpdateDocumentStatus(ctx, sqlc.UpdateDocumentStatusParams{
		ID:     req.Id,
		Status: sqlc.DocumentStatusVoided,
	})
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to void document")
	}

	return &pb.VoidDocumentResponse{Success: true}, nil
}

func (h *DocumentsHandler) AddSigner(ctx context.Context, req *pb.AddSignerRequest) (*pb.AddSignerResponse, error) {
	slog.Info("AddSigner request", "documentId", req.DocumentId, "email", req.Email, "name", req.Name, "signerType", req.SignerType)

	signerID := "sig_" + uuid.New().String()

	signer, err := h.db.Queries.CreateSigner(ctx, sqlc.CreateSignerParams{
		ID:           signerID,
		DocumentID:   req.DocumentId,
		Email:        req.Email,
		Name:         req.Name,
		SignerType:   sqlc.SignerType(protoSignerTypeToString(req.SignerType)),
		SigningOrder: req.SigningOrder,
	})
	if err != nil {
		slog.Error("Failed to add signer", "error", err, "documentId", req.DocumentId, "email", req.Email)
		return nil, status.Error(codes.Internal, "failed to add signer")
	}

	slog.Info("Signer added successfully", "signerId", signer.ID, "documentId", req.DocumentId)
	return &pb.AddSignerResponse{
		Signer: signerToProto(signer, nil),
	}, nil
}

func (h *DocumentsHandler) RemoveSigner(ctx context.Context, req *pb.RemoveSignerRequest) (*pb.RemoveSignerResponse, error) {
	if err := h.db.Queries.DeleteSigner(ctx, req.SignerId); err != nil {
		return nil, status.Error(codes.Internal, "failed to remove signer")
	}

	return &pb.RemoveSignerResponse{Success: true}, nil
}

func (h *DocumentsHandler) AddSignatureField(ctx context.Context, req *pb.AddSignatureFieldRequest) (*pb.AddSignatureFieldResponse, error) {
	fieldID := "fld_" + uuid.New().String()

	fieldType := protoFieldTypeToString(req.FieldType)
	slog.Info("Adding signature field",
		"fieldId", fieldID,
		"documentId", req.DocumentId,
		"signerId", req.SignerId,
		"fieldType", fieldType,
		"protoFieldType", req.FieldType,
		"pageNumber", req.PageNumber,
		"x", req.X,
		"y", req.Y,
	)

	field, err := h.db.Queries.CreateSignatureField(ctx, sqlc.CreateSignatureFieldParams{
		ID:         fieldID,
		DocumentID: req.DocumentId,
		SignerID:   req.SignerId,
		FieldType:  sqlc.FieldType(fieldType),
		PageNumber: req.PageNumber,
		X:          numericFromFloat64(float64(req.X)),
		Y:          numericFromFloat64(float64(req.Y)),
		Width:      numericFromFloat64(float64(req.Width)),
		Height:     numericFromFloat64(float64(req.Height)),
		Required:   req.Required,
		Label:      textFromString(req.Label),
		FontSize:   int4FromInt32(req.FontSize),
	})
	if err != nil {
		slog.Error("Failed to create signature field", "error", err, "fieldType", fieldType, "documentId", req.DocumentId, "signerId", req.SignerId)
		return nil, status.Error(codes.Internal, "failed to add signature field")
	}

	return &pb.AddSignatureFieldResponse{
		Field: fieldToProto(field),
	}, nil
}

func (h *DocumentsHandler) UpdateSignatureField(ctx context.Context, req *pb.UpdateSignatureFieldRequest) (*pb.UpdateSignatureFieldResponse, error) {
	field, err := h.db.Queries.UpdateSignatureField(ctx, sqlc.UpdateSignatureFieldParams{
		ID:         req.FieldId,
		PageNumber: req.PageNumber,
		X:          numericFromFloat64(float64(req.X)),
		Y:          numericFromFloat64(float64(req.Y)),
		Width:      numericFromFloat64(float64(req.Width)),
		Height:     numericFromFloat64(float64(req.Height)),
		Label:      textFromString(req.Label),
		FontSize:   int4FromInt32(req.FontSize),
	})
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to update field")
	}

	return &pb.UpdateSignatureFieldResponse{
		Field: fieldToProto(field),
	}, nil
}

func (h *DocumentsHandler) RemoveSignatureField(ctx context.Context, req *pb.RemoveSignatureFieldRequest) (*pb.RemoveSignatureFieldResponse, error) {
	if err := h.db.Queries.DeleteSignatureField(ctx, req.FieldId); err != nil {
		return nil, status.Error(codes.Internal, "failed to remove field")
	}

	return &pb.RemoveSignatureFieldResponse{Success: true}, nil
}

func (h *DocumentsHandler) GetCompletedDocument(ctx context.Context, req *pb.GetCompletedDocumentRequest) (*pb.GetCompletedDocumentResponse, error) {
	doc, err := h.db.Queries.GetDocument(ctx, req.Id)
	if err != nil {
		return nil, status.Error(codes.NotFound, "document not found")
	}

	if doc.Status != sqlc.DocumentStatusCompleted {
		return nil, status.Error(codes.FailedPrecondition, "document is not completed")
	}

	// Use signed document key if available, otherwise fall back to original
	storageKey := doc.StorageKey
	if doc.SignedStorageKey.Valid && doc.SignedStorageKey.String != "" {
		storageKey = doc.SignedStorageKey.String
	}

	// Generate presigned download URL (valid for 1 hour)
	downloadURL, err := h.storage.GetPresignedURL(ctx, storageKey, time.Hour)
	if err != nil {
		slog.Error("Failed to generate download URL", "error", err, "key", storageKey)
		return nil, status.Error(codes.Internal, "failed to generate download URL")
	}

	return &pb.GetCompletedDocumentResponse{
		DownloadUrl: downloadURL,
	}, nil
}

func (h *DocumentsHandler) GetDocumentSignatures(ctx context.Context, req *pb.GetDocumentSignaturesRequest) (*pb.GetDocumentSignaturesResponse, error) {
	// Get all signatures for this document
	signatures, err := h.db.Queries.GetSignaturesByDocument(ctx, req.DocumentId)
	if err != nil {
		slog.Error("Failed to get signatures", "error", err, "documentId", req.DocumentId)
		return nil, status.Error(codes.Internal, "failed to get signatures")
	}

	// Build response with signer info
	var pbSignatures []*pb.DocumentSignature
	for _, sig := range signatures {
		// Get signer info
		signer, err := h.db.Queries.GetSigner(ctx, sig.SignerID)
		if err != nil {
			slog.Error("Failed to get signer", "error", err, "signerId", sig.SignerID)
			continue
		}

		pbSig := &pb.DocumentSignature{
			Id:                 sig.ID,
			SignerId:           sig.SignerID,
			SignerName:         signer.Name,
			SignerEmail:        signer.Email,
			SignatureAlgorithm: string(sig.SignatureAlgorithm),
			DocumentHash:       sig.DocumentHash,
			HashAlgorithm:      sig.DocumentHashAlgorithm,
			SigningTimestamp:   timestamppb.New(sig.SigningTimestamp.Time),
			CertificateIssuer:  sig.CertificateIssuer.String,
			CertificateSerial:  sig.CertificateSerial.String,
		}

		if sig.CertificateValidFrom.Valid {
			pbSig.CertificateValidFrom = timestamppb.New(sig.CertificateValidFrom.Time)
		}
		if sig.CertificateValidTo.Valid {
			pbSig.CertificateValidTo = timestamppb.New(sig.CertificateValidTo.Time)
		}

		pbSignatures = append(pbSignatures, pbSig)
	}

	return &pb.GetDocumentSignaturesResponse{
		Signatures: pbSignatures,
	}, nil
}

func (h *DocumentsHandler) ListDocumentsToSign(ctx context.Context, req *pb.ListDocumentsToSignRequest) (*pb.ListDocumentsToSignResponse, error) {
	// Vuln 1 fix: never trust req.Email. The user's email must come from a
	// verified source: either the trusted reverse-proxy header (proxy mode
	// for service-to-service calls from agility/effects), or the OIDC
	// claims set by the auth middleware on browser sessions. Whichever
	// is present, use it; if neither is, reject.
	var email string
	if id := mtls.ProxyIdentityFromContext(ctx); id != nil && id.Email != "" {
		email = id.Email
	} else if e := auth.UserEmailFromContext(ctx); e != "" {
		email = e
	}
	if email == "" {
		return nil, status.Error(codes.Unauthenticated, "user email not asserted")
	}

	pageSize := int32(20)
	if req.PageSize > 0 && req.PageSize <= 100 {
		pageSize = req.PageSize
	}

	offset := int32(0)
	// TODO: Parse page token for offset

	// Get signers for this email
	signers, err := h.db.Queries.GetSignersByEmail(ctx, sqlc.GetSignersByEmailParams{
		Email:  email,
		Limit:  pageSize,
		Offset: offset,
	})
	if err != nil {
		slog.Error("Failed to get signers by email", "error", err, "email", email)
		return nil, status.Error(codes.Internal, "failed to get documents to sign")
	}

	// Get count
	count, err := h.db.Queries.CountSignersByEmail(ctx, email)
	if err != nil {
		slog.Error("Failed to count signers by email", "error", err)
		count = int64(len(signers))
	}

	var docsToSign []*pb.DocumentToSign
	for _, signer := range signers {
		// Get document for this signer
		doc, err := h.db.Queries.GetDocument(ctx, signer.DocumentID)
		if err != nil {
			slog.Error("Failed to get document for signer", "error", err, "documentId", signer.DocumentID)
			continue
		}

		// Get fields for this signer
		fields, _ := h.db.Queries.GetSignatureFieldsBySigner(ctx, signer.ID)

		// Build signing URL
		signingURL := ""
		if signer.AccessToken.Valid && signer.AccessToken.String != "" {
			signingURL = fmt.Sprintf("%s/sign/%s", h.cfg.Server.FrontendURL, signer.AccessToken.String)
		}

		docsToSign = append(docsToSign, &pb.DocumentToSign{
			Document:   documentToProto(doc),
			Signer:     signerToProto(signer, fields),
			SigningUrl: signingURL,
		})
	}

	return &pb.ListDocumentsToSignResponse{
		Documents:  docsToSign,
		TotalCount: int32(count),
	}, nil
}

// ResendSignerInvitation resends the signing invitation email to a signer
// NOTE: This requires proto regeneration - run `proto-gen` to enable
/*
func (h *DocumentsHandler) ResendSignerInvitation(ctx context.Context, req *pb.ResendSignerInvitationRequest) (*pb.ResendSignerInvitationResponse, error) {
	// Get the signer
	signer, err := h.db.Queries.GetSigner(ctx, req.SignerId)
	if err != nil {
		return nil, status.Error(codes.NotFound, "signer not found")
	}

	// Verify signer belongs to this document
	if signer.DocumentID != req.DocumentId {
		return nil, status.Error(codes.PermissionDenied, "signer does not belong to this document")
	}

	// Only resend if signer hasn't signed yet
	if signer.Status == sqlc.SignerStatusSigned {
		return nil, status.Error(codes.FailedPrecondition, "signer has already signed")
	}

	// Get document for email
	doc, err := h.db.Queries.GetDocument(ctx, req.DocumentId)
	if err != nil {
		return nil, status.Error(codes.NotFound, "document not found")
	}

	// Generate new access token
	token, expiry, err := GenerateAccessTokenWithExpiry(30)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate token")
	}

	// Update signer with new token
	_, err = h.db.Queries.SetSignerAccessToken(ctx, sqlc.SetSignerAccessTokenParams{
		ID:                   signer.ID,
		AccessToken:          textFromString(token),
		AccessTokenExpiresAt: pgtype.Timestamptz{Time: expiry, Valid: true},
	})
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to update token")
	}

	// Send invitation email
	signingURL := fmt.Sprintf("%s/sign/%s", h.cfg.Server.FrontendURL, token)
	err = h.email.SendSigningInvitation(ctx, email.SigningInvitation{
		RecipientEmail: signer.Email,
		RecipientName:  signer.Name,
		SenderName:     "Document Owner",
		DocumentName:   doc.Name,
		SigningURL:     signingURL,
		ExpiresAt:      expiry.Format("January 2, 2006"),
	})
	if err != nil {
		slog.Error("Failed to send invitation email", "error", err)
		return nil, status.Error(codes.Internal, "failed to send email")
	}

	slog.Info("Resent signing invitation", "signerId", signer.ID, "email", signer.Email)
	return &pb.ResendSignerInvitationResponse{
		Success: true,
		Message: "Invitation email sent successfully",
	}, nil
}
*/

// Helper functions
func textFromString(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: s, Valid: true}
}

func int4FromInt32(i int32) pgtype.Int4 {
	if i == 0 {
		return pgtype.Int4{Valid: false}
	}
	return pgtype.Int4{Int32: i, Valid: true}
}

func documentToProto(doc sqlc.Document) *pb.Document {
	return &pb.Document{
		Id:                    doc.ID,
		OrganizationId:        doc.OrganizationID,
		Name:                  doc.Name,
		Description:           stringFromText(doc.Description),
		Status:                pb.DocumentStatus(pb.DocumentStatus_value["DOCUMENT_STATUS_"+strings.ToUpper(string(doc.Status))]),
		StorageKey:            doc.StorageKey,
		SignedStorageKey:      stringFromText(doc.SignedStorageKey),
		TotalPages:            doc.TotalPages,
		FileSizeBytes:         int64FromInt8(doc.FileSizeBytes),
		SigningOrder:          doc.SigningOrder,
		ReminderFrequencyDays: int32FromInt4(doc.ReminderFrequencyDays),
		CreatedBy:             doc.CreatedBy,
		CreatedAt:             timestamppb.New(doc.CreatedAt.Time),
		UpdatedAt:             timestamppb.New(doc.UpdatedAt.Time),
	}
}

func signerToProto(s sqlc.Signer, fields []sqlc.SignatureField) *pb.Signer {
	signer := &pb.Signer{
		Id:           s.ID,
		DocumentId:   s.DocumentID,
		Email:        s.Email,
		Name:         s.Name,
		UserId:       stringFromText(s.UserID),
		SignerType:   pb.SignerType(pb.SignerType_value["SIGNER_TYPE_"+string(s.SignerType)]),
		SigningOrder: s.SigningOrder,
		Status:       pb.SignerStatus(pb.SignerStatus_value["SIGNER_STATUS_"+strings.ToUpper(string(s.Status))]),
	}

	for _, f := range fields {
		signer.Fields = append(signer.Fields, fieldToProto(f))
	}

	return signer
}

func fieldToProto(f sqlc.SignatureField) *pb.SignatureField {
	return &pb.SignatureField{
		Id:         f.ID,
		DocumentId: f.DocumentID,
		SignerId:   f.SignerID,
		FieldType:  pb.FieldType(pb.FieldType_value["FIELD_TYPE_"+strings.ToUpper(string(f.FieldType))]),
		PageNumber: f.PageNumber,
		X:          float64FromNumeric(f.X),
		Y:          float64FromNumeric(f.Y),
		Width:      float64FromNumeric(f.Width),
		Height:     float64FromNumeric(f.Height),
		Required:   f.Required,
		Label:      stringFromText(f.Label),
		Value:      stringFromText(f.Value),
		IsFilled:   f.Value.Valid,
		FontSize:   int32FromInt4(f.FontSize),
	}
}

func stringFromText(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

func int32FromInt4(i pgtype.Int4) int32 {
	if !i.Valid {
		return 0
	}
	return i.Int32
}

func int64FromInt8(i pgtype.Int8) int64 {
	if !i.Valid {
		return 0
	}
	return i.Int64
}

// VerifyDocument verifies all signatures on a document and returns their status
func (h *DocumentsHandler) VerifyDocument(ctx context.Context, req *pb.VerifyDocumentRequest) (*pb.VerifyDocumentResponse, error) {
	// Get the document
	doc, err := h.db.Queries.GetDocument(ctx, req.Id)
	if err != nil {
		return nil, status.Error(codes.NotFound, "document not found")
	}

	// Check if document is completed (has signatures)
	if doc.Status != sqlc.DocumentStatusCompleted {
		return &pb.VerifyDocumentResponse{
			DocumentValid:      false,
			AllSignaturesValid: false,
			Status:             "incomplete",
			Message:            "Document has not been fully signed",
			Signatures:         nil,
			DocumentModified:   false,
		}, nil
	}

	// Get all signatures for this document
	signatures, err := h.db.Queries.GetSignaturesByDocument(ctx, req.Id)
	if err != nil {
		slog.Error("Failed to get signatures", "error", err, "documentId", req.Id)
		return nil, status.Error(codes.Internal, "failed to get signatures")
	}

	if len(signatures) == 0 {
		return &pb.VerifyDocumentResponse{
			DocumentValid:      false,
			AllSignaturesValid: false,
			Status:             "unsigned",
			Message:            "No signatures found on document",
			Signatures:         nil,
			DocumentModified:   false,
		}, nil
	}

	// Build signature verification results
	var pbSignatures []*pb.SignatureVerification
	allValid := true

	for _, dbSig := range signatures {
		signer, err := h.db.Queries.GetSigner(ctx, dbSig.SignerID)
		if err != nil {
			slog.Error("Failed to get signer", "error", err, "signerId", dbSig.SignerID)
			continue
		}

		now := time.Now()
		certValidFrom := dbSig.CertificateValidFrom.Time
		certValidTo := dbSig.CertificateValidTo.Time
		certExpired := dbSig.CertificateValidTo.Valid && now.After(certValidTo)

		// Vuln 4 fix: actually verify the stored signature against the trust
		// bundle and the recomputed document hash. If trustedCAPool is nil
		// or any step fails we report the signature as invalid.
		sigValid := false
		hashMatches := false
		sigStatus := "invalid"
		sigMessage := "signature could not be verified"

		if h.trustedCAPool == nil {
			sigMessage = "trusted CA pool not configured; signatures cannot be verified"
		} else {
			cert, parseErr := x509.ParseCertificate([]byte(dbSig.CertificateChain))
			if parseErr != nil {
				sigMessage = "certificate could not be parsed"
			} else {
				recomputedHash, hashErr := h.recomputeDocumentHash(ctx, doc, dbSig.DocumentHashAlgorithm)
				if hashErr != nil {
					sigMessage = "could not recompute document hash"
				} else {
					storedHash, _ := base64.StdEncoding.DecodeString(dbSig.DocumentHash)
					hashMatches = bytes.Equal(storedHash, recomputedHash)

					if !hashMatches {
						sigMessage = "document hash does not match stored signature hash"
					} else {
						verifyErr := sig.VerifyClientSignature(sig.VerifyParams{
							Cert:          cert,
							Signature:     dbSig.SignatureData,
							Hash:          recomputedHash,
							HashAlgorithm: dbSig.DocumentHashAlgorithm,
							ExpectedEmail: signer.Email,
							Roots:         h.trustedCAPool,
							Now:           certValidFrom, // verify chain at signing time, not now
						})
						if verifyErr != nil {
							sigMessage = "signature verification failed: " + verifyErr.Error()
						} else {
							sigValid = true
							sigStatus = "valid"
							sigMessage = "Signature is valid"
							if certExpired {
								sigStatus = "valid_expired_cert"
								sigMessage = "Signature was valid at signing time; certificate has since expired"
							}
						}
					}
				}
			}
		}

		hasTimestamp := len(dbSig.TimestampToken) > 0

		verification := &pb.SignatureVerification{
			SignerName:           signer.Name,
			SignerEmail:          signer.Email,
			IsValid:              sigValid,
			Status:               sigStatus,
			Message:              sigMessage,
			CertificateSubject:   signer.Name,
			CertificateIssuer:    dbSig.CertificateIssuer.String,
			CertificateSerial:    dbSig.CertificateSerial.String,
			CertificateValidFrom: timestamppb.New(certValidFrom),
			CertificateValidTo:   timestamppb.New(certValidTo),
			CertificateExpired:   certExpired,
			HasTimestamp:         hasTimestamp,
			DocumentHash:         dbSig.DocumentHash,
			HashAlgorithm:        dbSig.DocumentHashAlgorithm,
			HashMatches:          hashMatches,
		}

		if hasTimestamp {
			verification.Timestamp = timestamppb.New(dbSig.SigningTimestamp.Time)
			verification.TimestampAuthority = "RFC 3161 TSA"
		}

		pbSignatures = append(pbSignatures, verification)

		if !sigValid {
			allValid = false
		}
	}

	// Build final response
	docStatus := "valid"
	docMessage := fmt.Sprintf("Document has %d valid signature(s)", len(pbSignatures))
	if !allValid {
		docStatus = "invalid"
		docMessage = "One or more signatures are invalid"
	}

	return &pb.VerifyDocumentResponse{
		DocumentValid:      allValid,
		AllSignaturesValid: allValid,
		Status:             docStatus,
		Message:            docMessage,
		Signatures:         pbSignatures,
		DocumentModified:   false,
	}, nil
}

func numericFromFloat64(f float64) pgtype.Numeric {
	var n pgtype.Numeric
	// Use ScanScientific with standard float format
	if err := n.ScanScientific(fmt.Sprintf("%.8f", f)); err != nil {
		slog.Error("Failed to convert float to numeric", "value", f, "error", err)
	}
	return n
}

func float64FromNumeric(n pgtype.Numeric) float64 {
	if !n.Valid {
		return 0
	}
	f, _ := n.Float64Value()
	return f.Float64
}

func protoSignerTypeToString(t pb.SignerType) string {
	switch t {
	case pb.SignerType_SIGNER_TYPE_SIGNER:
		return "signer"
	case pb.SignerType_SIGNER_TYPE_APPROVER:
		return "approver"
	case pb.SignerType_SIGNER_TYPE_CC:
		return "cc"
	default:
		return "signer"
	}
}

func protoFieldTypeToString(t pb.FieldType) string {
	switch t {
	case pb.FieldType_FIELD_TYPE_SIGNATURE:
		return "signature"
	case pb.FieldType_FIELD_TYPE_INITIALS:
		return "initials"
	case pb.FieldType_FIELD_TYPE_DATE:
		return "date"
	case pb.FieldType_FIELD_TYPE_TEXT:
		return "text"
	case pb.FieldType_FIELD_TYPE_CHECKBOX:
		return "checkbox"
	default:
		return "signature"
	}
}

// recomputeDocumentHash downloads the document's stored PDF and computes a
// fresh digest using the algorithm recorded at signing time. Used by
// VerifyDocument to detect post-sign tampering.
func (h *DocumentsHandler) recomputeDocumentHash(ctx context.Context, doc sqlc.Document, algo string) ([]byte, error) {
	body, err := h.storage.Download(ctx, doc.StorageKey)
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", doc.StorageKey, err)
	}
	defer body.Close()

	var hasher hash.Hash
	switch algo {
	case "SHA256":
		hasher = sha256.New()
	case "SHA384":
		hasher = sha512.New384()
	case "SHA512":
		hasher = sha512.New()
	default:
		return nil, fmt.Errorf("unsupported hash algorithm: %s", algo)
	}
	if _, err := io.Copy(hasher, body); err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	return hasher.Sum(nil), nil
}
