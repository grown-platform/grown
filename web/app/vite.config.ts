import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

// FortuneSheet 1.0.4 paints every cell without an explicit horizontal
// alignment (`ht`) left-aligned, numbers included. Excel and Google Sheets
// right-align numbers, centre booleans and errors, and left-align text. Patch
// the one resolver FortuneSheet paints with (`normalizedCellAttr(cell, "ht")`)
// to ask src/pages/sheets/cellAlign.ts for the type default. It is decided at
// render time and never written into cells, so saves and the xlsx export
// keep "no alignment" for cells that had none. Fails the build if the
// library's code changes shape (e.g. after an upgrade).
const FS_HT_FROM = 'var defaultValue = attr === "ht" ? "1" : "0";';
const FS_HT_TO =
  'var defaultValue = attr === "ht" ? (typeof globalThis.__grownDefaultHt === "function" ? globalThis.__grownDefaultHt(cell) : "1") : "0";';
const isFortuneCore = (id: string) => /@fortune-sheet[\\/]core[\\/]dist[\\/]index(\.esm)?\.js$/.test(id.split("?")[0]);
function patchFortuneCore(code: string, id: string): string {
  if (!code.includes(FS_HT_FROM)) throw new Error(`fortune-sheet alignment patch: pattern not found in ${id}`);
  return code.replace(FS_HT_FROM, FS_HT_TO);
}
function fortuneSheetAlignment(): Plugin {
  return {
    name: "grown:fortune-sheet-alignment",
    enforce: "pre",
    transform(code, id) {
      return isFortuneCore(id) ? { code: patchFortuneCore(code, id), map: null } : null;
    },
  };
}

export default defineConfig({
  plugins: [react(), fortuneSheetAlignment()],
  // The dev server pre-bundles dependencies with esbuild, bypassing
  // `transform`; patch FortuneSheet there too.
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: "grown:fortune-sheet-alignment",
          setup(build) {
            build.onLoad({ filter: /@fortune-sheet[\\/]core[\\/]dist[\\/]index(\.esm)?\.js$/ }, async (args) => {
              const { readFile } = await import("node:fs/promises");
              return { contents: patchFortuneCore(await readFile(args.path, "utf8"), args.path), loader: "js" };
            });
          },
        },
      ],
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      // In dev, proxy /api and /healthz to the Go backend on 8080.
      // Production: backend serves both the API and the built SPA directly.
      // ws: the collab hubs (/api/v1/{docs,sheets,slides,…}/d/<id>/connect)
      // are WebSockets; without this the dev editors silently run offline.
      "/api": { target: "http://127.0.0.1:8080", ws: true },
      "/healthz": "http://127.0.0.1:8080",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
