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
import { assessVisualQuality, buildUniversalDesignSkills, type ContentDirection, type VisualQualityReport } from "./designSkills";

export const NOVA_WEB_BUILDER_NAME = "Nova Web Builder";
export const NOVA_WEB_BUILDER_VERSION = "0.1.5 (Turbo Ultra)";

const MAX_DESCRIPTION_CHARS = 2_000;
const MAX_EXISTING_CODE_CHARS = 100_000;
const MAX_HTML_CHARS = 2_000_000;

export interface WebAppValidationReport extends VisualQualityReport {
  structuralPass: boolean;
  direction: ContentDirection;
}

export function isWebAppRequest(text: string): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return /\b(web ?app|webapp|website|landing page|dashboard|calculator|converter|todo|task manager|form|editor|mini ?app|saas|tool)\b/.test(normalized)
    || /(وب ?اپ|وبسایت|سایت|داشبورد|ماشین ?حساب|مبدل|فرم|ابزار|لیست وظایف|تسک منیجر)/.test(text);
}

function directionFor(text: string): ContentDirection {
  return /[\u0600-\u06ff]/.test(text) ? "rtl" : "ltr";
}

export function buildWebBuilderSystemInstruction(): string {
  return `You are Nova Web Builder 3, a world-class frontend engineer and UI designer.
Generate a complete, modern, interactive, single-file HTML5 web application.

CRITICAL PERFORMANCE & OUTPUT RULES:
- Output ONLY valid HTML starting with <!doctype html> and ending with </html>.
- Do NOT output markdown code blocks (no \`\`\`html), no conversational text.
- Use clean semantic HTML5, embedded modern CSS, and vanilla JavaScript.
- Provide a sleek Dark Mode UI with vibrant gradients, rounded cards, and smooth micro-interactions.
- Must be 100% fully functional with complete working logic (no placeholders, no TODOs).
- Include interactive feedback (sound effects via Web Audio or toast messages where appropriate).
- Ensure high responsiveness for mobile and desktop screens.`;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

export function buildWebAppPrompt(description: string, existingCode?: string): string {
  const concept = clip(String(description ?? "").trim(), MAX_DESCRIPTION_CHARS);
  const direction = directionFor(concept);
  const isRtl = direction === "rtl";

  let prompt = `Create a high-end, responsive web application for:
<concept>
${concept || "Modern interactive web application"}
</concept>

Design Specifications:
- Language & Direction: ${isRtl ? "Persian (fa), RTL" : "English (en), LTR"}.
- Theme: Dark Theme (Background #090d16, Cards #111827, Accent #38bdf8, Primary #818cf8, Text #f9fafb).
- CSS: Include clean Flexbox/Grid layouts, modern button states (:hover, :active), subtle box-shadows, and smooth transitions.
- JavaScript: Write resilient, self-contained vanilla JS for all user actions, state updates, and calculations.
- Safety: Handle empty inputs and edge-cases gracefully. Avoid any external network dependencies or build steps.`;

  if (existingCode?.trim()) {
    prompt += `\n\nReference / Base Draft to modernize and enhance:\n<draft>\n${clip(existingCode, MAX_EXISTING_CODE_CHARS)}\n</draft>`;
  }
  return prompt;
}

function stripModelWrappers(value: string): string {
  return value.trim().replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export function extractWebAppHtml(value: string): string {
  const source = stripModelWrappers(String(value ?? ""));
  const doctype = source.search(/<!doctype\s+html\b/i);
  const htmlStart = source.search(/<html\b/i);
  const start = doctype >= 0 ? doctype : htmlStart;
  if (start < 0) {
    if (source.includes("<body") || source.includes("<div") || source.includes("<script")) {
      return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${source}</body></html>`;
    }
    return "";
  }
  const endTag = source.toLowerCase().lastIndexOf("</html>");
  return source.slice(start, endTag >= start ? endTag + 7 : undefined).trim();
}

export function isWebAppComplete(code: string): boolean {
  const html = extractWebAppHtml(code);
  if (html.length < 300 || html.length > MAX_HTML_CHARS) return false;
  if (/\b(eval|new\s+Function|document\.write)\s*\(/i.test(html)) return false;
  return html.includes("<script") && (html.includes("<!doctype html") || html.includes("<html"));
}

export function salvageWebApp(partial: string): string {
  let html = extractWebAppHtml(partial);
  if (!html || html.length > MAX_HTML_CHARS) return "";
  if (!html.startsWith("<!doctype") && !html.startsWith("<!DOCTYPE")) {
    html = "<!doctype html>\n" + html;
  }
  if (!/<\/body>/i.test(html)) html += "\n</body>";
  if (!/<\/html>/i.test(html)) html += "\n</html>";
  return html;
}

export function normalizeWebAppOutput(raw: string): string | null {
  const extracted = extractWebAppHtml(raw);
  if (isWebAppComplete(extracted)) return extracted;
  const repaired = salvageWebApp(extracted);
  return isWebAppComplete(repaired) ? repaired : null;
}
