/** Brand is the per-deploy theming surface. Each field is a CSS-ready value. */
export interface Brand {
  productName: string;
  tagline: string;
  primaryColor: string;
  surfaceColor: string;
  onSurfaceColor: string;
  // Optional logo SVG markup. If absent, the productName initial is shown.
  logoSVG?: string;
  supportURL: string;
}

// The default workspace mark: a forest-green rounded square with a white
// "sprout" (fits grown-workspace). Self-contained SVG so it needs no asset.
export const workspaceLogoSVG = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" role="img" aria-label="Workspace">
  <rect width="40" height="40" rx="10" fill="#3F704D"/>
  <path d="M20 31 V19" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M20.5 21 C20.5 14.5 25.5 11.5 31 11.5 C31 18 26 21 20.5 21 Z" fill="#FFFFFF"/>
  <path d="M19.5 24.5 C19.5 19.5 15 17 9.5 17 C9.5 22.5 14 25 19.5 25 Z" fill="#FFFFFF" fill-opacity="0.82"/>
</svg>`;

export const defaultBrand: Brand = {
  productName: "Grown",
  tagline: "Self-hosted, multi-org workspace platform",
  primaryColor: "#3F704D", // muted forest green — distinct from Google's blue
  surfaceColor: "#FAFAF7", // warm white
  onSurfaceColor: "#1B2620", // dark green-black
  logoSVG: workspaceLogoSVG,
  supportURL: "https://code.pick.haus/grown/grown",
};
