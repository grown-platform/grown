# nix/spa.nix — build the grown React SPA (web/app) the same way the Dockerfile
# "web" stage does: `npm ci && npm run build` with the VITE_* build args baked
# in, producing the Vite `dist/` directory that the Go binary serves via
# --static-dir / GROWN_STATIC_DIR.
#
# Output: a derivation whose $out IS the dist directory (so it can be copied
# straight into the image at GROWN_STATIC_DIR).
{
  lib,
  buildNpmPackage,
  # VITE_* build args — defaults mirror the Dockerfile. Override per-environment.
  vitePdfUrl ? "/pdf/",
  # CRM host is deployment-specific; inject per-environment (not baked here).
  viteCrmUrl ? "",
  viteGitUrl ? "https://code.pick.haus",
  viteAssembleUrl ? "https://assemble.pick.haus",
}:
buildNpmPackage {
  pname = "grown-spa";
  version = "0.0.1";

  # Only the SPA sources; filter to web/app so changes elsewhere don't rebuild.
  src = lib.cleanSourceWith {
    src = ../web/app;
    filter =
      path: type:
      let
        base = baseNameOf path;
      in
      # Keep everything except node_modules / prior dist / test caches.
      !(builtins.elem base [
        "node_modules"
        "dist"
      ]);
  };

  # Populated from the package-lock.json by `prefetch-npm-deps` / build error.
  # Replace `lib.fakeHash` output reported by the first build.
  npmDepsHash = "sha256-bBVBjGHFkk+H/9SyJMc6d5wjIDeyEnCqjtUAV758a7g=";

  # The SPA is a pure static bundle — no native addons, no install scripts needed.
  npmFlags = [ "--no-fund" "--no-audit" ];

  # `npm run build` => `tsc -b && vite build` => web/app/dist.
  # buildNpmPackage runs `npm run build` by default (npmBuildScript = "build").

  VITE_PDF_URL = vitePdfUrl;
  VITE_CRM_URL = viteCrmUrl;
  VITE_GIT_URL = viteGitUrl;
  VITE_ASSEMBLE_URL = viteAssembleUrl;

  # The default installPhase expects a package to install; ours just emits the
  # built static site, so install dist/ as the whole output.
  installPhase = ''
    runHook preInstall
    cp -r dist "$out"
    runHook postInstall
  '';

  # No npm-published artifact / bin to produce.
  dontNpmInstall = true;
}
