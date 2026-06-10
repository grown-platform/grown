{
  pkgs,
  system,
  pre-commit-hooks,
  treefmtEval,
}:
let
  go-lint-backend = pkgs.writeShellApplication {
    name = "go-lint";
    runtimeInputs = [ pkgs.golangci-lint ];
    text = ''
      cd backend
      golangci-lint run ./...
      cd ..
    '';
  };
  go-test-backend = pkgs.writeShellApplication {
    name = "go-test";
    runtimeInputs = [ pkgs.go ];
    text = ''
      cd backend
      go test ./... -v
      cd ..
    '';
  };
  flake-check = pkgs.writeShellApplication {
    name = "flake-check";
    runtimeInputs = [ pkgs.nix ];
    text = ''
      nix flake check
    '';
  };
  container-build = pkgs.writeShellApplication {
    name = "container-build";
    runtimeInputs = [ pkgs.nix ];
    text = ''
      nix build .#container --no-link
    '';
  };
  frontend-lint = pkgs.writeShellApplication {
    name = "frontend-lint";
    runtimeInputs = [ pkgs.nodejs_22 ];
    text = ''
      cd frontend
      npm run lint
      cd ..
    '';
  };
in
pre-commit-hooks.lib.${system}.run {
  src = ../.;
  hooks = {
    gotest = {
      enable = true;
      entry = "${go-test-backend}/bin/go-test";
    };
    golangci-lint = {
      enable = true;
      package = pkgs.golangci-lint;
      entry = "${go-lint-backend}/bin/go-lint";
      extraPackages = [ pkgs.go ];
    };
    flake-checker.enable = true;
    treefmt-nix = {
      enable = true;
      entry = "${treefmtEval.${system}.config.build.wrapper}/bin/treefmt --ci";
      pass_filenames = false;
    };
    convco.enable = true;
    flake-check = {
      enable = true;
      entry = "${flake-check}/bin/flake-check";
      pass_filenames = false;
      stages = [ "pre-push" ];
    };
    frontend-lint = {
      enable = true;
      entry = "${frontend-lint}/bin/frontend-lint";
      pass_filenames = false;
    };
  }
  // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
    container-build = {
      enable = true;
      entry = "${container-build}/bin/container-build";
      pass_filenames = false;
      stages = [ "pre-push" ];
    };
  };
}
