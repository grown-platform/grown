/* grown-workspace games service worker — full offline + installability.
   Precaches every game on install; network-first at runtime so deploys are
   picked up online, with cache fallback offline. Scope: /games/. */
const CACHE = 'grown-games-v2';
const PRECACHE = ["/games/2048.html","/games/2048.webmanifest","/games/icons/2048.svg","/games/snake.html","/games/snake.webmanifest","/games/icons/snake.svg","/games/minesweeper.html","/games/minesweeper.webmanifest","/games/icons/minesweeper.svg","/games/sudoku.html","/games/sudoku.webmanifest","/games/icons/sudoku.svg","/games/tic-tac-toe.html","/games/tic-tac-toe.webmanifest","/games/icons/tic-tac-toe.svg","/games/connect-four.html","/games/connect-four.webmanifest","/games/icons/connect-four.svg","/games/memory-game.html","/games/memory-game.webmanifest","/games/icons/memory-game.svg","/games/reversi.html","/games/reversi.webmanifest","/games/icons/reversi.svg","/games/mastermind.html","/games/mastermind.webmanifest","/games/icons/mastermind.svg","/games/hangman.html","/games/hangman.webmanifest","/games/icons/hangman.svg","/games/lights-out.html","/games/lights-out.webmanifest","/games/icons/lights-out.svg","/games/sliding-puzzle.html","/games/sliding-puzzle.webmanifest","/games/icons/sliding-puzzle.svg","/games/solitaire.html","/games/solitaire.webmanifest","/games/icons/solitaire.svg","/games/crossword.html","/games/crossword.webmanifest","/games/icons/crossword.svg","/games/tetris.html","/games/tetris.webmanifest","/games/icons/tetris.svg","/games/breakout.html","/games/breakout.webmanifest","/games/icons/breakout.svg","/games/pong.html","/games/pong.webmanifest","/games/icons/pong.svg","/games/flappy.html","/games/flappy.webmanifest","/games/icons/flappy.svg","/games/whack-a-mole.html","/games/whack-a-mole.webmanifest","/games/icons/whack-a-mole.svg","/games/simon.html","/games/simon.webmanifest","/games/icons/simon.svg","/games/bubble-shooter.html","/games/bubble-shooter.webmanifest","/games/icons/bubble-shooter.svg","/games/tower-stack.html","/games/tower-stack.webmanifest","/games/icons/tower-stack.svg","/games-app-icon.svg","/games.webmanifest"];
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
