/*
 * gamepad-overlay.js — a reusable on-screen touch gamepad for keyboard-driven
 * web games (e.g. Emscripten/SDL ports). It renders an 8-way thumb d-pad and
 * action buttons over the game, and synthesizes real KeyboardEvents (keydown/
 * keyup) on a target element so the game receives them as ordinary key input.
 *
 * Framework-free, no dependencies. Multi-touch aware (move + fire at once).
 *
 *   GamepadOverlay.mount({
 *     target: window,                     // where key events are dispatched
 *     show: 'touch',                      // 'touch' | 'always' | 'never'
 *     dpad: { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight' },
 *     buttons: [
 *       { id:'fire',  label:'A', code:'Space',       side:'right' },
 *       { id:'jump',  label:'B', code:'ControlLeft', side:'right' },
 *       { id:'pause', label:'≡', code:'Escape',      side:'top'   },
 *     ],
 *   });
 */
(function (global) {
  "use strict";

  // Map a KeyboardEvent.code → { key, keyCode } for legacy compatibility.
  // SDL/Emscripten reads `.code` first, but we also set key/keyCode/which so
  // SDL2-style and key-name consumers work too.
  var KEYS = {
    ArrowUp: { key: "ArrowUp", kc: 38 },
    ArrowDown: { key: "ArrowDown", kc: 40 },
    ArrowLeft: { key: "ArrowLeft", kc: 37 },
    ArrowRight: { key: "ArrowRight", kc: 39 },
    Space: { key: " ", kc: 32 },
    Enter: { key: "Enter", kc: 13 },
    Escape: { key: "Escape", kc: 27 },
    ControlLeft: { key: "Control", kc: 17 },
    ShiftLeft: { key: "Shift", kc: 16 },
    AltLeft: { key: "Alt", kc: 18 },
    Tab: { key: "Tab", kc: 9 },
    KeyZ: { key: "z", kc: 90 },
    KeyX: { key: "x", kc: 88 },
    KeyC: { key: "c", kc: 67 },
    KeyA: { key: "a", kc: 65 },
    KeyS: { key: "s", kc: 83 },
  };

  function makeKeyEvent(type, code) {
    var info = KEYS[code] || { key: code, kc: 0 };
    var ev = new KeyboardEvent(type, {
      code: code,
      key: info.key,
      bubbles: true,
      cancelable: true,
      view: global,
    });
    // keyCode/which are legacy read-only; force them so SDL2-era handlers work.
    try {
      Object.defineProperty(ev, "keyCode", { get: function () { return info.kc; } });
      Object.defineProperty(ev, "which", { get: function () { return info.kc; } });
    } catch (e) { /* ignore */ }
    return ev;
  }

  function GamepadOverlay() {}

  GamepadOverlay.mount = function (opts) {
    opts = opts || {};
    var target = opts.target || global;
    var show = opts.show || "touch";
    var dpadKeys = opts.dpad || { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
    var buttons = opts.buttons || [];

    var isTouch = ("ontouchstart" in global) || (navigator.maxTouchPoints > 0);
    if (show === "never" || (show === "touch" && !isTouch)) return null;

    // Track which key codes are currently held, so we only fire transitions.
    var held = Object.create(null);
    function setKey(code, down) {
      if (!code) return;
      var was = !!held[code];
      if (down && !was) {
        held[code] = true;
        target.dispatchEvent(makeKeyEvent("keydown", code));
      } else if (!down && was) {
        held[code] = false;
        target.dispatchEvent(makeKeyEvent("keyup", code));
      }
    }
    function releaseAll() {
      for (var c in held) if (held[c]) setKey(c, false);
    }

    // ---- DOM scaffold -------------------------------------------------------
    var root = document.createElement("div");
    root.className = "gpo-root";
    root.innerHTML =
      '<div class="gpo-dpad" aria-hidden="true">' +
      '<div class="gpo-stick"></div>' +
      '<div class="gpo-cross"><span class="gpo-c gpo-u">▲</span><span class="gpo-c gpo-d">▼</span><span class="gpo-c gpo-l">◀</span><span class="gpo-c gpo-r">▶</span></div>' +
      "</div>" +
      '<div class="gpo-btns"></div>' +
      '<div class="gpo-top"></div>';

    var style = document.createElement("style");
    style.textContent = GPO_CSS;
    document.head.appendChild(style);
    document.body.appendChild(root);

    var dpadEl = root.querySelector(".gpo-dpad");
    var stickEl = root.querySelector(".gpo-stick");
    var btnsEl = root.querySelector(".gpo-btns");
    var topEl = root.querySelector(".gpo-top");

    // ---- Action buttons -----------------------------------------------------
    var btnByPointer = {}; // pointerId → button code (for press/release)
    buttons.forEach(function (b) {
      var el = document.createElement("button");
      el.className = "gpo-btn";
      el.textContent = b.label || "";
      el.setAttribute("aria-label", b.id || b.code);
      (b.side === "top" ? topEl : btnsEl).appendChild(el);
      el.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        el.setPointerCapture && el.setPointerCapture(e.pointerId);
        el.classList.add("gpo-on");
        btnByPointer[e.pointerId] = b.code;
        setKey(b.code, true);
      });
      var up = function (e) {
        if (btnByPointer[e.pointerId] === undefined) return;
        el.classList.remove("gpo-on");
        setKey(b.code, false);
        delete btnByPointer[e.pointerId];
      };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("pointerleave", up);
    });

    // ---- 8-way thumb d-pad --------------------------------------------------
    // The touch position within the pad maps to a direction; a small dead zone
    // in the center releases all directions. Diagonals press two keys.
    var dpadPointer = null;
    function dpadDir(clientX, clientY) {
      var r = dpadEl.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dx = clientX - cx;
      var dy = clientY - cy;
      var dist = Math.hypot(dx, dy);
      var dead = r.width * 0.16;
      // Move the visual stick.
      var max = r.width * 0.3;
      var sx = Math.max(-max, Math.min(max, dx));
      var sy = Math.max(-max, Math.min(max, dy));
      stickEl.style.transform = "translate(" + sx + "px," + sy + "px)";
      if (dist < dead) return { up: false, down: false, left: false, right: false };
      var ang = Math.atan2(dy, dx); // -PI..PI, 0 = right, PI/2 = down
      var deg = (ang * 180) / Math.PI;
      // 8 sectors of 45°, each centered on a cardinal/diagonal.
      var up = deg < -22.5 && deg > -157.5;
      var down = deg > 22.5 && deg < 157.5;
      var right = deg > -67.5 && deg < 67.5;
      var left = deg > 112.5 || deg < -112.5;
      return { up: up, down: down, left: left, right: right };
    }
    function applyDir(d) {
      setKey(dpadKeys.up, d.up);
      setKey(dpadKeys.down, d.down);
      setKey(dpadKeys.left, d.left);
      setKey(dpadKeys.right, d.right);
    }
    function resetStick() {
      stickEl.style.transform = "translate(0,0)";
    }
    dpadEl.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      dpadEl.setPointerCapture && dpadEl.setPointerCapture(e.pointerId);
      dpadPointer = e.pointerId;
      applyDir(dpadDir(e.clientX, e.clientY));
    });
    dpadEl.addEventListener("pointermove", function (e) {
      if (dpadPointer !== e.pointerId) return;
      applyDir(dpadDir(e.clientX, e.clientY));
    });
    var dpadUp = function (e) {
      if (dpadPointer !== e.pointerId) return;
      dpadPointer = null;
      applyDir({ up: false, down: false, left: false, right: false });
      resetStick();
    };
    dpadEl.addEventListener("pointerup", dpadUp);
    dpadEl.addEventListener("pointercancel", dpadUp);

    // Release everything if the page is hidden / loses focus.
    global.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) releaseAll();
    });

    return {
      destroy: function () {
        releaseAll();
        root.remove();
        style.remove();
      },
      setVisible: function (v) {
        root.style.display = v ? "" : "none";
      },
    };
  };

  // ---- styles (kept in JS so the module is one drop-in file) ----------------
  var GPO_CSS =
    ".gpo-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;" +
    "font:600 16px system-ui,sans-serif;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}" +
    ".gpo-root>*{pointer-events:auto;}" +
    ".gpo-dpad{position:absolute;left:calc(env(safe-area-inset-left,0px) + 18px);bottom:calc(env(safe-area-inset-bottom,0px) + 22px);" +
    "width:148px;height:148px;border-radius:50%;background:rgba(20,24,38,.32);border:1px solid rgba(255,255,255,.18);touch-action:none;}" +
    ".gpo-stick{position:absolute;left:50%;top:50%;width:62px;height:62px;margin:-31px 0 0 -31px;border-radius:50%;" +
    "background:rgba(230,236,255,.55);border:1px solid rgba(255,255,255,.5);transition:transform .04s;}" +
    ".gpo-cross{position:absolute;inset:0;color:rgba(255,255,255,.5);}" +
    ".gpo-c{position:absolute;font-size:13px;}" +
    ".gpo-u{left:50%;top:6px;transform:translateX(-50%);}" +
    ".gpo-d{left:50%;bottom:6px;transform:translateX(-50%);}" +
    ".gpo-l{left:7px;top:50%;transform:translateY(-50%);}" +
    ".gpo-r{right:7px;top:50%;transform:translateY(-50%);}" +
    ".gpo-btns{position:absolute;right:calc(env(safe-area-inset-right,0px) + 18px);bottom:calc(env(safe-area-inset-bottom,0px) + 30px);" +
    "display:flex;flex-direction:row-reverse;align-items:center;gap:14px;}" +
    ".gpo-top{position:absolute;right:calc(env(safe-area-inset-right,0px) + 14px);top:calc(env(safe-area-inset-top,0px) + 10px);display:flex;gap:10px;}" +
    ".gpo-btn{width:66px;height:66px;border-radius:50%;border:1px solid rgba(255,255,255,.3);color:#fff;" +
    "background:rgba(40,46,68,.5);font:700 20px system-ui,sans-serif;touch-action:none;cursor:pointer;}" +
    ".gpo-top .gpo-btn{width:42px;height:42px;font-size:15px;border-radius:14px;background:rgba(20,24,38,.45);}" +
    ".gpo-btn.gpo-on{background:rgba(90,130,255,.7);transform:scale(.94);}";

  global.GamepadOverlay = GamepadOverlay;
})(window);
