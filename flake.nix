{
  description = "grown-workspace: self-hosted multi-org workspace platform";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forAll = nixpkgs.lib.genAttrs systems;

      # nixpkgs instance used for the dockerTools image builds. The pinned
      # nixpkgs-unstable `minio` currently carries known CVEs and is marked
      # insecure; the chart already runs an upstream minio so this is no
      # regression — permit it explicitly so the image still builds.
      imagesPkgs =
        system:
        import nixpkgs {
          inherit system;
          config.permittedInsecurePackages = [
            "minio-2025-10-15T17-29-55Z"
          ];
        };
    in
    {
      devShells = forAll (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.go_1_25
              pkgs.gopls
              pkgs.golangci-lint
              pkgs.gofumpt
              pkgs.buf
              pkgs.protoc-gen-go
              pkgs.protoc-gen-go-grpc
              pkgs.grpc-gateway
              pkgs.postgresql_16
              pkgs.process-compose
              pkgs.zitadel
              pkgs.curl
              pkgs.jq
              pkgs.pandoc
              pkgs.tectonic
              pkgs.nodejs_22
              pkgs.playwright-driver
              pkgs.playwright-driver.browsers
              pkgs.awscli2
            ];

            shellHook = ''
              export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
              export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
              export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1
              export PROJECT_ROOT="$PWD"
              export PGDATA="$PROJECT_ROOT/deploy/process-compose/data/postgres"
              export PGHOST="$PROJECT_ROOT/deploy/process-compose/data"
              export PGPORT=5533
              export PGUSER=grown
              export PGDATABASE=grown
              echo "grown-workspace devshell ready."
              echo "  go:              $(go version 2>/dev/null | head -1)"
              echo "  buf:             $(buf --version 2>/dev/null)"
              echo "  process-compose: $(process-compose version 2>&1 | head -1)"
              echo
              echo "Run:  nix run .#dev    # bring up the full local stack"
            '';
          };
        }
      );

      apps = forAll (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          dev = pkgs.writeShellApplication {
            name = "grown-dev";
            runtimeInputs = [
              pkgs.process-compose
              pkgs.postgresql_16
              pkgs.zitadel
              pkgs.go_1_25
              pkgs.coreutils
              pkgs.awscli2
              pkgs.pandoc
              pkgs.tectonic
            ];
            text = ''
              cd "''${PROJECT_ROOT:-$PWD}"
              # --use-uds: process-compose's mgmt API defaults to :8080, colliding with
              #            our backend; Unix domain socket avoids the port conflict.
              # --tui=false: stable output in non-TTY contexts (CI, log capture).
              exec process-compose up --use-uds --tui=false -f deploy/process-compose/process-compose.yaml
            '';
          };
        in
        {
          dev = {
            type = "app";
            program = "${dev}/bin/grown-dev";
          };
        }
      );

      formatter = forAll (system: (import nixpkgs { inherit system; }).nixfmt-rfc-style);

      # -----------------------------------------------------------------------
      # OCI container images (Nix dockerTools) for grown + its runtime deps, so
      # the platform can migrate off the upstream Docker images one-by-one.
      # See nix/images.nix and docs/roadmap/2026-06-13-nix-images-migration.md.
      #
      # dockerTools images are LINUX images. We therefore build them against a
      # linux nixpkgs regardless of the host: the homelab cluster is amd64
      # (x86_64-linux) and the Pi cluster is arm64 (aarch64-linux). The default
      # `images` attrset targets x86_64-linux (homelab); `images-aarch64-linux`
      # targets the Pi cluster. Building on an aarch64-darwin host requires a
      # linux builder (a remote x86_64-linux builder is configured) and/or
      # substitution from the binary cache.
      #
      #   nix build .#images.grown      # grown app (Go + Vite SPA + pandoc)
      #   nix build .#images.postgres   # Postgres 17
      #   nix build .#images.minio      # MinIO
      #   nix build .#images.zitadel    # Zitadel (OIDC)
      #   nix build .#images.all        # all four tarballs in one dir
      #
      # Pi cluster (arm64):
      #   nix build .#images-aarch64-linux.grown   (etc.)
      # -----------------------------------------------------------------------
      images = import ./nix/images.nix {
        pkgs = imagesPkgs "x86_64-linux";
      };

      images-x86_64-linux = self.images;

      images-aarch64-linux = import ./nix/images.nix {
        pkgs = imagesPkgs "aarch64-linux";
      };
    };
}
