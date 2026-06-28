# Reading Flash Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a button-timed reading flash-card game for young children, with per-child profiles, a phonics-ladder curriculum, and "sound it out" / "say the word" audio buttons.

**Architecture:** One self-contained static HTML file in `web/app/public/games/`, vanilla JS + inline CSS + `localStorage`, matching every existing game (e.g. `typing-test.html`, `math-quiz.html`). It is built up function-by-function inside a single `<script>`. Audio uses the browser's built-in `window.speechSynthesis` (feature-detected; degrades gracefully). The game is registered in the React games grid (`index.tsx`) and the offline service worker (`games-sw.js`).

**Tech Stack:** HTML5, vanilla ES2017 JS, CSS (inline `<style>`), Web Speech `speechSynthesis`, `localStorage`. No build step for the game file itself; the surrounding app is Vite + React + TypeScript + MUI.

## Global Constraints

- The game is a **single self-contained HTML file** — no external scripts, styles, fonts, or network calls. Copy the structural/style conventions of `web/app/public/games/typing-test.html`.
- **No backend, no accounts, no network.** All persistence is `localStorage`, wrapped in try/catch so a throwing/disabled storage never breaks gameplay (see `math-quiz.html`).
- **Offline-first:** the file must work with no network. New files (`.html`, `.webmanifest`, `icon.svg`) must be added to `games-sw.js` `PRECACHE` and the `CACHE` version bumped, or they won't be cached.
- **No voice/speech-recognition** in this version — timing is by parent button tap only. (Voice is explicitly deferred.)
- `localStorage` key is exactly `grown_reading_flash_cards_v1`.
- Game id / file slug is exactly `reading-flash-cards`.
- Mobile-first: a single centered column, large tap targets, `viewport` meta with `maximum-scale=1.0` like the other games.
- These static games have **no unit-test runner**; verification is by loading the file in a real browser (Chrome DevTools Protocol / manual) and exercising flows. Each task therefore ends with explicit browser-verification steps, then a commit.

---

## File Structure

- **Create** `web/app/public/games/reading-flash-cards.html` — the entire game (markup, styles, data, logic).
- **Create** `web/app/public/games/reading-flash-cards.webmanifest` — PWA manifest.
- **Create** `web/app/public/games/icons/reading-flash-cards.svg` — tile icon.
- **Modify** `web/app/src/pages/games/index.tsx` — one `arcade(...)` registration line + Kids/Word category tags.
- **Modify** `web/app/public/games/games-sw.js` — add 3 precache URLs, bump `CACHE` version.

The HTML file's `<script>` is organized into these regions (defined in Task 1, filled later):

- **DATA** — the 6 level definitions, phoneme/keyword maps, tuning constants.
- **STORE** — `loadState`, `saveState`, child CRUD, time recording, nudge math.
- **SPEAK** — `speakWord`, `speakSounds`, voice selection.
- **VIEWS** — `renderPlayers`, `renderLevels`, `renderPlay`, `renderSummary`, and a `show(view)` router.
- **BOOT** — initial render on load.

---

### Task 1: Game shell — markup, styles, data, and storage module

Lays down the complete file scaffold: HTML structure, CSS, the full content DATA, the STORE module, and empty stubs for SPEAK/VIEWS so later tasks just fill function bodies. Deliverable: the file loads in a browser and shows the "Who's playing?" screen wired to real storage (add/select children), proving DATA + STORE work end-to-end.

**Files:**
- Create: `web/app/public/games/reading-flash-cards.html`

**Interfaces (Produced — later tasks rely on these exact names):**
- `STATE` — in-memory object `{ children: Child[], lastChildId: string|null }`.
- `Child` — `{ id: string, name: string, currentLevel: number, levels: Record<string, LevelStat> }`.
- `LevelStat` — `{ reads: number, bestMs: number|null, recentMs: number[] }`.
- `LEVELS: Level[]` where `Level = { n: number, key: string, title: string, cards: Card[] }`, `Card = { text: string, sub?: string, sounds: string[] }`. `LEVELS` is 0-indexed in the array but each has a 1-based `.n`.
- `loadState(): void` (populates `STATE`), `saveState(): void`.
- `addChild(name): Child`, `removeChild(id): void`, `renameChild(id, name): void`, `getChild(id): Child|null`, `setLastChild(id): void`.
- `statFor(child, levelN): LevelStat` — returns (creating if absent) the stat bucket.
- `recordTime(child, levelN, ms): void`, `recordTooHard(child, levelN): void`.
- `LEVEL_TARGET_MS: number[]` (index by `levelN-1`), `MIN_READS_FOR_NUDGE: number`, `RECENT_WINDOW: number`.
- `medianRecent(stat): number|null`, `readQuickly(child, levelN): boolean`, `shouldNudge(child): boolean`.
- `show(view, opts)` router and stubs `renderPlayers/renderLevels/renderPlay/renderSummary`, `speakWord(card)`, `speakSounds(card)`.
- DOM: a single `<div id="app"></div>` that every render function replaces.

- [ ] **Step 1: Create the file with the head, styles, body shell, DATA, STORE, and stubs.**

Create `web/app/public/games/reading-flash-cards.html` with exactly this content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>Reading Flash Cards</title>
<link rel="manifest" href="/games/reading-flash-cards.webmanifest">
<meta name="theme-color" content="#7C3AED">
<style>
  :root{
    --bg:#0f172a; --panel:#1e293b; --panel2:#334155; --text:#f1f5f9;
    --muted:#94a3b8; --accent:#7C3AED; --accent2:#22c55e; --warn:#f59e0b; --border:#334155;
  }
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{max-width:560px;margin:0 auto;padding:16px 14px 28px;min-height:100vh;display:flex;flex-direction:column;}
  header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;}
  h1{font-size:20px;margin:0;font-weight:800;letter-spacing:.3px;}
  .sub{color:var(--muted);font-size:13px;}
  button{font-family:inherit;cursor:pointer;border:0;}
  .btn{background:var(--panel);color:var(--text);border:1px solid var(--border);
    border-radius:14px;padding:14px 16px;font-size:17px;font-weight:600;width:100%;margin:6px 0;}
  .btn.primary{background:var(--accent);border-color:var(--accent);}
  .btn.go{background:var(--accent2);border-color:var(--accent2);font-size:22px;padding:20px;}
  .btn.small{font-size:14px;padding:8px 12px;width:auto;}
  .row{display:flex;gap:8px;align-items:center;}
  .spacer{flex:1;}
  .muted{color:var(--muted);}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:20px;
    padding:28px 18px;text-align:center;margin:10px 0;}
  .word{font-size:64px;font-weight:800;line-height:1.1;word-break:break-word;}
  .word .lc{font-size:38px;color:var(--muted);margin-left:10px;}
  .phrase{font-size:40px;font-weight:800;}
  .timer{font-size:30px;font-variant-numeric:tabular-nums;margin:8px 0;color:var(--warn);}
  .soundbtns{display:flex;gap:10px;justify-content:center;margin:6px 0 4px;}
  .soundbtns .btn{width:auto;font-size:16px;}
  .level-row{display:flex;align-items:center;gap:10px;}
  .level-row .tick{color:var(--accent2);font-weight:800;}
  .here{outline:2px solid var(--accent);}
  .nudge{background:#3b2f10;border:1px solid var(--warn);color:#fde68a;border-radius:12px;padding:10px 12px;margin:8px 0;font-size:14px;}
  .pill{display:inline-block;background:var(--panel2);border-radius:999px;padding:2px 10px;font-size:12px;color:var(--muted);}
  input[type=text]{font-family:inherit;font-size:17px;padding:12px;border-radius:12px;
    border:1px solid var(--border);background:var(--panel);color:var(--text);width:100%;}
  .disabled{opacity:.4;pointer-events:none;}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>📖 Reading Flash Cards</h1>
    <button class="btn small" id="homeBtn" style="display:none">Home</button>
  </header>
  <div id="app"></div>
</div>
<script>
"use strict";
/* ============================ DATA ============================ */
// Spoken phoneme hints — hand-tuned spellings so TTS approximates each sound.
// (English isn't phonetically regular; these are deliberately rough. See spec.)
var PHONEME = {a:"ah",b:"buh",c:"kuh",d:"duh",e:"eh",f:"ff",g:"guh",h:"huh",
  i:"ih",j:"juh",k:"kuh",l:"ll",m:"mm",n:"nn",o:"aw",p:"puh",q:"kwuh",r:"rr",
  s:"sss",t:"tuh",u:"uh",v:"vv",w:"wuh",x:"ks",y:"yuh",z:"zz"};
// Keyword per letter for the letter-sounds level ("ah, as in apple").
var KEYWORD = {a:"apple",b:"ball",c:"cat",d:"dog",e:"egg",f:"fish",g:"goat",
  h:"hat",i:"igloo",j:"jam",k:"kite",l:"lion",m:"moon",n:"nest",o:"octopus",
  p:"pig",q:"queen",r:"rain",s:"sun",t:"top",u:"umbrella",v:"van",w:"web",
  x:"fox",y:"yo-yo",z:"zip"};
var ALPHA = "abcdefghijklmnopqrstuvwxyz".split("");
// Builds a sounds[] blend for a simple word from its letters, then the whole word.
function blend(word){
  var arr = word.toLowerCase().split("").map(function(ch){return PHONEME[ch]||ch;});
  arr.push(word); return arr;
}
var CVC = ["cat","dog","sun","hat","pig","bed","cup","box","fan","log",
  "mom","dad","red","run","big","sit","top","bug","net","jam"];
var SIGHT = ["the","and","is","you","to","see","we","go","my","he",
  "she","it","in","on","up","can","look","like","a","I"];
var BIG = ["apple","happy","water","tiger","table","yellow",
  "rabbit","pencil","garden","sunny","basket","monkey"];
var PHRASES = ["I see a cat","the dog can run","we go up","I like you",
  "look at me","the sun is hot","I can see","my red hat","a big dog","we can go"];

var LEVELS = [
  { n:1, key:"letters", title:"Letters",
    cards: ALPHA.map(function(c){
      return { text:c.toUpperCase(), sub:c, sounds:[c.toUpperCase()] }; }) },
  { n:2, key:"sounds", title:"Letter Sounds",
    cards: ALPHA.map(function(c){
      return { text:c.toUpperCase(), sub:c,
        sounds:[ PHONEME[c]+", as in "+KEYWORD[c] ] }; }) },
  { n:3, key:"cvc", title:"CVC Words",
    cards: CVC.map(function(w){ return { text:w, sounds:blend(w) }; }) },
  { n:4, key:"sight", title:"Sight Words",
    cards: SIGHT.map(function(w){ return { text:w, sounds:[w] }; }) },
  { n:5, key:"big", title:"Big Words",
    cards: BIG.map(function(w){ return { text:w, sounds:blend(w) }; }) },
  { n:6, key:"phrases", title:"Short Phrases",
    cards: PHRASES.map(function(p){
      return { text:p, sounds:p.split(" ") }; }) },
];

// Tuning constants (all adjustable).
var STORAGE_KEY = "grown_reading_flash_cards_v1";
var LEVEL_TARGET_MS = [1500,2000,2500,2500,3500,6000]; // index = levelN-1
var MIN_READS_FOR_NUDGE = 8;
var RECENT_WINDOW = 8;

/* ============================ STORE ============================ */
var STATE = { children:[], lastChildId:null };

function loadState(){
  try{
    var raw = localStorage.getItem(STORAGE_KEY);
    if(raw){ var p = JSON.parse(raw);
      if(p && Array.isArray(p.children)){
        STATE.children = p.children; STATE.lastChildId = p.lastChildId||null; } }
  }catch(e){ /* storage unavailable — run session-only */ }
}
function saveState(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); }catch(e){}
}
function uid(){ return "c"+Date.now().toString(36)+Math.floor(Math.random()*1e6).toString(36); }
function getChild(id){ for(var i=0;i<STATE.children.length;i++){ if(STATE.children[i].id===id) return STATE.children[i]; } return null; }
function addChild(name){
  var c = { id:uid(), name:name, currentLevel:1, levels:{} };
  STATE.children.push(c); STATE.lastChildId = c.id; saveState(); return c;
}
function removeChild(id){
  STATE.children = STATE.children.filter(function(c){return c.id!==id;});
  if(STATE.lastChildId===id) STATE.lastChildId = STATE.children[0] ? STATE.children[0].id : null;
  saveState();
}
function renameChild(id,name){ var c=getChild(id); if(c){ c.name=name; saveState(); } }
function setLastChild(id){ STATE.lastChildId=id; saveState(); }
function statFor(child, levelN){
  var k=String(levelN);
  if(!child.levels[k]) child.levels[k]={ reads:0, bestMs:null, recentMs:[] };
  return child.levels[k];
}
function recordTime(child, levelN, ms){
  var s=statFor(child,levelN); s.reads++;
  s.bestMs = (s.bestMs===null)? ms : Math.min(s.bestMs, ms);
  s.recentMs.push(ms); if(s.recentMs.length>RECENT_WINDOW) s.recentMs.shift();
  saveState();
}
function recordTooHard(child, levelN){
  // A "too hard" tap pushes a sentinel large time so the median rises and the
  // nudge softens. Stored as the level target so it weighs against readiness.
  var s=statFor(child,levelN);
  s.recentMs.push(LEVEL_TARGET_MS[levelN-1]*3);
  if(s.recentMs.length>RECENT_WINDOW) s.recentMs.shift();
  saveState();
}
function medianRecent(stat){
  if(!stat || !stat.recentMs.length) return null;
  var a = stat.recentMs.slice().sort(function(x,y){return x-y;});
  var m = Math.floor(a.length/2);
  return a.length%2 ? a[m] : Math.round((a[m-1]+a[m])/2);
}
function readQuickly(child, levelN){
  var s = child.levels[String(levelN)];
  if(!s || s.reads < MIN_READS_FOR_NUDGE) return false;
  var med = medianRecent(s);
  return med!==null && med < LEVEL_TARGET_MS[levelN-1];
}
function shouldNudge(child){
  return child.currentLevel < LEVELS.length && readQuickly(child, child.currentLevel);
}

/* ============================ SPEAK (filled in Task 5) ============================ */
function speakWord(card){ /* Task 5 */ }
function speakSounds(card){ /* Task 5 */ }

/* ============================ VIEWS ============================ */
var APP = document.getElementById("app");
var HOME = document.getElementById("homeBtn");
function esc(s){ return String(s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

// Router: view is one of "players","levels","play","summary".
function show(view, opts){
  opts = opts || {};
  HOME.style.display = (view==="players") ? "none" : "";
  if(view==="players") renderPlayers(opts);
  else if(view==="levels") renderLevels(opts);
  else if(view==="play") renderPlay(opts);
  else if(view==="summary") renderSummary(opts);
}
HOME.addEventListener("click", function(){ show("players"); });

function renderPlayers(opts){
  var h = "";
  h += '<p class="sub">Who is reading today?</p>';
  if(!STATE.children.length){
    h += '<p class="muted">No readers yet. Add your first child below.</p>';
  }
  STATE.children.forEach(function(c){
    h += '<div class="row" style="margin:6px 0">'
      +  '<button class="btn primary" data-go="'+c.id+'" style="flex:1;text-align:left">'
      +    esc(c.name)+' <span class="pill">Level '+c.currentLevel+'</span></button>'
      +  '<button class="btn small" data-rename="'+c.id+'">Rename</button>'
      +  '<button class="btn small" data-del="'+c.id+'">✕</button>'
      +  '</div>';
  });
  h += '<div class="card"><div class="row">'
    +  '<input type="text" id="newName" placeholder="Add a child\'s name" maxlength="20">'
    +  '<button class="btn primary small" id="addBtn" style="margin-left:8px">Add</button>'
    +  '</div></div>';
  APP.innerHTML = h;
  document.getElementById("addBtn").onclick = function(){
    var el=document.getElementById("newName"); var name=(el.value||"").trim();
    if(!name){ el.focus(); return; }
    var c=addChild(name); show("levels",{childId:c.id});
  };
  APP.querySelectorAll("[data-go]").forEach(function(b){
    b.onclick=function(){ setLastChild(b.getAttribute("data-go")); show("levels",{childId:b.getAttribute("data-go")}); }; });
  APP.querySelectorAll("[data-rename]").forEach(function(b){
    b.onclick=function(){ var id=b.getAttribute("data-rename"); var c=getChild(id);
      var nm=prompt("New name:", c?c.name:""); if(nm && nm.trim()){ renameChild(id,nm.trim()); show("players"); } }; });
  APP.querySelectorAll("[data-del]").forEach(function(b){
    b.onclick=function(){ var id=b.getAttribute("data-del"); var c=getChild(id);
      if(confirm("Remove "+(c?c.name:"this child")+"?")){ removeChild(id); show("players"); } }; });
}

// Filled in later tasks:
function renderLevels(opts){ APP.innerHTML = '<p class="muted">Level select — Task 3.</p>'; }
function renderPlay(opts){ APP.innerHTML = '<p class="muted">Play — Task 4.</p>'; }
function renderSummary(opts){ APP.innerHTML = '<p class="muted">Summary — Task 6.</p>'; }

/* ============================ BOOT ============================ */
loadState();
show("players");
</script>
</body>
</html>
```

- [ ] **Step 2: Verify the shell loads and storage works.**

Run: `cd web/app && python3 -m http.server 8099 --directory public` (or any static server), then open `http://localhost:8099/games/reading-flash-cards.html`.

Expected:
- "Who is reading today?" with "No readers yet."
- Type a name, click **Add** → it navigates to the "Level select — Task 3." stub (proves `addChild` + router work).
- Reload the page → the child you added still appears (proves `loadState`/`saveState`).
- Add a second child, **Rename** one, **✕** delete one → list updates and persists across reload.

- [ ] **Step 3: Commit.**

```bash
git add web/app/public/games/reading-flash-cards.html
git commit -m "feat(games): reading flash cards shell — data, storage, players screen"
```

---

### Task 2: Level select screen

Implements `renderLevels` — the 6 levels with the child's current spot, a checkmark when they've read a level quickly, "ready for the next level?" nudge, a Play button, and a back-to-players action.

**Files:**
- Modify: `web/app/public/games/reading-flash-cards.html` (replace the `renderLevels` stub)

**Interfaces:**
- Consumes: `getChild`, `LEVELS`, `readQuickly`, `shouldNudge`, `statFor`, `medianRecent`, `show`.
- Produces: navigates to `show("play",{childId, levelN})`.

- [ ] **Step 1: Replace the `renderLevels` stub with:**

```javascript
function renderLevels(opts){
  var child = getChild(opts.childId);
  if(!child){ show("players"); return; }
  var h = '<p class="sub">'+esc(child.name)+' · pick a level</p>';
  if(shouldNudge(child)){
    var next = child.currentLevel+1;
    h += '<div class="nudge">⭐ '+esc(child.name)+' is reading Level '+child.currentLevel
      +  ' quickly — ready to try Level '+next+' ('+LEVELS[next-1].title+')?</div>';
  }
  LEVELS.forEach(function(L){
    var here = (L.n===child.currentLevel);
    var tick = readQuickly(child, L.n) ? '<span class="tick">✓</span> ' : '';
    var s = child.levels[String(L.n)];
    var med = medianRecent(s);
    var meta = s ? (' · '+s.reads+' read'+(s.reads===1?'':'s')
      + (med!==null ? ', ~'+(med/1000).toFixed(1)+'s' : '')) : '';
    h += '<button class="btn level-row'+(here?' here':'')+'" data-level="'+L.n+'">'
      +  '<span>'+tick+'Level '+L.n+': '+esc(L.title)+'</span>'
      +  '<span class="spacer"></span>'
      +  '<span class="muted" style="font-size:13px">'+(here?'here':'')+esc(meta)+'</span>'
      +  '</button>';
  });
  APP.innerHTML = h;
  APP.querySelectorAll("[data-level]").forEach(function(b){
    b.onclick = function(){
      var n = parseInt(b.getAttribute("data-level"),10);
      child.currentLevel = n; saveState();
      show("play",{childId:child.id, levelN:n});
    };
  });
}
```

- [ ] **Step 2: Verify in browser.**

Reload the game, select/add a child. Expected:
- 6 levels listed, Level 1 outlined as "here".
- Tapping a level navigates to the "Play — Task 4." stub and (after reload + reselect) that level now shows "here" (proves `currentLevel` persisted).
- No nudge yet (no reads recorded). No checkmarks yet.

- [ ] **Step 3: Commit.**

```bash
git add web/app/public/games/reading-flash-cards.html
git commit -m "feat(games): reading flash cards level-select screen"
```

---

### Task 3: Play screen — cards, timer, and recording

Implements `renderPlay`: shuffles the level's cards, shows one at a time with a running timer, and handles **Got it!** (record time, next), **Skip** (no record, next), **Too hard** (record sentinel, next). When the deck is exhausted it goes to the summary. Sound buttons are present but call the SPEAK stubs (wired in Task 4).

**Files:**
- Modify: `web/app/public/games/reading-flash-cards.html` (replace the `renderPlay` stub)

**Interfaces:**
- Consumes: `getChild`, `LEVELS`, `recordTime`, `recordTooHard`, `speakWord`, `speakSounds`, `show`.
- Produces: a per-session `SESSION` object `{ childId, levelN, results: {text, ms}[], fastest: {text, ms}|null }` passed to `show("summary",{session})`.

- [ ] **Step 1: Replace the `renderPlay` stub with:**

```javascript
function shuffle(a){ a=a.slice();
  for(var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i];a[i]=a[j];a[j]=t; }
  return a; }

function renderPlay(opts){
  var child = getChild(opts.childId);
  var L = LEVELS[opts.levelN-1];
  if(!child || !L){ show("players"); return; }
  var deck = shuffle(L.cards);
  var idx = 0;
  var startedAt = 0;
  var timerId = null;
  var locked = false; // debounce Got it!
  var session = { childId:child.id, levelN:L.n, results:[], fastest:null };

  function card(){ return deck[idx]; }
  function fmt(ms){ return (ms/1000).toFixed(1)+'s'; }

  function paint(){
    var c = card();
    var isPhrase = (L.key==="phrases");
    var wordHtml = isPhrase
      ? '<div class="phrase">'+esc(c.text)+'</div>'
      : '<div class="word">'+esc(c.text)
        + (c.sub && c.sub!==c.text.toLowerCase() ? '' : '')
        + (L.key==="letters"||L.key==="sounds" ? '<span class="lc">'+esc(c.sub)+'</span>' : '')
        + '</div>';
    APP.innerHTML =
      '<div class="sub">'+esc(child.name)+' · Level '+L.n+': '+esc(L.title)
        +' · card '+(idx+1)+'/'+deck.length+'</div>'
      + '<div class="card">'+ wordHtml
        + '<div class="soundbtns">'
        +   '<button class="btn" id="bWord">🔊 Word</button>'
        +   '<button class="btn" id="bSounds">🔉 Sounds</button>'
        + '</div>'
        + '<div class="timer" id="timer">0.0s</div>'
      + '</div>'
      + '<button class="btn go" id="bGot">✓ Got it!</button>'
      + '<div class="row" style="margin-top:6px">'
      +   '<button class="btn small" id="bSkip">Skip ›</button>'
      +   '<span class="spacer"></span>'
      +   '<button class="btn small" id="bHard">Too hard</button>'
      + '</div>';
    locked = false;
    startedAt = Date.now();
    if(timerId) clearInterval(timerId);
    timerId = setInterval(function(){
      var el=document.getElementById("timer"); if(el) el.textContent = fmt(Date.now()-startedAt);
    }, 100);
    document.getElementById("bWord").onclick = function(){ speakWord(c); };
    document.getElementById("bSounds").onclick = function(){ speakSounds(c); };
    document.getElementById("bGot").onclick = onGot;
    document.getElementById("bSkip").onclick = function(){ advance(); };
    document.getElementById("bHard").onclick = function(){ recordTooHard(child, L.n); advance(); };
  }

  function onGot(){
    if(locked) return; locked = true;
    var ms = Date.now()-startedAt;
    recordTime(child, L.n, ms);
    session.results.push({ text:card().text, ms:ms });
    if(!session.fastest || ms < session.fastest.ms) session.fastest = { text:card().text, ms:ms };
    advance();
  }

  function advance(){
    idx++;
    if(idx >= deck.length){ if(timerId) clearInterval(timerId); show("summary",{session:session}); return; }
    paint();
  }

  paint();
}
```

- [ ] **Step 2: Verify in browser.**

Select a child → Level 1 → Play. Expected:
- A letter card with "🔊 Word" / "🔉 Sounds" (no-ops for now), a timer counting up, a big green **Got it!**, plus **Skip** and **Too hard**.
- **Got it!** advances and the card counter increments; rapid double-tap records only once (counter advances by one).
- After the last card it shows the "Summary — Task 6." stub.
- Return to Level select: Level 1 now shows a read count and ~time. After ≥8 fast Got-its, a ✓ and the nudge appear.

- [ ] **Step 3: Commit.**

```bash
git add web/app/public/games/reading-flash-cards.html
git commit -m "feat(games): reading flash cards play screen — timer + recording"
```

---

### Task 4: Sound engine (speechSynthesis)

Implements `speakWord` and `speakSounds` and feature-detection. **🔊 Word** speaks the whole text slowly. **🔉 Sounds** speaks each `sounds[]` hint with gaps, then the whole word. Disables the buttons if `speechSynthesis` is absent.

**Files:**
- Modify: `web/app/public/games/reading-flash-cards.html` (replace the SPEAK stubs; add a small init in BOOT)

**Interfaces:**
- Consumes: `Card.text`, `Card.sounds`.
- Produces: `speakWord(card)`, `speakSounds(card)`, `TTS_OK` (boolean).

- [ ] **Step 1: Replace the SPEAK stub block with:**

```javascript
/* ============================ SPEAK ============================ */
var TTS_OK = (typeof window !== "undefined" && "speechSynthesis" in window
  && typeof window.SpeechSynthesisUtterance !== "undefined");
var VOICE = null;
function pickVoice(){
  if(!TTS_OK) return;
  var vs = window.speechSynthesis.getVoices() || [];
  // Prefer an English, local voice; fall back to any English; else default.
  VOICE = vs.filter(function(v){return /^en(-|_|$)/i.test(v.lang) && v.localService;})[0]
       || vs.filter(function(v){return /^en(-|_|$)/i.test(v.lang);})[0]
       || null;
}
function utter(text, rate){
  var u = new SpeechSynthesisUtterance(text);
  u.rate = rate; u.pitch = 1.05; if(VOICE) u.voice = VOICE;
  return u;
}
function speakWord(card){
  if(!TTS_OK) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter(card.text, 0.85));
}
function speakSounds(card){
  if(!TTS_OK) return;
  window.speechSynthesis.cancel();
  var parts = (card.sounds && card.sounds.length) ? card.sounds.slice() : [card.text];
  // Speak each hint, then the whole word at the end (skip if last part already is it).
  if(parts[parts.length-1] !== card.text) parts.push(card.text);
  var i = 0;
  function next(){
    if(i >= parts.length) return;
    var isWhole = (i === parts.length-1);
    var u = utter(parts[i], isWhole ? 0.85 : 0.7);
    u.onend = function(){ i++; setTimeout(next, isWhole ? 0 : 220); };
    window.speechSynthesis.speak(u);
  }
  next();
}
```

- [ ] **Step 2: In the BOOT region, initialize voices before `show("players")`. Replace the BOOT block with:**

```javascript
/* ============================ BOOT ============================ */
loadState();
if(TTS_OK){
  pickVoice();
  if(window.speechSynthesis.onvoiceschanged !== undefined){
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }
}
show("players");
```

- [ ] **Step 3: Disable sound buttons when TTS is unavailable. In `renderPlay`'s `paint()`, after the two `document.getElementById("bWord"/"bSounds").onclick` lines, add:**

```javascript
    if(!TTS_OK){
      document.getElementById("bWord").classList.add("disabled");
      document.getElementById("bSounds").classList.add("disabled");
    }
```

- [ ] **Step 4: Verify in browser.**

Play any level. Expected:
- **🔊 Word** speaks the whole word/letter.
- **🔉 Sounds** on a Level 3 CVC word (e.g. "cat") says the blend ("kuh… ah… tuh…") then "cat". On Level 2 it says e.g. "ah, as in apple".
- Tapping a sound button mid-playback restarts cleanly (no overlap).
- (Optional) In a browser with TTS disabled, the two buttons render greyed/disabled and gameplay still works.

- [ ] **Step 5: Commit.**

```bash
git add web/app/public/games/reading-flash-cards.html
git commit -m "feat(games): reading flash cards sound-out engine (speechSynthesis)"
```

---

### Task 5: Session summary screen

Implements `renderSummary`: cards read this session, the fastest card, the list of times, the level-up nudge if earned, and buttons to play the level again or return to levels/players.

**Files:**
- Modify: `web/app/public/games/reading-flash-cards.html` (replace the `renderSummary` stub)

**Interfaces:**
- Consumes: `getChild`, `LEVELS`, `shouldNudge`, the `session` object from Task 3, `show`.

- [ ] **Step 1: Replace the `renderSummary` stub with:**

```javascript
function renderSummary(opts){
  var sess = opts.session;
  if(!sess){ show("players"); return; }
  var child = getChild(sess.childId);
  if(!child){ show("players"); return; }
  var L = LEVELS[sess.levelN-1];
  var n = sess.results.length;
  var h = '<p class="sub">'+esc(child.name)+' · Level '+L.n+': '+esc(L.title)+'</p>';
  h += '<div class="card">';
  h += '<div class="word" style="font-size:40px">'+n+' read 🎉</div>';
  if(sess.fastest){
    h += '<p>Fastest: <strong>'+esc(sess.fastest.text)+'</strong> in '
      +  (sess.fastest.ms/1000).toFixed(1)+'s</p>';
  } else {
    h += '<p class="muted">No cards recorded this round.</p>';
  }
  h += '</div>';
  if(sess.results.length){
    h += '<div class="card" style="text-align:left">';
    sess.results.forEach(function(r){
      h += '<div class="row"><span>'+esc(r.text)+'</span><span class="spacer"></span>'
        +  '<span class="muted">'+(r.ms/1000).toFixed(1)+'s</span></div>';
    });
    h += '</div>';
  }
  if(shouldNudge(child)){
    var next = child.currentLevel+1;
    h += '<div class="nudge">⭐ Ready for Level '+next+' ('+LEVELS[next-1].title+')?</div>';
  }
  h += '<button class="btn primary" id="again">Play this level again</button>';
  h += '<button class="btn" id="toLevels">Choose a level</button>';
  APP.innerHTML = h;
  document.getElementById("again").onclick = function(){ show("play",{childId:child.id, levelN:L.n}); };
  document.getElementById("toLevels").onclick = function(){ show("levels",{childId:child.id}); };
}
```

- [ ] **Step 2: Verify in browser.**

Play a full level (use **Skip** to reach the end fast). Expected:
- Summary shows the count, fastest card, the per-card time list.
- **Play this level again** restarts the deck; **Choose a level** returns to level select.
- After enough fast reads, the nudge appears here and on the level screen.

- [ ] **Step 3: Commit.**

```bash
git add web/app/public/games/reading-flash-cards.html
git commit -m "feat(games): reading flash cards session summary + level-up nudge"
```

---

### Task 6: Register the game (grid + manifest + icon)

Adds the webmanifest, the SVG icon, and the `index.tsx` registration so the game appears in the grid under **Kids** and **Word** and launches.

**Files:**
- Create: `web/app/public/games/reading-flash-cards.webmanifest`
- Create: `web/app/public/games/icons/reading-flash-cards.svg`
- Modify: `web/app/src/pages/games/index.tsx`

- [ ] **Step 1: Create `web/app/public/games/reading-flash-cards.webmanifest`:**

```json
{
  "name": "Reading Flash Cards",
  "short_name": "Reading Cards",
  "description": "Reading Flash Cards — practice letters, words, and phrases. Play online or off.",
  "start_url": "/games/reading-flash-cards.html",
  "scope": "/games/reading-flash-cards.html",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#0f172a",
  "theme_color": "#7C3AED",
  "icons": [
    {
      "src": "/games/icons/reading-flash-cards.svg",
      "sizes": "192x192",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    },
    {
      "src": "/games/icons/reading-flash-cards.svg",
      "sizes": "512x512",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    }
  ]
}
```

- [ ] **Step 2: Create `web/app/public/games/icons/reading-flash-cards.svg`:**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#7C3AED"/>
  <text x="50%" y="52%" dominant-baseline="central" text-anchor="middle" font-size="300">📖</text>
</svg>
```

- [ ] **Step 3: Register in the grid.** In `web/app/src/pages/games/index.tsx`, add this line to the `GAMES` array near the other word/kids games (e.g. right after the `arcade("word-ladder", ...)` line at ~L217):

```typescript
  arcade("reading-flash-cards", "Reading Flash Cards", "#7C3AED", "MenuBook"),
```

- [ ] **Step 4: Add category tags.** In the same file, add `reading-flash-cards` to the **Kids** array inside `CATEGORY_IDS` (the `Kids:` line, ~L262), appended at the end:

```typescript
  Kids: ["memory-game", "whack-a-mole", "simon", "rock-paper-scissors", "coloring", "math-quiz", "balloon-pop", "fruit-catch", "dot-to-dot", "cookie-clicker", "guess-the-number", "reading-flash-cards"],
```

Then, so it also surfaces under **Word**, add an `EXTRA_CATS` entry (the `EXTRA_CATS` object, ~L247-251). Add this property:

```typescript
  "reading-flash-cards": ["Kids", "Word"],
```

(`CATEGORY_OF` will map it to Kids as primary; `EXTRA_CATS` makes the Word filter also match it via the `matchesCat` logic at ~L617.)

- [ ] **Step 5: Verify the grid build + appearance.**

Run: `cd web/app && npx tsc --noEmit -p tsconfig.json` (or the project's typecheck). Expected: no new type errors from the edit.

Then run the web app dev server (`cd web/app && npm run dev`), open the games page. Expected:
- "Reading Flash Cards" tile appears with the 📖 icon under **All**, **Kids**, and **Word** filters.
- Clicking it launches `/games/reading-flash-cards.html`.

- [ ] **Step 6: Commit.**

```bash
git add web/app/public/games/reading-flash-cards.webmanifest web/app/public/games/icons/reading-flash-cards.svg web/app/src/pages/games/index.tsx
git commit -m "feat(games): register Reading Flash Cards in grid (Kids + Word)"
```

---

### Task 7: Offline service-worker precache

Adds the three new files to the games service worker precache and bumps the cache version so deployed clients pick them up and they work offline.

**Files:**
- Modify: `web/app/public/games/games-sw.js`

- [ ] **Step 1: Bump the cache version.** In `web/app/public/games/games-sw.js` line 4, change:

```javascript
const CACHE = 'grown-games-v9';
```

to:

```javascript
const CACHE = 'grown-games-v10';
```

- [ ] **Step 2: Add the three URLs to `PRECACHE`.** In the `PRECACHE` array (line 5), insert these three entries just before the trailing `"/games-app-icon.svg","/games.webmanifest"`:

```javascript
"/games/reading-flash-cards.html","/games/reading-flash-cards.webmanifest","/games/icons/reading-flash-cards.svg",
```

- [ ] **Step 3: Verify.**

Run: `node -e "new Function(require('fs').readFileSync('web/app/public/games/games-sw.js','utf8').replace(/self\.|caches\.|addEventListener/g,'void '))" 2>/dev/null; grep -c "reading-flash-cards" web/app/public/games/games-sw.js`

Expected: prints `3` (the three new URLs present). Confirm `grown-games-v10` is set: `grep -n "grown-games-v10" web/app/public/games/games-sw.js` prints the version line.

(Optional, in browser DevTools → Application → Service Workers: after reload the new SW activates and the three files appear in the `grown-games-v10` cache; toggle offline and confirm the game still loads.)

- [ ] **Step 4: Commit.**

```bash
git add web/app/public/games/games-sw.js
git commit -m "feat(games): precache Reading Flash Cards for offline (cache v10)"
```

---

### Task 8: Full end-to-end verification

A final pass exercising the whole game in a real browser, per the spec's Testing section. No new code unless a defect is found.

**Files:** none (verification only).

- [ ] **Step 1: Run the full flow in a browser (dev server or static server).** Confirm each:
  - Create child "Mia"; add second child "Noah"; switch between them; rename one; remove one — all persist across reload.
  - Level select shows all 6 levels; current level outlined; free selection of any level.
  - Play Level 1: timer runs; **Got it!** records a time and advances; **Skip** records nothing; **Too hard** advances and softens readiness; double-tap **Got it!** records once.
  - **🔊 Word** speaks the whole word; **🔉 Sounds** blends hints then says the word (try Levels 2, 3, 6).
  - Drive ≥8 quick **Got it!** taps on Level 1 → ✓ + level-up nudge appear on both the summary and level-select screens.
  - Reload mid-progress → child profiles, current level, read counts, and times all persist.
  - Games grid: tile shows under **All / Kids / Word** and launches.

- [ ] **Step 2: Final commit (if any fixes were made during verification).**

```bash
git add -A
git commit -m "fix(games): reading flash cards verification fixes"
```

(If no fixes were needed, skip this commit.)

---

## Self-Review

**Spec coverage:**
- Button-only timing → Task 3 (`Got it!`/timer). ✓
- Phonics ladder, 6 levels with editable arrays → Task 1 DATA. ✓
- Two sound buttons (sounds + word) → Task 4. ✓
- Multiple named profiles, per-child level + times → Tasks 1 (STORE) + 1 (players UI). ✓
- Parent-controlled, always-selectable levels + nudge → Tasks 2 + 1 (`shouldNudge`). ✓
- Session summary → Task 5. ✓
- localStorage with try/catch, offline, self-contained HTML → Tasks 1 + 7. ✓
- speechSynthesis feature-detected/graceful → Task 4. ✓
- Registration under Kids + Word → Task 6. ✓
- Risks (approximate phonemes) → encoded as hand-tuned `PHONEME`/`KEYWORD` strings in Task 1. ✓

**Placeholder scan:** No "TBD"/"handle edge cases" — every step has concrete code or exact commands. Task 1 intentionally ships labeled stubs (`renderLevels`/`renderPlay`/`renderSummary`/`speakWord`/`speakSounds`) that named later tasks replace; each is explicitly addressed.

**Type/name consistency:** `STATE`, `LEVELS` (`.n`/`.key`/`.title`/`.cards`), `Card.text`/`Card.sub`/`Card.sounds`, `statFor`, `recordTime`, `recordTooHard`, `medianRecent`, `readQuickly`, `shouldNudge`, `show(view,opts)` with `{childId, levelN, session}`, and `session.{childId,levelN,results,fastest}` are used consistently across Tasks 1–5. The `disabled` CSS class (Task 1 styles) is applied in Task 4. Icon name `MenuBook` is a standard MUI icon used by the grid's `iconName` mechanism.
