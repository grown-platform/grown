import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { defaultBrand, type Brand } from "./defaultBrand";

const BrandContext = createContext<Brand>(defaultBrand);

/** useBrand returns the active Brand. Falls back to defaultBrand if no provider is mounted. */
export function useBrand(): Brand {
  return useContext(BrandContext);
}

interface BrandProviderProps {
  /** Optional partial override merged onto defaultBrand. */
  brand?: Partial<Brand>;
  /** When true (default), BrandProvider fetches the active org's branding
   *  (accent color + logo) at mount and applies it over the defaults. Set false
   *  to render with the static defaults only (e.g. public/signed-out routes). */
  loadOrgBranding?: boolean;
  children: ReactNode;
}

// Shape of GET /api/v1/org/branding (kept local so the brand module has no
// dependency on the admin page bundle).
interface OrgBranding {
  accent_color: string;
  has_logo: boolean;
  product_name: string;
}

// fetchOrgBranding loads the active org's branding. Returns null on any failure
// (signed-out, network, server error) so the provider silently keeps defaults.
async function fetchOrgBranding(): Promise<OrgBranding | null> {
  try {
    const resp = await fetch("/api/v1/org/branding", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as OrgBranding;
  } catch {
    return null;
  }
}

/** BrandProvider exposes the active brand to descendants and emits CSS
 *  custom properties on its wrapper element so non-React styles can read the
 *  same tokens. When loadOrgBranding is set, it also fetches the active org's
 *  branding (accent color → primary; logo → Header brand) once at mount and
 *  applies it over the deploy defaults — falling back to defaults when unset. */
export function BrandProvider({
  brand,
  loadOrgBranding = true,
  children,
}: BrandProviderProps) {
  // orgOverride holds the per-org branding once fetched. Starts null so the very
  // first paint uses defaults (no flash of a wrong accent before load).
  const [orgOverride, setOrgOverride] = useState<Partial<Brand> | null>(null);

  useEffect(() => {
    if (!loadOrgBranding) return;
    let cancelled = false;
    void fetchOrgBranding().then((b) => {
      if (cancelled || !b) return;
      const next: Partial<Brand> = {};
      if (b.accent_color) next.primaryColor = b.accent_color;
      if (b.product_name) next.productName = b.product_name;
      if (b.has_logo) {
        // The logo is an authed same-origin blob; cache-bust on each load so a
        // re-upload is reflected. <img> works for raster + SVG alike.
        next.logoSVG =
          `<img src="/api/v1/org/branding/logo?t=${Date.now()}" alt="Logo" ` +
          `width="100%" height="100%" style="object-fit:contain" />`;
      }
      if (Object.keys(next).length > 0) setOrgOverride(next);
    });
    return () => {
      cancelled = true;
    };
  }, [loadOrgBranding]);

  const merged: Brand = {
    ...defaultBrand,
    ...(brand ?? {}),
    ...(orgOverride ?? {}),
  };
  const cssVars: Record<string, string> = {
    "--grown-primary": merged.primaryColor,
    "--grown-surface": merged.surfaceColor,
    "--grown-on-surface": merged.onSurfaceColor,
  };
  // When the org overrides the accent color, also drive MUI Joy's primary
  // palette via its CSS custom properties so themed components (buttons,
  // switches, links) pick it up at runtime. The static theme (theme.ts) seeds
  // the same slots from the deploy default; this overrides them per-org.
  if (orgOverride?.primaryColor) {
    cssVars["--joy-palette-primary-500"] = orgOverride.primaryColor;
    cssVars["--joy-palette-primary-solidBg"] = orgOverride.primaryColor;
    cssVars["--joy-palette-primary-solidHoverBg"] = orgOverride.primaryColor;
    cssVars["--joy-palette-primary-plainColor"] = orgOverride.primaryColor;
    cssVars["--joy-palette-primary-outlinedColor"] = orgOverride.primaryColor;
  }
  return (
    <BrandContext.Provider value={merged}>
      <div style={cssVars as React.CSSProperties}>{children}</div>
    </BrandContext.Provider>
  );
}
