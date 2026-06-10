# Shared helpers for the flake
{ self, nixpkgs }:
let
  # to work with older version of flakes
  lastModifiedDate = self.lastModifiedDate or self.lastModified or "19700101";

  # Generate a git-based version number for dev builds
  gitVersion =
    builtins.substring 0 8 lastModifiedDate
    + "-"
    + builtins.substring 8 8 lastModifiedDate
    + "-"
    + (self.shortRev or self.dirtyShortRev or "unknown");

  # Read semantic version from version.txt if it exists, otherwise use git-based version
  versionFile = self + "/version.txt";
  version =
    if builtins.pathExists versionFile then
      nixpkgs.lib.strings.trim (builtins.readFile versionFile)
    else
      gitVersion;

  # System types to support.
  supportedSystems = [
    "x86_64-linux"
    "aarch64-darwin"
  ];

  # Helper function to generate an attrset '{ x86_64-linux = f "x86_64-linux"; ... }'.
  forAllSystems =
    f:
    nixpkgs.lib.genAttrs supportedSystems (
      system:
      f {
        inherit system;
        pkgs = import nixpkgs { inherit system; };
      }
    );

  # Maintainers list (follows nixpkgs conventions)
  maintainers = import ./maintainers.nix;

  # Project license (MIT assigned to Grown)
  license = {
    spdxId = "MIT";
    fullName = "MIT License";
    url = "https://opensource.org/licenses/MIT";
    free = true;
    redistributable = true;
    deprecated = false;
    shortName = "mit";
    copyrightHolder = "Grown";
  };
in
{
  inherit
    version
    supportedSystems
    forAllSystems
    maintainers
    license
    ;
}
