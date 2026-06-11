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

# ---- 1b. Build the PDF signing SPA (served in-process under /pdf) ----------
# The PDF frontend (React 19 + Vite) is bundled and served by grown itself when
# GROWN_PDF_BUILTIN=true and GROWN_PDF_STATIC_DIR points at its dist (see runtime
# stage), so no separate pdf-frontend container is needed. Build env wires it to
# grown's session: it talks to the in-process backend at /pdf-api/api with cookie
# auth and redirects 401s to grown's login. Vite base "/pdf/" makes asset URLs
# resolve under grown's /pdf mount (vite.config.ts reads GROWN_PDF_BASE).
FROM node:22-alpine AS pdfweb
WORKDIR /pdf
ENV GROWN_PDF_BASE=/pdf/ \
    VITE_GROWN_INTEGRATED=true \
    VITE_API_BASE=/pdf-api/api \
    VITE_GROWN_LOGIN_URL=/api/v1/auth/login
# tibui is fetched from the public code.pick.haus registry per the lockfile.
COPY pdf/frontend/package.json pdf/frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY pdf/frontend/ ./
RUN npm run build   # -> /pdf/dist

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
# Stamp the build so GET /healthz reports the real version/commit instead of the
# "0.0.0-dev"/"unknown" defaults. CI passes these via --build-arg; harmless if unset.
ARG VERSION=0.0.0-dev
ARG COMMIT=unknown
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath \
      -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
      -o /out/server ./cmd/server

# ---- 3. Runtime ------------------------------------------------------------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates pandoc tzdata && adduser -D -u 10001 grown
WORKDIR /app
COPY --from=build  /out/server /app/server
COPY --from=web    /web/dist   /app/web/dist
COPY --from=pdfweb /pdf/dist   /app/pdf-web
ENV GROWN_STATIC_DIR=/app/web/dist \
    GROWN_PDF_STATIC_DIR=/app/pdf-web
USER grown
EXPOSE 8080 9000
ENTRYPOINT ["/app/server"]
