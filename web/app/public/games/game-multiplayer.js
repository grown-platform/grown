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
  function relAge(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    if (sec < 60) return sec + "s";
    var m = Math.floor(sec / 60); if (m < 60) return m + "m";
    var h = Math.floor(m / 60); if (h < 24) return h + "h";
    return Math.floor(h / 24) + "d";
  }
  function fetchLobby() {
    return fetch("/api/v1/gamerooms/list", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("bad"); return r.json(); })
      .then(function (j) { return (j && j.rooms) || []; });
  }

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

  function connect(code, pass, name, onErr, isHost) {
    var proto = location.protocol === "https:" ? "wss://" : "ws://";
    var url = proto + location.host + "/api/v1/gamerooms/ws?room=" + encodeURIComponent(code) +
      "&password=" + encodeURIComponent(pass) + "&name=" + encodeURIComponent(name) +
      "&game=" + encodeURIComponent(gameName);
    // When we CREATE a room, mark it public + named so it shows up in the lobby.
    // Joining an existing room never needs this (the room already exists).
    if (isHost) url += "&public=1";
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
    icon.setAttribute("aria-label", "Play online");
    // Crisp monochrome "people" glyph (matches the ⏸ menu button's weight),
    // not the blurry color emoji.
    icon.innerHTML = '<svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>';
    // padding:0 + box-sizing keep it a perfect circle even though games set a
    // global `button{padding:...}` rule; flex centers the glyph.
    css(icon, "position:fixed;z-index:2147483646;top:calc(env(safe-area-inset-top,0px) + 10px);right:calc(env(safe-area-inset-right,0px) + 54px);width:40px;height:40px;min-width:0;padding:0;margin:0;box-sizing:border-box;border:none;border-radius:50%;background:rgba(15,23,42,.6);color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);touch-action:manipulation;display:flex;align-items:center;justify-content:center;line-height:0");
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
        connect(code, passC._input.value, nameF._input.value || suggestName(), errEl, true);
      };
      panel.appendChild(createBtn);
      panel.appendChild(copyBtn);

      // ---- Browse open games --------------------------------------------
      var divider = document.createElement("div");
      css(divider, "display:flex;align-items:center;gap:10px;margin:16px 0 8px;font-size:12px;opacity:.6");
      var dl = document.createElement("span"); css(dl, "flex:1;height:1px;background:#243049");
      var dt = document.createElement("span"); dt.textContent = "or join an open game";
      var dr = document.createElement("span"); css(dr, "flex:1;height:1px;background:#243049");
      divider.appendChild(dl); divider.appendChild(dt); divider.appendChild(dr);
      panel.appendChild(divider);

      var head = document.createElement("div");
      css(head, "display:flex;align-items:center;justify-content:space-between;margin-bottom:6px");
      var headT = document.createElement("span"); headT.textContent = "Open " + gameName + " games"; css(headT, "font-size:12px;opacity:.7");
      var refreshBtn = document.createElement("button"); refreshBtn.textContent = "↻ Refresh";
      css(refreshBtn, "padding:4px 10px;border:1px solid #243049;border-radius:8px;background:transparent;color:#e8eefc;cursor:pointer;font:600 12px system-ui");
      head.appendChild(headT); head.appendChild(refreshBtn);
      panel.appendChild(head);

      var list = document.createElement("div");
      css(list, "max-height:180px;overflow:auto;margin-bottom:6px");
      panel.appendChild(list);

      function joinRow(room) {
        var name = nameF._input.value || suggestName();
        if (room.has_password) {
          // Reveal a password field inline, then join on confirm.
          list.innerHTML = "";
          var note = document.createElement("div"); note.textContent = "This game is locked. Enter the password:"; css(note, "font-size:13px;opacity:.8;margin-bottom:6px");
          list.appendChild(note);
          var passL = field("Room password"); passL._input.type = "password";
          list.appendChild(passL);
          var go = button("Join game", true);
          go.onclick = function () { setStatus("Connecting…"); connect(room.code, passL._input.value, name, errEl); };
          list.appendChild(go);
          passL._input.focus();
        } else {
          setStatus("Connecting…");
          connect(room.code, "", name, errEl);
        }
      }

      function renderRooms(rooms) {
        list.innerHTML = "";
        var open = (rooms || []).filter(function (r) {
          return r && r.game && String(r.game).toLowerCase() === String(gameName).toLowerCase() &&
            (r.players >= 1) && (r.players < 2);
        });
        if (!open.length) {
          var empty = document.createElement("div");
          empty.textContent = "No open games right now — create one!";
          css(empty, "font-size:13px;opacity:.6;padding:8px 2px");
          list.appendChild(empty);
          return;
        }
        open.forEach(function (room) {
          var row = document.createElement("button");
          css(row, "width:100%;display:flex;align-items:center;gap:8px;text-align:left;padding:10px 12px;margin-bottom:6px;border:1px solid #243049;border-radius:10px;background:#0b1220;color:#e8eefc;cursor:pointer;font:inherit");
          var nm = document.createElement("span"); nm.textContent = room.game || gameName; css(nm, "flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis");
          var pl = document.createElement("span"); pl.textContent = "👤 " + (room.players || 1); css(pl, "font-size:13px;opacity:.85");
          var lock = document.createElement("span"); lock.textContent = room.has_password ? "🔒" : ""; css(lock, "font-size:13px");
          var age = document.createElement("span"); age.textContent = relAge(room.age_sec); css(age, "font-size:12px;opacity:.55;min-width:24px;text-align:right");
          row.appendChild(nm); row.appendChild(pl); if (room.has_password) row.appendChild(lock); row.appendChild(age);
          row.onclick = function () { joinRow(room); };
          list.appendChild(row);
        });
      }

      function loadRooms() {
        list.innerHTML = "";
        var loading = document.createElement("div"); loading.textContent = "Loading open games…"; css(loading, "font-size:13px;opacity:.6;padding:8px 2px");
        list.appendChild(loading);
        fetchLobby().then(renderRooms).catch(function () {
          list.innerHTML = "";
          var err = document.createElement("div"); err.textContent = "Couldn't load open games."; css(err, "font-size:13px;opacity:.6;padding:8px 2px");
          list.appendChild(err);
        });
      }
      refreshBtn.onclick = loadRooms;
      loadRooms();
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
