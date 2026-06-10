# internal/drive

Drive's data-access + business logic. Metadata in Postgres (`grown.drive_files`,
`grown.drive_shares`); blobs in rustfs (S3 API).

## Interfaces

- `Repository` — metadata CRUD: CreateFolder, CreateFile, Get, ListChildren, UpdateNameOrParent, Trash, Restore, DeleteForever.
- `Blobs` — blob layer (Task 7): Put, Get, Delete.
- `ACL` — share-token CRUD + permission checks (Task 8).
- `Service` — gRPC `DriveService` (Tasks 9–12).

## Depends on

- `internal/storage` (migrations + pool)
- `github.com/jackc/pgx/v5`
- `github.com/aws/aws-sdk-go-v2`

## Used by

- `internal/server` — registers DriveService on the gateway.
- `cmd/server` — constructs the blob client + repository.
