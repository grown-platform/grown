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
      '<div class="gpo-zone" aria-hidden="true"></div>' +
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
    var zoneEl = root.querySelector(".gpo-zone");
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

    // ---- Floating 8-way thumb stick -----------------------------------------
    // A "floating origin" joystick (like mobile MOBAs): wherever the thumb
    // first lands in the lower-left zone becomes the center, and direction is
    // measured *relative to that point* — so there's no fixed center to fight
    // and no way to stall in a dead zone while running. The visible base hops
    // to the thumb on press and returns home on release. Touches are read in
    // the wide invisible `gpo-zone`, not the small visible ring, so you never
    // have to aim for the circle.
    var TRAVEL = 52; // px the stick rides from the origin at full deflection
    var DEAD = 16; // px dead zone around the origin (neutral)
    var dpadPointer = null;
    var origin = null; // { x, y } screen point of the active touch-down

    // Control scheme: "joystick" (floating origin) or "dpad" (fixed origin).
    // Persisted so the player's choice sticks between sessions.
    var STORE_KEY = "gpo_control_mode";
    var controlMode = "joystick";
    try {
      var savedMode = localStorage.getItem(STORE_KEY);
      if (savedMode === "dpad" || savedMode === "joystick") controlMode = savedMode;
    } catch (e) { /* storage unavailable */ }

    function placeBase(x, y) {
      dpadEl.classList.add("gpo-float");
      dpadEl.style.left = x + "px";
      dpadEl.style.top = y + "px";
    }
    function homeBase() {
      dpadEl.classList.remove("gpo-float");
      dpadEl.style.left = "";
      dpadEl.style.top = "";
      resetStick();
    }
    function dpadDir(clientX, clientY) {
      var dx = clientX - origin.x;
      var dy = clientY - origin.y;
      var dist = Math.hypot(dx, dy);
      // Ride the visual stick toward the thumb, clamped to TRAVEL.
      var k = dist > TRAVEL ? TRAVEL / dist : 1;
      stickEl.style.transform = "translate(" + dx * k + "px," + dy * k + "px)";
      if (dist < DEAD) return { up: false, down: false, left: false, right: false };
      var deg = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 = right, 90 = down
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
    function dpadRelease() {
      applyDir({ up: false, down: false, left: false, right: false });
      dpadEl.classList.remove("gpo-press");
      homeBase();
    }
    // Begin a movement gesture. The joystick floats its origin to the thumb;
    // the d-pad keeps a fixed origin at the base's home centre (the visible
    // ring stays put and just brightens).
    function startInput(x, y) {
      if (controlMode === "dpad") {
        homeBase();
        var r = dpadEl.getBoundingClientRect();
        origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        dpadEl.classList.add("gpo-press");
      } else {
        origin = { x: x, y: y };
        placeBase(x, y);
      }
      applyDir(dpadDir(x, y));
    }

    // --- Touch input (phones) ---
    // Driven from *touch* events on purpose: a touch sequence stays bound to
    // the element it started on for its whole life, so the finger can roam
    // anywhere on screen without setPointerCapture, and `preventDefault()`
    // stops the browser reinterpreting the drag as a scroll/zoom. Touch-derived
    // *pointer* events, by contrast, fire `pointercancel` whenever the UA's
    // gesture recognizer takes over (common during multi-touch — moving and
    // firing at once), which would release every direction key mid-run.
    var dpadTouchId = null;
    zoneEl.addEventListener("touchstart", function (e) {
      if (dpadTouchId !== null) return; // already tracking a finger
      var t = e.changedTouches[0];
      dpadTouchId = t.identifier;
      e.preventDefault();
      startInput(t.clientX, t.clientY);
    }, { passive: false });
    zoneEl.addEventListener("touchmove", function (e) {
      if (dpadTouchId === null) return;
      for (var i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === dpadTouchId) {
          e.preventDefault();
          applyDir(dpadDir(e.touches[i].clientX, e.touches[i].clientY));
          return;
        }
      }
    }, { passive: false });
    var dpadTouchEnd = function (e) {
      if (dpadTouchId === null) return;
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === dpadTouchId) {
          dpadTouchId = null;
          dpadRelease();
          return;
        }
      }
    };
    zoneEl.addEventListener("touchend", dpadTouchEnd);
    zoneEl.addEventListener("touchcancel", dpadTouchEnd);

    // --- Mouse input (desktop testing only) ---
    // Touch is handled above; ignore touch-derived pointer events here so the
    // two paths never double-fire.
    zoneEl.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "touch") return;
      e.preventDefault();
      zoneEl.setPointerCapture && zoneEl.setPointerCapture(e.pointerId);
      dpadPointer = e.pointerId;
      startInput(e.clientX, e.clientY);
    });
    zoneEl.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch" || dpadPointer !== e.pointerId) return;
      applyDir(dpadDir(e.clientX, e.clientY));
    });
    var dpadUp = function (e) {
      if (e.pointerType === "touch" || dpadPointer !== e.pointerId) return;
      dpadPointer = null;
      dpadRelease();
    };
    zoneEl.addEventListener("pointerup", dpadUp);
    zoneEl.addEventListener("pointercancel", dpadUp);

    // ---- Control-mode switcher (top bar) ------------------------------------
    // A small menu, sitting to the left of Pause, that switches between the
    // floating Joystick and a fixed D-Pad. The button's icon reflects the
    // active mode and the choice is remembered across sessions.
    var MODE_ICON = { joystick: "🕹️", dpad: "✚" };
    var MODE_LABEL = { joystick: "Joystick", dpad: "D-Pad" };

    var modeBtn = document.createElement("button");
    modeBtn.className = "gpo-btn gpo-mode";
    modeBtn.setAttribute("aria-label", "Control mode");
    modeBtn.textContent = MODE_ICON[controlMode];
    topEl.insertBefore(modeBtn, topEl.firstChild); // leftmost → left of Pause

    var menu = document.createElement("div");
    menu.className = "gpo-menu";
    ["joystick", "dpad"].forEach(function (m) {
      var item = document.createElement("button");
      item.setAttribute("data-m", m);
      item.textContent = MODE_ICON[m] + "  " + MODE_LABEL[m];
      if (m === controlMode) item.classList.add("gpo-active");
      menu.appendChild(item);
    });
    root.appendChild(menu);

    function setMode(m) {
      if (m !== "joystick" && m !== "dpad") return;
      controlMode = m;
      modeBtn.textContent = MODE_ICON[m];
      try { localStorage.setItem(STORE_KEY, m); } catch (e) { /* ignore */ }
      var items = menu.querySelectorAll("button");
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle("gpo-active", items[i].getAttribute("data-m") === m);
      }
      // Don't leave a direction held while switching schemes.
      applyDir({ up: false, down: false, left: false, right: false });
      dpadEl.classList.remove("gpo-press");
      homeBase();
    }

    modeBtn.addEventListener("click", function (e) {
      e.preventDefault();
      menu.style.display = menu.style.display === "flex" ? "none" : "flex";
    });
    menu.addEventListener("click", function (e) {
      var t = e.target;
      while (t && t !== menu && !(t.getAttribute && t.getAttribute("data-m"))) t = t.parentNode;
      if (t && t.getAttribute && t.getAttribute("data-m")) {
        e.preventDefault();
        setMode(t.getAttribute("data-m"));
        menu.style.display = "none";
      }
    });
    // Tap anywhere else closes the menu.
    document.addEventListener("pointerdown", function (e) {
      if (menu.style.display !== "flex") return;
      if (menu.contains(e.target) || e.target === modeBtn) return;
      menu.style.display = "none";
    }, true);

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
    // Invisible activation area: the entire left half of the screen. Touch
    // anywhere here to drive movement — the joystick floats to your thumb, the
    // d-pad reads direction from its fixed home centre.
    ".gpo-zone{position:absolute;left:0;top:0;width:50%;height:100%;touch-action:none;background:transparent;}" +
    // Visible base is a hint only; the zone handles all input (pointer-events:none).
    ".gpo-dpad{position:absolute;left:calc(env(safe-area-inset-left,0px) + 18px);bottom:calc(env(safe-area-inset-bottom,0px) + 22px);" +
    "width:148px;height:148px;border-radius:50%;background:rgba(20,24,38,.32);border:1px solid rgba(255,255,255,.18);" +
    "pointer-events:none;opacity:.55;touch-action:none;}" +
    // While a thumb is down, the base hops to the touch point and brightens.
    ".gpo-dpad.gpo-float{left:0;top:0;bottom:auto;transform:translate(-50%,-50%);opacity:1;}" +
    // In fixed d-pad mode the base stays home but brightens while pressed.
    ".gpo-dpad.gpo-press{opacity:1;}" +
    // Control-mode switcher button + its little pop-up menu.
    ".gpo-mode{font-size:19px;}" +
    ".gpo-menu{position:absolute;right:calc(env(safe-area-inset-right,0px) + 14px);top:calc(env(safe-area-inset-top,0px) + 60px);" +
    "display:none;flex-direction:column;gap:4px;padding:6px;border-radius:12px;min-width:158px;z-index:2147483600;" +
    "background:rgba(16,20,32,.94);border:1px solid rgba(255,255,255,.16);box-shadow:0 8px 24px rgba(0,0,0,.5);}" +
    ".gpo-menu button{display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;border:0;border-radius:8px;" +
    "background:transparent;color:#e6ecff;font:600 15px system-ui,sans-serif;text-align:left;cursor:pointer;}" +
    ".gpo-menu button.gpo-active{background:rgba(90,130,255,.32);}" +
    ".gpo-menu button:active{background:rgba(90,130,255,.55);}" +
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
