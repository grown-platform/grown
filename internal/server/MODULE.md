# internal/server

Wires gRPC services and the grpc-gateway HTTP surface into one `*Server`.
The HTTP gateway is registered in-process (no self-dial) for V1 — when we add
auth interceptors that need a real network path, we switch to a dialed gateway.

## Interfaces

- `New(cfg Config) *Server`
- `(*Server).HTTPHandler() http.Handler` — for an external `http.Server` to use
- `(*Server).GRPC() *grpc.Server` — for an external listener to `grpc.Server.Serve(lis)` on

## Depends on

- `internal/health`
- `gen/go/grown/v1`

## Used by

- `cmd/server` — the binary entrypoint
