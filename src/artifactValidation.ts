import { parse } from "acorn";

export interface ArtifactReport { pass: boolean; errors: string[]; warnings: string[] }
type AstNode = { type: string; [key: string]: any };
const parsedScripts = new Map<string, ArtifactReport>();

/**
 * Parse generated code without executing it. Safe on Workers; bounded to avoid
 * parser abuse.
 *
 * The former `game` mode enforced the NovaGE scene contract ("no direct DOM
 * access", "must init and start the menu scene"). That runtime no longer
 * exists — the model authors the whole document — so the flag was removed
 * rather than left as a trap for the next caller.
 */
export function inspectJavaScript(source: string, module = false): ArtifactReport {
  const key = `${Number(module)}:${source}`;
  const cached = parsedScripts.get(key);
  if (cached) return { ...cached, errors: [...cached.errors], warnings: [...cached.warnings] };
  const errors: string[] = [], warnings: string[] = [];
  if (source.length > 600_000) return { pass: false, errors: ["Script exceeds the 600 KB validation budget."], warnings };
  let tree: AstNode;
  try { tree = parse(source, { ecmaVersion: "latest", sourceType: module ? "module" : "script", locations: true }) as AstNode; }
  catch (e) { return { pass: false, errors: [`JavaScript syntax: ${String((e as Error).message).slice(0, 180)}`], warnings }; }
  const stack = [tree]; let count = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (++count > 100_000) { errors.push("Script AST exceeds the complexity budget."); break; }
    if (node.type === "CallExpression" || node.type === "NewExpression") {
      const callee = node.callee;
      const property = callee?.type === "MemberExpression" && !callee.computed ? callee.property.name : "";
      const owner = callee?.object?.name;
      if ((callee?.type === "Identifier" && ["eval", "Function"].includes(callee.name)) || (owner === "document" && property === "write")) errors.push("Runtime code generation is forbidden.");
    }
    if (["ImportDeclaration", "ImportExpression"].includes(node.type)) errors.push("External module dependencies are unavailable in a self-contained artifact.");
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end"].includes(key)) continue;
      if (Array.isArray(value)) { for (const child of value) if (child?.type) stack.push(child); }
      else if (value && typeof value === "object" && value.type) stack.push(value);
    }
  }
  const report = { pass: errors.length === 0, errors: [...new Set(errors)].slice(0, 12), warnings };
  parsedScripts.set(key, report);
  if (parsedScripts.size > 4) parsedScripts.delete(parsedScripts.keys().next().value!);
  return { ...report, errors: [...report.errors], warnings: [...report.warnings] };
}

export function inspectWebArtifact(html: string): ArtifactReport {
  const errors: string[] = [], warnings: string[] = [];
  let scripts = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(match[1])) { errors.push("External scripts are not bundled."); continue; }
    const type = /\btype\s*=\s*["']([^"']+)/i.exec(match[1])?.[1]?.toLowerCase();
    if (type && !["module", "text/javascript", "application/javascript"].includes(type)) continue;
    scripts++;
    const report = inspectJavaScript(match[2], type === "module");
    errors.push(...report.errors.map(e => `Script ${scripts}: ${e}`));
  }
  if (!scripts) errors.push("No executable application script.");
  if (!/<meta[^>]+name\s*=\s*["']viewport/i.test(html)) warnings.push("Add a responsive viewport.");
  if (!/<(?:main|form)\b/i.test(html)) warnings.push("Add a semantic main region or form.");
  if (!/:focus-visible|:focus\b/.test(html)) warnings.push("Add visible keyboard focus styles.");
  if (/<input\b/i.test(html) && !/<label\b|aria-label\s*=/i.test(html)) warnings.push("Label input controls.");
  return { pass: errors.length === 0, errors: [...new Set(errors)].slice(0, 12), warnings };
}

export function repairArtifactPrompt(original: string, draft: string, issues: string[]): string {
  return `${original}\n\nREPAIR THE EXISTING DRAFT, preserving the requested features and visual identity.
Fix these concrete validation failures before returning the COMPLETE replacement file:
${issues.slice(0, 10).map(issue => `- ${issue}`).join("\n")}
<invalid-draft>\n${draft.slice(0, 100_000)}\n</invalid-draft>\nOutput only the corrected complete artifact; no explanation.`;
}
