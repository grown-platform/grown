package audit

import (
	"context"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/status"
)

// mutatingPrefixes are the RPC-name prefixes we treat as state-changing and
// therefore audit. A method whose short name starts with one of these (e.g.
// CreateVideo, DeleteFile, ShareDoc) is recorded; everything else (List/Get/
// Search/Whoami/Health/…) is skipped. Order longest-first only matters for the
// derived action verb (see actionFor), not for the include decision.
var mutatingPrefixes = []string{
	"Create", "Update", "Delete", "Trash", "Set", "Submit", "Post", "Add",
	"Remove", "Move", "Copy", "Share", "Rename", "Reorder", "Upsert", "Generate",
}

// NewInterceptor returns a grpc.UnaryServerInterceptor that records every
// MUTATING RPC (see mutatingPrefixes) AFTER the handler runs. Read-only RPCs
// (List/Get/Search/Whoami/Health) are skipped. One registration auto-covers
// every gRPC service. A nil recorder yields a pass-through interceptor.
func NewInterceptor(rec *Recorder) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		resp, err := handler(ctx, req)
		if rec == nil {
			return resp, err
		}
		svc, method := splitFullMethod(info.FullMethod)
		if !isMutating(method) {
			return resp, err
		}

		st := "ok"
		detail := map[string]any{}
		if err != nil {
			st = "error"
			detail["code"] = status.Code(err).String()
		}

		// Best-effort resource info from the request message. We deliberately do
		// NOT depend on gen/ types here; we sniff common id-bearing fields via a
		// tiny reflection-free interface set (see resourceFromReq).
		resType := serviceSlug(svc) // sensible default: the service's own noun
		resID := resourceFromReq(req)

		rec.Record(ctx, Event{
			Service:      serviceSlug(svc),
			Action:       actionFor(method),
			ResourceType: resType,
			ResourceID:   resID,
			Method:       info.FullMethod,
			Status:       st,
			Detail:       detail,
		})
		return resp, err
	}
}

// splitFullMethod splits "/grown.v1.VideoService/CreateVideo" into the trailing
// service name ("VideoService") and the method ("CreateVideo").
func splitFullMethod(full string) (service, method string) {
	full = strings.TrimPrefix(full, "/")
	slash := strings.LastIndex(full, "/")
	if slash < 0 {
		return "", full
	}
	svcPath := full[:slash]
	method = full[slash+1:]
	if dot := strings.LastIndex(svcPath, "."); dot >= 0 {
		service = svcPath[dot+1:]
	} else {
		service = svcPath
	}
	return service, method
}

// isMutating reports whether an RPC method name denotes a state-changing call.
func isMutating(method string) bool {
	for _, p := range mutatingPrefixes {
		if strings.HasPrefix(method, p) {
			return true
		}
	}
	return false
}

// serviceSlug turns a gRPC service name into a lowercase noun: "VideoService" →
// "video", "MailService" → "mail". A bare name with no "Service" suffix is just
// lowercased.
func serviceSlug(service string) string {
	service = strings.TrimSuffix(service, "Service")
	return strings.ToLower(service)
}

// actionFor derives the action verb from a method name by stripping the leading
// mutating prefix and lowercasing it: "CreateVideo" → "create", "DeleteFile" →
// "delete", "ShareDoc" → "share". When the matched prefix is the whole method
// (rare), the prefix itself is the action.
func actionFor(method string) string {
	for _, p := range mutatingPrefixes {
		if strings.HasPrefix(method, p) {
			return strings.ToLower(p)
		}
	}
	return strings.ToLower(method)
}

// resourceFromReq best-effort extracts a resource id from a request message
// without importing gen/. Generated request protos expose getters; we probe the
// most common id field names via narrow interfaces. Returns "" when none match.
func resourceFromReq(req any) string {
	type getID interface{ GetId() string }
	type getResource interface{ GetResourceId() string }
	switch m := req.(type) {
	case getID:
		return m.GetId()
	case getResource:
		return m.GetResourceId()
	}
	return ""
}
