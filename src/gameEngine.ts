import { buildUniversalDesignSkills } from "./designSkills";
import {
  detectGameDesignIntent,
  isLightSetting,
  serializeRuntimeTheme,
  type GameDesignIntent,
} from "./gameDesign";

export const NOVA_GAME_ENGINE_VERSION = "0.3.0 (Design Intent)";
export const NOVA_GAME_ENGINE_NAME = "Nova Game Engine";

export type GameOrientation = "portrait" | "landscape" | "auto";

/** تشخیص جهت بازی از روی توصیف کاربر — عمودی/پورتریت یا افقی/لنداسکیپ. */
export function detectGameOrientation(description: string): GameOrientation {
  const d = String(description ?? "").toLowerCase();
  if (/(عمودی|پورتریت|پورت|راست.?قد|vertical|portrait|9:16|9\/16|صفحه.?گوشی|موبایل.?عمودی)/.test(d)) return "portrait";
  if (/(افقی|لنداسکیپ|لندسکیپ|landscape|16:9|16\/9|عریض|desktop|pc|دسکتاپ|لپ)/.test(d)) return "landscape";
  return "auto";
}

const NOVA_GE_RUNTIME = String.raw`
(function (global) {
  "use strict";
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const hit = (a, b) => a.x < b.x + (b.w || b.width || 0) && a.x + (a.w || a.width || 0) > b.x && a.y < b.y + (b.h || b.height || 0) && a.y + (a.h || a.height || 0) > b.y;
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

  // ── Themed audio ────────────────────────────────────────────────────────
  // This used to be four hardcoded chiptune blips (jump/hit/coin/laser), so a
  // horror game's damage sound was bit-identical to an arcade shooter's. Now a
  // tone spec per event is modulated by the theme's audio character: the same
  // game.sound("hit") is a filtered sub-bass thud in a horror game, a crunchy
  // detuned saw in an industrial one and a bright square in a retro arcade one.
  let audioCtx = null;

  const TONES = {
    jump:      { wave: "sine",     from: 150, to: 600,  dur: 0.15, gain: 0.30, slide: "exp" },
    hit:       { wave: "sawtooth", from: 120, to: 30,   dur: 0.25, gain: 0.40, slide: "lin" },
    coin:      { wave: "sine",     from: 587, to: 880,  dur: 0.25, gain: 0.25, slide: "step" },
    laser:     { wave: "triangle", from: 800, to: 100,  dur: 0.12, gain: 0.30, slide: "exp" },
    select:    { wave: "square",   from: 420, to: 620,  dur: 0.07, gain: 0.18, slide: "step" },
    step:      { wave: "triangle", from: 90,  to: 70,   dur: 0.08, gain: 0.16, slide: "lin" },
    thud:      { wave: "sine",     from: 70,  to: 40,   dur: 0.35, gain: 0.45, slide: "exp" },
    alarm:     { wave: "square",   from: 660, to: 440,  dur: 0.45, gain: 0.28, slide: "step" },
    whoosh:    { wave: "sawtooth", from: 300, to: 900,  dur: 0.22, gain: 0.14, slide: "exp" },
    heartbeat: { wave: "sine",     from: 60,  to: 45,   dur: 0.20, gain: 0.50, slide: "exp" },
    win:       { wave: "triangle", from: 523, to: 1046, dur: 0.45, gain: 0.30, slide: "step" },
    lose:      { wave: "sawtooth", from: 320, to: 80,   dur: 0.60, gain: 0.32, slide: "exp" }
  };

  // Generated code invents its own event names; map the common ones instead of
  // silently playing nothing (the old code just fell through four if-branches).
  const TONE_ALIAS = {
    up: "jump", flap: "jump", bounce: "jump",
    explosion: "hit", damage: "hit", hurt: "hit", hurt2: "hit", break: "hit",
    score: "coin", pickup: "coin", collect: "coin", point: "coin", match: "coin",
    shoot: "laser", fire: "laser", shot: "laser",
    click: "select", tap: "select", menu: "select", move: "select", place: "select",
    footstep: "step", walk: "step",
    land: "thud", crash: "thud", drop: "thud", impact: "thud",
    warning: "alarm", danger: "alarm", spotted: "alarm",
    dash: "whoosh", swing: "whoosh", slide: "whoosh",
    pulse: "heartbeat", beat: "heartbeat",
    success: "win", victory: "win", levelup: "win", solved: "win",
    fail: "lose", gameover: "lose", death: "lose", defeat: "lose"
  };

  const CHARACTERS = {
    chiptune:   { wave: null,       pitch: 1.00, dur: 1.00, gain: 1.00, cut: 0,    detune: 0 },
    sub:        { wave: "sine",     pitch: 0.45, dur: 1.90, gain: 1.05, cut: 420,  detune: -14 },
    industrial: { wave: "sawtooth", pitch: 0.80, dur: 1.25, gain: 0.95, cut: 1400, detune: 24 },
    soft:       { wave: "sine",     pitch: 1.00, dur: 1.15, gain: 0.62, cut: 2200, detune: 0 },
    orchestral: { wave: "triangle", pitch: 0.75, dur: 1.60, gain: 0.90, cut: 3000, detune: 7 },
    lofi:       { wave: "triangle", pitch: 0.90, dur: 1.30, gain: 0.75, cut: 1100, detune: 16 }
  };

  function rampTo(param, slide, target, now, dur) {
    if (slide === "exp") param.exponentialRampToValueAtTime(target, now + dur);
    else if (slide === "lin") param.linearRampToValueAtTime(target, now + dur);
    else param.setValueAtTime(target, now + dur * 0.35);
  }

  function playBeep(type, character) {
    try {
      const key = String(type || "").toLowerCase();
      const spec = TONES[key] || TONES[TONE_ALIAS[key]] || null;
      if (!spec) return;
      const ch = CHARACTERS[String(character || "chiptune")] || CHARACTERS.chiptune;
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();

      const now = audioCtx.currentTime;
      const dur = Math.max(0.03, spec.dur * ch.dur);
      const from = Math.max(20, spec.from * ch.pitch);
      const to = Math.max(20, spec.to * ch.pitch);

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(Math.min(0.6, spec.gain * ch.gain), now);
      gain.gain.linearRampToValueAtTime(0.0001, now + dur);

      // The lowpass is what makes "sub" sound muffled and dreadful rather than
      // merely lower — without it every character was the same timbre.
      let tail = gain;
      if (ch.cut > 0 && typeof audioCtx.createBiquadFilter === "function") {
        const filter = audioCtx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(ch.cut, now);
        gain.connect(filter);
        tail = filter;
      }
      tail.connect(audioCtx.destination);

      const osc = audioCtx.createOscillator();
      osc.type = ch.wave || spec.wave;
      osc.frequency.setValueAtTime(from, now);
      rampTo(osc.frequency, spec.slide, to, now, dur);
      osc.connect(gain);
      osc.start(now); osc.stop(now + dur);

      if (ch.detune !== 0) {
        const osc2 = audioCtx.createOscillator();
        osc2.type = osc.type;
        osc2.detune.setValueAtTime(ch.detune, now);
        osc2.frequency.setValueAtTime(from, now);
        rampTo(osc2.frequency, spec.slide, to, now, dur);
        osc2.connect(gain);
        osc2.start(now); osc2.stop(now + dur);
      }
    } catch (e) {}
  }

  // Neutral defaults for code that boots NovaGE outside the generated shell.
  // The shell always injects window.NOVA_THEME, so in practice the design
  // intent wins; this only keeps a bare init() from throwing.
  const THEME_FALLBACK = {
    canvas: "#0e1116", ink: "#f5f7fa", muted: "#93a0b4", primary: "#4f8cff",
    accent: "#ffc857", danger: "#ff5c5c", shapeA: "#4f8cff", shapeB: "#ffc857",
    particle: "#ffffff", font: "ui-sans-serif, system-ui, sans-serif",
    audio: "chiptune", density: 2,
    light: "top-left", depth: "layered", lighting: "flat", camera: "fixed", ui: "corners"
  };

  /* ── Colour helpers ────────────────────────────────────────────────────────
     Shared by the depth primitives. Parsing is tolerant: #rgb, #rrggbb and
     rgb()/rgba() all work, and anything unrecognised degrades to mid grey
     rather than throwing inside a render loop. */
  const COLOR_CACHE = Object.create(null);
  function parseColor(input) {
    const key = String(input == null ? "" : input);
    const hit = COLOR_CACHE[key];
    if (hit) return hit;
    let out = [128, 128, 128];
    const c = key.trim();
    if (c.charAt(0) === "#") {
      const hex = c.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        out = [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
      } else if (hex.length >= 6) {
        out = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
      }
    } else {
      const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
      if (m) out = [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
    }
    if (out.some(function (n) { return !isFinite(n); })) out = [128, 128, 128];
    // Bounded: a game can only reference so many distinct colours, but a
    // procedurally-generated colour per frame must not grow this forever.
    if (Object.keys(COLOR_CACHE).length < 512) COLOR_CACHE[key] = out;
    return out;
  }
  function shadeColor(color, amount) {
    const rgb = parseColor(color);
    const t = Math.max(-1, Math.min(1, Number(amount) || 0));
    const mix = t >= 0 ? 255 : 0;
    const k = Math.abs(t);
    return "rgb(" + Math.round(rgb[0] + (mix - rgb[0]) * k) + ","
      + Math.round(rgb[1] + (mix - rgb[1]) * k) + ","
      + Math.round(rgb[2] + (mix - rgb[2]) * k) + ")";
  }
  function fadeColor(color, alpha) {
    const rgb = parseColor(color);
    const a = alpha == null ? 1 : Math.max(0, Math.min(1, Number(alpha) || 0));
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a + ")";
  }

  // The single live game instance. Generated code (or a hot reload) can call
  // NovaGE.init() more than once; without tearing the previous instance down its
  // listeners stayed attached and its rAF loop kept running against a dead
  // canvas, so input went to the wrong game and each call leaked a full set.
  let activeGame = null;

  function init(options) {
    if (activeGame && typeof activeGame.destroy === "function") {
      try { activeGame.destroy(); } catch (e) {}
      activeGame = null;
    }
    const canvas = document.getElementById("nova-canvas");
    if (!canvas) throw new Error("Nova canvas missing");
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D unavailable");

    // ── Theme ────────────────────────────────────────────────────────────
    // Every drawing default used to be a hardcoded neon literal, so any
    // uncoloured draw call pulled the same purple/cyan arcade look into every
    // game regardless of genre. Defaults now come from the design intent, which
    // the shell injects as window.NOVA_THEME, and generated code can read the
    // whole set through game.palette.
    const themeSrc = (options && options.theme) || global.NOVA_THEME || {};
    const palette = {};
    for (const fk in THEME_FALLBACK) palette[fk] = THEME_FALLBACK[fk];
    for (const tk in themeSrc) { if (themeSrc[tk]) palette[tk] = themeSrc[tk]; }
    const audioCharacter = String(palette.audio || "chiptune");
    const burstDensity = Math.max(1, Math.min(4, Number(palette.density) || 2));
    // One light direction for the whole game, so every box face and every cast
    // shadow agrees. The shell derives it from the design intent's lighting.
    const lightDir = (function () {
      const raw = String(palette.light || "top-left");
      if (raw === "top-right") return [-1, -1];
      if (raw === "top") return [0, -1];
      if (raw === "left") return [1, 0];
      return [1, -1];
    })();

    // ── Adaptive orientation ─────────────────────────────────────────────
    // landscape: 16:9 wide playfield · portrait: 9:16 tall playfield ·
    // auto: follows the device's current orientation and reacts to rotation.
    // Only three values are meaningful. Anything else (a typo, or a value the
    // model invented) previously became the live orientation string, so
    // game.view.orientation reported e.g. "sideways" and every
    // an orientation === "portrait" branch silently took the landscape path.
    const rawOrientation = String((options && options.orientation) || "auto").toLowerCase();
    const requestedOrientation = (rawOrientation === "portrait" || rawOrientation === "landscape")
      ? rawOrientation
      : "auto";
    const isPortraitNow = () => window.innerHeight > window.innerWidth;
    let orientation = requestedOrientation === "auto"
      ? (isPortraitNow() ? "portrait" : "landscape")
      : requestedOrientation;
    let width = Math.max(240, Number(options && options.width) || (orientation === "portrait" ? 540 : 960));
    let height = Math.max(240, Number(options && options.height) || (orientation === "portrait" ? 960 : 540));
    // If the caller supplied only one dimension, derive the other from the aspect.
    if (options && Number(options.width) && !Number(options.height)) {
      height = Math.round(width * (orientation === "portrait" ? 16 / 9 : 9 / 16));
    } else if (options && Number(options.height) && !Number(options.width)) {
      width = Math.round(height * (orientation === "portrait" ? 9 / 16 : 16 / 9));
    }

    const scenes = new Map();
    const keys = Object.create(null);
    const pressed = new Set();
    const pointer = {
      x: width / 2,
      y: height / 2,
      down: false,
      tapped: false,
      get pressed() { return this.down; },
      get justDown() { return this.tapped; }
    };

    let particles = [];
    let current = null;
    let currentName = "";
    let raf = 0;
    let last = 0;
    let running = false;
    let resizeTimer = 0;

    function applyOrientationCss() {
      try {
        document.documentElement.style.setProperty("--nova-ar", orientation === "portrait" ? "9/16" : "16/9");
      } catch (e) {}
    }

    function setCanvasSize(w, h) {
      width = Math.max(240, w);
      height = Math.max(240, h);
      canvas.width = width;
      canvas.height = height;
      applyOrientationCss();
    }

    setCanvasSize(width, height);

    const game = {
      canvas, ctx,
      get width() { return width; },
      set width(w) { setCanvasSize(w, height); },
      get height() { return height; },
      set height(h) { setCanvasSize(width, h); },
      keys, pressed, pointer,
      state: Object.create(null),
      clamp, hit, dist,
      /** Live design-intent colours. Prefer these over literal hex values. */
      palette,
      /** Audio character in force (chiptune | sub | industrial | soft | orchestral | lofi). */
      audio: audioCharacter,
      sound(type, character) { playBeep(type, character || audioCharacter); },
      /** Canvas font string in the theme's family — game.font(28, "bold"). */
      font(size, weight) { return (weight || "bold") + " " + (Number(size) || 24) + "px " + palette.font; },
      random(min, max) { return min + Math.random() * (max - min); },
      randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
      key(name) { return !!keys[String(name).toLowerCase()]; },
      justPressed(name) { return pressed.has(String(name).toLowerCase()); },
      clear(color) { ctx.fillStyle = color || palette.canvas; ctx.fillRect(0, 0, width, height); },
      text(text, x, y, size, color, align, weight) {
        ctx.save();
        ctx.fillStyle = color || palette.ink;
        ctx.font = (weight || "bold") + " " + (size || 24) + "px " + palette.font;
        ctx.textAlign = align || "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(text), x, y);
        ctx.restore();
      },
      rect(x, y, w, h, color, radius) {
        ctx.save(); ctx.fillStyle = color || palette.shapeA;
        const r = Math.max(0, Math.min(radius || 0, Math.min(w, h) / 2));
        ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.restore();
      },
      circle(x, y, radius, color) {
        ctx.save(); ctx.fillStyle = color || palette.shapeB;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      },
      /* ── Depth & light primitives ──────────────────────────────────────────
         Design intent asks for parallax planes, volume, projection and real
         lighting. Asking a model to hand-roll all of that inside a 30-second
         generation is how you get "it ignored the brief and drew flat
         rectangles again". These make the intended look the cheap option. */

      /** Lighten (amount > 0) or darken (amount < 0) any hex/rgb colour. */
      shade(color, amount) { return shadeColor(color || palette.shapeA, amount); },
      /** Same colour at a given alpha — for glow passes, hazes and washes. */
      fade(color, alpha) { return fadeColor(color || palette.ink, alpha); },
      /**
       * A solid with volume: top face, side face and a cast shadow, all lit from
       * one consistent direction. lift is the apparent height in pixels.
       */
      box(x, y, w, h, lift, color) {
        const base = color || palette.shapeA;
        const dz = lift == null ? 10 : lift;
        const lx = lightDir[0], ly = lightDir[1];
        ctx.save();
        // Cast shadow first, offset along the light direction.
        ctx.fillStyle = "rgba(0,0,0,.28)";
        ctx.beginPath();
        ctx.ellipse(x + w / 2 + lx * dz * 0.8, y + h + ly * dz * 0.35, w * 0.55, Math.max(2, h * 0.18), 0, 0, Math.PI * 2);
        ctx.fill();
        // Side face (away from the light), then the front, then the top.
        ctx.fillStyle = shadeColor(base, -0.32);
        ctx.beginPath();
        ctx.moveTo(x + w, y); ctx.lineTo(x + w - lx * dz, y - dz);
        ctx.lineTo(x + w - lx * dz, y + h - dz); ctx.lineTo(x + w, y + h);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = base;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = shadeColor(base, 0.22);
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x - lx * dz, y - dz);
        ctx.lineTo(x + w - lx * dz, y - dz); ctx.lineTo(x + w, y);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      },
      /** Ground shadow on its own, for circles/sprites that are not boxes. */
      shadow(x, y, rx, ry) {
        ctx.save(); ctx.fillStyle = "rgba(0,0,0,.26)";
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry == null ? rx * 0.35 : ry, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.restore();
      },
      /**
       * Parallax offset for a plane at depth z (0 = infinitely far, 1 = the
       * playfield). Wraps by span so callers can draw a repeating strip.
       */
      parallax(x, z, span) {
        const w = span || width;
        const o = (x * (z == null ? 0.5 : z)) % w;
        return o < 0 ? o + w : o;
      },
      /** Perspective scale for an object z units into the screen. */
      project(z, focal) {
        const f = focal || 320;
        return f / (f + Math.max(0, z));
      },
      /** Horizon-relative ground scale for Mode-7 style rows. */
      groundScale(screenY, horizonY) {
        const hz = horizonY == null ? height * 0.42 : horizonY;
        const d = screenY - hz;
        return d <= 0 ? 0 : Math.min(1, d / Math.max(1, height - hz));
      },
      /**
       * Darken the whole canvas except a lit radius around (x, y). This is real
       * occlusion, not a dimmed overlay: call it AFTER drawing the scene.
       */
      light(x, y, radius, strength) {
        const s = strength == null ? 0.92 : Math.max(0, Math.min(1, strength));
        const g = ctx.createRadialGradient(x, y, Math.max(1, radius * 0.25), x, y, Math.max(2, radius));
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.65, "rgba(0,0,0," + (s * 0.55).toFixed(3) + ")");
        g.addColorStop(1, "rgba(0,0,0," + s.toFixed(3) + ")");
        ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, width, height); ctx.restore();
      },
      /** A hard-edged light cone from (x, y) pointing at angle radians. */
      cone(x, y, angle, spread, length, strength) {
        const s = strength == null ? 0.9 : Math.max(0, Math.min(1, strength));
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0," + s.toFixed(3) + ")";
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        ctx.moveTo(x, y);
        ctx.arc(x, y, length || Math.max(width, height), angle - (spread || 0.5) / 2, angle + (spread || 0.5) / 2);
        ctx.closePath();
        ctx.fill("evenodd");
        ctx.restore();
      },
      /** Emissive halo pass — draw before the solid core for a neon look. */
      glow(x, y, radius, color, layers) {
        const n = layers || 3;
        const c = color || palette.accent;
        ctx.save();
        for (let i = n; i > 0; i--) {
          ctx.fillStyle = fadeColor(c, 0.1 + 0.06 * (n - i));
          ctx.beginPath(); ctx.arc(x, y, radius * (1 + i * 0.45), 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      },
      /** Edge darkening. Cheap atmosphere for dread/gritty moods. */
      vignette(strength) {
        const s = strength == null ? 0.55 : Math.max(0, Math.min(1, strength));
        const g = ctx.createRadialGradient(
          width / 2, height / 2, Math.min(width, height) * 0.32,
          width / 2, height / 2, Math.max(width, height) * 0.75);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, "rgba(0,0,0," + s.toFixed(3) + ")");
        ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, width, height); ctx.restore();
      },
      /** Flat translucent colour wash — the ambient-tint lighting model. */
      tint(color, alpha) {
        ctx.save(); ctx.fillStyle = fadeColor(color || palette.primary, alpha == null ? 0.12 : alpha);
        ctx.fillRect(0, 0, width, height); ctx.restore();
      },
      /** A full-width horizontal band — sky/ground/haze planes in one call. */
      band(y, h, color) {
        ctx.save(); ctx.fillStyle = color || palette.surface;
        ctx.fillRect(0, y, width, h); ctx.restore();
      },
      burst(x, y, color, count) {
        // Particle count follows the mood's density (a dread game gets a sparse
        // puff, a playful one a wide spray) instead of a fixed 12 everywhere.
        const num = count || Math.round(6 * burstDensity);
        for (let i = 0; i < num; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 150 + 50;
          particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            decay: Math.random() * 2 + 1.5,
            color: color || palette.particle,
            size: Math.random() * 4 + 2
          });
        }
      },
      scene(name, definition) {
        if (!name || !definition || typeof definition.render !== "function") throw new Error("Invalid scene: " + name);
        scenes.set(name, definition); return game;
      },
      go(name, payload) {
        const next = scenes.get(name);
        if (!next) throw new Error("Unknown scene: " + name);
        if (current && typeof current.exit === "function") current.exit(game);
        current = next; currentName = name;
        game.state.scene = name;
        if (typeof current.enter === "function") current.enter(game, payload);
      },
      start(name) {
        if (running) { game.go(name || "menu"); return game; }
        game.go(name || "menu"); running = true; last = performance.now();
        raf = requestAnimationFrame(frame); return game;
      },
      stop() { running = false; cancelAnimationFrame(raf); },
      get sceneName() { return currentName; },
      get orientation() { return orientation; },
      /** Live view info — always reflects the current logical playfield. */
      /* The design intent the shell chose, so gameplay/render code can branch on
         it instead of hardcoding one presentation. Read-only. */
      design: {
        depth: String(palette.depth || "layered"),
        lighting: String(palette.lighting || "flat"),
        camera: String(palette.camera || "fixed"),
        ui: String(palette.ui || "corners"),
        light: lightDir
      },
      get view() {
        return { width, height, aspect: width / height, orientation, isPortrait: orientation === "portrait" };
      },
      /** Recompute the logical playfield. Notifies the active scene via onResize(game). */
      resize(w, h) {
        if (w && h) { setCanvasSize(w, h); }
        if (current && typeof current.onResize === "function") current.onResize(game, game.view);
        return game;
      },
      /** Switch orientation at runtime (e.g. device rotation). Swaps logical dims. */
      setOrientation(next) {
        const o = String(next || "auto").toLowerCase();
        const valid = o === "portrait" || o === "landscape" ? o : "auto";
        const target = valid === "auto" ? (isPortraitNow() ? "portrait" : "landscape") : valid;
        if (target === orientation) return game;
        orientation = target;
        setCanvasSize(orientation === "portrait" ? Math.min(width, height) || 540 : Math.max(width, height) || 960,
                       orientation === "portrait" ? Math.max(width, height) || 960 : Math.min(width, height) || 540);
        if (current && typeof current.onResize === "function") current.onResize(game, game.view);
        return game;
      }
    };

    function frame(now) {
      if (!running) return;
      // A tab that was backgrounded can deliver a huge first delta; clamping to
      // 50ms keeps physics stable instead of teleporting entities across the map.
      const dt = clamp((Number(now) - last) / 1000, 0, 0.05);
      last = Number(now);
      try {
        if (current && typeof current.update === "function") current.update(game, dt);
        if (current) current.render(game, ctx);

        // Update and draw particles automatically
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= p.decay * dt;
          if (p.life <= 0) { particles.splice(i, 1); continue; }
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      } catch (error) {
        running = false;
        const overlay = document.getElementById("nova-error");
        if (overlay) { overlay.hidden = false; overlay.textContent = "Game runtime: " + (error && error.message ? error.message : error); }
        console.error(error);
      }
      pointer.tapped = false; pressed.clear();
      if (running) raf = requestAnimationFrame(frame);
    }

    function mapPointer(event) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.x = clamp((event.clientX - rect.left) * width / rect.width, 0, width);
      pointer.y = clamp((event.clientY - rect.top) * height / rect.height, 0, height);
    }

    // ── Listener bookkeeping ──────────────────────────────────────────────
    // Every listener is registered through on() so game.destroy() can remove
    // all of them. Without this, calling NovaGE.init() twice — which happens on
    // hot-reload, on a "play again" flow that re-boots the game, or simply if the
    // generated code calls init() more than once — left the previous set attached
    // forever: input fired into a dead game object, resize handlers multiplied,
    // and every generation leaked another full set.
    const bound = [];
    function on(target, type, fn, opts) {
      if (!target || typeof target.addEventListener !== "function") return;
      target.addEventListener(type, fn, opts);
      bound.push({ target: target, type: type, fn: fn, opts: opts });
    }

    // ── Rotation / resize handling: keeps the playfield in sync with the screen ──
    function handleResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (requestedOrientation === "auto") {
          const wantPortrait = isPortraitNow();
          if ((wantPortrait && orientation !== "portrait") || (!wantPortrait && orientation !== "landscape")) {
            game.setOrientation(wantPortrait ? "portrait" : "landscape");
            return;
          }
        }
        if (current && typeof current.onResize === "function") current.onResize(game, game.view);
      }, 120);
    }
    on(window, "resize", handleResize, { passive: true });
    if (window.screen && window.screen.orientation) {
      on(window.screen.orientation, "change", handleResize);
    }
    on(window, "orientationchange", handleResize, { passive: true });

    on(window, "keydown", function (event) {
      const key = String(event.key || "").toLowerCase();
      if (!keys[key]) pressed.add(key);
      keys[key] = true;
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
    }, { passive: false });
    on(window, "keyup", function (event) { keys[String(event.key || "").toLowerCase()] = false; });

    on(canvas, "pointerdown", function (event) {
      mapPointer(event);
      pointer.down = true;
      pointer.tapped = true;
      // Older/edge browsers can throw here (invalid pointer id, detached node).
      try { canvas.setPointerCapture(event.pointerId); } catch (e) {}
    });
    on(canvas, "pointermove", mapPointer);
    on(canvas, "pointerup", function (event) { mapPointer(event); pointer.down = false; });
    // Without pointercancel/leave the pointer stays logically "down" forever when
    // the gesture is interrupted (notification, scroll takeover, touch leaving
    // the canvas) — the player's character kept moving on its own.
    on(canvas, "pointercancel", function () { pointer.down = false; });
    on(canvas, "pointerleave", function () { pointer.down = false; });
    on(canvas, "contextmenu", function (event) { event.preventDefault(); });

    on(document, "visibilitychange", function () {
      if (!document.hidden) return;
      // Clear held keys AND the pointer, otherwise returning to the tab resumes
      // with phantom input still applied.
      for (const k of Object.keys(keys)) keys[k] = false;
      pressed.clear();
      pointer.down = false;
      pointer.tapped = false;
    });

    /** Detach every listener, stop the loop, and release the audio context. */
    game.destroy = function destroy() {
      running = false;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      for (const b of bound) {
        try { b.target.removeEventListener(b.type, b.fn, b.opts); } catch (e) {}
      }
      bound.length = 0;
      particles.length = 0;
      scenes.clear();
      current = null;
      try { if (audioCtx && typeof audioCtx.close === "function") audioCtx.close(); } catch (e) {}
      audioCtx = null;
      if (activeGame === game) activeGame = null;
      return game;
    };

    activeGame = game;
    return game;
  }

  global.NovaGE = Object.freeze({
    init: init,
    clamp: clamp,
    hit: hit,
    dist: dist,
    /** Tear down the live instance (listeners, loop, audio). Safe to call twice. */
    destroy: function () {
      if (activeGame && typeof activeGame.destroy === "function") {
        try { activeGame.destroy(); } catch (e) {}
      }
      activeGame = null;
    },
    get current() { return activeGame; }
  });
})(window);
`;

export function isGameRequest(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  const explicitUtility = /\b(calculator|converter|dashboard|editor|form|utility|tool)\b/.test(t)
    || /(ماشین\s*حساب|حسابگر|مبدل|داشبورد|ویرایشگر|فرم|ابزار)/.test(text);
  const explicitGame = /\b(game|arcade|shooter|platformer|runner|snake|tetris|pong|flappy|breakout|maze|rpg|tower defense|match[- ]?3|minesweeper)\b/.test(t)
    || /(بازی|گیم|پلتفرمر|تتریس|دونده|تیراندازی|مرحله|امتیاز|برد\s*و\s*باخت|گیم.?اور|رانندگی|مسابقه)/.test(text);
  if (explicitUtility && !explicitGame) return false;
  return explicitGame || /\b(puzzle|2048)\b/.test(t) || /(مار|پازل|فکری)/.test(text);
}

function stripFences(value: string): string {
  return String(value ?? "").trim().replace(/^```(?:javascript|js)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function safeTitle(value: string): string {
  return value.replace(/[<>"']/g, "").slice(0, 80) || "Nova Game";
}

/**
 * Wrap generated gameplay code in a self-contained playable document.
 *
 * The shell used to be a single hardcoded look — one purple/cyan token set, one
 * radial+linear gradient, one 18px radius, one system font stack and the literal
 * hint "Touch / WASD / Keys" — which is most of the reason a horror game and a
 * candy puzzle arrived looking like the same neon arcade cabinet. Every visual
 * decision here now comes from the design intent, so the differentiation is
 * deterministic instead of depending on the model remembering to vary it.
 *
 * Pass `concept` (the user's own description) or a pre-computed `intent`; with
 * neither, the title is used, and failing that a neutral arcade look applies.
 */
export function wrapGameHtml(
  gameCode: string,
  opts: {
    title?: string;
    rtl?: boolean;
    orientation?: GameOrientation;
    concept?: string;
    intent?: GameDesignIntent;
  } = {},
): string {
  const title = safeTitle(opts.title || "Nova Game");
  const code = stripFences(gameCode);
  const rtl = !!opts.rtl;
  const dir = rtl ? "rtl" : "ltr";
  const lang = rtl ? "fa" : "en";
  const orientation: GameOrientation = opts.orientation ?? "auto";
  // Initial aspect for the CSS layout; "auto" defaults to landscape until the
  // runtime measures the device and flips the --nova-ar variable itself.
  const initialAspect = orientation === "portrait" ? "9/16" : "16/9";
  const dataOrientation = orientation;

  const intent = opts.intent ?? detectGameDesignIntent(opts.concept || opts.title || "");
  const p = intent.palette;
  const type = intent.typography;
  const chrome = intent.chrome;
  const light = isLightSetting(intent.setting);
  const hint = rtl ? intent.hint.fa : intent.hint.en;
  // The runtime reads this instead of its hardcoded draw colours. Injected as a
  // global so generated code cannot forget to pass it to NovaGE.init().
  const theme = serializeRuntimeTheme(intent);

  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="theme-color" content="${p.bg}">
<title>${title}</title>
<style>
:root{--bg:${p.bg};--surface:${p.surface};--surface-2:${p.surfaceAlt};--text:${p.text};--muted:${p.muted};--border:${p.border};--primary:${p.primary};--accent:${p.accent};--danger:${p.danger};--radius:${chrome.radius};--shadow:${chrome.shadow};--display:${type.display};--body:${type.body};--nova-ar:${initialAspect}}
*{box-sizing:border-box}
html,body{width:100%;min-height:100%;margin:0;background:${chrome.backdrop};background-attachment:fixed;color:var(--text);font-family:var(--body);overflow:hidden}
body{min-height:100dvh;display:grid;place-items:center;padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left))}
.shell{width:min(1000px,100%);display:grid;gap:10px}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 6px}
.title{margin:0;font-family:var(--display);font-size:clamp(1rem,2.6vw,1.35rem);font-weight:${type.weight};letter-spacing:${type.tracking};text-transform:${type.transform};color:var(--accent)}
.hint{margin:0;color:var(--muted);font-size:.78rem;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tick{display:none}
.stage{position:relative;border:${chrome.border};border-radius:var(--radius);overflow:hidden;background:${p.canvas};box-shadow:var(--shadow)}
canvas{display:block;width:100%;height:auto;max-height:calc(100dvh - 76px);aspect-ratio:var(--nova-ar,16/9);touch-action:none;outline:none}
.veil{position:absolute;inset:0;pointer-events:none;${chrome.overlay ? `background:${chrome.overlay}` : "display:none"}}
.error{position:absolute;inset:auto 16px 16px;padding:12px;border-radius:8px;background:var(--danger);color:#fff;font-family:ui-monospace,monospace;font-size:.8rem;line-height:1.5;z-index:3}

/* ── Frame identities: the same markup reads as six different machines ── */
.shell[data-frame="vignette"] .title{font-size:.9rem;color:var(--muted);letter-spacing:.3em}
.shell[data-frame="vignette"] .hint{opacity:.55}
.shell[data-frame="vignette"] .stage{box-shadow:0 0 0 1px rgba(255,255,255,.05)}

.shell[data-frame="crt"] .bar{border:2px solid var(--border);border-radius:4px;padding:6px 10px;background:var(--surface)}
.shell[data-frame="crt"] .stage{border:6px solid var(--surface-2);box-shadow:inset 0 0 40px rgba(0,0,0,.65),0 0 0 2px var(--border)}
.shell[data-frame="crt"] canvas{image-rendering:pixelated}

.shell[data-frame="panel"] .tick{display:block;width:26px;height:2px;background:var(--accent);box-shadow:0 6px 0 var(--primary)}
.shell[data-frame="panel"] .title{flex:1}
.shell[data-frame="panel"] .stage{clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px);border-color:var(--accent)}
.shell[data-frame="panel"] .bar{border-bottom:1px solid var(--border);padding-bottom:8px}

.shell[data-frame="parchment"] .bar{flex-direction:column;gap:4px;text-align:center;border-top:2px solid var(--border);border-bottom:2px solid var(--border);padding:8px 0}
.shell[data-frame="parchment"] .title{color:var(--primary)}
.shell[data-frame="parchment"] .stage{border-width:2px;box-shadow:${light ? "0 10px 30px rgba(60,45,25,.18)" : "var(--shadow)"}}

.shell[data-frame="arcade"] .title{font-size:clamp(1.1rem,3.4vw,1.7rem);color:var(--primary)}
.shell[data-frame="arcade"] .hint{background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:5px 12px;color:var(--muted)}
.shell[data-frame="arcade"] .stage{border-width:2px}

.shell[data-frame="clean"] .title{color:var(--text)}
.shell[data-frame="clean"] .stage{box-shadow:${light ? "0 14px 40px rgba(24,24,27,.10)" : "var(--shadow)"}}

@media(prefers-reduced-motion:reduce){.veil{opacity:.4}}
@media(max-width:640px){body{padding:0}.shell{gap:0}.bar{padding:6px 10px}.stage{border-radius:0;border-left:0;border-right:0}canvas{max-height:calc(100dvh - 44px)}.shell[data-frame="crt"] .stage{border-width:3px}}
</style>
</head>
<body>
<main class="shell" data-frame="${chrome.frame}">
<header class="bar"><span class="tick" aria-hidden="true"></span><h1 class="title">${title}</h1><p class="hint">${hint}</p></header>
<section class="stage"><canvas id="nova-canvas" tabindex="0" data-orientation="${dataOrientation}"></canvas><div class="veil" aria-hidden="true"></div><div id="nova-error" class="error" hidden></div></section>
</main>
<script>window.NOVA_THEME=${theme};</script>
<script>${NOVA_GE_RUNTIME}</script>
<script>
try {
${code}
} catch (e) {
  const err = document.getElementById("nova-error");
  if(err) { err.hidden = false; err.textContent = "Boot error: " + e.message; }
}
</script>
</body>
</html>`;
}

/**
 * Build the game generator's system instruction.
 *
 * The old version mandated one arcade template for every concept — "Must define
 * 3 scenes: menu, play, gameover", a high-score menu and "Tap / Space to
 * Restart" — so a turn-based strategy game, a narrative horror piece and a match-3
 * puzzle were all pushed into the same shape and the same presentation. The
 * contract that actually matters (a "menu" scene, a "play" scene, and
 * `game.start("menu")` — what `isGameComplete` and the runtime require) is kept;
 * everything above it is now driven by the design intent.
 */
export function buildGameEnginePrompt(
  deviceTarget: "desktop" | "mobile" | "auto" = "auto",
  orientation: GameOrientation = "auto",
  direction: "rtl" | "ltr" | "auto" = "auto",
  intent?: GameDesignIntent,
): string {
  const orientationRule = orientation === "portrait"
    ? "PORTRAIT MODE: the playfield is 9:16 (tall/vertical). Design for portrait phones — keep the HUD at the top, controls near the thumb, and vertical flow."
    : orientation === "landscape"
      ? "LANDSCAPE MODE: the playfield is 16:9 (wide/horizontal). Design for desktop/landscape screens — wide view, HUD in the corners."
      : "ADAPTIVE MODE: support BOTH portrait (9:16) and landscape (16:9). Read game.view.orientation / game.view.isPortrait at runtime, keep HUD anchored with margins, and recenter dynamic elements in scene.onResize(game, view).";

  const design = intent ?? detectGameDesignIntent("");
  const scenes = design.scenes;
  const sceneList = scenes.map(name => `"${name}"`).join(", ");
  const endScenes = scenes.slice(2);
  const p = design.palette;

  // designSkills was imported here but never called — the game surface rules
  // ("readable HUD, obvious controls, responsive canvas, start/pause/retry")
  // never reached the model. Wired in below, now with a genre-specific rule.
  const designSkills = buildUniversalDesignSkills(
    direction,
    "game",
    `this is a ${design.mood} ${design.genre} game in a ${design.setting} setting, shown ${design.camera} with ${design.depth} depth and ${design.lighting} lighting. `
    + `The HUD is ${design.chrome.hud}. Match the genre's conventions, not a generic arcade layout — ${design.presentation[0]}`,
  );

  return `You are Nova Game Engine Turbo, a fast, expert 2D HTML5 game developer.
Output ONLY runnable JavaScript code. Do not output markdown, HTML, backticks, or explanations.

BUILT-IN API SPECIFICATION (NovaGE):
- const game = NovaGE.init({ orientation: "auto" }); // or "portrait" / "landscape"
- game.scene("name", { enter(game, payload), update(game, dt), render(game, ctx), exit(game), onResize(game, view) });
- game.go("name", payload), game.start("menu");
- game.clear(color), game.text(str, x, y, size, color, align, weight), game.rect(x, y, w, h, color, radius), game.circle(x, y, r, color);
- game.palette -> THE THEME. Fields: canvas, ink, muted, primary, accent, danger, shapeA, shapeB, particle. Every colour argument above is OPTIONAL and defaults to the matching palette entry.
- game.font(size, weight) -> themed canvas font string for direct ctx.font use.
- game.burst(x, y, color, count) -> spawns a particle explosion automatically (count defaults to the theme's density).
- game.sound(name) -> synthesised SFX in the theme's audio character. Names: jump, hit, coin, laser, select, step, thud, alarm, whoosh, heartbeat, win, lose (plus aliases like explosion, score, shoot, click, land, danger, dash, success, fail).
- game.keys, game.key("arrowleft"|"a"|" " etc), game.justPressed("key");
- game.pointer (fields: .x, .y, .down, .tapped);
- RESPONSIVE DIMENSIONS: ALWAYS use game.view.width / game.view.height (or game.width / game.height) for layout math, centers and spawn bounds — never hard-code 960/540. game.view also has .aspect, .orientation, .isPortrait.
- game.clamp(v, min, max), game.hit(boxA, boxB), game.dist(x1, y1, x2, y2), game.random(min, max), game.randomChoice(array);
- DEPTH & LIGHT PRIMITIVES (use these — they are why this game will not look flat):
  · game.shade(color, amount) -> lighter (+) / darker (-) variant of a colour. For faces, distance haze and hover states.
  · game.fade(color, alpha) -> the same colour translucent. For glows, washes and trails.
  · game.box(x, y, w, h, lift, color) -> a solid WITH a top face, a side face and a cast shadow, lit consistently. Use instead of game.rect() for anything that should have volume.
  · game.shadow(x, y, rx, ry) -> ground shadow for round/sprite entities.
  · game.parallax(scrollX, z, span) -> wrapped offset for a background plane at depth z (0.1 far … 1 playfield). Call once per plane.
  · game.project(z, focal) -> perspective scale for an object z units into the screen. Multiply size AND offset by it, draw far-to-near.
  · game.groundScale(screenY, horizonY) -> 0..1 ground-plane scale for Mode-7 style rows and sprite footing.
  · game.light(x, y, radius, strength) -> darkens everything except a lit radius. Call at the END of render().
  · game.cone(x, y, angleRad, spread, length, strength) -> hard-edged light cone, everything outside is dark.
  · game.glow(x, y, radius, color, layers) -> emissive halo. Draw BEFORE the solid core.
  · game.vignette(strength), game.tint(color, alpha), game.band(y, h, color) -> atmosphere and background planes.
- game.design -> { depth, lighting, camera, ui } — the chosen presentation, already decided for you.

🎨 DESIGN INTENT — this game is NOT a generic arcade game. Build to this brief:
- Genre: ${design.genre.toUpperCase()} · Mood: ${design.mood.toUpperCase()} · Setting: ${design.setting.toUpperCase()} · Camera: ${design.camera.toUpperCase()}
- Core loop: ${design.loop}.
- Palette is ALREADY themed (${isLightSetting(design.setting) ? "LIGHT background, dark ink" : "dark background, light ink"}). Read colours from game.palette — canvas ${p.canvas}, ink ${p.ink}, primary ${p.primary}, accent ${p.accent}, danger ${p.danger}. Do NOT invent a new palette and do NOT hardcode hex values for the base look; use game.palette.* so the page shell and the canvas agree.
- Depth model: ${design.depth.toUpperCase()} · Lighting: ${design.lighting.toUpperCase()} · HUD: ${design.uiLayout.toUpperCase()}
- Motion: ${design.motion.transition}. On impact: ${design.motion.impact}.
- Audio character is ${design.audio}; call game.sound() with at least three DIFFERENT event names so the soundscape is not one repeated blip.
${design.presentation.map(rule => `- ${rule}`).join("\n")}

🚫 THIS GAME MUST NOT BE (anti-repetition contract — every generated game gets a different one of these briefs, so do not regress to the generic version):
${design.avoid.map(rule => `- ${rule}`).join("\n")}

REQUIRED CONTRACT (Keep code concise, playable & fast):
1. Define these scenes: ${sceneList}. End the code with: game.start("menu");  ("menu" and "play" are mandatory — the engine boots from "menu".)
2. "menu" scene: state the game's identity and its one-sentence goal in the genre's own voice, plus how to begin. On pointer.tapped or space -> game.go("play"). Only show a high score if a score is actually the point of this genre.
3. "play" scene: reset ALL gameplay variables in enter() — never rely on values left over from a previous round, or a restart will inherit the old score/positions. Support keyboard + pointer/touch (Target: ${deviceTarget.toUpperCase()}).
   Use delta-time (dt) for every movement and timer. Use game.burst() and game.sound() on events.
4. ${endScenes.length
    ? `End states: ${endScenes.map(name => `"${name}"`).join(" and ")}. Present each one the way this genre would — a result summary, a defeat beat, a solved board — not a generic "GAME OVER" card. Offer a clear way back to "play" or "menu".`
    : `End state: return to "menu" with the run's outcome shown.`}
5. ${orientationRule}
6. RESIZE: implement an optional onResize(game, view) hook (e.g. recenter the player, recompute spawn bounds, reflow HUD). The engine calls it automatically when the page resizes or the device rotates.
7. Write 100% complete, bug-free gameplay logic. Do NOT access window/document or external libraries.

PERFORMANCE RULES (the loop runs 60x/second — allocation here causes stutter):
8. Allocate NOTHING per frame: no object/array literals, no closures, no .map/.filter/.slice inside update() or render(). Pre-allocate pools in enter() and reuse entries.
9. Remove dead entities by swapping with the last element and popping, or by iterating backwards with splice — never rebuild the array each frame.
10. Cap entity counts (bullets, enemies, particles) so a long session cannot grow unbounded.
11. Keep per-frame work O(n) — avoid nested loops over all entities where a simple bounds/grid check suffices.

GAME FEEL:
12. Give the player immediate feedback on every input (visual + game.sound()).
13. Make the difficulty ramp readable and gradual; never spike instantly.
14. Show the player's current state (score, lives, resource, progress) in the form this genre uses — a meter, a panel, a scoreboard or a quiet counter.

🚫 ANTI-SAMENESS RULES (these are the most common failure):
15. Do NOT default to a neon purple/cyan space-arcade look. The palette above is the game's identity; a ${design.setting} game must read as ${design.setting}.
16. Do NOT draw every entity as an identical rounded rectangle. Vary silhouette by role (the player, the threat, the reward and the terrain must be distinguishable at a glance).
17. Do NOT render a flat single-colour background. Build the environment the ${design.camera} camera implies — layers, ground, grid, lanes or a board — using palette tones.

${designSkills}`;
}

export function isGameComplete(code: string): boolean {
  const source = stripFences(code);
  if (source.length < 500) return false;
  if (/<html|<script/i.test(source)) return false;
  if (/\beval\s*\(|\bnew\s+Function\s*\(|\bdocument\.getElementById/i.test(source)) return false;
  return /NovaGE\.init\s*\(/.test(source)
    && /\.scene\s*\(\s*["'`]play["'`]/.test(source)
    && /\.start\s*\(\s*["'`]menu["'`]\s*\)/.test(source);
}

export function salvageGame(partial: string): string {
  let source = stripFences(partial);
  if (!source) return "";
  if (!source.includes('game.start("menu")') && !source.includes("game.start('menu')")) {
    source += '\nif (typeof game !== "undefined") game.start("menu");';
  }
  return isGameComplete(source) ? source : "";
}
