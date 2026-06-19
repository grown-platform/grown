# ls-sandbox — the Phase 1 Guacamole connection target.
#
# Final stage is `scratch`: no shell, no coreutils, no package manager — there is
# literally nothing for a session to escape *to*. The binary itself only ever
# runs `ls` against a fake in-memory tree (see eval.go).
#
# Build context is the repo root:
#   docker build -f cmd/ls-sandbox/Dockerfile -t code.pick.haus/grown/ls-sandbox:latest .
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/ls-sandbox ./cmd/ls-sandbox

FROM scratch
COPY --from=build /out/ls-sandbox /ls-sandbox
USER 65534:65534
EXPOSE 2222
ENTRYPOINT ["/ls-sandbox"]
