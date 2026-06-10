# internal/health

HealthService gRPC implementation. Reports build version, commit SHA, and uptime.

## Interfaces

- `NewService(version, commit string, startedAt time.Time) *Service` — constructor
- Implements `grownv1.HealthServiceServer` (one method: `Check`)

## Depends on

- `gen/go/grown/v1` — generated proto types

## Used by

- `internal/server` — registers the service on the gRPC server and gateway
