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
  { id: "crossword", name: "Crossword", color: "#6741D9", glyph: "📝" },
  { id: "tetris", name: "Tetris", color: "#7C3AED", glyph: "🟪" },
  { id: "breakout", name: "Breakout", color: "#0EA5E9", glyph: "🧱" },
  { id: "pong", name: "Pong", color: "#475569", glyph: "🏓" },
  { id: "flappy", name: "Flappy", color: "#FACC15", glyph: "🐤" },
  { id: "whack-a-mole", name: "Whack-a-Mole", color: "#65A30D", glyph: "🔨" },
  { id: "simon", name: "Simon", color: "#E11D48", glyph: "🎶" },
  { id: "bubble-shooter", name: "Bubble Shooter", color: "#DB2777", glyph: "🫧" },
  { id: "tower-stack", name: "Tower Stack", color: "#F59E0B", glyph: "📦" },
  { id: "hormuz", name: "Strait of Hormuz", color: "#0369A1", glyph: "🚤" },
  { id: "word-search", name: "Word Search", color: "#0891B2", glyph: "🔍" },
  { id: "asteroids", name: "Asteroids", color: "#334155", glyph: "☄️" },
  { id: "doodle-jump", name: "Doodle Jump", color: "#22C55E", glyph: "🦘" },
  { id: "rock-paper-scissors", name: "Rock Paper Scissors", color: "#F43F5E", glyph: "✊" },
  { id: "checkers", name: "Checkers", color: "#B91C1C", glyph: "🟤" },
  { id: "maze", name: "Maze", color: "#7C3AED", glyph: "🧭" },
  { id: "coloring", name: "Coloring Pad", color: "#EC4899", glyph: "🎨" },
  { id: "snakes-and-ladders", name: "Snakes & Ladders", color: "#16A34A", glyph: "🎲" },
  { id: "math-quiz", name: "Math Quiz", color: "#2563EB", glyph: "➗" },
  { id: "space-invaders", name: "Space Invaders", color: "#6366F1", glyph: "👾" },
  { id: "gomoku", name: "Gomoku", color: "#0F766E", glyph: "5️⃣" },
  { id: "dots-and-boxes", name: "Dots & Boxes", color: "#DB2777", glyph: "🔲" },
  { id: "tower-of-hanoi", name: "Tower of Hanoi", color: "#CA8A04", glyph: "🗼" },
  { id: "water-sort", name: "Water Sort", color: "#06B6D4", glyph: "🧪" },
  { id: "sokoban", name: "Sokoban", color: "#B45309", glyph: "🗃️" },
  { id: "frogger", name: "Frogger", color: "#16A34A", glyph: "🐸" },
  { id: "blackjack", name: "Blackjack", color: "#15803D", glyph: "♠️" },
  { id: "air-hockey", name: "Air Hockey", color: "#DC2626", glyph: "🏒" },
  { id: "piano-tiles", name: "Piano Tiles", color: "#1E293B", glyph: "🎹" },
  { id: "fruit-catch", name: "Fruit Catch", color: "#F97316", glyph: "🍎" },
  { id: "balloon-pop", name: "Balloon Pop", color: "#EF4444", glyph: "🎈" },
  { id: "reaction-time", name: "Reaction Time", color: "#10B981", glyph: "⚡" },
  { id: "aim-trainer", name: "Aim Trainer", color: "#E11D48", glyph: "🎯" },
  { id: "guess-the-number", name: "Guess the Number", color: "#2563EB", glyph: "❓" },
  { id: "higher-lower", name: "Higher or Lower", color: "#7C3AED", glyph: "🎴" },
  { id: "video-poker", name: "Video Poker", color: "#166534", glyph: "♣️" },
  { id: "war", name: "War", color: "#7F1D1D", glyph: "⚔️" },
  { id: "slot-machine", name: "Slot Machine", color: "#B91C1C", glyph: "🎰" },
  { id: "yahtzee", name: "Yahtzee", color: "#4F46E5", glyph: "🎲" },
  { id: "pig", name: "Pig", color: "#DB2777", glyph: "🐷" },
  { id: "word-scramble", name: "Word Scramble", color: "#0D9488", glyph: "🔡" },
  { id: "wordle", name: "Wordle", color: "#16A34A", glyph: "🟩" },
  { id: "typing-test", name: "Typing Test", color: "#475569", glyph: "⌨️" },
  { id: "boggle", name: "Boggle", color: "#CA8A04", glyph: "🔠" },
  { id: "tron", name: "Tron", color: "#06B6D4", glyph: "🏍️" },
  { id: "helicopter", name: "Helicopter", color: "#0EA5E9", glyph: "🚁" },
  { id: "car-dodge", name: "Car Dodge", color: "#F59E0B", glyph: "🚗" },
  { id: "missile-command", name: "Missile Command", color: "#DC2626", glyph: "🚀" },
  { id: "lunar-lander", name: "Lunar Lander", color: "#334155", glyph: "🌙" },
  { id: "match-3", name: "Match 3", color: "#DB2777", glyph: "💎" },
  { id: "centipede", name: "Centipede", color: "#65A30D", glyph: "🐛" },
  { id: "monopoly-deal", name: "Monopoly Deal", color: "#16A34A", glyph: "🏠" },
  { id: "spider-solitaire", name: "Spider Solitaire", color: "#047857", glyph: "🕷️" },
  { id: "freecell", name: "FreeCell", color: "#0D9488", glyph: "🆓" },
  { id: "crazy-eights", name: "Crazy Eights", color: "#DC2626", glyph: "8️⃣" },
  { id: "go-fish", name: "Go Fish", color: "#0EA5E9", glyph: "🐟" },
  { id: "baccarat", name: "Baccarat", color: "#7C3AED", glyph: "💰" },
  { id: "old-maid", name: "Old Maid", color: "#BE185D", glyph: "👵" },
  { id: "snap", name: "Snap", color: "#F59E0B", glyph: "👏" },
  { id: "mancala", name: "Mancala", color: "#B45309", glyph: "🫘" },
  { id: "battleship", name: "Battleship", color: "#1E40AF", glyph: "🚢" },
  { id: "nine-mens-morris", name: "Nine Men's Morris", color: "#6D28D9", glyph: "🔵" },
  { id: "dominoes", name: "Dominoes", color: "#1F2937", glyph: "⬛" },
  { id: "nonogram", name: "Nonogram", color: "#2563EB", glyph: "🖼️" },
  { id: "flow-connect", name: "Flow Connect", color: "#DB2777", glyph: "🔗" },
  { id: "columns", name: "Columns", color: "#7C3AED", glyph: "💠" },
  { id: "flood-it", name: "Flood It", color: "#EA580C", glyph: "🌊" },
  { id: "pyramid-solitaire", name: "Pyramid Solitaire", color: "#B45309", glyph: "🔺" },
  { id: "tri-peaks", name: "TriPeaks", color: "#0E7490", glyph: "⛰️" },
  { id: "golf-solitaire", name: "Golf Solitaire", color: "#15803D", glyph: "⛳" },
  { id: "peg-solitaire", name: "Peg Solitaire", color: "#92400E", glyph: "🕳️" },
  { id: "chess", name: "Chess", color: "#1F2937", glyph: "♟️" },
  { id: "chinese-checkers", name: "Chinese Checkers", color: "#7C3AED", glyph: "✴️" },
  { id: "ludo", name: "Ludo", color: "#DC2626", glyph: "🎲" },
  { id: "ultimate-tic-tac-toe", name: "Ultimate Tic-Tac-Toe", color: "#EC407A", glyph: "#️⃣" },
  { id: "galaxian", name: "Galaxian", color: "#4338CA", glyph: "🛸" },
  { id: "pinball", name: "Pinball", color: "#DB2777", glyph: "🟣" },
  { id: "stacker", name: "Stacker", color: "#F59E0B", glyph: "🟧" },
  { id: "knife-hit", name: "Knife Hit", color: "#B91C1C", glyph: "🔪" },
  { id: "color-switch", name: "Color Switch", color: "#06B6D4", glyph: "🌈" },
  { id: "unblock", name: "Unblock", color: "#DC2626", glyph: "🚙" },
  { id: "pipes", name: "Pipes", color: "#0891B2", glyph: "🚰" },
  { id: "mahjong-solitaire", name: "Mahjong Solitaire", color: "#166534", glyph: "🀄" },
  { id: "kakuro", name: "Kakuro", color: "#2563EB", glyph: "➕" },
  { id: "color-lines", name: "Color Lines", color: "#DB2777", glyph: "🟠" },
  { id: "helix-jump", name: "Helix Jump", color: "#7C3AED", glyph: "🌀" },
  { id: "cryptogram", name: "Cryptogram", color: "#475569", glyph: "🔐" },
  { id: "word-ladder", name: "Word Ladder", color: "#0D9488", glyph: "🪜" },
  { id: "dot-to-dot", name: "Dot to Dot", color: "#F59E0B", glyph: "✏️" },
  { id: "cookie-clicker", name: "Cookie Clicker", color: "#B45309", glyph: "🍪" },
  { id: "tilt-maze", name: "Tilt Maze", color: "#0EA5E9", glyph: "🎱" },
  { id: "heads-up", name: "Heads Up", color: "#7C3AED", glyph: "🤔" },
  { id: "catch-phrase", name: "Catch Phrase", color: "#DC2626", glyph: "💬" },
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
    <style>/* keep content clear of the iPhone notch / camera island (safe-area insets) */
    body{padding-top:env(safe-area-inset-top,0px);padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);}
    </style>
    <script>
    if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/games/games-sw.js').catch(function(){})})}
    // Back-to-all-games pill (top-left) + one-tap install button (bottom-right).
    // Positioned with env(safe-area-inset-*) so they clear the notch/Dynamic Island.
    window.addEventListener('DOMContentLoaded',function(){var a=document.createElement('a');a.href='/games';a.textContent='‹ Games';a.setAttribute('style','position:fixed;left:calc(env(safe-area-inset-left,0px) + 10px);top:calc(env(safe-area-inset-top,0px) + 10px);z-index:2147483646;padding:6px 12px;border-radius:20px;background:rgba(15,23,42,.6);color:#fff;font:600 13px system-ui,sans-serif;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.3);touch-action:manipulation');document.body.appendChild(a);});
    (function(){var dp=null,btn=null;function mk(){btn=document.createElement('button');btn.textContent='⬇ Install';btn.setAttribute('style','position:fixed;right:calc(env(safe-area-inset-right,0px) + 12px);bottom:calc(env(safe-area-inset-bottom,0px) + 12px);z-index:2147483647;padding:10px 16px;border:none;border-radius:24px;background:${g.color};color:#fff;font:600 14px system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.3);cursor:pointer;touch-action:manipulation');btn.onclick=function(){if(!dp)return;dp.prompt();dp.userChoice.finally(function(){dp=null;btn.remove();btn=null;});};document.body.appendChild(btn);}window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();dp=e;if(!btn)mk();});window.addEventListener('appinstalled',function(){if(btn){btn.remove();btn=null;}});})();
    </script>
    <!-- pwa:end -->`;

// Shared offline service worker (network-first → fresh online, cached offline).
// Every game + its assets is precached on install, so the whole /games
// collection works fully offline even for games never opened — while staying
// network-first so a new deploy is picked up while online.
const PRECACHE = [
  ...CONFIG.flatMap((g) => [
    `/games/${g.id}.html`,
    `/games/${g.id}.webmanifest`,
    `/games/icons/${g.id}.svg`,
  ]),
  "/games-app-icon.svg",
  "/games.webmanifest",
];
const SW = `/* grown-workspace games service worker — full offline + installability.
   Precaches every game on install; network-first at runtime so deploys are
   picked up online, with cache fallback offline. Scope: /games/. */
const CACHE = 'grown-games-v2';
const PRECACHE = ${JSON.stringify(PRECACHE)};
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})));
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));
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
      .catch(() => caches.match(req).then((r) => r || caches.match('/games/' + (new URL(req.url).pathname.split('/').pop())))),
  );
});
`;

function injectHead(html, g) {
  // Opt the viewport into the display safe-area so env(safe-area-inset-*) works
  // (needed for the notch / camera-island handling). Idempotent.
  html = html.replace(
    /(<meta\s+name=["']viewport["']\s+content=["'])([^"']*)(["'])/i,
    (m, a, content, c) =>
      /viewport-fit/.test(content) ? m : `${a}${content.replace(/\s+$/, "")}, viewport-fit=cover${c}`,
  );
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
