export type DesignSurface = "webapp" | "game";
export type ContentDirection = "rtl" | "ltr";

export interface VisualQualityReport {
  pass: boolean;
  score: number;
  issues: string[];
}

const SKILLS = [
  `VISUAL HIERARCHY: create a clear page shell, prominent title, short supporting text, grouped controls, and one obvious primary action. Never place the entire interface as tiny controls in a page corner.`,
  `COLOR SYSTEM: define CSS custom properties for background, surface, text, muted text, primary, accent, border, success and danger. Use a restrained palette, readable contrast, and never rely on color alone for meaning.`,
  `TYPOGRAPHY: use a practical system font stack, fluid type sizes with clamp(), comfortable line-height, distinct heading/body/label weights, and tabular numerals for calculator or data output.`,
  `BILINGUAL TEXT: set html lang and dir correctly. In RTL pages, wrap English labels, code, formulas, numbers and technical identifiers in dir="ltr" or CSS unicode-bidi:isolate. Do not concatenate Persian and English fragments into one uncontrolled text node.`,
  `LAYOUT: use a centered responsive container, Grid or Flexbox, an 8px-derived spacing scale, consistent alignment, and generous whitespace. The primary interface must remain usable from 320px phones to wide desktop screens.`,
  `COMPONENTS: style buttons, inputs, cards, alerts and navigation consistently. Provide hover, active, focus-visible and disabled states; make touch targets at least 44px.`,
  `RESPONSIVENESS: include the viewport meta tag, fluid widths, overflow handling and at least one meaningful media query. Avoid fixed desktop-only coordinates for normal web apps.`,
  `ACCESSIBILITY: use semantic landmarks, real labels, keyboard operation, visible focus, aria-live for changing results, and sufficient contrast. Respect prefers-reduced-motion.`,
  `INTERACTION: every visible control must work. Include empty, error and success states where relevant. Persist user-owned preferences locally when useful, but do not let storage failure break the app.`,
  `POLISH: use subtle shadows, borders, radii and short transitions with restraint. No default browser controls, no giant empty canvas, no placeholder copy, no fake links and no unfinished sections.`,
] as const;

/**
 * @param surfaceNote Optional replacement for the generic surface rule. The game
 *   generator passes a genre-specific rule here so a horror game and a board
 *   game do not receive the same "readable HUD, obvious controls" instruction.
 */
export function buildUniversalDesignSkills(
  direction: ContentDirection | "auto",
  surface: DesignSurface,
  surfaceNote?: string,
): string {
  const note = surfaceNote?.trim();
  const surfaceRule = surface === "game"
    ? `GAME SURFACE: ${note || "prioritize a readable HUD, obvious controls, responsive canvas, start/pause/retry states and high-contrast gameplay."}`
    : `APPLICATION SURFACE: ${note || "prioritize task completion, clear forms/results, responsive cards and useful feedback."}`;
  return [
    "GENERAL UI/UX SKILLS — apply all of them regardless of topic:",
    ...SKILLS.map((skill, index) => `${index + 1}. ${skill}`),
    `11. DOCUMENT DIRECTION: ${direction === "auto" ? "infer language and direction from the user concept; Persian/Arabic is RTL and English is LTR" : `the requested document direction is ${direction.toUpperCase()}`}.`,
    `12. ${surfaceRule}`,
  ].join("\n");
}

/**
 * Device-specific build brief, per surface.
 *
 * The dispatch path used to append ONE fixed device note to every request:
 *
 *   · "Fullscreen 16:9 canvas layout, keyboard WASD/Arrows controls + Spacebar +
 *     Mouse aiming" for desktop,
 *   · "MANDATORY ON-SCREEN TOUCH CONTROLS (Virtual Joystick / D-Pad on
 *     bottom-left, Jump/Action buttons on bottom-right)" for mobile,
 *   · the same joystick note for hybrid.
 *
 * Two defects came from that single string. It was injected into WEB APP
 * requests too — which is why dashboards and calculators arrived with arcade
 * canvas structure — and for games it hard-coded the joystick that made every
 * generated game feel like the same mobile arcade, including the ones whose
 * control model is tapping or swiping. A device note has to know which surface
 * it is describing, and a game's control model is decided by its design intent,
 * not by the device alone.
 *
 * `gameControl` is the intent's already-resolved control contract
 * (`detectGameDesignIntent(concept).input`), passed in as plain strings so this
 * module keeps no dependency on the design layer.
 */
export function buildDeviceBrief(
  surface: DesignSurface,
  device: "desktop" | "mobile" | "auto",
  gameControl?: { desktop: string; touch: string; joystick: boolean; pad?: boolean; label?: string },
): string {
  if (surface === "webapp") {
    const base = "This is a production web application, not a game: never add a virtual joystick, d-pad, HUD overlay, score/lives counter or a canvas playfield.";
    if (device === "mobile") {
      return `IMPORTANT DEVICE REQUIREMENT — mobile-first: single column, touch targets of at least 44px, the primary action within thumb reach, and no affordance that only works on hover. Pinch/zoom is not part of the design; content must fit the viewport. ${base}`;
    }
    if (device === "desktop") {
      return `IMPORTANT DEVICE REQUIREMENT — desktop-first: use the available width with a multi-column or sidebar layout, cap the text measure (~65ch), provide hover/active states, and make every action reachable by keyboard with a visible focus ring. ${base}`;
    }
    return `IMPORTANT DEVICE REQUIREMENT — responsive across 320px to 1440px with real breakpoints (not just fluid width): the same layout must be usable with a finger and a mouse. ${base}`;
  }

  const control = gameControl;
  if (!control) {
    return "IMPORTANT DEVICE REQUIREMENT: choose the control scheme this game's genre actually uses (tapping, dragging, swiping, steering or keys) instead of defaulting to a virtual joystick, and state it on the menu screen.";
  }
  // Three distinct contracts, not two. Collapsing them into "uses a stick" vs
  // "must not use a pad" told a platformer with typed controls that its d-pad
  // was forbidden, and told a puzzle game that a pad was merely unlikely.
  const noStick = control.joystick
    ? "An analogue stick is correct here only because movement and aim are independent; it must not cover the action."
    : control.pad
      ? "Use a discrete directional pad or button cluster here — NOT an analogue stick, and never both."
      : "Do NOT add any joystick, d-pad or movement pad: this game's control model has no directional movement, and a pad would cover the playfield.";
  if (device === "mobile") {
    return `IMPORTANT DEVICE REQUIREMENT — mobile target. Touch: ${control.touch} ${noStick}`;
  }
  if (device === "desktop") {
    // MERGE FIX: `noStick` was computed above but never used on this branch, so
    // a desktop puzzle/strategy game lost the control contract that keeps the
    // model from bolting on a joystick or d-pad.
    return `IMPORTANT DEVICE REQUIREMENT — desktop target. Keyboard/pointer: ${control.desktop} Touch controls must still exist for a touch-capable laptop or tablet, drawn only while touch is actually used. ${noStick}`;
  }
  return `IMPORTANT DEVICE REQUIREMENT — adaptive: keyboard/pointer (${control.desktop}) AND touch (${control.touch}) must both work, and the layout must expose only the control the current device can actually use. ${noStick}`;
}

function count(source: string, pattern: RegExp): number {
  return (source.match(pattern) ?? []).length;
}

export function assessVisualQuality(html: string, direction: ContentDirection): VisualQualityReport {
  const source = String(html ?? "");
  const lower = source.toLowerCase();
  const issues: string[] = [];
  let score = 0;

  const style = source.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i)?.[1] ?? "";
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? "";

  if (style.length >= 700) score++; else issues.push("insufficient-css");
  if (count(style, /--[a-z][\w-]*\s*:/gi) >= 6) score++; else issues.push("missing-color-tokens");
  if (/(display\s*:\s*(grid|flex))|grid-template-columns/i.test(style)) score++; else issues.push("missing-layout-system");
  if (/@media\b/i.test(style)) score++; else issues.push("missing-responsive-rule");
  if (/:focus-visible|:focus\b/i.test(style) && /:hover/i.test(style)) score++; else issues.push("missing-interaction-states");
  if (/font-family\s*:/i.test(style) && /line-height\s*:/i.test(style)) score++; else issues.push("missing-typography-system");
  if (/min-height\s*:\s*(44px|2\.75rem|3rem)|height\s*:\s*(44px|2\.75rem|3rem)/i.test(style)) score++; else issues.push("small-touch-targets");
  if (/<meta\s+name=["']viewport["']/i.test(source)) score++; else issues.push("missing-viewport");
  if (/<(main|header|section|form)\b/i.test(source)) score++; else issues.push("missing-semantic-structure");
  if (script.length >= 250 && /(addEventListener|onclick|onsubmit)/i.test(script)) score++; else issues.push("insufficient-interaction-code");
  if (/aria-live|aria-label|<label\b/i.test(source)) score++; else issues.push("missing-accessibility-labels");
  if (/prefers-reduced-motion/i.test(style)) score++; else issues.push("missing-reduced-motion");

  if (direction === "rtl") {
    if (/<html\b[^>]*\bdir=["']rtl["']/i.test(source) && /\b(lang=["']fa["']|lang=["']fa-ir["'])/i.test(lower)) score++;
    else issues.push("incorrect-rtl-document");
    if (/unicode-bidi\s*:\s*isolate|dir=["']ltr["']/i.test(source)) score++;
    else issues.push("missing-bidi-isolation");
  } else {
    if (/<html\b[^>]*\bdir=["']ltr["']/i.test(source) || !/<html\b[^>]*\bdir=/i.test(source)) score++;
    else issues.push("incorrect-ltr-document");
  }

  if (count(style, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) >= 4) score++; else issues.push("weak-color-system");
  if (/<button\b/i.test(source) && !/button\s*[{,]|\.btn\b|\[class[^\]]*button/i.test(style)) issues.push("unstyled-buttons");
  if (source.length < 2_000) issues.push("output-too-small");

  const critical = new Set(["insufficient-css", "missing-layout-system", "missing-responsive-rule", "insufficient-interaction-code", "unstyled-buttons", "output-too-small"]);
  const hasCritical = issues.some(issue => critical.has(issue));
  return { pass: score >= 11 && !hasCritical, score, issues };
}
