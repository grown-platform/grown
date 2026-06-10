{
  lib,
  buildNpmPackage,
  nodejs_22,
  maintainers,
  license,
  version,
}:
buildNpmPackage {
  pname = "pdf-frontend";
  inherit version;
  src = ../../frontend;
  # To get the correct hash, run: nix build .#frontend 2>&1 | grep "got:"
  # Then update this value with the hash from the error message
  npmDepsHash = "sha256-o1XrxL3dQ+Rem3EIeH70WTM4AKHvzdkqF07r8Th09xY=";
  makeCacheWritable = true;
  npmDepsFetcherVersion = 2;
  buildInputs = [ nodejs_22 ];
  env.VITE_APP_VERSION = version;
  installPhase = ''
    npm run build -- --outDir $out/usr/share/html
  '';

  meta = {
    description = "Pdf document signing frontend web application";
    homepage = "https://code.pick.haus/grown/pdf";
    inherit license;
    maintainers = with maintainers; [
      lucas
    ];
    platforms = lib.platforms.all;
  };
}
