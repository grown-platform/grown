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
    };
}
