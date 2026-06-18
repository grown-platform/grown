# nix/images.nix — Nix (dockerTools) OCI image builds for grown + its runtime
# dependencies (Postgres, MinIO, Zitadel), so the platform can migrate off the
# upstream Docker images one-by-one (see docs/roadmap/2026-06-13-nix-images-migration.md).
#
# IMPORTANT — architecture: dockerTools images are Linux images. They are built
# for `pkgs.system`. On this repo we build LINUX images by importing nixpkgs
# with a linux system (x86_64-linux for the homelab amd64 cluster, aarch64-linux
# for the Pi cluster) — see flake.nix which wires `imagesFor <linuxSystem>`.
# Building on an aarch64-darwin host therefore requires a linux builder (a remote
# x86_64-linux builder is configured) or substitution from the binary cache.
#
# Usage (from flake.nix outputs):
#   nix build .#images.grown      # grown app (Go backend + Vite SPA + pandoc)
#   nix build .#images.postgres   # Postgres 17
#   nix build .#images.minio      # MinIO
#   nix build .#images.zitadel    # Zitadel (OIDC)
#   nix build .#images.all        # all of the above (a dir of the tarballs)
{
  pkgs,
  lib ? pkgs.lib,
  # Image tag. The grown chart resolves the tag at deploy time; "nix" marks
  # these as the Nix-built variants.
  tag ? "nix",
  # VITE_* build args forwarded to the SPA build.
  vitePdfUrl ? "/pdf/",
  # CRM host is deployment-specific; inject per-environment (not baked here).
  viteCrmUrl ? "",
  viteGitUrl ? "https://code.pick.haus",
  viteAssembleUrl ? "",
}:
let
  inherit (pkgs) dockerTools;

  # ---------------------------------------------------------------------------
  # grown Go backend. Mirrors the Dockerfile "build" stage: CGO disabled, the
  # version/commit ldflags, migrations embedded (go:embed in the module). The
  # generated gRPC/gateway code under gen/ is committed in the working tree
  # (gitignored but present), so we build from the repo source directly rather
  # than re-running `buf generate` (which needs network/BSR remote plugins).
  # ---------------------------------------------------------------------------
  grownBackend = pkgs.buildGoModule {
    pname = "grown";
    version = "0.0.0-dev";

    # Whole repo (gen/ included). cleanSource drops .git and editor cruft.
    src = lib.cleanSource ../.;

    # Resolved from go.mod/go.sum via the first build's hash mismatch error.
    vendorHash = "sha256-DD1IQwbNBgrhSMJ/wM3De5tIuv+PWjZdl4LBXhhBYpM=";

    subPackages = [ "cmd/server" ];

    env.CGO_ENABLED = 0;

    ldflags = [
      "-s"
      "-w"
      "-X main.version=0.0.0-dev"
      "-X main.commit=nix"
    ];

    # gen/ proto output is committed; no codegen needed at build time.
    # Tests need a database / network — skip in the image build.
    doCheck = false;

    meta.mainProgram = "server";
  };

  # SPA dist directory (Vite build output).
  grownSpa = pkgs.callPackage ./spa.nix {
    inherit vitePdfUrl viteCrmUrl viteGitUrl viteAssembleUrl;
  };

  # ---------------------------------------------------------------------------
  # grown application image. Replicates the Dockerfile runtime stage:
  #   - the Go binary at /app/server (ENTRYPOINT)
  #   - the SPA dist at /app/web/dist  (GROWN_STATIC_DIR)
  #   - pandoc on PATH (Docs export endpoint)
  #   - ca-certificates + tzdata
  #   - ports 8080 (HTTP/REST) + 9000 (gRPC)
  # NB: the PDF SPA (/app/pdf-web, GROWN_PDF_STATIC_DIR) from the Dockerfile's
  # pdfweb stage is NOT bundled here yet — it pulls a non-registry `tibui`
  # tarball that complicates a hermetic npm build; GROWN_PDF_BUILTIN is off by
  # default so the image is functional without it. See the roadmap doc.
  # ---------------------------------------------------------------------------
  grownImage = dockerTools.buildLayeredImage {
    name = "grown";
    inherit tag;

    contents = [
      grownBackend
      pkgs.pandoc
      pkgs.cacert
      pkgs.tzdata
      # Minimal shell/coreutils for debugging + any /bin/sh assumptions.
      pkgs.busybox
    ];

    # Place the SPA where GROWN_STATIC_DIR expects it.
    extraCommands = ''
      mkdir -p app/web
      cp -r ${grownSpa} app/web/dist
    '';

    config = {
      Entrypoint = [ "${grownBackend}/bin/server" ];
      WorkingDir = "/app";
      ExposedPorts = {
        "8080/tcp" = { };
        "9000/tcp" = { };
      };
      Env = [
        "GROWN_STATIC_DIR=/app/web/dist"
        "GROWN_PDF_STATIC_DIR=/app/pdf-web"
        "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
        "PATH=/bin"
      ];
      User = "10001";
    };
  };

  # ---------------------------------------------------------------------------
  # Postgres image. The grown chart's StatefulSet runs the stock
  # docker-library/postgres entrypoint: it reads POSTGRES_USER/PASSWORD/DB +
  # PGDATA, runs initdb on first boot, sources /docker-entrypoint-initdb.d/*.sh,
  # then execs `postgres`. We reproduce that contract with a small entrypoint so
  # this image is drop-in for the chart's postgres.image.
  # ---------------------------------------------------------------------------
  pgEntrypoint = pkgs.writeShellApplication {
    name = "docker-entrypoint.sh";
    runtimeInputs = [
      pkgs.postgresql_17
      pkgs.coreutils
      pkgs.gnugrep
      pkgs.gnused
      pkgs.bash
    ];
    text = ''
      set -euo pipefail

      : "''${POSTGRES_USER:=postgres}"
      : "''${POSTGRES_DB:=$POSTGRES_USER}"
      : "''${PGDATA:=/var/lib/postgresql/data/pgdata}"

      export PGDATA

      # First boot: initialise the cluster + create the role/db, then run any
      # /docker-entrypoint-initdb.d/*.sh against it (the chart mounts an
      # init-extra-dbs.sh there to create the zitadel/pdf databases).
      if [ ! -s "$PGDATA/PG_VERSION" ]; then
        mkdir -p "$PGDATA"
        # initdb won't run as root; the chart runs us as a normal uid.
        echo "''${POSTGRES_PASSWORD:-}" > /tmp/pwfile
        initdb -U "$POSTGRES_USER" --pwfile=/tmp/pwfile -D "$PGDATA"
        rm -f /tmp/pwfile

        # Allow network connections (the chart connects over the pod network).
        echo "host all all all scram-sha-256" >> "$PGDATA/pg_hba.conf"
        echo "listen_addresses = '*'" >> "$PGDATA/postgresql.conf"

        # Bring the server up locally (no TCP) to run bootstrap SQL.
        PGUSER="$POSTGRES_USER" pg_ctl -D "$PGDATA" \
          -o "-p 5432" -w start

        if [ "$POSTGRES_DB" != "$POSTGRES_USER" ] && [ "$POSTGRES_DB" != "postgres" ]; then
          psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
            -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";" || true
        fi

        if [ -d /docker-entrypoint-initdb.d ]; then
          for f in /docker-entrypoint-initdb.d/*.sh; do
            [ -e "$f" ] || continue
            echo "running init script $f"
            POSTGRES_USER="$POSTGRES_USER" POSTGRES_DB="$POSTGRES_DB" sh "$f"
          done
        fi

        PGUSER="$POSTGRES_USER" pg_ctl -D "$PGDATA" -m fast -w stop
      fi

      exec postgres -D "$PGDATA"
    '';
  };

  postgresImage = dockerTools.buildLayeredImage {
    name = "postgres";
    inherit tag;
    contents = [
      pkgs.postgresql_17
      pkgs.coreutils
      pkgs.bash
      pkgs.busybox
      pgEntrypoint
    ];
    extraCommands = ''
      mkdir -p var/lib/postgresql/data docker-entrypoint-initdb.d tmp
      chmod 1777 tmp
    '';
    config = {
      Entrypoint = [ "${pgEntrypoint}/bin/docker-entrypoint.sh" ];
      ExposedPorts."5432/tcp" = { };
      Env = [
        "PGDATA=/var/lib/postgresql/data/pgdata"
        "PATH=/bin"
      ];
      Cmd = [ ];
    };
  };

  # ---------------------------------------------------------------------------
  # MinIO image. The chart runs `["server", "/data", "--console-address", ":9001"]`
  # against the minio binary, reading MINIO_ROOT_USER/PASSWORD, exposing 9000
  # (S3) + 9001 (console). Entrypoint = the minio binary, so the chart's args
  # pass straight through.
  # ---------------------------------------------------------------------------
  minioImage = dockerTools.buildLayeredImage {
    name = "minio";
    inherit tag;
    contents = [
      pkgs.minio
      pkgs.busybox
      pkgs.cacert
    ];
    extraCommands = ''
      mkdir -p data
    '';
    config = {
      Entrypoint = [ "${pkgs.minio}/bin/minio" ];
      # Default to the chart's invocation; the chart overrides args anyway.
      Cmd = [ "server" "/data" "--console-address" ":9001" ];
      ExposedPorts = {
        "9000/tcp" = { };
        "9001/tcp" = { };
      };
      Env = [
        "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
        "PATH=/bin"
      ];
    };
  };

  # ---------------------------------------------------------------------------
  # Zitadel image. zitadel IS in nixpkgs. The chart runs:
  #   args: [start-from-init, --masterkeyFromEnv, --tlsMode, disabled]
  # with ZITADEL_* env (incl. ZITADEL_MASTERKEY) from a secret, exposing 8080.
  # Entrypoint = the zitadel binary so those args pass straight through.
  # ---------------------------------------------------------------------------
  zitadelImage = dockerTools.buildLayeredImage {
    name = "zitadel";
    inherit tag;
    contents = [
      pkgs.zitadel
      pkgs.busybox
      pkgs.cacert
    ];
    config = {
      Entrypoint = [ "${pkgs.zitadel}/bin/zitadel" ];
      ExposedPorts."8080/tcp" = { };
      Env = [
        "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
        "PATH=/bin"
      ];
    };
  };

  all = pkgs.linkFarm "grown-images-all" [
    { name = "grown.tar.gz"; path = grownImage; }
    { name = "postgres.tar.gz"; path = postgresImage; }
    { name = "minio.tar.gz"; path = minioImage; }
    { name = "zitadel.tar.gz"; path = zitadelImage; }
  ];
in
{
  grown = grownImage;
  postgres = postgresImage;
  minio = minioImage;
  zitadel = zitadelImage;
  inherit all;

  # Expose the intermediate derivations too (useful for debugging / reuse).
  grown-backend = grownBackend;
  grown-spa = grownSpa;
}
