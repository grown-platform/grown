package handler

import (
	"context"
	"testing"

	"code.pick.haus/grown/grown/internal/pdf/mtls"
	pb "code.pick.haus/grown/grown/internal/pdf/proto/documents"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestListDocumentsToSign_NoProxyIdentity_Unauthenticated(t *testing.T) {
	h := &DocumentsHandler{}
	_, err := h.ListDocumentsToSign(context.Background(), &pb.ListDocumentsToSignRequest{
		Email: "anyone@example.com",
	})
	if err == nil {
		t.Fatal("expected Unauthenticated error, got nil")
	}
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", status.Code(err))
	}
}

func TestListDocumentsToSign_EmptyProxyEmail_Unauthenticated(t *testing.T) {
	h := &DocumentsHandler{}
	ctx := mtls.WithProxyIdentity(context.Background(), &mtls.ProxyIdentity{Email: ""})
	_, err := h.ListDocumentsToSign(ctx, &pb.ListDocumentsToSignRequest{
		Email: "anyone@example.com",
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", err)
	}
}
