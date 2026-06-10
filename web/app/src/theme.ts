import { extendTheme } from "@mui/joy/styles";
import { defaultBrand } from "./brand/defaultBrand";

/**
 * MUI Joy theme seeded from the default brand tokens.
 *
 * MUI Joy derives colour shades at build time so the palette must contain
 * real colour values, not CSS custom property references.  The BrandProvider
 * still emits the CSS vars for components that use sx/style props directly.
 */
export const grownTheme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
        primary: {
          500: defaultBrand.primaryColor,
          solidBg: defaultBrand.primaryColor,
        },
        background: {
          body: defaultBrand.surfaceColor,
          surface: defaultBrand.surfaceColor,
        },
        text: {
          primary: defaultBrand.onSurfaceColor,
        },
      },
    },
    // Dark mode keeps the brand accent; backgrounds use Joy's dark defaults.
    dark: {
      palette: {
        primary: {
          500: defaultBrand.primaryColor,
          solidBg: defaultBrand.primaryColor,
        },
      },
    },
  },
  fontFamily: {
    body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    display: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
});
