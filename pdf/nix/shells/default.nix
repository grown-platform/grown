{
  mkShell,
  writeShellScriptBin,
  treefmt,
  enabledPackages,
  shellHook,
  appNames,
  packageNames,
  playwright-driver,
  # golang
  go,
  gopls,
  gotools,
  golangci-lint,
  sqlc,
  # protobuf
  protobuf,
  protoc-gen-go,
  protoc-gen-go-grpc,
  grpc-gateway,
  # frontend
  nodejs_22,
  typescript,
  # security
  trivy,
  grype,
  cosign,
  syft,
  # dev services
  process-compose,
  air,
  postgresql,
  # secrets
  sops,
  ssh-to-age,
  # github
  gh,
  git-cliff,
  # utils
  jq,
  # yubikey
  yubico-piv-tool,
  opensc,
}:
let
  packagesList = builtins.concatStringsSep "\n" (
    builtins.map (name: "  \\033[33mnix build .#${name}\\033[0m") packageNames
  );

  # Git aliases
  gst = writeShellScriptBin "gst" ''git status "$@"'';
  gp = writeShellScriptBin "gp" ''git push "$@"'';
  gl = writeShellScriptBin "gl" ''git pull "$@"'';
  gd = writeShellScriptBin "gd" ''git diff "$@"'';
  ga = writeShellScriptBin "ga" ''git add "$@"'';
  gc = writeShellScriptBin "gc" ''git commit "$@"'';
  gco = writeShellScriptBin "gco" ''git checkout "$@"'';
  gb = writeShellScriptBin "gb" ''git branch "$@"'';
  glog = writeShellScriptBin "glog" ''git log --oneline --graph "$@"'';

  # Generate protobuf code
  proto-gen = writeShellScriptBin "proto-gen" ''
    set -euo pipefail
    cd "$PDF_ROOT/backend"
    echo "Generating protobuf code..."
    mkdir -p pkg/proto/documents pkg/proto/signing pkg/proto/audit

    # Generate each proto file into its own package directory
    for proto in api/proto/documents.proto api/proto/signing.proto api/proto/audit.proto; do
      name=$(basename "$proto" .proto)
      ${protobuf}/bin/protoc \
        --proto_path=api/proto \
        --go_out=pkg/proto/$name --go_opt=paths=source_relative \
        --go-grpc_out=pkg/proto/$name --go-grpc_opt=paths=source_relative \
        --grpc-gateway_out=pkg/proto/$name --grpc-gateway_opt=paths=source_relative \
        "$proto"
    done
    echo "Done!"
  '';

  # Generate sqlc code
  sqlc-gen = writeShellScriptBin "sqlc-gen" ''
    set -euo pipefail
    cd "$PDF_ROOT/backend"
    echo "Generating sqlc code..."
    ${sqlc}/bin/sqlc generate
    echo "Done!"
  '';

  # Generate all code
  generate = writeShellScriptBin "generate" ''
    set -euo pipefail
    proto-gen
    sqlc-gen
  '';

  # Process compose alias
  pc = writeShellScriptBin "pc" ''
    cd "$PDF_ROOT"
    exec ${process-compose}/bin/process-compose --port 8086 "$@"
  '';

  # Local CI command
  ci = writeShellScriptBin "ci" (builtins.readFile ../../scripts/ci.sh);

  # Local release commands
  release-local = writeShellScriptBin "release-local" (
    builtins.readFile ../../scripts/release-local.sh
  );

  menu = writeShellScriptBin "menu" ''
    echo ""
    echo -e "\033[1;36m  Pdf Development Environment\033[0m"
    echo ""
    echo -e "\033[1mNix packages:\033[0m"
    echo ""
    echo -e "${packagesList}"
    echo ""
    echo -e "\033[1mCode Generation:\033[0m"
    echo ""
    echo -e "  \033[33mgenerate\033[0m          Generate all code (proto + sqlc)"
    echo -e "  \033[33mproto-gen\033[0m         Generate protobuf code"
    echo -e "  \033[33msqlc-gen\033[0m          Generate sqlc code"
    echo ""
    echo -e "\033[1mDev commands:\033[0m"
    echo ""
    echo -e "  \033[33mpc up\033[0m             Start all services with process-compose"
    echo -e "  \033[33mmenu\033[0m              Show this menu"
    echo ""
    echo -e "\033[1mLocal CI & Release:\033[0m"
    echo ""
    echo -e "  \033[33mci\033[0m                Run full local CI (lint, test, build)"
    echo -e "  \033[33mci --stage <stage>\033[0m  Run specific stage (sast, test, build, container)"
    echo -e "  \033[33mrelease-local build\033[0m  Build container locally"
    echo -e "  \033[33mrelease-local dev\033[0m    Build and push with timestamp+commit tag"
    echo ""
  '';
in
mkShell {
  shellHook = ''
    ${shellHook}
    export PDF_ROOT="$(pwd)"
    menu
  '';
  env = {
    PLAYWRIGHT_BROWSERS_PATH = playwright-driver.browsers;
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
    PC_PORT_NUM = "8086";
    PKCS11_MODULE_PATH = "${yubico-piv-tool}/lib/libykcs11.so";
  };
  buildInputs = [
    treefmt
    enabledPackages
    menu
    # code generation
    generate
    proto-gen
    sqlc-gen
    # git aliases
    gst
    gp
    gl
    gd
    ga
    gc
    gco
    gb
    glog
    # golang
    go
    gopls
    gotools
    golangci-lint
    sqlc
    postgresql
    # protobuf
    protobuf
    protoc-gen-go
    protoc-gen-go-grpc
    grpc-gateway
    # frontend
    nodejs_22
    typescript
    # security
    trivy
    grype
    cosign
    syft
    # dev services
    process-compose
    pc
    air
    # secrets
    sops
    ssh-to-age
    # github
    gh
    git-cliff
    # utils
    jq
    # yubikey
    yubico-piv-tool
    opensc
    # local ci and release
    ci
    release-local
  ];
}
