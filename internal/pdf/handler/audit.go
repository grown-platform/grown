package handler

import (
	"context"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"code.pick.haus/grown/grown/internal/pdf/config"
	"code.pick.haus/grown/grown/internal/pdf/database"
	"code.pick.haus/grown/grown/internal/pdf/sqlc"
	pb "code.pick.haus/grown/grown/internal/pdf/proto/audit"
)

type AuditHandler struct {
	pb.UnimplementedAuditServiceServer
	db  *database.DB
	cfg *config.Config
}

func NewAuditHandler(db *database.DB, cfg *config.Config) *AuditHandler {
	return &AuditHandler{
		db:  db,
		cfg: cfg,
	}
}

func (h *AuditHandler) GetAuditTrail(ctx context.Context, req *pb.GetAuditTrailRequest) (*pb.GetAuditTrailResponse, error) {
	pageSize := int32(50)
	if req.PageSize > 0 && req.PageSize <= 100 {
		pageSize = req.PageSize
	}

	offset := int32(0)
	// TODO: Parse page token for offset

	entries, err := h.db.Queries.GetAuditTrail(ctx, sqlc.GetAuditTrailParams{
		DocumentID: req.DocumentId,
		Limit:      pageSize,
		Offset:     offset,
	})
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to get audit trail")
	}

	count, _ := h.db.Queries.CountAuditEntries(ctx, req.DocumentId)

	var protoEntries []*pb.AuditEntry
	for _, e := range entries {
		protoEntries = append(protoEntries, auditEntryToProto(e))
	}

	return &pb.GetAuditTrailResponse{
		Entries:    protoEntries,
		TotalCount: int32(count),
	}, nil
}

func auditEntryToProto(e sqlc.AuditTrail) *pb.AuditEntry {
	// Convert DB action (lowercase like "document_viewed") to proto enum key (uppercase like "AUDIT_ACTION_DOCUMENT_VIEWED")
	actionKey := "AUDIT_ACTION_" + strings.ToUpper(string(e.Action))
	entry := &pb.AuditEntry{
		Id:         e.ID,
		DocumentId: e.DocumentID,
		Action:     pb.AuditAction(pb.AuditAction_value[actionKey]),
		CreatedAt:  timestamppb.New(e.CreatedAt.Time),
	}

	if e.SignerID.Valid {
		entry.SignerId = e.SignerID.String
	}
	if e.UserID.Valid {
		entry.UserId = e.UserID.String
	}
	if e.ActionDetails != nil {
		entry.ActionDetails = string(e.ActionDetails)
	}
	if e.IpAddress != nil {
		entry.IpAddress = e.IpAddress.String()
	}
	if e.UserAgent.Valid {
		entry.UserAgent = e.UserAgent.String
	}
	if e.GeoLocation.Valid {
		entry.GeoLocation = e.GeoLocation.String
	}

	return entry
}
