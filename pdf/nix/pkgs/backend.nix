{
  lib,
  buildGoModule,
  version,
  maintainers,
  license,
}:
buildGoModule {
  pname = "pdf";
  inherit version;
  src = ../../backend;
  # To get the correct hash, run: nix build .#backend 2>&1 | grep "got:"
  # Then update this value with the hash from the error message
  vendorHash = "sha256-uIGBF0J5PQjYmYdIya2yANbYJYqykbXj3wKCDyrrIfE=";
  doCheck = false;
  ldflags = [
    "-X"
    "main.Version=${version}"
  ];
  postInstall = ''
    mkdir -p $out/usr/bin
    cp $out/bin/server $out/usr/bin/pdf
  '';

  meta = {
    description = "Pdf document signing backend API server";
    homepage = "https://code.pick.haus/grown/pdf";
    inherit license;
    maintainers = with maintainers; [
      lucas
    ];
    mainProgram = "pdf";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
