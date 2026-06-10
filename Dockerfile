# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# grown-workspace — single image: Go backend that also serves the built React
# SPA (--static-dir) on :8080 (HTTP/REST) and :9000 (gRPC). pandoc is included
# for the Docs export endpoint. Migrations are embedded in the binary.
# ---------------------------------------------------------------------------

# ---- 1. Build the React SPA ------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
# Build-time public URLs baked into the SPA. Override per-environment with
# --build-arg. Defaults point at the pick.haus deployment's sibling apps.
ARG VITE_PDF_URL=https://pdf.pick.haus/
ARG VITE_CRM_URL=https://crm.pick.haus/
ARG VITE_GIT_URL=https://code.pick.haus
ARG VITE_ASSEMBLE_URL=https://assemble.pick.haus
ENV VITE_PDF_URL=$VITE_PDF_URL \
    VITE_CRM_URL=$VITE_CRM_URL \
    VITE_GIT_URL=$VITE_GIT_URL \
    VITE_ASSEMBLE_URL=$VITE_ASSEMBLE_URL
COPY web/app/package.json web/app/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY web/app/ ./
RUN npm run build   # -> /web/dist

# ---- 2. Generate protos + build the Go binary ------------------------------
FROM golang:1.25-alpine AS build
RUN apk add --no-cache git
# buf generates the gRPC + grpc-gateway code (gen/ is gitignored) using public
# BSR remote plugins, so the build needs network but no extra local toolchain.
RUN go install github.com/bufbuild/buf/cmd/buf@v1.64.0
WORKDIR /src
# Prime the module cache.
COPY go.mod go.sum ./
RUN go mod download
# Source needed for generation + build. buf.lock pins the googleapis BSR dep
# (google/api/annotations.proto); buf generate fetches it from the lock.
COPY proto/ ./proto/
COPY buf.yaml buf.gen.yaml buf.lock ./
RUN buf dep update && buf generate
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ---- 3. Runtime ------------------------------------------------------------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates pandoc tzdata && adduser -D -u 10001 grown
WORKDIR /app
COPY --from=build /out/server /app/server
COPY --from=web   /web/dist   /app/web/dist
ENV GROWN_STATIC_DIR=/app/web/dist
USER grown
EXPOSE 8080 9000
ENTRYPOINT ["/app/server"]
