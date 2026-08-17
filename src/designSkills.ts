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

export function buildUniversalDesignSkills(direction: ContentDirection | "auto", surface: DesignSurface): string {
  const surfaceRule = surface === "game"
    ? `GAME SURFACE: prioritize a readable HUD, obvious controls, responsive canvas, start/pause/retry states and high-contrast gameplay.`
    : `APPLICATION SURFACE: prioritize task completion, clear forms/results, responsive cards and useful feedback.`;
  return [
    "GENERAL UI/UX SKILLS — apply all of them regardless of topic:",
    ...SKILLS.map((skill, index) => `${index + 1}. ${skill}`),
    `11. DOCUMENT DIRECTION: ${direction === "auto" ? "infer language and direction from the user concept; Persian/Arabic is RTL and English is LTR" : `the requested document direction is ${direction.toUpperCase()}`}.`,
    `12. ${surfaceRule}`,
  ].join("\n");
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
