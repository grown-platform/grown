/*
 * game-multiplayer.js — a drop-in online-multiplayer layer for the arcade games.
 *
 * Adds a multiplayer icon at the top-right; tapping it opens a panel to create a
 * room (get a share link) or join one (auto-detected from ?room=). A nickname is
 * always pre-suggested so nobody has to type. It connects to the game-room relay
 * (/api/v1/gamerooms/ws) and exposes a tiny API so a turn-based game can sync:
 *
 *   GameMP.setup({ gameName: "Tic-Tac-Toe" });
 *   GameMP.onReady((role) => { ... });   // role 0 = host (goes first), 1 = guest
 *   GameMP.onMove((payload) => { ... });  // opponent move
 *   GameMP.onReset(() => { ... });        // opponent reset
 *   GameMP.onPeerLeft(() => { ... });
 *   GameMP.send(payload);                 // send a move to the opponent
 *   GameMP.sendReset();
 *   GameMP.active();  GameMP.role();      // state
 *
 * Framework-free, no dependencies.
 */
(function (global) {
  "use strict";

  var ADJ = ["Swift", "Brave", "Clever", "Lucky", "Mighty", "Sly", "Witty", "Bold", "Cosmic", "Turbo", "Sneaky", "Jolly", "Nimble", "Fuzzy", "Zippy", "Rad"];
  var ANIMAL = ["Otter", "Fox", "Panda", "Falcon", "Tiger", "Koala", "Wolf", "Lynx", "Raven", "Gecko", "Moose", "Heron", "Badger", "Orca", "Yak", "Wombat"];
  function suggestName() {
    function pick(a) { var b = new Uint8Array(1); crypto.getRandomValues(b); return a[b[0] % a.length]; }
    var n = new Uint8Array(1); crypto.getRandomValues(n);
    return pick(ADJ) + " " + pick(ANIMAL) + " " + (10 + (n[0] % 90));
  }
  function randCode() {
    var s = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", out = "", a = new Uint8Array(7);
    crypto.getRandomValues(a);
    for (var i = 0; i < 7; i++) out += s[a[i] % s.length];
    return out;
  }
  function css(el, s) { el.setAttribute("style", s); }

  var ws = null, role = null, ready = false, peers = 0, active = false;
  var cb = { ready: null, move: null, reset: null, left: null };
  var gameName = "Game";

  var GameMP = {
    setup: function (opts) {
      opts = opts || {};
      gameName = opts.gameName || "Game";
      buildUI();
      // Auto-open the join flow when arriving via a share link.
      var room = new URLSearchParams(location.search).get("room");
      if (room) openPanel(room);
    },
    onReady: function (fn) { cb.ready = fn; },
    onMove: function (fn) { cb.move = fn; },
    onReset: function (fn) { cb.reset = fn; },
    onPeerLeft: function (fn) { cb.left = fn; },
    send: function (payload) { sendMsg(Object.assign({ type: "move" }, payload)); },
    sendReset: function () { sendMsg({ type: "reset" }); },
    active: function () { return active; },
    role: function () { return role; },
  };

  function sendMsg(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  function connect(code, pass, name, onErr) {
    var proto = location.protocol === "https:" ? "wss://" : "ws://";
    var url = proto + location.host + "/api/v1/gamerooms/ws?room=" + encodeURIComponent(code) +
      "&password=" + encodeURIComponent(pass) + "&name=" + encodeURIComponent(name);
    ws = new WebSocket(url);
    active = true;
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === "roster") {
        role = (m.peers && m.peers.length <= 1) ? 0 : 1;
        peers = (m.peers || []).length;
        setStatus(role === 0 ? "Waiting for an opponent…" : "Connected — get ready!");
        if (peers >= 2) fireReady();
      } else if (m.type === "join") {
        peers++;
        if (peers >= 2) fireReady();
      } else if (m.type === "leave") {
        peers = Math.max(0, peers - 1);
        setStatus("Opponent left.");
        if (cb.left) cb.left();
      } else if (m.type === "move") {
        if (cb.move) cb.move(m);
      } else if (m.type === "reset") {
        if (cb.reset) cb.reset();
      }
    };
    ws.onerror = function () { onErr && onErr("Connection error."); };
    ws.onclose = function () { if (active && peers < 2) setStatus("Disconnected."); };
  }

  function fireReady() {
    if (ready) return;
    ready = true;
    closePanel();
    setStatus("Online — you are " + (role === 0 ? "Player 1" : "Player 2"));
    if (cb.ready) cb.ready(role);
  }

  // ---- UI ------------------------------------------------------------------
  var icon, scrim, panel, statusEl;

  function setStatus(t) { if (statusEl) statusEl.textContent = t; }

  function buildUI() {
    icon = document.createElement("button");
    icon.title = "Play online";
    icon.innerHTML = "👥";
    css(icon, "position:fixed;z-index:2147483646;top:calc(env(safe-area-inset-top,0px) + 10px);right:calc(env(safe-area-inset-right,0px) + 54px);width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(15,23,42,.6);color:#fff;font-size:19px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);touch-action:manipulation");
    icon.onclick = function () { openPanel(null); };
    (document.body || document.documentElement).appendChild(icon);

    scrim = document.createElement("div");
    css(scrim, "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.55);opacity:0;transition:opacity .18s;pointer-events:none");
    scrim.onclick = closePanel;
    document.body.appendChild(scrim);

    panel = document.createElement("div");
    css(panel, "position:fixed;z-index:2147483647;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);opacity:0;transition:opacity .18s,transform .18s;pointer-events:none;width:min(360px,92vw);background:#0f172a;border:1px solid #243049;border-radius:16px;padding:18px;color:#e8eefc;font:15px/1.5 system-ui,-apple-system,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.6)");
    document.body.appendChild(panel);
  }

  function field(label) {
    var wrap = document.createElement("div"); wrap.style.marginBottom = "10px";
    var l = document.createElement("label"); l.textContent = label; css(l, "display:block;font-size:12px;opacity:.7;margin-bottom:4px");
    var i = document.createElement("input"); css(i, "width:100%;padding:10px 12px;border-radius:10px;border:1px solid #243049;background:#0b1220;color:#e8eefc;font:inherit;box-sizing:border-box");
    wrap.appendChild(l); wrap.appendChild(i); wrap._input = i; return wrap;
  }
  function button(label, primary) {
    var b = document.createElement("button"); b.textContent = label;
    css(b, "width:100%;padding:11px 14px;margin-top:6px;border:0;border-radius:10px;cursor:pointer;font:600 15px system-ui;" + (primary ? "background:#2563eb;color:#fff" : "background:transparent;border:1px solid #243049;color:#e8eefc"));
    return b;
  }

  function openPanel(joinRoom) {
    panel.innerHTML = "";
    var h = document.createElement("h3"); h.textContent = (joinRoom ? "Join online game" : "Play " + gameName + " online"); css(h, "margin:0 0 10px;font-size:18px");
    panel.appendChild(h);

    var nameF = field("Your nickname"); nameF._input.value = suggestName(); nameF._input.maxLength = 40;
    panel.appendChild(nameF);

    statusEl = document.createElement("div"); css(statusEl, "min-height:18px;font-size:13px;opacity:.8;margin:4px 0 8px");
    var errEl = function (t) { statusEl.style.color = "#fb7185"; setStatus(t); };

    if (joinRoom) {
      var passJ = field("Room password (if any)"); passJ._input.type = "password";
      panel.appendChild(passJ);
      panel.appendChild(statusEl);
      var joinBtn = button("Join game", true);
      joinBtn.onclick = function () { setStatus("Connecting…"); connect(joinRoom, passJ._input.value, nameF._input.value || suggestName(), errEl); };
      panel.appendChild(joinBtn);
    } else {
      var passC = field("Room password (optional)"); passC._input.type = "password"; passC._input.placeholder = "optional";
      panel.appendChild(passC);
      var shareBox = document.createElement("div"); css(shareBox, "display:none;font:13px ui-monospace,monospace;word-break:break-all;background:#0b1220;border:1px solid #243049;border-radius:8px;padding:8px;margin:8px 0");
      panel.appendChild(shareBox);
      panel.appendChild(statusEl);
      var createBtn = button("Create game & get link", true);
      var copyBtn = button("Copy link"); copyBtn.style.display = "none";
      createBtn.onclick = function () {
        var code = randCode();
        var link = location.origin + location.pathname + "?room=" + code;
        shareBox.style.display = "block"; shareBox.textContent = link;
        createBtn.style.display = "none"; copyBtn.style.display = "";
        copyBtn.onclick = function () { navigator.clipboard && navigator.clipboard.writeText(link); copyBtn.textContent = "Copied!"; };
        setStatus("Share the link, then wait for a player…");
        connect(code, passC._input.value, nameF._input.value || suggestName(), errEl);
      };
      panel.appendChild(createBtn);
      panel.appendChild(copyBtn);
    }
    var cancel = button("Cancel"); cancel.onclick = closePanel; panel.appendChild(cancel);

    scrim.style.opacity = "1"; scrim.style.pointerEvents = "auto";
    panel.style.opacity = "1"; panel.style.pointerEvents = "auto"; panel.style.transform = "translate(-50%,-50%) scale(1)";
  }

  function closePanel() {
    scrim.style.opacity = "0"; scrim.style.pointerEvents = "none";
    panel.style.opacity = "0"; panel.style.pointerEvents = "none"; panel.style.transform = "translate(-50%,-50%) scale(.96)";
  }

  global.GameMP = GameMP;
})(window);
