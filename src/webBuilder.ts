import {
  assessVisualQuality,
  buildUniversalDesignSkills,
  type ContentDirection,
  type VisualQualityReport,
} from "./designSkills";

export const NOVA_WEB_BUILDER_NAME = "Nova Web Builder";
export const NOVA_WEB_BUILDER_VERSION = "0.2.0 (Design-System Enforced)";

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

export function buildWebBuilderSystemInstruction(direction: ContentDirection | "auto" = "auto"): string {
  // The 12-skill design system in designSkills.ts existed but was never wired
  // into any prompt — buildUniversalDesignSkills() had zero callers, so every
  // generated app relied only on the short style blurb below. Injecting it here
  // is the single highest-leverage quality change for generated output.
  return `You are Nova Web Builder, a world-class frontend engineer and UI designer.
Generate a complete, modern, interactive, single-file HTML5 web application.

OUTPUT CONTRACT (violating any of these makes the output unusable):
- Output ONLY valid HTML: start with <!doctype html>, end with </html>.
- No markdown fences, no commentary, no explanation before or after.
- Everything inline in ONE file: no external CSS/JS/font/image requests, no build step, no CDN.
- No eval(), no new Function(), no document.write() — these are rejected by the validator.
- Fully working logic. No TODOs, no placeholder copy, no dead controls, no fake links.

${buildUniversalDesignSkills(direction, "webapp")}

ENGINEERING REQUIREMENTS:
- Structure state explicitly: a single state object, pure render function(s), and event handlers that mutate state then re-render. Avoid scattered ad-hoc DOM mutation.
- Handle empty input, invalid input, and boundary values on every control.
- Provide visible loading / empty / error states wherever an operation can fail or return nothing.
- Persist user-owned preferences with try/catch around storage; storage failure must never break the app.
- Keep the DOM small: build lists with a single innerHTML assignment or a fragment, not per-item reflows.
- Escape any user-supplied string before inserting it into HTML.`;
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
    // Case-insensitive so <BODY>/<DIV>/<SCRIPT> fragments are still recognised.
    if (/<(body|div|script|main|section|header)\b/i.test(source)) {
      return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${source}</body></html>`;
    }
    return "";
  }
  // Locate the closing tag case-insensitively over the ORIGINAL string, so the
  // index and length refer to the same text. The previous
  // `toLowerCase().lastIndexOf("</html>")` also missed `</html >` (legal
  // whitespace), which left trailing junk attached to the document.
  let sliceEnd: number | undefined;
  const closeRe = /<\/html\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = closeRe.exec(source)) !== null) {
    if (match.index >= start) sliceEnd = match.index + match[0].length;
  }
  return source.slice(start, sliceEnd).trim();
}

export function isWebAppComplete(code: string): boolean {
  const html = extractWebAppHtml(code);
  if (html.length < 300 || html.length > MAX_HTML_CHARS) return false;
  if (/\b(eval|new\s+Function|document\.write)\s*\(/i.test(html)) return false;
  // Case-insensitive: <SCRIPT>/<HTML>/<!DOCTYPE> are valid HTML and models do
  // emit them, but the original substring checks were case-sensitive so such
  // output was rejected outright.
  if (!/<script\b/i.test(html)) return false;
  if (!/<!doctype\s+html/i.test(html) && !/<html\b/i.test(html)) return false;
  // Truncated output used to pass this gate: it only checked that <script> and a
  // doctype were PRESENT, so a response cut off mid-function was declared
  // "complete" and shipped — the browser then rendered a blank page because the
  // unterminated script swallowed the rest of the document. Require balanced
  // <script> tags and a closed document; salvageWebApp() repairs the rest.
  const opens = (html.match(/<script\b[^>]*>/gi) ?? []).length;
  const closes = (html.match(/<\/script\s*>/gi) ?? []).length;
  if (opens !== closes) return false;
  return /<\/html\s*>\s*$/i.test(html);
}

/**
 * Structural + visual validation of a generated app.
 *
 * `assessVisualQuality` (12-point design-system scorer) previously had no
 * callers at all. This wires it in so the generator can tell "structurally
 * parseable" apart from "actually a finished-looking app", and report why.
 */
export function validateWebApp(code: string, directionHint?: ContentDirection): WebAppValidationReport {
  const html = extractWebAppHtml(code);
  const direction = directionHint ?? directionFor(html);
  const structuralPass = isWebAppComplete(html);
  const visual = assessVisualQuality(html, direction);
  return { ...visual, structuralPass, direction };
}

export function salvageWebApp(partial: string): string {
  let html = extractWebAppHtml(partial);
  if (!html || html.length > MAX_HTML_CHARS) return "";
  if (!/^<!doctype/i.test(html)) {
    html = "<!doctype html>\n" + html;
  }
  // Generation can be cut off INSIDE a <script>. Appending </body></html> after
  // an unterminated script leaves the closing tags inside the script body, so the
  // browser parses no markup at all and renders a blank page. Close the script
  // first when the open/close counts disagree.
  const opens = (html.match(/<script\b[^>]*>/gi) ?? []).length;
  const closes = (html.match(/<\/script\s*>/gi) ?? []).length;
  if (opens > closes) {
    // Drop a trailing partial statement so the recovered script can still parse,
    // then balance every unclosed <script>.
    html = html.replace(/[^\n;{}]*$/, "");
    html += "\n/* truncated by generator */\n" + "</script>".repeat(opens - closes);
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
