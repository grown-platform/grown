// Generates per-game PWA assets (favicon/icon SVG + web manifest) and injects
// the PWA <head> block + service-worker registration into each bundled game's
// HTML. Idempotent: the injected block is delimited by <!-- pwa:start/end -->
// and replaced on re-run, so it's safe to run after adding a new game.
//
//   node web/app/scripts/gen-games-pwa.mjs
//
// Run from the repo root (paths are relative to web/app/public/games).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const GAMES = join(here, "..", "public", "games");
const ICONS = join(GAMES, "icons");

// id → display name, accent color (matches the catalog tiles), and glyph.
const CONFIG = [
  { id: "2048", name: "2048", color: "#EDC22E", glyph: "🔢" },
  { id: "snake", name: "Snake", color: "#43A047", glyph: "🐍" },
  { id: "minesweeper", name: "Minesweeper", color: "#455A64", glyph: "💣" },
  { id: "sudoku", name: "Sudoku", color: "#1E88E5", glyph: "🧮" },
  { id: "tic-tac-toe", name: "Tic-Tac-Toe", color: "#EC407A", glyph: "⭕" },
  { id: "connect-four", name: "Connect Four", color: "#E63946", glyph: "🔴" },
  { id: "memory-game", name: "Memory", color: "#26A69A", glyph: "🧠" },
  { id: "reversi", name: "Reversi", color: "#2E7D32", glyph: "⚫" },
  { id: "mastermind", name: "Mastermind", color: "#7C4DFF", glyph: "🎯" },
  { id: "hangman", name: "Hangman", color: "#6D4C41", glyph: "🔤" },
  { id: "lights-out", name: "Lights Out", color: "#F4A261", glyph: "💡" },
  { id: "sliding-puzzle", name: "Sliding Puzzle", color: "#5C6BC0", glyph: "🧩" },
  { id: "solitaire", name: "Solitaire", color: "#0B6E4F", glyph: "🃏" },
];

const iconSvg = (color, glyph) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${color}"/>
  <text x="50%" y="52%" dominant-baseline="central" text-anchor="middle" font-size="300">${glyph}</text>
</svg>
`;

const manifest = (g) => JSON.stringify(
  {
    name: g.name,
    short_name: g.name,
    description: `${g.name} — play in your browser, online or off.`,
    start_url: `/games/${g.id}.html`,
    scope: `/games/${g.id}.html`,
    display: "standalone",
    orientation: "any",
    background_color: "#0f172a",
    theme_color: g.color,
    icons: [
      { src: `/games/icons/${g.id}.svg`, sizes: "192x192", type: "image/svg+xml", purpose: "any maskable" },
      { src: `/games/icons/${g.id}.svg`, sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" },
    ],
  },
  null,
  2,
);

const headBlock = (g) => `<!-- pwa:start -->
    <link rel="icon" type="image/svg+xml" href="/games/icons/${g.id}.svg">
    <link rel="manifest" href="/games/${g.id}.webmanifest">
    <meta name="theme-color" content="${g.color}">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="${g.name}">
    <link rel="apple-touch-icon" href="/games/icons/${g.id}.svg">
    <script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/games/games-sw.js').catch(function(){})})}</script>
    <!-- pwa:end -->`;

// Shared offline service worker (network-first → fresh online, cached offline).
const SW = `/* grown-workspace games service worker — offline + installability.
   Network-first so a new deploy is picked up while online, with a cache
   fallback so installed games keep working offline. Scope: /games/. */
const CACHE = 'grown-games-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
`;

function injectHead(html, g) {
  const block = headBlock(g);
  if (html.includes("<!-- pwa:start -->")) {
    return html.replace(/<!-- pwa:start -->[\s\S]*?<!-- pwa:end -->/, block);
  }
  if (!html.includes("</head>")) throw new Error(`${g.id}.html has no </head>`);
  return html.replace("</head>", `    ${block}\n</head>`);
}

mkdirSync(ICONS, { recursive: true });
writeFileSync(join(GAMES, "games-sw.js"), SW);

let changed = 0;
for (const g of CONFIG) {
  const htmlPath = join(GAMES, `${g.id}.html`);
  if (!existsSync(htmlPath)) {
    console.warn(`skip ${g.id}: ${g.id}.html not found`);
    continue;
  }
  writeFileSync(join(ICONS, `${g.id}.svg`), iconSvg(g.color, g.glyph));
  writeFileSync(join(GAMES, `${g.id}.webmanifest`), manifest(g) + "\n");
  const before = readFileSync(htmlPath, "utf8");
  const after = injectHead(before, g);
  if (after !== before) { writeFileSync(htmlPath, after); changed++; }
  console.log(`✓ ${g.id} (icon + manifest + head)`);
}
console.log(`\nDone: ${CONFIG.length} games, ${changed} HTML files updated, shared games-sw.js written.`);
