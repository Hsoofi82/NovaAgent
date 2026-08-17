/**
 * ƝØVΛ — Advanced AI Agent Platform for Telegram
 * Copyright (C) 2026 Hsoofi82
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of Nova (https://github.com/Hsoofi82/NovaAgent).
 *
 * Nova is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * Nova is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for
 * more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Nova. If not, see <https://www.gnu.org/licenses/>.
 */
import { buildUniversalDesignSkills } from "./designSkills";

export const NOVA_GAME_ENGINE_VERSION = "0.2.0 (Adaptive Orientation)";
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

  // Simple Synthesized Audio FX (Web Audio API - No external assets needed)
  let audioCtx = null;
  function playBeep(type) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const now = audioCtx.currentTime;

      if (type === "jump" || type === "up") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
      } else if (type === "hit" || type === "explosion") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.linearRampToValueAtTime(30, now + 0.25);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.25);
        osc.start(now); osc.stop(now + 0.25);
      } else if (type === "coin" || type === "score") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.setValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.25);
        osc.start(now); osc.stop(now + 0.25);
      } else if (type === "laser" || type === "shoot") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.12);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.12);
        osc.start(now); osc.stop(now + 0.12);
      }
    } catch (e) {}
  }

  function init(options) {
    const canvas = document.getElementById("nova-canvas");
    if (!canvas) throw new Error("Nova canvas missing");
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D unavailable");

    // ── Adaptive orientation ─────────────────────────────────────────────
    // landscape: 16:9 wide playfield · portrait: 9:16 tall playfield ·
    // auto: follows the device's current orientation and reacts to rotation.
    const requestedOrientation = String((options && options.orientation) || "auto").toLowerCase();
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
      sound: playBeep,
      random(min, max) { return min + Math.random() * (max - min); },
      randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
      key(name) { return !!keys[String(name).toLowerCase()]; },
      justPressed(name) { return pressed.has(String(name).toLowerCase()); },
      clear(color) { ctx.fillStyle = color || "#07111f"; ctx.fillRect(0, 0, width, height); },
      text(text, x, y, size, color, align) {
        ctx.save();
        ctx.fillStyle = color || "#f8fafc";
        ctx.font = "bold " + (size || 24) + "px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = align || "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(text), x, y);
        ctx.restore();
      },
      rect(x, y, w, h, color, radius) {
        ctx.save(); ctx.fillStyle = color || "#7c3aed";
        const r = Math.max(0, Math.min(radius || 0, Math.min(w, h) / 2));
        ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.restore();
      },
      circle(x, y, radius, color) {
        ctx.save(); ctx.fillStyle = color || "#22d3ee";
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      },
      burst(x, y, color, count) {
        const num = count || 12;
        for (let i = 0; i < num; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 150 + 50;
          particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            decay: Math.random() * 2 + 1.5,
            color: color || "#38bdf8",
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
        const target = o === "auto" ? (isPortraitNow() ? "portrait" : "landscape") : o;
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
      const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
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
    addEventListener("resize", handleResize, { passive: true });
    if (typeof window.screen?.orientation?.addEventListener === "function") {
      window.screen.orientation.addEventListener("change", handleResize);
    }
    addEventListener("orientationchange", handleResize, { passive: true });

    addEventListener("keydown", event => {
      const key = event.key.toLowerCase();
      if (!keys[key]) pressed.add(key); keys[key] = true;
      if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(key)) event.preventDefault();
    }, { passive: false });
    addEventListener("keyup", event => { keys[event.key.toLowerCase()] = false; });
    canvas.addEventListener("pointerdown", event => {
      mapPointer(event);
      pointer.down = true;
      pointer.tapped = true;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", mapPointer);
    canvas.addEventListener("pointerup", event => { mapPointer(event); pointer.down = false; });
    canvas.addEventListener("contextmenu", event => event.preventDefault());
    document.addEventListener("visibilitychange", () => { if (document.hidden) Object.keys(keys).forEach(k => { keys[k] = false; }); });
    return game;
  }

  global.NovaGE = Object.freeze({ init, clamp, hit, dist });
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

export function wrapGameHtml(
  gameCode: string,
  opts: { title?: string; rtl?: boolean; orientation?: GameOrientation } = {},
): string {
  const title = safeTitle(opts.title || "Nova Game");
  const code = stripFences(gameCode);
  const dir = opts.rtl ? "rtl" : "ltr";
  const lang = opts.rtl ? "fa" : "en";
  const orientation: GameOrientation = opts.orientation ?? "auto";
  // Initial aspect for the CSS layout; "auto" defaults to landscape until the
  // runtime measures the device and flips the --nova-ar variable itself.
  const initialAspect = orientation === "portrait" ? "9/16" : "16/9";
  const dataOrientation = orientation;
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="theme-color" content="#070b18">
<title>${title}</title>
<style>
:root{--bg:#050816;--surface:#0d1630;--surface-2:#16213f;--text:#f8fafc;--muted:#a9b8d4;--primary:#8b5cf6;--accent:#22d3ee;--danger:#fb7185;--border:rgba(255,255,255,.14);--shadow:0 24px 80px rgba(0,0,0,.45);--nova-ar:${initialAspect}}
*{box-sizing:border-box}html,body{width:100%;min-height:100%;margin:0;background:radial-gradient(circle at 20% 0,#162451 0,transparent 40%),linear-gradient(145deg,var(--bg),#090d1f);color:var(--text);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
body{min-height:100dvh;display:grid;place-items:center;padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left))}
.game-shell{width:min(1000px,100%);display:grid;gap:8px}.game-header{display:flex;align-items:center;justify-content:space-between;padding:0 6px}.game-title{font-size:1.1rem;font-weight:800;letter-spacing:.01em;color:var(--accent)}.game-hint{color:var(--muted);font-size:.8rem}
.canvas-frame{position:relative;border:1px solid var(--border);border-radius:18px;overflow:hidden;background:#07111f;box-shadow:var(--shadow)}
canvas{display:block;width:100%;height:auto;max-height:calc(100dvh - 70px);aspect-ratio:var(--nova-ar,16/9);touch-action:none;outline:none}
.error{position:absolute;inset:auto 16px 16px;padding:12px;border-radius:10px;background:rgba(225,29,72,.95);color:#fff;font-size:.85rem}
/* Portrait gets a narrower, taller frame so the playfield stays large on phones. */
@media(max-width:640px){body{padding:0}.game-shell{gap:0}.canvas-frame{border-radius:0;border:0}canvas{max-height:calc(100dvh - 38px)}}
</style>
</head>
<body>
<main class="game-shell">
<header class="game-header"><div class="game-title">${title}</div><div class="game-hint">Touch / WASD / Keys</div></header>
<section class="canvas-frame"><canvas id="nova-canvas" tabindex="0" data-orientation="${dataOrientation}"></canvas><div id="nova-error" class="error" hidden></div></section>
</main>
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

export function buildGameEnginePrompt(
  deviceTarget: "desktop" | "mobile" | "auto" = "auto",
  orientation: GameOrientation = "auto",
): string {
  const orientationRule = orientation === "portrait"
    ? "PORTRAIT MODE: the playfield is 9:16 (tall/vertical). Design for portrait phones — keep the HUD at the top, controls near the thumb, and vertical flow."
    : orientation === "landscape"
      ? "LANDSCAPE MODE: the playfield is 16:9 (wide/horizontal). Design for desktop/landscape screens — wide view, HUD in the corners."
      : "ADAPTIVE MODE: support BOTH portrait (9:16) and landscape (16:9). Read game.view.orientation / game.view.isPortrait at runtime, keep HUD anchored with margins, and recenter dynamic elements in scene.onResize(game, view).";
  return `You are Nova Game Engine Turbo, a fast, expert 2D HTML5 game developer.
Output ONLY runnable JavaScript code. Do not output markdown, HTML, backticks, or explanations.

BUILT-IN API SPECIFICATION (NovaGE):
- const game = NovaGE.init({ orientation: "auto" }); // or "portrait" / "landscape"
- game.scene("name", { enter(game, payload), update(game, dt), render(game, ctx), exit(game), onResize(game, view) });
- game.go("name", payload), game.start("menu");
- game.clear(color), game.text(str, x, y, size, color, align), game.rect(x, y, w, h, color, radius), game.circle(x, y, r, color);
- game.burst(x, y, color, count) -> spawns particle explosion automatically!
- game.sound("jump" | "hit" | "coin" | "laser") -> plays 8-bit sound effects instantly!
- game.keys, game.key("arrowleft"|"a"|" " etc), game.justPressed("key");
- game.pointer (fields: .x, .y, .down, .tapped);
- RESPONSIVE DIMENSIONS: ALWAYS use game.view.width / game.view.height (or game.width / game.height) for layout math, centers and spawn bounds — never hard-code 960/540. game.view also has .aspect, .orientation, .isPortrait.
- game.clamp(v, min, max), game.hit(boxA, boxB), game.dist(x1, y1, x2, y2), game.random(min, max), game.randomChoice(array);

REQUIRED CONTRACT (Keep code concise, playable & fast):
1. Must define 3 scenes: "menu", "play", "gameover". End code with: game.start("menu");
2. "menu" scene: draw title, high score, and a start button. On pointer.tapped or space -> game.go("play").
3. "play" scene: reset all variables in enter(). Support keyboard + pointer/touch dragging (Target: ${deviceTarget}).
   Use delta-time (dt) for movements. Use game.burst() and game.sound() on events.
4. "gameover" scene: show score and "Tap / Space to Restart" -> game.go("play").
5. ${orientationRule}
6. RESIZE: implement an optional onResize(game, view) hook (e.g. recenter the player, recompute spawn bounds, reflow HUD). The engine calls it automatically when the page resizes or the device rotates.
7. Write 100% complete, bug-free gameplay logic. Do NOT access window/document or external libraries.`;
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
