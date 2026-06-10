{
  description = "Pdf - Document Signing Platform";

  inputs = {
    nixpkgs.url = "nixpkgs/nixos-unstable";
    nix2container.url = "github:nlewo/nix2container";
    treefmt-nix.url = "github:numtide/treefmt-nix";
    pre-commit-hooks = {
      url = "github:cachix/pre-commit-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      nix2container,
      treefmt-nix,
      pre-commit-hooks,
    }:
    let
      lib = import ./nix/lib.nix { inherit self nixpkgs; };
      inherit (lib)
        version
        forAllSystems
        maintainers
        license
        ;

      treefmtEval = forAllSystems (
        { pkgs, ... }:
        treefmt-nix.lib.evalModule pkgs {
          projectRootFile = "flake.nix";
          programs.nixfmt.enable = true;
          programs.gofmt.enable = true;
          programs.prettier.enable = true;
        }
      );

      preCommitEval = forAllSystems (
        { system, pkgs }:
        pkgs.callPackage ./nix/pre-commit.nix {
          inherit system pre-commit-hooks treefmtEval;
        }
      );
    in
    {
      formatter = forAllSystems ({ system, ... }: treefmtEval.${system}.config.build.wrapper);

      packages = forAllSystems (
        { system, pkgs }:
        let
          backend = pkgs.callPackage ./nix/pkgs/backend.nix { inherit version maintainers license; };
          frontend = pkgs.callPackage ./nix/pkgs/frontend.nix { inherit version maintainers license; };
        in
        {
          inherit backend frontend;
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          container = pkgs.callPackage ./nix/pkgs/container.nix {
            inherit
              nix2container
              system
              version
              maintainers
              license
              backend
              frontend
              ;
          };
        }
      );

      devShells = forAllSystems (
        { system, pkgs }:
        let
          inherit (preCommitEval.${system}) shellHook enabledPackages;
        in
        {
          default = pkgs.callPackage ./nix/shells/default.nix {
            inherit shellHook enabledPackages;
            treefmt = treefmtEval.${system}.config.build.wrapper;
            appNames = [ ];
            packageNames = builtins.attrNames self.packages.${system};
          };
        }
      );
    };
}
