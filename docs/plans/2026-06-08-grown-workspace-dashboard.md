# grown-workspace Dashboard + Brand + Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Material 3-sibling dashboard at `http://workspace.localtest.me:8080/` — a React SPA that authenticates against our existing Plan 2 backend, displays a grid of all planned-app tiles (the catalog), and routes each tile click to a branded "coming soon" page. After signing in, the user lands on real UI instead of the current 404.

**Architecture:** React + TypeScript + Vite SPA built into `web/app/dist/`. The Go backend serves these static assets at `/` (with SPA fallback to `index.html`) while `/api/v1/*` continues to be served by grpc-gateway. The dashboard fetches `/api/v1/whoami` on mount: 401 → SignIn screen with a "Log in" button that points at `/api/v1/auth/login`; 200 → Dashboard with the catalog grid. A `BrandContext` exposes per-deploy theming via CSS custom properties so future white-labels are a config push.

**Tech Stack:** React 18, TypeScript 5, Vite 5, MUI Joy UI (Material 3-sibling), React Router 6, Playwright (e2e). No protobuf-to-TS generation for V1 — hand-written interfaces for the small auth surface.

**Spec:** `docs/superpowers/specs/2026-06-08-grown-workspace-v1-design.md`
**Builds on:** Plan 1 (v0.0.1) + Plan 2 (v0.0.2) at `/home/lucas/workspace/grown/grown-workspace/`.

**Working directory:** `/home/lucas/workspace/grown/grown-workspace/`

---

## File structure

### Frontend (new)

| Path                                  | Purpose                                            |
| ------------------------------------- | -------------------------------------------------- |
| `web/app/package.json`                | Dependencies + scripts                             |
| `web/app/tsconfig.json`               | Strict TS config                                   |
| `web/app/tsconfig.node.json`          | Vite's node-side TS config                         |
| `web/app/vite.config.ts`              | Vite config + `/api` dev proxy                     |
| `web/app/index.html`                  | SPA shell                                          |
| `web/app/src/main.tsx`                | React entry point                                  |
| `web/app/src/App.tsx`                 | Top-level providers + routes                       |
| `web/app/src/theme.ts`                | MUI Joy theme bound to brand tokens                |
| `web/app/src/api/types.ts`            | `User`, `Org`, `WhoamiResponse` TS interfaces      |
| `web/app/src/api/client.ts`           | `whoami()`, `logout()`, `loginURL()` fetch helpers |
| `web/app/src/api/client.test.ts`      | Unit tests for the client                          |
| `web/app/src/brand/Brand.tsx`         | `BrandProvider` + `useBrand` hook                  |
| `web/app/src/brand/defaultBrand.ts`   | Default brand tokens                               |
| `web/app/src/brand/Brand.test.tsx`    | BrandProvider tests                                |
| `web/app/src/catalog/apps.ts`         | Tile metadata for all planned apps                 |
| `web/app/src/catalog/apps.test.ts`    | Catalog shape tests                                |
| `web/app/src/components/Header.tsx`   | App-bar with brand + user menu                     |
| `web/app/src/components/Tile.tsx`     | Single tile card                                   |
| `web/app/src/components/TileGrid.tsx` | Responsive grid of tiles                           |
| `web/app/src/pages/Dashboard.tsx`     | Logged-in tile launcher                            |
| `web/app/src/pages/SignIn.tsx`        | Unauthenticated landing                            |
| `web/app/src/pages/ComingSoon.tsx`    | Placeholder per tile                               |
| `web/app/src/pages/NotFound.tsx`      | 404                                                |
| `web/app/MODULE.md`                   | Frontend module doc                                |

### Backend (modify)

| Path                             | Reason                                        |
| -------------------------------- | --------------------------------------------- |
| `internal/server/static.go`      | New: static file handler with SPA fallback    |
| `internal/server/static_test.go` | New: tests for the static handler             |
| `internal/server/server.go`      | Wire the static handler after the gateway mux |
| `cmd/server/main.go`             | `--static-dir` flag + env var                 |
| `internal/server/server_test.go` | Updated to cover the static path              |

### Deploy / build (modify)

| Path                                          | Reason                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `deploy/process-compose/process-compose.yaml` | Add `web-build` one-shot before `backend`; backend serves `web/app/dist` |
| `.gitignore`                                  | Add `web/app/dist/`                                                      |

### E2E (new)

| Path                        | Purpose                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `web/e2e/dashboard.spec.ts` | Sign-in → dashboard tiles render → click tile → coming-soon page |

---

## Task 1: Scaffold the `web/app/` React + Vite + TS project

**Files:**

- Create: `web/app/package.json`
- Create: `web/app/tsconfig.json`
- Create: `web/app/tsconfig.node.json`
- Create: `web/app/vite.config.ts`
- Create: `web/app/index.html`
- Create: `web/app/src/main.tsx`
- Create: `web/app/src/App.tsx`
- Modify: `.gitignore` (add `web/app/dist/`)

- [ ] **Step 1: Add `web/app/dist/` to `.gitignore`**

In `/home/lucas/workspace/grown/grown-workspace/.gitignore`, find the `# Frontend` block and ensure it contains:

```
node_modules/
web/*/node_modules/
web/app/dist/
```

(If the third line is missing, add it; otherwise leave the block alone.)

- [ ] **Step 2: Write `package.json`**

Path: `web/app/package.json`

```json
{
  "name": "grown-workspace-app",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@emotion/react": "^11.11.4",
    "@emotion/styled": "^11.11.5",
    "@mui/joy": "5.0.0-beta.48",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.2",
    "vite": "^5.4.6",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

Path: `web/app/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Write `tsconfig.node.json`**

Path: `web/app/tsconfig.node.json`

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Write `vite.config.ts`**

Path: `web/app/vite.config.ts`

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      // In dev, proxy /api and /healthz to the Go backend on 8080.
      // Production: backend serves both the API and the built SPA directly.
      "/api": "http://127.0.0.1:8080",
      "/healthz": "http://127.0.0.1:8080",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

- [ ] **Step 6: Write `index.html`**

Path: `web/app/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Workspace</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Write `src/main.tsx`**

Path: `web/app/src/main.tsx`

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
```

- [ ] **Step 8: Write `src/App.tsx` (skeleton)**

Path: `web/app/src/App.tsx`

```typescript
import { Routes, Route } from "react-router-dom";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<div>grown-workspace scaffold</div>} />
    </Routes>
  );
}
```

- [ ] **Step 9: Write the Vitest setup file**

Path: `web/app/src/test-setup.ts`

```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 10: Install dependencies**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm install --no-fund --no-audit
```

Expected: `added <N> packages` with no errors.

- [ ] **Step 11: Verify build works**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm run build
```

Expected: produces `web/app/dist/index.html` + asset bundle. No errors.

- [ ] **Step 12: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add .gitignore web/app/package.json web/app/package-lock.json web/app/tsconfig.json web/app/tsconfig.node.json web/app/vite.config.ts web/app/index.html web/app/src/main.tsx web/app/src/App.tsx web/app/src/test-setup.ts
git commit -m "build(web): scaffold React + Vite + TypeScript app with MUI Joy"
```

---

## Task 2: API types + client (TDD)

**Files:**

- Create: `web/app/src/api/types.ts`
- Create: `web/app/src/api/client.ts`
- Create: `web/app/src/api/client.test.ts`

- [ ] **Step 1: Write `types.ts`**

Path: `web/app/src/api/types.ts`

```typescript
// TypeScript projections of the proto types in proto/grown/v1/.
// Hand-written for V1 — generation pipeline can be added later if the
// surface grows much larger.

export interface User {
  id: string;
  org_id: string;
  oidc_issuer: string;
  oidc_subject: string;
  email: string;
  display_name: string;
  // protojson serializes int64 as a string to preserve precision in JS.
  created_at: string;
}

export interface Org {
  id: string;
  slug: string;
  display_name: string;
}

export interface WhoamiResponse {
  user: User;
  org: Org;
}

// Sentinel returned by client.whoami() when the user is not authenticated.
// Pattern-match on the discriminated union returned by whoami() to handle
// each case explicitly.
export type WhoamiResult =
  | { status: "ok"; data: WhoamiResponse }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };
```

- [ ] **Step 2: Write the failing test for the client**

Path: `web/app/src/api/client.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "./client";

describe("api/client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loginURL returns /api/v1/auth/login", () => {
    expect(client.loginURL()).toBe("/api/v1/auth/login");
  });

  it("whoami returns ok with parsed body on 200", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: {
            id: "u1",
            org_id: "o1",
            oidc_issuer: "i",
            oidc_subject: "s",
            email: "e@x",
            display_name: "E",
            created_at: "1",
          },
          org: { id: "o1", slug: "default", display_name: "Default" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const r = await client.whoami();
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.data.user.email).toBe("e@x");
      expect(r.data.org.slug).toBe("default");
    }
  });

  it("whoami returns unauthenticated on 401", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "no session" }), { status: 401 }),
    );
    const r = await client.whoami();
    expect(r.status).toBe("unauthenticated");
  });

  it("whoami returns error on 500", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("boom", { status: 500 }),
    );
    const r = await client.whoami();
    expect(r.status).toBe("error");
  });

  it("logout posts to /api/v1/auth/logout and returns ok on 200", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await client.logout();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm test
```

Expected: 5 tests FAIL (cannot find module "./client").

- [ ] **Step 4: Implement `client.ts`**

Path: `web/app/src/api/client.ts`

```typescript
import type { WhoamiResponse, WhoamiResult } from "./types";

const API_BASE = "/api/v1";

/** loginURL returns the backend URL that initiates the OIDC flow. */
export function loginURL(): string {
  return `${API_BASE}/auth/login`;
}

/**
 * whoami fetches the currently-authenticated user. Returns a discriminated
 * union so callers can pattern-match on the auth state explicitly rather
 * than throwing on 401 (which is a normal flow control case).
 */
export async function whoami(): Promise<WhoamiResult> {
  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/whoami`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }
  if (resp.status === 401) return { status: "unauthenticated" };
  if (!resp.ok) {
    return { status: "error", message: `HTTP ${resp.status}` };
  }
  const data = (await resp.json()) as WhoamiResponse;
  return { status: "ok", data };
}

/** logout revokes the current session. Success-on-200 only — callers may
 *  refresh the page or navigate away afterwards. */
export async function logout(): Promise<void> {
  const resp = await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!resp.ok) {
    throw new Error(`logout failed: HTTP ${resp.status}`);
  }
}
```

- [ ] **Step 5: Run tests, all 5 PASS**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm test
```

Expected: 5 PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/src/api/
git commit -m "feat(web): API types + whoami/logout client with discriminated union"
```

---

## Task 3: Brand layer (TDD)

**Files:**

- Create: `web/app/src/brand/defaultBrand.ts`
- Create: `web/app/src/brand/Brand.tsx`
- Create: `web/app/src/brand/Brand.test.tsx`

- [ ] **Step 1: Write `defaultBrand.ts`**

Path: `web/app/src/brand/defaultBrand.ts`

```typescript
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

export const defaultBrand: Brand = {
  productName: "Workspace",
  tagline: "Self-hosted, multi-org workspace platform",
  primaryColor: "#3F704D", // muted forest green — distinct from Google's blue
  surfaceColor: "#FAFAF7", // warm white
  onSurfaceColor: "#1B2620", // dark green-black
  supportURL: "https://code.pick.haus/grown/grown",
};
```

- [ ] **Step 2: Write the failing test**

Path: `web/app/src/brand/Brand.test.tsx`

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandProvider, useBrand } from "./Brand";
import { defaultBrand } from "./defaultBrand";

function ProbeProductName() {
  const b = useBrand();
  return <span data-testid="probe">{b.productName}</span>;
}

describe("BrandProvider", () => {
  it("exposes defaultBrand when no override is passed", () => {
    render(
      <BrandProvider>
        <ProbeProductName />
      </BrandProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent(defaultBrand.productName);
  });

  it("merges the override brand onto the default", () => {
    render(
      <BrandProvider brand={{ productName: "AcmeCorp Workspace" }}>
        <ProbeProductName />
      </BrandProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("AcmeCorp Workspace");
  });

  it("sets CSS custom properties on the root element", () => {
    render(
      <BrandProvider brand={{ primaryColor: "#abcdef" }}>
        <ProbeProductName />
      </BrandProvider>,
    );
    // BrandProvider writes CSS vars onto the immediate wrapper element.
    const wrapper = screen.getByTestId("probe").parentElement!;
    expect(wrapper.style.getPropertyValue("--grown-primary")).toBe("#abcdef");
  });
});
```

- [ ] **Step 3: Run, verify it fails**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm test
```

Expected: brand tests fail (module not found).

- [ ] **Step 4: Implement `Brand.tsx`**

Path: `web/app/src/brand/Brand.tsx`

```typescript
import { createContext, useContext, type ReactNode } from "react";
import { defaultBrand, type Brand } from "./defaultBrand";

const BrandContext = createContext<Brand>(defaultBrand);

/** useBrand returns the active Brand. Falls back to defaultBrand if no provider is mounted. */
export function useBrand(): Brand {
  return useContext(BrandContext);
}

interface BrandProviderProps {
  /** Optional partial override merged onto defaultBrand. */
  brand?: Partial<Brand>;
  children: ReactNode;
}

/** BrandProvider exposes the active brand to descendants and emits CSS
 *  custom properties on its wrapper element so non-React styles can read
 *  the same tokens. */
export function BrandProvider({ brand, children }: BrandProviderProps) {
  const merged: Brand = { ...defaultBrand, ...(brand ?? {}) };
  const cssVars: Record<string, string> = {
    "--grown-primary": merged.primaryColor,
    "--grown-surface": merged.surfaceColor,
    "--grown-on-surface": merged.onSurfaceColor,
  };
  return (
    <BrandContext.Provider value={merged}>
      <div style={cssVars as React.CSSProperties}>{children}</div>
    </BrandContext.Provider>
  );
}
```

- [ ] **Step 5: Run tests, 3 PASS**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm test
```

Expected: all tests pass (5 from Task 2 + 3 from this task = 8 total).

- [ ] **Step 6: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/src/brand/
git commit -m "feat(web): BrandProvider + defaultBrand with CSS-var emission"
```

---

## Task 4: MUI Joy theme bound to brand tokens

**Files:**

- Create: `web/app/src/theme.ts`

- [ ] **Step 1: Write `theme.ts`**

Path: `web/app/src/theme.ts`

```typescript
import { extendTheme } from "@mui/joy/styles";

/**
 * MUI Joy theme bound to our brand CSS custom properties.
 *
 * Using CSS vars instead of static values means runtime brand changes
 * (`BrandProvider` re-rendering with a new brand) immediately reflect in
 * Joy components without a theme rebuild.
 */
export const grownTheme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
        primary: {
          // Map Joy's primary palette to our CSS var.
          // Other shades fall back to Joy's defaults derived from primary.
          500: "var(--grown-primary)",
          solidBg: "var(--grown-primary)",
        },
        background: {
          body: "var(--grown-surface)",
          surface: "var(--grown-surface)",
        },
        text: {
          primary: "var(--grown-on-surface)",
        },
      },
    },
  },
  fontFamily: {
    body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    display: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
});
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/src/theme.ts
git commit -m "feat(web): MUI Joy theme bound to brand CSS variables"
```

---

## Task 5: App catalog

**Files:**

- Create: `web/app/src/catalog/apps.ts`
- Create: `web/app/src/catalog/apps.test.ts`

- [ ] **Step 1: Write the failing test**

Path: `web/app/src/catalog/apps.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { apps, type AppTile } from "./apps";

describe("catalog/apps", () => {
  it("exposes a non-empty list of tiles", () => {
    expect(Array.isArray(apps)).toBe(true);
    expect(apps.length).toBeGreaterThan(10);
  });

  it("every tile has a unique non-empty id", () => {
    const ids = new Set<string>();
    for (const a of apps) {
      expect(a.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(ids.has(a.id)).toBe(false);
      ids.add(a.id);
    }
  });

  it("every tile has a name, accent color, and at least one phase tag", () => {
    for (const a of apps) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(a.phase).toBeGreaterThanOrEqual(1);
      expect(a.phase).toBeLessThanOrEqual(4);
    }
  });

  it("includes the core editor tiles", () => {
    const ids = new Set(apps.map((a) => a.id));
    for (const required of [
      "drive",
      "calendar",
      "mail",
      "docs",
      "sheets",
      "slides",
      "meet",
      "chat",
      "whiteboard",
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  type _Check = AppTile["id"]; // ensures the type is exported
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm test
```

- [ ] **Step 3: Implement `apps.ts`**

Path: `web/app/src/catalog/apps.ts`

```typescript
/**
 * Catalog of all planned-app tiles surfaced on the dashboard.
 *
 * Each tile renders as a card on the dashboard and routes to a "coming
 * soon" page on click. As real app phases ship, the `comingSoon` flag
 * flips to false and the tile points at the app's mount path instead.
 */
export interface AppTile {
  /** URL-safe identifier; used in the coming-soon route param. */
  id: string;
  /** Display name shown on the tile. */
  name: string;
  /** One-line description shown under the name. */
  blurb: string;
  /** Hex accent color used for the tile's avatar circle. */
  accentColor: string;
  /** Implementation phase per the V1 design spec (1–4). */
  phase: 1 | 2 | 3 | 4;
  /** True until the underlying app ships. */
  comingSoon: boolean;
}

export const apps: AppTile[] = [
  // Phase 1: foundational data apps
  {
    id: "drive",
    name: "Drive",
    blurb: "Files, folders, sharing.",
    accentColor: "#3F88C5",
    phase: 1,
    comingSoon: true,
  },
  {
    id: "calendar",
    name: "Calendar",
    blurb: "Schedules, events, free/busy.",
    accentColor: "#E0777D",
    phase: 1,
    comingSoon: true,
  },
  {
    id: "contacts",
    name: "Contacts",
    blurb: "Address book.",
    accentColor: "#5B9279",
    phase: 1,
    comingSoon: true,
  },
  {
    id: "whiteboard",
    name: "Whiteboard",
    blurb: "Excalidraw-based drawing surface.",
    accentColor: "#C46B45",
    phase: 1,
    comingSoon: true,
  },

  // Phase 2: communication
  {
    id: "mail",
    name: "Mail",
    blurb: "Email, threads, search.",
    accentColor: "#D64550",
    phase: 2,
    comingSoon: true,
  },
  {
    id: "chat",
    name: "Chat",
    blurb: "Direct and group messages.",
    accentColor: "#7A5980",
    phase: 2,
    comingSoon: true,
  },
  {
    id: "meet",
    name: "Meet",
    blurb: "Video calls and meetings.",
    accentColor: "#2A9D8F",
    phase: 2,
    comingSoon: true,
  },

  // Phase 3: documents
  {
    id: "docs",
    name: "Docs",
    blurb: "Collaborative text documents.",
    accentColor: "#3D5A80",
    phase: 3,
    comingSoon: true,
  },
  {
    id: "sheets",
    name: "Sheets",
    blurb: "Collaborative spreadsheets.",
    accentColor: "#1D8348",
    phase: 3,
    comingSoon: true,
  },
  {
    id: "slides",
    name: "Slides",
    blurb: "Collaborative presentations.",
    accentColor: "#D9A441",
    phase: 3,
    comingSoon: true,
  },
  {
    id: "forms",
    name: "Forms",
    blurb: "Surveys and quizzes.",
    accentColor: "#7E4E6F",
    phase: 3,
    comingSoon: true,
  },
  {
    id: "photos",
    name: "Photos",
    blurb: "Photo library and sharing.",
    accentColor: "#B8627D",
    phase: 3,
    comingSoon: true,
  },

  // Phase 4: auxiliary + admin
  {
    id: "keep",
    name: "Keep",
    blurb: "Quick notes.",
    accentColor: "#E8B14F",
    phase: 4,
    comingSoon: true,
  },
  {
    id: "sites",
    name: "Sites",
    blurb: "Internal site builder.",
    accentColor: "#5A9367",
    phase: 4,
    comingSoon: true,
  },
  {
    id: "groups",
    name: "Groups",
    blurb: "Mailing lists and forums.",
    accentColor: "#8E6E53",
    phase: 4,
    comingSoon: true,
  },
  {
    id: "admin",
    name: "Admin",
    blurb: "User and org management.",
    accentColor: "#4F5D75",
    phase: 4,
    comingSoon: true,
  },
  {
    id: "marketplace",
    name: "Marketplace",
    blurb: "Third-party apps.",
    accentColor: "#9B5E5E",
    phase: 4,
    comingSoon: true,
  },
];
```

- [ ] **Step 4: Run tests, all 4 PASS**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/src/catalog/
git commit -m "feat(web): catalog of 17 planned app tiles across phases 1–4"
```

---

## Task 6: Header component

**Files:**

- Create: `web/app/src/components/Header.tsx`

- [ ] **Step 1: Write `Header.tsx`**

Path: `web/app/src/components/Header.tsx`

```typescript
import { Box, Sheet, Typography, Avatar, Dropdown, MenuButton, Menu, MenuItem } from "@mui/joy";
import { useBrand } from "../brand/Brand";
import type { User } from "../api/types";
import { logout } from "../api/client";

interface HeaderProps {
  user: User | null;
}

/** Header is the top app-bar shown on every authenticated page. Displays
 *  the active brand on the left and the user menu on the right. */
export function Header({ user }: HeaderProps) {
  const brand = useBrand();
  const initial = (user?.display_name || user?.email || "?").charAt(0).toUpperCase();

  return (
    <Sheet
      component="header"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        px: 3,
        py: 1.5,
        borderBottom: "1px solid",
        borderColor: "divider",
        bgcolor: "background.surface",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Avatar
          variant="solid"
          sx={{ bgcolor: brand.primaryColor, color: "white", fontWeight: 700 }}
        >
          {brand.productName.charAt(0).toUpperCase()}
        </Avatar>
        <Typography level="title-lg" sx={{ color: brand.onSurfaceColor }}>
          {brand.productName}
        </Typography>
      </Box>

      {user && (
        <Dropdown>
          <MenuButton
            slots={{ root: Avatar }}
            slotProps={{ root: { variant: "soft", "aria-label": "user menu" } as any }}
          >
            {initial}
          </MenuButton>
          <Menu placement="bottom-end">
            <MenuItem disabled>{user.email}</MenuItem>
            <MenuItem onClick={() => logout().then(() => window.location.reload())}>
              Sign out
            </MenuItem>
          </Menu>
        </Dropdown>
      )}
    </Sheet>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/src/components/Header.tsx
git commit -m "feat(web): Header with brand + user menu (sign out)"
```

---

## Task 7: Tile + TileGrid components

**Files:**

- Create: `web/app/src/components/Tile.tsx`
- Create: `web/app/src/components/TileGrid.tsx`

- [ ] **Step 1: Write `Tile.tsx`**

Path: `web/app/src/components/Tile.tsx`

```typescript
import { Card, CardContent, Typography, Avatar, Chip } from "@mui/joy";
import { Link as RouterLink } from "react-router-dom";
import type { AppTile } from "../catalog/apps";

interface TileProps {
  app: AppTile;
}

/** Tile renders one app card. Clicking it routes to /coming-soon/:id. */
export function Tile({ app }: TileProps) {
  const initial = app.name.charAt(0).toUpperCase();
  return (
    <Card
      component={RouterLink}
      to={`/coming-soon/${app.id}`}
      variant="soft"
      sx={{
        textDecoration: "none",
        color: "inherit",
        cursor: "pointer",
        transition: "transform 120ms, box-shadow 120ms",
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: "md",
        },
      }}
      data-testid={`tile-${app.id}`}
    >
      <CardContent sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Avatar
          sx={{
            bgcolor: app.accentColor,
            color: "white",
            fontWeight: 700,
            width: 48,
            height: 48,
            fontSize: 22,
          }}
        >
          {initial}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography level="title-md" sx={{ mb: 0.25 }}>
            {app.name}
          </Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            {app.blurb}
          </Typography>
        </div>
        {app.comingSoon && (
          <Chip size="sm" variant="outlined" color="neutral">
            Coming soon
          </Chip>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Write `TileGrid.tsx`**

Path: `web/app/src/components/TileGrid.tsx`

```typescript
import { Box } from "@mui/joy";
import { Tile } from "./Tile";
import type { AppTile } from "../catalog/apps";

interface TileGridProps {
  apps: AppTile[];
}

/** TileGrid lays out tiles in a responsive CSS grid: 1 column on
 *  small screens, 2 on medium, 3 on large, 4 on xl. */
export function TileGrid({ apps }: TileGridProps) {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: {
          xs: "1fr",
          sm: "repeat(2, minmax(0, 1fr))",
          md: "repeat(3, minmax(0, 1fr))",
          lg: "repeat(4, minmax(0, 1fr))",
        },
      }}
    >
      {apps.map((app) => (
        <Tile key={app.id} app={app} />
      ))}
    </Box>
  );
}
```

- [ ] **Step 3: Verify they compile**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npx tsc -b
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/src/components/Tile.tsx web/app/src/components/TileGrid.tsx
git commit -m "feat(web): Tile card + responsive TileGrid"
```

---

## Task 8: Dashboard, SignIn, ComingSoon, NotFound pages

**Files:**

- Create: `web/app/src/pages/Dashboard.tsx`
- Create: `web/app/src/pages/SignIn.tsx`
- Create: `web/app/src/pages/ComingSoon.tsx`
- Create: `web/app/src/pages/NotFound.tsx`

- [ ] **Step 1: Write `Dashboard.tsx`**

Path: `web/app/src/pages/Dashboard.tsx`

```typescript
import { Container, Typography } from "@mui/joy";
import { Header } from "../components/Header";
import { TileGrid } from "../components/TileGrid";
import { apps } from "../catalog/apps";
import { useBrand } from "../brand/Brand";
import type { User } from "../api/types";

interface DashboardProps {
  user: User;
}

export function Dashboard({ user }: DashboardProps) {
  const brand = useBrand();
  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Typography level="h2" sx={{ mb: 0.5 }}>
          Welcome back, {user.display_name || user.email}
        </Typography>
        <Typography level="body-md" sx={{ mb: 4, opacity: 0.75 }}>
          {brand.tagline}
        </Typography>
        <TileGrid apps={apps} />
      </Container>
    </>
  );
}
```

- [ ] **Step 2: Write `SignIn.tsx`**

Path: `web/app/src/pages/SignIn.tsx`

```typescript
import { Box, Button, Card, CardContent, Typography, Avatar } from "@mui/joy";
import { useBrand } from "../brand/Brand";
import { loginURL } from "../api/client";

export function SignIn() {
  const brand = useBrand();
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.body",
        p: 2,
      }}
    >
      <Card variant="soft" sx={{ maxWidth: 420, width: "100%" }}>
        <CardContent sx={{ alignItems: "center", textAlign: "center", gap: 2 }}>
          <Avatar
            variant="solid"
            sx={{
              bgcolor: brand.primaryColor,
              color: "white",
              fontWeight: 700,
              width: 64,
              height: 64,
              fontSize: 28,
            }}
          >
            {brand.productName.charAt(0).toUpperCase()}
          </Avatar>
          <Typography level="h3">{brand.productName}</Typography>
          <Typography level="body-md" sx={{ opacity: 0.75 }}>
            {brand.tagline}
          </Typography>
          <Button
            component="a"
            href={loginURL()}
            size="lg"
            sx={{ bgcolor: brand.primaryColor, mt: 2, alignSelf: "stretch" }}
            data-testid="sign-in-button"
          >
            Sign in
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
```

- [ ] **Step 3: Write `ComingSoon.tsx`**

Path: `web/app/src/pages/ComingSoon.tsx`

```typescript
import { useParams, Link as RouterLink } from "react-router-dom";
import { Box, Container, Typography, Avatar, Button, Chip } from "@mui/joy";
import { Header } from "../components/Header";
import { apps } from "../catalog/apps";
import type { User } from "../api/types";

interface ComingSoonProps {
  user: User;
}

export function ComingSoon({ user }: ComingSoonProps) {
  const { appId } = useParams<{ appId: string }>();
  const app = apps.find((a) => a.id === appId);

  return (
    <>
      <Header user={user} />
      <Container maxWidth="md" sx={{ py: 6 }}>
        {app ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 2 }}>
            <Avatar
              sx={{
                bgcolor: app.accentColor,
                color: "white",
                fontWeight: 700,
                width: 80,
                height: 80,
                fontSize: 36,
              }}
            >
              {app.name.charAt(0).toUpperCase()}
            </Avatar>
            <Typography level="h2">{app.name}</Typography>
            <Typography level="body-lg" sx={{ opacity: 0.75 }}>
              {app.blurb}
            </Typography>
            <Chip variant="outlined" color="neutral">
              Phase {app.phase} — Coming soon
            </Chip>
            <Button
              component={RouterLink}
              to="/"
              variant="plain"
              sx={{ mt: 2 }}
              data-testid="back-to-dashboard"
            >
              Back to dashboard
            </Button>
          </Box>
        ) : (
          <Typography level="h3">Unknown app: {appId}</Typography>
        )}
      </Container>
    </>
  );
}
```

- [ ] **Step 4: Write `NotFound.tsx`**

Path: `web/app/src/pages/NotFound.tsx`

```typescript
import { Box, Typography, Button } from "@mui/joy";
import { Link as RouterLink } from "react-router-dom";

export function NotFound() {
  return (
    <Box sx={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
      <Typography level="h1">404</Typography>
      <Typography level="body-lg">Page not found.</Typography>
      <Button component={RouterLink} to="/">Back to dashboard</Button>
    </Box>
  );
}
```

- [ ] **Step 5: Verify all pages compile**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npx tsc -b
```

- [ ] **Step 6: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/src/pages/
git commit -m "feat(web): Dashboard, SignIn, ComingSoon, NotFound pages"
```

---

## Task 9: Wire routes + auth gate in `App.tsx`

**Files:**

- Modify: `web/app/src/App.tsx`

- [ ] **Step 1: Replace `App.tsx`**

Path: `web/app/src/App.tsx`

```typescript
import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { CssVarsProvider, CssBaseline } from "@mui/joy";

import { grownTheme } from "./theme";
import { BrandProvider } from "./brand/Brand";
import { whoami } from "./api/client";
import type { User } from "./api/types";
import { Dashboard } from "./pages/Dashboard";
import { SignIn } from "./pages/SignIn";
import { ComingSoon } from "./pages/ComingSoon";
import { NotFound } from "./pages/NotFound";

type AuthState =
  | { kind: "loading" }
  | { kind: "authenticated"; user: User }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    whoami().then((r) => {
      if (cancelled) return;
      switch (r.status) {
        case "ok":
          setAuth({ kind: "authenticated", user: r.data.user });
          break;
        case "unauthenticated":
          setAuth({ kind: "unauthenticated" });
          break;
        case "error":
          setAuth({ kind: "error", message: r.message });
          break;
      }
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <CssVarsProvider theme={grownTheme} defaultMode="light">
      <CssBaseline />
      <BrandProvider>
        {auth.kind === "loading" && null}
        {auth.kind === "unauthenticated" && <SignIn />}
        {auth.kind === "error" && (
          <div role="alert" style={{ padding: 24 }}>
            Error contacting backend: {auth.message}
          </div>
        )}
        {auth.kind === "authenticated" && (
          <Routes>
            <Route path="/" element={<Dashboard user={auth.user} />} />
            <Route path="/coming-soon/:appId" element={<ComingSoon user={auth.user} />} />
            <Route path="*" element={<NotFound />} />
            <Route path="/sign-in" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </BrandProvider>
    </CssVarsProvider>
  );
}
```

- [ ] **Step 2: Build the full app**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/app
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm run build
```

Expected: produces `dist/index.html` + asset bundle. No errors.

- [ ] **Step 3: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add web/app/src/App.tsx
git commit -m "feat(web): App.tsx — auth gate + routes (dashboard, coming-soon, sign-in)"
```

---

## Task 10: Backend static file handler (TDD)

**Files:**

- Create: `grown-workspace/internal/server/static.go`
- Create: `grown-workspace/internal/server/static_test.go`

- [ ] **Step 1: Write the failing test**

Path: `internal/server/static_test.go`

```go
package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticHandler_ServesIndexAtRoot(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "index.html"), "<!doctype html><html>index</html>")

	h := StaticHandler(dir)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "<!doctype html>") {
		t.Errorf("body: got %q, want index.html content", rr.Body.String())
	}
}

func TestStaticHandler_ServesAssetByExactPath(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "assets/app.js"), "console.log('hi')")

	h := StaticHandler(dir)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "console.log") {
		t.Errorf("body: got %q, want js content", rr.Body.String())
	}
}

func TestStaticHandler_SPAFallbackToIndex(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "index.html"), "<!doctype html><html>spa</html>")

	h := StaticHandler(dir)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/coming-soon/drive", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (SPA fallback)", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "spa") {
		t.Errorf("body: got %q, want index.html SPA content", rr.Body.String())
	}
}

func TestStaticHandler_DoesNotShadowAPIPaths(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "index.html"), "spa")

	h := StaticHandler(dir)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/whoami", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("/api/v1/* must return 404 from static handler so the gateway gets it; got %d", rr.Code)
	}
}

func TestStaticHandler_MissingDirReturns404(t *testing.T) {
	h := StaticHandler("/this/path/does/not/exist")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("missing dir: got %d, want 404", rr.Code)
	}
}

func mustWrite(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 2: Run, verify fails (undefined: StaticHandler)**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go test ./internal/server/... -run TestStatic
```

Expected: build failure.

- [ ] **Step 3: Implement `static.go`**

Path: `internal/server/static.go`

```go
package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// StaticHandler serves the built React SPA from `dir`. Behavior:
//   - GET /api/* always returns 404 (so the gateway mux handles it via the
//     server's outer routing).
//   - GET /<exact-file> with a file extension serves the file from `dir`,
//     404 if missing.
//   - Any other GET serves index.html (SPA history-API fallback) so client
//     routing works on hard refreshes.
//
// If `dir` is empty or missing, all requests get 404 — letting the operator
// run the backend in API-only mode for tests.
func StaticHandler(dir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Never shadow API paths; let the outer router fall through.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}

		if dir == "" {
			http.NotFound(w, r)
			return
		}
		if _, err := os.Stat(dir); err != nil {
			http.NotFound(w, r)
			return
		}

		// Exact file match (path has an extension and file exists).
		if hasFileExt(r.URL.Path) {
			full := filepath.Join(dir, filepath.Clean(r.URL.Path))
			if !strings.HasPrefix(full, filepath.Clean(dir)+string(filepath.Separator)) && full != filepath.Clean(dir) {
				http.NotFound(w, r) // path-escape guard
				return
			}
			if fi, err := os.Stat(full); err == nil && !fi.IsDir() {
				http.ServeFile(w, r, full)
				return
			}
			http.NotFound(w, r)
			return
		}

		// SPA fallback.
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}

func hasFileExt(p string) bool {
	base := filepath.Base(p)
	return strings.Contains(base, ".")
}
```

- [ ] **Step 4: Run tests, all 5 PASS**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command go test ./internal/server/... -v -run TestStatic
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add internal/server/static.go internal/server/static_test.go
git commit -m "feat(server): static file handler with SPA fallback + API passthrough"
```

---

## Task 11: Wire static handler into `internal/server/server.go`

**Files:**

- Modify: `internal/server/server.go`

The current Server's `HTTPHandler()` returns the gateway mux wrapped in auth middleware. We need to route non-API paths to the static handler while keeping API paths on the gateway.

- [ ] **Step 1: Modify `Config` to accept `StaticDir`**

Edit `/home/lucas/workspace/grown/grown-workspace/internal/server/server.go`. In the `Config` struct, add a field after `DefaultOrg`:

```go
	// StaticDir is the path to the built React SPA. Empty disables static
	// serving (API-only mode for tests).
	StaticDir string
```

- [ ] **Step 2: Compose the final HTTP handler**

In the `New` function, replace the line:

```go
	wrapped := auth.HTTPMiddleware(cfg.AuthConfig, cfg.Sessions, cfg.UsersRepo, cfg.DefaultOrg)(mux)
	return &Server{grpc: grpcSrv, httpHandler: wrapped}
```

With:

```go
	authWrapped := auth.HTTPMiddleware(cfg.AuthConfig, cfg.Sessions, cfg.UsersRepo, cfg.DefaultOrg)(mux)

	// Route /api/* and /healthz to the auth-wrapped gateway; everything
	// else falls through to the static SPA handler.
	static := StaticHandler(cfg.StaticDir)
	router := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" {
			authWrapped.ServeHTTP(w, r)
			return
		}
		static.ServeHTTP(w, r)
	})

	return &Server{grpc: grpcSrv, httpHandler: router}
```

- [ ] **Step 3: Add the `strings` import**

The imports block should include `"strings"`. If it's missing, add it.

- [ ] **Step 4: Verify build + existing tests still pass**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c 'go vet ./... && go test ./internal/server/... ./internal/health/...'
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add internal/server/server.go
git commit -m "feat(server): route /api and /healthz to gateway, everything else to SPA"
```

---

## Task 12: `cmd/server/main.go` — `--static-dir` flag

**Files:**

- Modify: `cmd/server/main.go`

- [ ] **Step 1: Add the flag definition and plumb to Config**

In `/home/lucas/workspace/grown/grown-workspace/cmd/server/main.go`, find the flag block (after `dsn := flag.String(...)`):

```go
	dsn := flag.String("postgres-dsn", os.Getenv("GROWN_POSTGRES_DSN"), "Postgres DSN")
	flag.Parse()
```

Replace with:

```go
	dsn := flag.String("postgres-dsn", os.Getenv("GROWN_POSTGRES_DSN"), "Postgres DSN")
	staticDir := flag.String("static-dir", os.Getenv("GROWN_STATIC_DIR"), "Path to the built React SPA (web/app/dist). Empty = API-only.")
	flag.Parse()
```

Then in the `server.New(server.Config{...})` call, add `StaticDir: *staticDir,` to the Config literal (place it adjacent to `DefaultOrg`):

```go
	srv := server.New(server.Config{
		Version:    version,
		Commit:     commit,
		StartedAt:  time.Now(),
		AuthConfig: authCfg,
		OIDC:       oidcClient,
		Sessions:   auth.NewSessionStore(pool),
		UsersRepo:  users.NewRepository(pool),
		OrgsRepo:   orgsRepo,
		DefaultOrg: defaultOrg,
		StaticDir:  *staticDir,
	})
```

- [ ] **Step 2: Verify build + tests**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c 'go build ./cmd/server && go test ./cmd/server/...'
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add cmd/server/main.go
git commit -m "feat(server): --static-dir flag + GROWN_STATIC_DIR env"
```

---

## Task 13: process-compose — `web-build` step + backend serves dist

**Files:**

- Modify: `deploy/process-compose/process-compose.yaml`

- [ ] **Step 1: Add the `web-build` process**

Edit `/home/lucas/workspace/grown/grown-workspace/deploy/process-compose/process-compose.yaml`. Add this process AFTER `zitadel-create-app` and BEFORE `backend`:

```yaml
web-build:
  command: |
    set -e
    cd "$PROJECT_ROOT/web/app"
    if [ ! -d node_modules ]; then
      npm install --no-fund --no-audit
    fi
    npm run build
  availability:
    restart: "no"
```

(No `depends_on` — the web build is independent of the backend stack and can run in parallel with Zitadel boot. process-compose handles the parallelism.)

- [ ] **Step 2: Update `backend` to depend on `web-build` and pass `--static-dir`**

In the `backend` process block, modify the `command` block and the `depends_on` block.

The command should now include `--static-dir`:

```yaml
backend:
  command: |
    exec go run ./cmd/server \
      --http-addr=:8080 \
      --grpc-addr=:9000 \
      --static-dir="$PROJECT_ROOT/web/app/dist"
```

And `depends_on` should include `web-build`:

```yaml
depends_on:
  postgres-createdb:
    condition: process_completed_successfully
  zitadel-create-app:
    condition: process_completed_successfully
  web-build:
    condition: process_completed_successfully
```

- [ ] **Step 3: Validate the YAML parses**

```bash
cd /home/lucas/workspace/grown/grown-workspace
python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1])); print('OK')" deploy/process-compose/process-compose.yaml
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add deploy/process-compose/process-compose.yaml
git commit -m "build(dev): add web-build process and serve dist from backend"
```

---

## Task 14: Smoke test — full stack with frontend

**Files:**

- (no new files)

- [ ] **Step 1: Stop the existing stack (it was running from Plan 2)**

```bash
pgrep -fa 'process-compose.*grown-workspace' | head -1 | awk '{print $1}' | xargs -r kill 2>/dev/null
sleep 2
pgrep -fa 'process-compose.*grown-workspace' || echo "stopped"
```

- [ ] **Step 2: Bring up the full stack with the new frontend**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  process-compose up --use-uds --tui=false -f deploy/process-compose/process-compose.yaml > /tmp/pc_p3.log 2>&1 &
  echo "stack PID: $!"
  # Wait for backend
  for i in $(seq 1 240); do
    if curl -fs http://workspace.localtest.me:8080/healthz >/dev/null 2>&1; then
      echo "backend ready after ${i}s"
      break
    fi
    sleep 1
  done
'
```

- [ ] **Step 3: Verify the SPA is served at /**

```bash
curl -sv http://workspace.localtest.me:8080/ 2>&1 | head -20
```

Expected: `HTTP/1.1 200 OK` with `Content-Type: text/html` and a body containing `<div id="root">` and a script tag pointing to a hashed JS asset.

- [ ] **Step 4: Verify /api/v1/whoami still works (returns 401 without session)**

```bash
curl -i -s http://workspace.localtest.me:8080/api/v1/whoami | head -5
```

Expected: `HTTP/1.1 401 Unauthorized`.

- [ ] **Step 5: Verify SPA fallback for /coming-soon/drive**

```bash
curl -sv http://workspace.localtest.me:8080/coming-soon/drive 2>&1 | grep -E '^(< HTTP|< Content-Type|<title>|<div id)'
```

Expected: 200 OK + `Content-Type: text/html` + the same index.html shell (React Router handles the route client-side).

- [ ] **Step 6: Verify the static asset bundle is served**

```bash
# Find the bundled JS asset name (it's hashed).
JS_ASSET=$(curl -s http://workspace.localtest.me:8080/ | grep -oE '/assets/[^"]+\.js' | head -1)
echo "found: $JS_ASSET"
curl -s -o /dev/null -w 'http=%{http_code} ctype=%{content_type} size=%{size_download}\n' "http://workspace.localtest.me:8080$JS_ASSET"
```

Expected: `http=200 ctype=application/javascript; charset=utf-8 size=<positive>`.

If all checks pass, the smoke is good. (Don't stop the stack — Task 15's e2e needs it running.)

- [ ] **Step 7: Note the stack PID for later cleanup**

```bash
pgrep -fa 'process-compose.*grown-workspace' | head -1
```

Save this PID — Task 16 will use it for cleanup.

---

## Task 15: E2E — full dashboard flow

**Files:**

- Create: `web/e2e/dashboard.spec.ts`

- [ ] **Step 1: Write the e2e test**

Path: `web/e2e/dashboard.spec.ts`

```typescript
import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.GROWN_HTTP_URL ?? "http://workspace.localtest.me:8080";

test.describe.serial("dashboard", () => {
  test("sign-in screen renders when not authenticated", async ({ page }) => {
    // Use a fresh context (no cookies) to guarantee the unauthenticated state.
    const context = await page.context();
    await context.clearCookies();

    await page.goto(`${BASE_URL}/`);
    await expect(page.getByTestId("sign-in-button")).toBeVisible();
  });

  test("after OIDC login, dashboard shows the catalog of tiles", async ({
    page,
  }) => {
    const context = await page.context();
    await context.clearCookies();

    await page.goto(`${BASE_URL}/`);
    await page.getByTestId("sign-in-button").click();

    // Now we're on the Zitadel login form.
    await page
      .locator('input[name="loginName"], input[id="loginName"]')
      .fill("admin");
    await page.locator('button[type="submit"]').first().click();
    await page
      .locator('input[name="password"], input[id="password"]')
      .fill("DevPassword!1");
    await page.locator('button[type="submit"]').first().click();

    // Land back on dashboard.
    await page.waitForURL(
      new RegExp(
        "^" + BASE_URL.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "/?$",
      ),
      { timeout: 30_000 },
    );

    // Several tiles should be visible.
    await expect(page.getByTestId("tile-drive")).toBeVisible();
    await expect(page.getByTestId("tile-docs")).toBeVisible();
    await expect(page.getByTestId("tile-whiteboard")).toBeVisible();

    // Welcome line uses the admin's display name or email.
    await expect(page.getByText(/Welcome back/i)).toBeVisible();
  });

  test("clicking a tile navigates to its coming-soon page", async ({
    page,
  }) => {
    // Assumes the previous test left us authenticated (same context).
    await page.goto(`${BASE_URL}/`);
    await page.getByTestId("tile-drive").click();

    await expect(page).toHaveURL(`${BASE_URL}/coming-soon/drive`);
    await expect(page.getByText("Coming soon", { exact: false })).toBeVisible();
    await expect(page.getByTestId("back-to-dashboard")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the e2e against the running stack**

```bash
cd /home/lucas/workspace/grown/grown-workspace/web/e2e
nix --extra-experimental-features 'nix-command flakes' develop ../.. --command npm test -- --grep "dashboard"
```

Expected: 3 tests PASS.

If the test fails, take a screenshot via `await page.screenshot({ path: '/tmp/dash.png' })` before the failing locator to debug. Common failure modes:

- The auth.spec test from Plan 2 left a session in the browser context — the first test clears cookies explicitly to handle this.
- The Zitadel login selectors changed — adjust if needed (same advice as Plan 2 T17).

- [ ] **Step 3: Commit**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git add web/e2e/dashboard.spec.ts
git commit -m "test(e2e): dashboard sign-in, tile grid, and tile-click flows"
```

---

## Task 16: Final verification + tag v0.0.3

**Files:**

- (no new files)

- [ ] **Step 1: Stop the stack from Task 14**

```bash
pgrep -fa 'process-compose.*grown-workspace' | head -1 | awk '{print $1}' | xargs -r kill 2>/dev/null
sleep 2
```

- [ ] **Step 2: Verify tree clean + all checks**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git status --short
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  go vet ./...
  go test ./internal/health/... ./internal/server/... ./internal/auth/... ./cmd/server/...
  buf lint
  go build ./...
  ( cd web/app && npm run build && npm test )
  echo "ALL GREEN"
'
```

Expected: tree clean, all checks pass, ALL GREEN printed.

- [ ] **Step 3: Full stack + both e2e tests end-to-end**

```bash
cd /home/lucas/workspace/grown/grown-workspace
nix --extra-experimental-features 'nix-command flakes' develop --command bash -c '
  set -e
  process-compose up --use-uds --tui=false -f deploy/process-compose/process-compose.yaml > /tmp/pc_final3.log 2>&1 &
  SC=$!
  trap "kill $SC 2>/dev/null; wait $SC 2>/dev/null || true" EXIT
  for i in $(seq 1 240); do
    if curl -fs http://workspace.localtest.me:8080/healthz >/dev/null 2>&1; then break; fi
    sleep 1
  done
  echo "--- healthz ---"
  curl -s http://workspace.localtest.me:8080/healthz | jq .
  echo "--- index HTML head ---"
  curl -s http://workspace.localtest.me:8080/ | head -5
  echo "--- e2e suite (auth + dashboard) ---"
  ( cd web/e2e && npm test )
'
```

Expected: healthz returns JSON, index HTML served, all e2e tests pass (auth + 3 dashboard tests = 4 passing).

- [ ] **Step 4: Tag v0.0.3**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git tag -a v0.0.3 -m "v0.0.3 Dashboard + brand + catalog: signed-in users land on a Material 3 tile launcher"
git tag -l
```

- [ ] **Step 5: Print summary**

```bash
cd /home/lucas/workspace/grown/grown-workspace
git log --oneline | head -25
echo
git show v0.0.3 --no-patch
```

---

## Self-review checklist

- **Spec coverage**: dashboard ✓, brand layer ✓, catalog of all planned apps ✓, Material 3 sibling aesthetic ✓ (MUI Joy), per-deploy theming via CSS vars ✓, "coming soon" stubs ✓.
- **No placeholders**: every step has exact code.
- **Type consistency**: `User`, `Org`, `WhoamiResponse` interfaces match the Go proto field names (snake_case JSON keys). `AppTile` shape used consistently across catalog, Tile, and ComingSoon.
- **Bite-sized**: each step is one action; larger files (App.tsx) are single-step replacements.
- **Frequent commits**: ~15 commits expected (one per task).

## Done criteria

When all tasks are complete:

1. `nix run .#dev` brings up Postgres + Zitadel + the built React SPA + backend.
2. Visiting `http://workspace.localtest.me:8080/` shows the SignIn screen with the brand's primary color and product name.
3. Clicking "Sign in" redirects through Zitadel; after login, the dashboard appears with a grid of ~17 app tiles.
4. Clicking any tile (e.g. Drive) navigates to `/coming-soon/drive` showing a branded placeholder.
5. The user menu in the Header allows signing out, which reloads the page back to the SignIn screen.
6. The Playwright `dashboard.spec.ts` test passes end-to-end.
7. `v0.0.3` tag exists.

## Next plans

- **Plan 4** — gam-compat shim (`/admin/directory/v1/users`, `/groups`) + native `grown` CLI.
- **Plan 5** — Multi-org subdomain routing + Helm chart + production e2e.
