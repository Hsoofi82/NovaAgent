/**
 * Nova content-generation engine regression suite.
 *
 * Covers exportEngine (PDF/DOCX/XLSX/PPTX/HTML/MD), gameEngine's browser
 * runtime, webBuilder and designSkills. Each test pins a defect that was found
 * by adversarially probing the real engines.
 *
 * The worker uses extensionless imports (Wrangler resolves them); Node does not,
 * so this file is run with the resolver hook in tests/ts-resolve.mjs — see the
 * "test:engines" script in package.json.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  exportDocument, analyzeContent, officeCapabilities,
  AVAILABLE_FORMATS, AVAILABLE_THEMES, parseDocument,
} from "../src/exportEngine.ts";
import { sanitizeHyperlink } from "../src/core.ts";
import {
  buildGameEnginePrompt, wrapGameHtml, isGameComplete, salvageGame,
  detectGameOrientation,
} from "../src/gameEngine.ts";
import {
  detectGameDesignIntent, assessGameDesign, describeIntent, isLightSetting,
  serializeRuntimeTheme, GAME_GENRES, GAME_SETTINGS,
} from "../src/gameDesign.ts";
import {
  buildWebBuilderSystemInstruction, buildWebAppPrompt, isWebAppComplete,
  normalizeWebAppOutput, validateWebApp, extractWebAppHtml,
} from "../src/webBuilder.ts";
import { buildUniversalDesignSkills, assessVisualQuality } from "../src/designSkills.ts";
import { rankSearchItems, normalizeSearchItems } from "../src/webSearch.ts";
import { runSearch, normalizeEffort, describeSearchRun } from "../src/search.ts";
import { classifyRequestIntent } from "../src/intent.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder();
const FA = "سلام دنیا این یک آزمون فارسی است";

const pdfText = (src, opts = {}) => latin1.decode(exportDocument(src, { format: "pdf", ...opts }).bytes);

/* ══════════════════════════════════════════════════════════════════════════
   EXPORT / PDF — hyperlink safety.
   PDF link annotations and exported HTML are opened by real viewers, and link
   targets come from model output + fetched pages. javascript:/data:/vbscript:
   were previously embedded verbatim into /A << /S /URI >> actions.
   ══════════════════════════════════════════════════════════════════════════ */
test("pdf: dangerous URI schemes never reach a link annotation", () => {
  const hostile = [
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "  javascript:alert(1)  ",
    "java\tscript:alert(1)", "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)",
    "file:///etc/passwd", "//evil.example/x",
  ];
  for (const url of hostile) {
    const pdf = pdfText(`[click me](${url})`);
    assert.doesNotMatch(pdf, /javascript|vbscript|data:text\/html|file:\/\/\//i,
      `unsafe scheme leaked into PDF for ${JSON.stringify(url)}`);
    // The visible label must survive — only the target is dropped.
    assert.match(pdf, /Tj/, "text should still be emitted");
  }
});

test("pdf: safe schemes still produce working link annotations", () => {
  for (const url of ["https://example.com/a?b=c", "http://example.com", "mailto:a@b.co", "tel:+15551234"]) {
    const pdf = pdfText(`[click](${url})`);
    assert.match(pdf, /\/Subtype\s*\/Link/, `no annotation emitted for ${url}`);
    assert.match(pdf, /\/S\s*\/URI/, `no URI action for ${url}`);
  }
});

test("html export: dangerous hrefs are dropped, text is escaped", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<script>x</script>", "vbscript:x"]) {
    const html = utf8.decode(exportDocument(`[c](${url})`, { format: "html" }).bytes);
    assert.doesNotMatch(html, /href="\s*(javascript|vbscript|data):/i, `leaked href for ${url}`);
  }
  const injected = utf8.decode(
    exportDocument('# <img src=x onerror=alert(1)>\n\n<script>alert(2)</script>', { format: "html" }).bytes);
  assert.doesNotMatch(injected, /<script>alert\(2\)/, "raw <script> must be escaped");
  assert.doesNotMatch(injected, /<img\s+src=x/, "raw <img> must be escaped");
});

test("docx: hyperlink relationships are sanitized", () => {
  // A .docx relationship Target is followed by Word on click.
  const zip = latin1.decode(exportDocument("[c](javascript:alert(1))", { format: "docx" }).bytes);
  assert.doesNotMatch(zip, /javascript:/i, "unsafe scheme in docx relationship");
});

test("core: sanitizeHyperlink blocks evasions but preserves legitimate URLs", () => {
  for (const bad of [
    "javascript:alert(1)", "JAVASCRIPT:x", " javascript:x", "java\tscript:x",
    "java\nscript:x", "data:text/html,x", "vbscript:x", "file:///etc/passwd",
    "//evil.com", "", "   ", null, undefined,
  ]) {
    assert.equal(sanitizeHyperlink(bad), null, `must reject ${JSON.stringify(bad)}`);
  }
  for (const good of [
    "https://a.co/p?q=1#f", "http://a.co", "mailto:x@y.z", "tel:+1",
    "#anchor", "relative/page.html",
  ]) {
    assert.equal(sanitizeHyperlink(good), good, `must preserve ${good}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   EXPORT — format/theme validation. `format` arrives from model tool args.
   ══════════════════════════════════════════════════════════════════════════ */
test("export: unknown/hostile format falls back to PDF instead of throwing", () => {
  for (const fmt of ["docxx", "PDF", "", "__proto__", "constructor", "toString", null, undefined, 7, {}]) {
    let r;
    assert.doesNotThrow(() => { r = exportDocument("body text", { format: fmt }); },
      `exportDocument threw for format=${JSON.stringify(fmt)}`);
    assert.ok(r.bytes instanceof Uint8Array && r.bytes.length > 0, "must produce bytes");
    assert.ok(AVAILABLE_FORMATS.includes(r.format), `bogus format returned: ${r.format}`);
    assert.ok(typeof r.ext === "string" && r.ext.length > 0, "must have an extension");
    assert.ok(typeof r.mime === "string" && r.mime.includes("/"), "must have a mime type");
  }
  // Case-insensitive match should resolve, not silently downgrade.
  assert.equal(exportDocument("x", { format: "DOCX" }).format, "docx");
  // A genuinely unsupported value should explain itself.
  assert.match(exportDocument("x", { format: "rtf" }).note ?? "", /Unsupported format/i);
});

test("export: every advertised format and theme actually renders", () => {
  for (const format of AVAILABLE_FORMATS) {
    const r = exportDocument(`# T\n\n${FA}\n\n| a | b |\n| --- | --- |\n| 1 | 2 |`, { format });
    assert.ok(r.bytes.length > 0, `${format} produced no bytes`);
    assert.equal(r.format, format);
  }
  for (const theme of AVAILABLE_THEMES) {
    const r = exportDocument("# Title\n\nBody text.", { format: "pdf", theme });
    assert.ok(r.bytes.length > 500, `theme ${theme} produced suspiciously small output`);
  }
});

test("index.ts validates create_pdf args against the engine's own lists", () => {
  const src = readFileSync(join(ROOT, "src/index.ts"), "utf8");
  // The hardcoded 5-theme array omitted corporate/sunset/ocean, which the tool
  // description explicitly offers — they silently became "professional".
  assert.doesNotMatch(src, /\["professional", "modern", "elegant", "minimal", "dark"\]\.includes/,
    "theme validation must use AVAILABLE_THEMES, not a stale hardcoded copy");
  assert.match(src, /\(AVAILABLE_THEMES as string\[\]\)\.includes/, "must validate against AVAILABLE_THEMES");
  assert.match(src, /\(AVAILABLE_FORMATS as string\[\]\)\.includes/, "must validate against AVAILABLE_FORMATS");
});

/* ══════════════════════════════════════════════════════════════════════════
   EXPORT — robustness against hostile / degenerate documents.
   ══════════════════════════════════════════════════════════════════════════ */
test("export: hostile documents never throw and never emit empty output", () => {
  const cases = {
    "empty": "",
    "whitespace": "   \n\n\t  ",
    "persian heavy": `# ${FA}\n\n${FA}\n\n${FA}`,
    "mixed rtl/ltr": `${FA} with English and https://example.com/x and \`code\``,
    "unbreakable word": "x".repeat(4000),
    "long persian word": "ب".repeat(3000),
    "astral/emoji": "Hello 🎉🚀 🏳️‍🌈 end",
    "lone surrogate": "bad \uD800 half",
    "control chars": "a\u0000b\u0007c\u001fd",
    "unterminated fence": "```js\nconst a=1;\n",
    "malformed table": "| a | b\n| --- |\n| 1 | 2 | 3 | 4 |",
    "deep nesting": Array.from({ length: 60 }, (_, i) => "  ".repeat(i) + "- l" + i).join("\n"),
    "xml hostile": `# </w:t></w:r>]]>&<>"'`,
    "huge table": "| A | B |\n| --- | --- |\n" + Array.from({ length: 900 }, (_, i) => `| ${i} | v |`).join("\n"),
    "wide table": "| " + Array.from({ length: 60 }, (_, i) => "c" + i).join(" | ") + " |\n"
      + "| " + Array.from({ length: 60 }, () => "---").join(" | ") + " |\n"
      + "| " + Array.from({ length: 60 }, (_, i) => "v" + i).join(" | ") + " |",
    "broken image": "![alt](https://invalid.invalid/x.png)",
    "image with js url": "![alt](javascript:alert(1))",
  };
  for (const format of AVAILABLE_FORMATS) {
    for (const [name, src] of Object.entries(cases)) {
      let bytes;
      assert.doesNotThrow(() => { bytes = exportDocument(src, { format }).bytes; },
        `${format} threw on "${name}"`);
      assert.ok(bytes.length > 0, `${format} produced 0 bytes for "${name}"`);
    }
  }
});

test("export: image URLs are sanitized at the parse boundary", () => {
  const img = parseDocument("![alt](javascript:alert(1))").blocks.find(b => b.type === "image");
  assert.ok(img, "image block should still exist");
  assert.equal(img.url, "", "unsafe image URL must be cleared");
  assert.equal(img.alt, "alt", "alt text must be preserved");

  const ok = parseDocument("![alt](https://example.com/i.png)").blocks.find(b => b.type === "image");
  assert.equal(ok.url, "https://example.com/i.png", "safe image URL must survive");

  // Parentheses inside the target used to truncate the match at the first ")",
  // so the whole image/link fell through to the plain-text tokenizer — which
  // ALSO meant it skipped URL sanitization entirely.
  const paren = parseDocument("![a](https://e.com/i(1).png)").blocks.find(b => b.type === "image");
  assert.equal(paren.url, "https://e.com/i(1).png", "balanced parens must be kept");
  const wiki = parseDocument("[l](https://en.wikipedia.org/wiki/Foo_(bar))").blocks[0];
  assert.equal(wiki.inlines[0].link, "https://en.wikipedia.org/wiki/Foo_(bar)", "wiki-style URL must survive");
});

test("pdf: output size and page count stay proportional to input", () => {
  const mk = n => Array.from({ length: n }, (_, i) => `Paragraph ${i} with wrapping text.`).join("\n\n");
  const small = exportDocument(mk(100), { format: "pdf" }).bytes.length;
  const large = exportDocument(mk(1000), { format: "pdf" }).bytes.length;
  assert.ok(large > small, "more content must produce more bytes");
  // Guard against pathological blow-up (e.g. the font re-embedded per page).
  assert.ok(large < small * 20, `non-linear growth: ${small} -> ${large}`);
  const pages = (latin1.decode(exportDocument(mk(1000), { format: "pdf" }).bytes).match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.ok(pages > 5 && pages < 200, `implausible page count: ${pages}`);
});

test("pdf: the Unicode font is embedded only when actually needed", () => {
  // The subset font is ~41KB; embedding it in every Latin PDF would triple the
  // size of the common case for no benefit.
  const latinPdf = pdfText("Pure latin content only.");
  const persianPdf = pdfText(FA);
  assert.doesNotMatch(latinPdf, /FontFile2/, "Latin-only PDF must not embed the CID font");
  assert.match(persianPdf, /FontFile2/, "Persian PDF MUST embed the font (else it renders blank)");
});

test("pdf: Persian output uses the embedded CID font, not base-14", () => {
  const pdf = pdfText(FA);
  assert.match(pdf, /\/Subtype\s*\/Type0/, "Persian requires a Type0/CID font");
  assert.match(pdf, /Identity-H/, "expected Identity-H encoding");
  // Regression guard: Persian PDFs were once rerouted to DOCX entirely.
  assert.equal(exportDocument(FA, { format: "pdf" }).format, "pdf", "must stay a real PDF");
});

test("export: analyzeContent and officeCapabilities stay stable", () => {
  const a = analyzeContent("# H\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert.equal(a.hasTables, true);
  assert.equal(a.headings, 1);
  assert.equal(analyzeContent(FA).rtl, true, "Persian must be detected as RTL");
  assert.equal(analyzeContent("plain english").rtl, false);
  const caps = officeCapabilities();
  assert.ok(Array.isArray(caps.formats) && caps.formats.length === AVAILABLE_FORMATS.length);
});

/* ══════════════════════════════════════════════════════════════════════════
   GAME ENGINE — the runtime ships to the browser as a string, so a syntax
   error or a stray backtick is invisible until a user opens the game.
   ══════════════════════════════════════════════════════════════════════════ */
const gameSrc = readFileSync(join(ROOT, "src/gameEngine.ts"), "utf8");
const runtimeCode = (() => {
  const m = gameSrc.match(/const NOVA_GE_RUNTIME = String\.raw`([\s\S]*?)`;/);
  assert.ok(m, "NOVA_GE_RUNTIME template not found");
  return m[1];
})();

test("game runtime: parses as browser JS and contains no TS syntax", () => {
  assert.doesNotThrow(() => new Function("window", runtimeCode), "runtime must parse");
  // A backtick inside String.raw terminates the template and silently truncates
  // the shipped runtime — this actually happened while editing it.
  assert.equal(runtimeCode.includes("`"), false, "no backticks allowed inside the runtime template");
  for (const [re, label] of [
    [/:\s*(string|number|boolean|any|void)\b/, "TS type annotation"],
    [/\binterface\s+\w+/, "TS interface"],
    [/<[A-Z]\w*>/, "TS generic"],
  ]) {
    assert.doesNotMatch(runtimeCode, re, `${label} leaked into the browser payload`);
  }
});

test("game runtime: exposes teardown and does not leak listeners across init()", () => {
  const counts = { win: 0, canvas: 0, doc: 0 };
  const mkTarget = key => ({
    addEventListener() { counts[key]++; },
    removeEventListener() { counts[key]--; },
  });
  const canvas = {
    ...mkTarget("canvas"), width: 0, height: 0,
    style: { setProperty() {} },
    getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
    setPointerCapture() {},
  };
  const documentStub = {
    ...mkTarget("doc"), hidden: false,
    documentElement: { style: { setProperty() {} } },
    getElementById: id => (id === "nova-canvas" ? canvas : { hidden: true, textContent: "" }),
  };
  const windowStub = {
    ...mkTarget("win"), innerWidth: 960, innerHeight: 540,
    screen: { orientation: { addEventListener() {}, removeEventListener() {} } },
  };
  const g = globalThis;
  const saved = { window: g.window, document: g.document, performance: g.performance,
    requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame,
    addEventListener: g.addEventListener, removeEventListener: g.removeEventListener };
  try {
    g.window = windowStub; g.document = documentStub;
    g.performance = { now: () => 0 };
    g.requestAnimationFrame = () => 1; g.cancelAnimationFrame = () => {};
    g.addEventListener = windowStub.addEventListener;
    g.removeEventListener = windowStub.removeEventListener;

    new Function("window", runtimeCode)(windowStub);
    const NovaGE = windowStub.NovaGE;
    assert.ok(NovaGE, "NovaGE must be exported");
    assert.equal(typeof NovaGE.destroy, "function", "NovaGE.destroy is required for teardown");

    NovaGE.init({ orientation: "landscape" });
    const afterFirst = { ...counts };
    NovaGE.init({ orientation: "landscape" });
    const afterSecond = { ...counts };
    assert.deepEqual(afterSecond, afterFirst,
      "init() twice must tear the previous instance down, not stack listeners");

    const inst = NovaGE.init({});
    assert.equal(typeof inst.destroy, "function", "instance needs destroy()");
    // Junk orientation must normalize, not become the live value.
    assert.equal(NovaGE.init({ orientation: "sideways" }).orientation, "landscape");
    assert.equal(NovaGE.init({ orientation: "PORTRAIT" }).orientation, "portrait");
    // Degenerate dimensions clamp to the documented minimum.
    const tiny = NovaGE.init({ width: -5, height: 0 });
    assert.ok(tiny.width >= 240 && tiny.height >= 240, "dimensions must clamp to >= 240");
    NovaGE.destroy();
  } finally {
    Object.assign(g, saved);
  }
});

test("game runtime: clears held input when the tab is hidden", () => {
  // Returning to a backgrounded tab used to resume with keys still held down,
  // and pointercancel was not handled at all.
  assert.match(runtimeCode, /visibilitychange/, "must react to tab visibility");
  assert.match(runtimeCode, /pointercancel/, "must handle interrupted gestures");
  assert.match(runtimeCode, /pointer\.down = false/, "must release the pointer");
});

test("game: wrapGameHtml produces a valid, self-contained document", () => {
  const html = wrapGameHtml('const game = NovaGE.init({}); game.scene("play",{render(){}}); game.start("menu");',
    { title: "My Game", rtl: true, orientation: "portrait" });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.match(html, /id="nova-canvas"/);
  assert.match(html, /--nova-ar:9\/16/, "portrait aspect must be applied");
  assert.doesNotMatch(html, /<script src=/i, "must not load external scripts");
  assert.match(html, /<meta name="viewport"/, "needs a viewport meta");
  // Title must not be able to break out of the tag.
  const evil = wrapGameHtml("x", { title: '</title><script>alert(1)</script>' });
  assert.doesNotMatch(evil, /<script>alert\(1\)/, "title must be sanitized");
});

test("game: completeness and salvage gates behave", () => {
  const good = `const game = NovaGE.init({ orientation: "auto" });
${"// filler\n".repeat(40)}
game.scene("menu", { render(g){} });
game.scene("play", { enter(g){}, update(g,dt){}, render(g){} });
game.scene("gameover", { render(g){} });
game.start("menu");`;
  assert.equal(isGameComplete(good), true, "valid game must pass");
  assert.equal(isGameComplete("game.start('menu')"), false, "too short must fail");
  assert.equal(isGameComplete(good.replace("NovaGE.init", "eval")), false, "eval must be rejected");
  assert.equal(isGameComplete("<html><script>x</script></html>"), false, "HTML must be rejected");
  assert.equal(isGameComplete(good + "\ndocument.getElementById('x')"), false, "DOM access must be rejected");
  // salvage appends the missing start() call.
  const salvaged = salvageGame(good.replace('game.start("menu");', ""));
  assert.match(salvaged, /game\.start\("menu"\)/, "salvage must restore the entry point");
});

test("game: orientation detection maps both languages", () => {
  assert.equal(detectGameOrientation("a vertical portrait runner"), "portrait");
  assert.equal(detectGameOrientation("یک بازی عمودی"), "portrait");
  assert.equal(detectGameOrientation("wide landscape 16:9 shooter"), "landscape");
  assert.equal(detectGameOrientation("بازی افقی"), "landscape");
  assert.equal(detectGameOrientation("a game"), "auto");
});

/* ══════════════════════════════════════════════════════════════════════════
   GAME DESIGN INTENT — every generated game used to look the same: one
   hardcoded purple/cyan shell, one runtime palette, four chiptune blips and a
   mandatory arcade menu/play/gameover template. These tests pin the
   differentiation so a refactor cannot quietly collapse it back.
   ══════════════════════════════════════════════════════════════════════════ */

/** Boot NOVA_GE_RUNTIME against recording stubs. Returns { NovaGE, calls }. */
function bootRuntime(theme) {
  const ramp = () => ({
    setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {},
  });
  const calls = { fills: [], fonts: [], oscillators: [], filters: 0 };
  const ctxStub = {
    _fill: null, textAlign: "", textBaseline: "", globalAlpha: 1,
    set fillStyle(v) { calls.fills.push(v); this._fill = v; },
    get fillStyle() { return this._fill; },
    set font(v) { calls.fonts.push(v); },
    get font() { return ""; },
    save() {}, restore() {}, fillRect() {}, beginPath() {}, roundRect() {},
    arc() {}, fill() {}, fillText() {},
  };
  const canvas = {
    addEventListener() {}, removeEventListener() {},
    width: 0, height: 0, style: { setProperty() {} },
    getContext: () => ctxStub,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
    setPointerCapture() {},
  };
  const documentStub = {
    addEventListener() {}, removeEventListener() {}, hidden: false,
    documentElement: { style: { setProperty() {} } },
    getElementById: id => (id === "nova-canvas" ? canvas : { hidden: true, textContent: "" }),
  };
  const AudioStub = function () {
    return {
      state: "running", currentTime: 0, destination: {},
      resume() {}, close() {},
      createOscillator() {
        const osc = { type: "", detune: ramp(), frequency: ramp(), connect() {}, start() {}, stop() {} };
        calls.oscillators.push(osc);
        return osc;
      },
      createGain() { return { gain: ramp(), connect() {} }; },
      createBiquadFilter() { calls.filters++; return { type: "", frequency: ramp(), connect() {} }; },
    };
  };
  const windowStub = {
    addEventListener() {}, removeEventListener() {},
    innerWidth: 960, innerHeight: 540,
    AudioContext: AudioStub,
    screen: { orientation: { addEventListener() {}, removeEventListener() {} } },
    NOVA_THEME: theme,
  };
  const g = globalThis;
  const saved = {
    window: g.window, document: g.document, performance: g.performance,
    requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame,
  };
  g.window = windowStub; g.document = documentStub;
  g.performance = { now: () => 0 };
  g.requestAnimationFrame = () => 1; g.cancelAnimationFrame = () => {};
  try {
    new Function("window", runtimeCode)(windowStub);
    return { NovaGE: windowStub.NovaGE, calls, restore: () => Object.assign(g, saved) };
  } catch (e) {
    Object.assign(g, saved);
    throw e;
  }
}

test("game design: intent is materially different per genre, not a shared template", () => {
  const horror = detectGameDesignIntent("a scary horror game in a haunted hospital");
  const candy = detectGameDesignIntent("a cute colorful candy match-3 puzzle for kids");
  const strategy = detectGameDesignIntent("a medieval tower defense strategy game");

  assert.equal(horror.genre, "horror");
  assert.equal(candy.genre, "puzzle");
  assert.equal(strategy.genre, "strategy");

  // The three axes that made every game look identical must all diverge.
  const keyOf = i => [i.palette.bg, i.palette.canvas, i.typography.display, i.chrome.frame, i.audio, i.camera].join("|");
  assert.notEqual(keyOf(horror), keyOf(candy));
  assert.notEqual(keyOf(candy), keyOf(strategy));
  assert.notEqual(keyOf(horror), keyOf(strategy));

  // Horror must not come out as a colourful arcade cabinet.
  assert.equal(horror.mood, "dread");
  assert.equal(horror.audio, "sub");
  assert.equal(horror.chrome.frame, "vignette");
  assert.equal(candy.audio, "chiptune");
  assert.ok(candy.motion.particleDensity > horror.motion.particleDensity,
    "a playful game must be more particle-dense than a dread one");

  // Scene shape follows the genre instead of a forced menu/play/gameover.
  for (const intent of [horror, candy, strategy]) {
    assert.ok(intent.scenes.includes("menu") && intent.scenes.includes("play"),
      `boot contract is mandatory, got ${intent.scenes}`);
  }
  assert.ok(strategy.scenes.includes("briefing"), `strategy needs a briefing, got ${strategy.scenes}`);
  assert.ok(strategy.scenes.includes("results"), `strategy needs a results scene, got ${strategy.scenes}`);
  assert.ok(candy.scenes.includes("solved"), `a puzzle ends solved, got ${candy.scenes}`);
  assert.ok(!horror.scenes.includes("gameover"), "horror must not use the arcade gameover card");
  assert.ok(describeIntent(horror).includes("horror"));
});

test("game design: detection is bilingual and always yields a complete intent", () => {
  assert.equal(detectGameDesignIntent("یک بازی ترسناک در بیمارستان").genre, "horror");
  assert.equal(detectGameDesignIntent("بازی پازل فکری").genre, "puzzle");
  assert.equal(detectGameDesignIntent("بازی مسابقه رانندگی").genre, "racing");
  assert.equal(detectGameDesignIntent("یک بازی استراتژی دفاع از برج").genre, "strategy");
  assert.equal(detectGameDesignIntent("سایبرپانک نئون").setting, "cyberpunk");

  // Every genre keyword must resolve to a fully-populated intent — a missing
  // table entry would ship `undefined` straight into the CSS and the prompt.
  const seenSettings = new Set();
  for (const genre of GAME_GENRES) {
    const intent = detectGameDesignIntent(genre === "arcade" ? "" : genre);
    seenSettings.add(intent.setting);
    for (const [k, v] of Object.entries(intent.palette)) {
      assert.match(String(v), /^(#[0-9a-f]{3,8}|rgba?\()/i, `${genre}.palette.${k} is not a colour`);
    }
    assert.ok(intent.typography.display.length > 4, `${genre} has no display font`);
    assert.ok(intent.chrome.backdrop.length > 3, `${genre} has no backdrop`);
    assert.ok(intent.scenes.length >= 3, `${genre} has too few scenes`);
    assert.ok(intent.presentation.length >= 2, `${genre} has no presentation rules`);
    assert.ok(intent.loop.length > 20, `${genre} has no loop description`);
    assert.ok(intent.hint.en && intent.hint.fa, `${genre} is missing a localised hint`);
  }
  assert.ok(seenSettings.size >= 6, `genres collapse onto too few settings: ${[...seenSettings]}`);

  // And every declared setting has a real palette + typography row.
  for (const setting of GAME_SETTINGS) {
    const intent = detectGameDesignIntent(setting === "paper" ? "board game" : setting);
    assert.ok(intent.palette.bg, `${setting} has no palette`);
    assert.equal(typeof isLightSetting(intent.setting), "boolean");
  }
});

test("game design: light settings really are light, not dark-on-dark", () => {
  // The old shell was dark-only, which is most of why every game shared an
  // atmosphere. A cozy puzzle and a board game must render on light ground.
  for (const concept of ["a cute candy puzzle", "a paper board game with hexes", "a minimal abstract geometric puzzle"]) {
    const intent = detectGameDesignIntent(concept);
    assert.equal(isLightSetting(intent.setting), true, `${concept} -> ${intent.setting} should be light`);
    // Crude but sufficient: a light background's first hex digit is high.
    assert.match(intent.palette.bg, /^#[def]/i, `${intent.setting} bg is not light`);
    assert.match(intent.palette.ink, /^#[0-3]/i, `${intent.setting} ink is not dark`);
  }
  const dark = detectGameDesignIntent("a horror game");
  assert.equal(isLightSetting(dark.setting), false);
  assert.match(dark.palette.bg, /^#0/);
});

test("game: the shell is generated from the intent, not one fixed palette", () => {
  const horror = wrapGameHtml("game.start('menu');", { title: "Asylum", concept: "a scary horror game in an asylum" });
  const candy = wrapGameHtml("game.start('menu');", { title: "Sweets", concept: "a cute candy match-3 puzzle" });
  const retro = wrapGameHtml("game.start('menu');", { title: "Blaster", concept: "a retro 8-bit pixel arcade shooter" });

  // Two games must not share a background, a frame identity or a font stack.
  const bg = html => html.match(/--bg:([^;]+);/)[1];
  assert.notEqual(bg(horror), bg(candy));
  assert.notEqual(bg(candy), bg(retro));
  assert.match(horror, /data-frame="vignette"/);
  assert.match(candy, /data-frame="arcade"/);
  assert.match(retro, /data-frame="crt"/);

  // The literal hardcoded look is gone for good.
  for (const html of [horror, candy, retro]) {
    for (const legacy of ["#8b5cf6", "#22d3ee", "#050816", "#0d1630", "#07111f"]) {
      assert.equal(html.includes(legacy), false, `legacy hardcoded ${legacy} still in the shell`);
    }
    assert.equal(html.includes("Touch / WASD / Keys"), false, "the fixed control hint must be genre-aware");
    assert.match(html, /window\.NOVA_THEME=\{/, "runtime theme must be injected");
    assert.doesNotMatch(html, /<script src=/i, "must stay self-contained");
  }

  // The hint follows the camera and the document language.
  assert.match(candy, /Tap or click a tile/);
  const fa = wrapGameHtml("x", { title: "پازل", rtl: true, concept: "بازی پازل فکری" });
  assert.match(fa, /<html lang="fa" dir="rtl">/);
  assert.match(fa, /ضربه بزنید/, "Persian games need the Persian hint");

  // Theme JSON can never break out of the script tag.
  const theme = serializeRuntimeTheme(detectGameDesignIntent("horror"));
  assert.equal(theme.includes("</"), false, "theme JSON must escape </");
  // Backward compatibility: no concept at all still produces a valid document.
  const bare = wrapGameHtml("x", {});
  assert.match(bare, /^<!doctype html>/i);
  assert.match(bare, /--nova-ar:16\/16|--nova-ar:16\/9/);
});

test("game runtime: draw defaults and audio come from the theme", () => {
  const theme = {
    canvas: "#101010", ink: "#fefefe", shapeA: "#aa0000", shapeB: "#00aa00",
    particle: "#0000aa", font: "Georgia, serif", audio: "sub", density: 1,
  };
  const { NovaGE, calls, restore } = bootRuntime(theme);
  try {
    const game = NovaGE.init({ orientation: "landscape" });
    assert.equal(game.palette.canvas, "#101010", "theme must reach game.palette");
    assert.equal(game.audio, "sub");

    // Uncoloured draw calls must pick up the theme, not the old purple/cyan.
    game.clear();
    game.rect(0, 0, 10, 10);
    game.circle(5, 5, 3);
    game.text("hi", 0, 0);
    assert.deepEqual(calls.fills, ["#101010", "#aa0000", "#00aa00", "#fefefe"]);
    assert.match(calls.fonts[0], /Georgia, serif/, "canvas font must be themed");
    assert.match(game.font(30, "600"), /^600 30px Georgia, serif$/);

    // Aliased event names resolve instead of silently playing nothing, and the
    // "sub" character adds a lowpass + a detuned second voice.
    game.sound("explosion");
    assert.equal(calls.oscillators.length, 2, "sub character layers a detuned voice");
    assert.equal(calls.filters, 1, "sub character must be lowpass filtered");
    assert.equal(calls.oscillators[0].type, "sine", "sub overrides the waveform");

    // An unknown name must be a silent no-op, never a throw inside the loop.
    const before = calls.oscillators.length;
    game.sound("definitely-not-a-sound");
    assert.equal(calls.oscillators.length, before);

    // Density scales the automatic burst count.
    game.burst(1, 1);
    NovaGE.destroy();
  } finally {
    restore();
  }
});

test("game runtime: chiptune stays unfiltered so characters are audibly distinct", () => {
  const { NovaGE, calls, restore } = bootRuntime({ audio: "chiptune" });
  try {
    const game = NovaGE.init({});
    game.sound("coin");
    assert.equal(calls.filters, 0, "chiptune must not be lowpassed");
    assert.equal(calls.oscillators.length, 1, "chiptune has no detuned layer");
    assert.equal(calls.oscillators[0].type, "sine");
    NovaGE.destroy();
  } finally {
    restore();
  }
});

test("game: the prompt carries design intent and no longer forces the arcade template", () => {
  const horror = buildGameEnginePrompt("mobile", "portrait", "ltr", detectGameDesignIntent("a scary horror game"));
  const strategy = buildGameEnginePrompt("desktop", "landscape", "ltr", detectGameDesignIntent("a medieval tower defense strategy game"));

  for (const prompt of [horror, strategy]) {
    assert.match(prompt, /DESIGN INTENT/, "intent brief missing");
    assert.match(prompt, /ANTI-SAMENESS RULES/, "anti-sameness rules missing");
    assert.match(prompt, /game\.palette/, "palette API must be documented");
    assert.match(prompt, /Allocate NOTHING per frame/, "per-frame allocation rule lost");
    assert.match(prompt, /GENERAL UI\/UX SKILLS/, "design skills missing");
    assert.match(prompt, /GAME SURFACE/, "game surface rule missing");
    assert.equal(prompt.includes('Must define 3 scenes: "menu", "play", "gameover"'), false,
      "the rigid arcade template must be gone");
    assert.match(prompt, /game\.start\("menu"\)/, "boot contract must survive");
  }

  assert.match(horror, /HORROR/);
  assert.match(horror, /PORTRAIT MODE/);
  assert.match(horror, /limited light radius/, "horror needs its visibility rule");
  assert.match(strategy, /STRATEGY/);
  assert.match(strategy, /LANDSCAPE MODE/);
  assert.match(strategy, /"briefing"/, "strategy scene shape must reach the prompt");
  assert.match(strategy, /resource bar/, "strategy needs its interface rule");
  assert.equal(horror.includes("limited light radius") && strategy.includes("limited light radius"), false,
    "presentation rules must differ between genres");

  // Default call (no intent) must still produce a usable prompt.
  const fallback = buildGameEnginePrompt();
  assert.match(fallback, /DESIGN INTENT/);
  assert.match(fallback, /ADAPTIVE MODE/);
});

test("game: the design scorer separates intent-honouring code from legacy output", () => {
  const intent = detectGameDesignIntent("a retro arcade shooter");
  const good = `const game = NovaGE.init({ orientation: "auto" });
game.scene("menu", {
  render(game) {
    game.clear();
    game.text("Blaster", game.view.width / 2, 80, 32, game.palette.accent);
  }
});
game.scene("play", {
  enter(game) {
    game.state.score = 0;
  },
  update(game, dt) {
    game.state.score += dt;
  },
  render(game) {
    game.clear(game.palette.canvas);
    game.rect(1, 1, 2, 2, game.palette.shapeA);
  },
  onResize(game, view) {
    game.state.cx = view.width / 2;
  }
});
game.scene("gameover", {
  render(game) {
    game.text("done", 1, 1);
  }
});
game.sound("laser");
game.sound("hit");
game.sound("coin");
game.start("menu");`;
  const legacy = `const game = NovaGE.init({});
game.scene("menu", { render(game) { game.text("Blaster", 10, 10); } });
game.scene("play", {
  update(game, dt) {
    const live = game.state.bullets.filter(b => b.on);
  },
  render(game) {
    game.clear("#07111f");
    game.rect(0, 0, 4, 4, "#7c3aed");
  }
});
game.sound("hit");
game.start("menu");`;

  const strong = assessGameDesign(good, intent);
  const weak = assessGameDesign(legacy, intent);
  assert.ok(strong.score > weak.score, `expected ${strong.score} > ${weak.score}`);
  assert.equal(strong.pass, true, `good code should pass, issues: ${strong.issues}`);
  assert.equal(weak.pass, false, "legacy neon output must not pass");
  assert.ok(weak.issues.includes("legacy-neon-palette"), `expected legacy-neon-palette, got ${weak.issues}`);
  assert.ok(weak.issues.includes("ignores-theme-palette"), `expected ignores-theme-palette, got ${weak.issues}`);
  assert.ok(weak.issues.includes("per-frame-allocation"), `expected per-frame-allocation, got ${weak.issues}`);
  assert.ok(weak.issues.includes("monotone-audio"), `expected monotone-audio, got ${weak.issues}`);

  // The genre's own scene list must not be treated as mandatory: a strategy
  // game only owes the engine "menu" + "play".
  const strategyIntent = detectGameDesignIntent("a medieval tower defense strategy game");
  assert.ok(!assessGameDesign(good, strategyIntent).issues.includes("missing-required-scenes"),
    "only menu/play are required, never the genre-specific scenes");

  // Never throws on junk input — it runs inside the generation path.
  assert.equal(typeof assessGameDesign("", intent).score, "number");
  assert.equal(typeof assessGameDesign(undefined, intent).score, "number");
});

/* ══════════════════════════════════════════════════════════════════════════
   DESIGN SYSTEM — was entirely dead code: zero callers for either export.
   ══════════════════════════════════════════════════════════════════════════ */
test("design system: is actually wired into both generators", () => {
  const webSrc = readFileSync(join(ROOT, "src/webBuilder.ts"), "utf8");
  assert.match(webSrc, /buildUniversalDesignSkills\(/, "web builder must inject the design skills");
  assert.match(webSrc, /assessVisualQuality\(/, "web builder must use the quality scorer");
  assert.match(gameSrc, /buildUniversalDesignSkills\(/, "game engine must inject the design skills");

  // And the injected text must actually reach the prompts.
  const gamePrompt = buildGameEnginePrompt("mobile", "portrait", "rtl");
  assert.match(gamePrompt, /GENERAL UI\/UX SKILLS/, "design skills missing from game prompt");
  assert.match(gamePrompt, /GAME SURFACE/, "game surface rule missing");
  assert.match(gamePrompt, /PORTRAIT MODE/, "orientation rule missing");
  assert.match(gamePrompt, /Allocate NOTHING per frame/, "per-frame allocation rule missing");

  const webPrompt = buildWebBuilderSystemInstruction("rtl");
  assert.match(webPrompt, /GENERAL UI\/UX SKILLS/, "design skills missing from web prompt");
  assert.match(webPrompt, /APPLICATION SURFACE/, "application surface rule missing");
  assert.match(webPrompt, /RTL/, "explicit direction missing");
});

test("design system: skills text adapts to direction and surface", () => {
  assert.match(buildUniversalDesignSkills("rtl", "game"), /RTL/);
  assert.match(buildUniversalDesignSkills("ltr", "webapp"), /LTR/);
  assert.match(buildUniversalDesignSkills("auto", "webapp"), /infer language and direction/);
});

test("design system: quality scorer separates finished from unfinished output", () => {
  const bare = "<!doctype html><html><body><button>x</button><script>1</script></body></html>";
  const poor = assessVisualQuality(bare, "ltr");
  assert.equal(poor.pass, false, "a bare page must not pass");
  assert.ok(poor.issues.length > 0, "must report why it failed");
  assert.ok(poor.issues.includes("insufficient-css"), `expected insufficient-css, got ${poor.issues}`);
  // Scores must be comparable, not arbitrary.
  const better = assessVisualQuality(readFileSync(join(ROOT, "src/adminDashboard.html"), "utf8"), "rtl");
  assert.ok(better.score > poor.score, "a real dashboard must outscore a bare page");
});

/* ══════════════════════════════════════════════════════════════════════════
   WEB BUILDER
   ══════════════════════════════════════════════════════════════════════════ */
test("web builder: output contract forbids unsafe constructs", () => {
  const instr = buildWebBuilderSystemInstruction("ltr");
  assert.match(instr, /^You are Nova Web Builder/);
  assert.match(instr, /No eval\(\)/, "must forbid eval in the contract");
  assert.match(instr, /ONE file/i, "must require a single self-contained file");

  const withEval = '<!doctype html><html><body><script>eval("x")</script>' + "y".repeat(400) + "</body></html>";
  assert.equal(isWebAppComplete(withEval), false, "eval must fail the gate");
  assert.equal(isWebAppComplete('<!doctype html><html><body><script>new Function("x")</script>' + "y".repeat(400) + "</body></html>"), false);
  assert.equal(isWebAppComplete("<!doctype html><html><body>no script</body></html>"), false, "needs a script");
  assert.equal(isWebAppComplete("tiny"), false);
});

test("web builder: extraction and salvage handle model wrapper noise", () => {
  const body = "<!doctype html><html><head><style>" + "body{margin:0}".repeat(20)
    + "</style></head><body><div>hi</div><script>var a=1;</script></body></html>";
  assert.equal(extractWebAppHtml("```html\n" + body + "\n```"), body, "must strip markdown fences");
  assert.equal(extractWebAppHtml("Here you go:\n" + body), body, "must strip leading prose");
  assert.equal(extractWebAppHtml("no html at all"), "", "must return empty when there is no HTML");
  // Fragment-only output gets wrapped into a real document.
  const wrapped = extractWebAppHtml("<div>frag</div><script>1</script>");
  assert.match(wrapped, /^<!doctype html>/i);
  assert.match(wrapped, /<meta name="viewport"/);
  assert.equal(isWebAppComplete(body), true, "a well-formed document must pass the gate");

  // Truncated MID-SCRIPT must NOT pass: appending </body></html> after an
  // unterminated <script> leaves them inside the script, so the browser renders
  // a blank page.
  const midScript = "<!doctype html><html><body><script>function f(){ var a=1;" + "// pad\n".repeat(60);
  assert.equal(isWebAppComplete(midScript), false, "truncated script must fail the gate");
  const repaired = normalizeWebAppOutput(midScript);
  assert.ok(repaired, "salvage must recover truncated output");
  assert.equal(
    (repaired.match(/<script\b[^>]*>/gi) ?? []).length,
    (repaired.match(/<\/script\s*>/gi) ?? []).length,
    "salvage must balance <script> tags",
  );
  assert.match(repaired, /<\/html>\s*$/i, "salvage must close the document");

  // Missing closing tags are also repaired.
  const noClose = "<!doctype html><html><body><div>x</div><script>var a=1;</script>" + "y".repeat(320);
  assert.ok(normalizeWebAppOutput(noClose), "salvage must close an unterminated document");
});

test("web builder: quality assessment is wired into the generation pipeline", () => {
  // validateWebApp / assessVisualQuality were dead code; ensure the heavy-gen
  // pipeline actually consults them (advisory: logged, never fatal).
  const src = readFileSync(join(ROOT, "src/index.ts"), "utf8");
  assert.match(src, /assessQuality\?:/, "HeavyGenSpec must declare an assessQuality hook");
  assert.match(src, /assessQuality: \(code: string\) => validateWebApp\(code\)/, "web-app spec must supply it");
  assert.match(src, /spec\.assessQuality\(normalized\)/, "pipeline must call it");
  // It must NOT reject output: a low score only warns.
  const call = src.slice(src.indexOf("if (spec.assessQuality)"), src.indexOf("return normalized;", src.indexOf("if (spec.assessQuality)")));
  assert.match(call, /logger\.warn/, "low quality must be logged");
  assert.doesNotMatch(call, /continue;/, "quality must never reject a usable generation");
});

test("web builder: validateWebApp reports structure and visuals together", () => {
  const report = validateWebApp(readFileSync(join(ROOT, "src/adminDashboard.html"), "utf8"), "rtl");
  assert.equal(typeof report.structuralPass, "boolean");
  assert.equal(typeof report.score, "number");
  assert.equal(report.direction, "rtl");
  assert.ok(Array.isArray(report.issues));
});

test("source hygiene: no stray control characters in any source file", () => {
  // A literal backspace (0x08) once landed in a regex where the two-character
  // escape \b belonged: /<(body|div|...)<BS>/ compiled fine and matched nothing,
  // silently disabling the fragment-wrapping path. Control bytes in source are
  // invisible in most editors, so assert their absence directly.
  const files = [
    "src/core.ts", "src/index.ts", "src/exportEngine.ts", "src/gameEngine.ts",
    "src/webBuilder.ts", "src/designSkills.ts", "src/novaFont.ts", "src/gameDesign.ts",
    "tests/engines.test.mjs", "tests/regression.test.mjs",
  ];
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    const offenders = [];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      // Allow tab (9), LF (10), CR (13). Everything else below 0x20 plus DEL.
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
        offenders.push(`0x${code.toString(16)} at line ${text.slice(0, i).split("\n").length}`);
      }
    }
    assert.deepEqual(offenders, [], `${rel} contains control characters: ${offenders.join(", ")}`);
  }
});

test("web builder: recognises HTML regardless of tag case", () => {
  const upper = `<!DOCTYPE HTML>
<HTML lang="en"><HEAD><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<STYLE>${"body{margin:0}".repeat(20)}</STYLE></HEAD>
<BODY><MAIN><h1>App</h1><button id="b">Go</button></MAIN>
<SCRIPT>document.getElementById("b").addEventListener("click",function(){});</SCRIPT>
</BODY></HTML>`;
  assert.equal(isWebAppComplete(upper), true, "uppercase tags are valid HTML and must pass");
  assert.ok(normalizeWebAppOutput(upper), "uppercase output must normalize");
  // `</html >` with legal whitespace must also be recognised as the end.
  assert.ok(normalizeWebAppOutput(upper.replace("</HTML>", "</html >")), "spaced close tag must be handled");
  // Trailing prose after the document must be stripped, not retained.
  assert.match(extractWebAppHtml(upper + "\nsome trailing prose"), /<\/HTML>$/);
  // Uppercase fragments still get wrapped into a real document.
  assert.match(extractWebAppHtml("<DIV>x</DIV><SCRIPT>1</SCRIPT>"), /^<!doctype html>/i);
  assert.match(extractWebAppHtml("<div>x</div><script>1</script>"), /^<!doctype html>/i);
});

test("web builder: prompt carries the concept and detects direction", () => {
  assert.match(buildWebAppPrompt("a budget tracker"), /budget tracker/);
  assert.match(buildWebAppPrompt("یک ماشین حساب"), /Persian \(fa\), RTL/);
  assert.match(buildWebAppPrompt("a calculator"), /English \(en\), LTR/);
  // Oversized input must be clipped, not passed through.
  assert.ok(buildWebAppPrompt("x".repeat(50_000)).length < 10_000, "description must be clipped");
});

// ── جستجوی وب: فیلتر هرز + پایداری رتبه‌بندی ────────────────────────────────
const si = (link, title, snippet) => ({ link, title, snippet });

test("web search: junk filter matches hosts, not substrings of paths", () => {
  // این‌ها قبلاً به‌اشتباه حذف می‌شدند: الگوی `ads?\.` رشته‌ی "ad." را داخل مسیر
  // پیدا می‌کرد، پس downLOAD. / uploAD. / threAD. / soundtrACK. هرز شمرده می‌شدند.
  const legit = [
    si("https://example.com/download.zip", "Download the dataset", "A long enough snippet describing the dataset download page contents."),
    si("https://example.com/upload.php", "Upload guide", "How to upload files to the service with a reasonably descriptive snippet here."),
    si("https://forum.example.org/thread.html", "Forum thread", "A discussion thread about the topic with plenty of descriptive snippet text."),
    si("https://music.example.net/soundtrack.html", "Soundtrack listing", "The full soundtrack listing for the film with track names and durations."),
  ];
  const kept = rankSearchItems(legit, 10).map(r => r.link);
  for (const item of legit) {
    assert.ok(kept.includes(item.link), `legitimate result must survive: ${item.link}`);
  }
});

test("web search: junk filter still drops ad hosts and rival result pages", () => {
  const junk = [
    si("https://ads.example.com/x", "Ad", "An advertisement page snippet that is long enough to score."),
    si("https://ad.doubleclick.net/x", "Ad", "Another advertisement page snippet that is long enough to score."),
    si("https://track.example.com/x", "Tracker", "A tracking pixel endpoint with a snippet long enough to score."),
    // بدون www هم باید حذف شود — قبلاً `(^|\.)bing\.com` این را نمی‌گرفت.
    si("https://bing.com/search?q=x", "Bing", "A search engine result page snippet that is long enough to score."),
    si("https://www.bing.com/search?q=x", "Bing", "A search engine result page snippet that is long enough to score."),
    si("https://duckduckgo.com/?q=x", "DDG", "A search engine result page snippet that is long enough to score."),
    si("https://www.google.com/search?q=x", "Google", "A search engine result page snippet that is long enough to score."),
  ];
  assert.deepEqual(rankSearchItems(junk, 10), [], "every junk link must be filtered");
  // یک نتیجه‌ی سالم روی همان دامنه‌ها نباید قربانی شود.
  const mixed = rankSearchItems([...junk, si("https://example.com/ads-explained", "What ads are", "An article explaining how online advertising works, with a full snippet.")], 10);
  assert.equal(mixed.length, 1, "a normal page about ads is not an ad host");
});

test("web search: ranking is idempotent so citation indices stay aligned", () => {
  // مسیر web_search ابزار، فهرست را یک‌بار رتبه‌بندی می‌کند و همان را هم به مدل
  // (با شماره‌ی [1]..[n]) و هم به فرمت‌کننده می‌دهد؛ فرمت‌کننده دوباره رتبه‌بندی
  // می‌کند. اگر این عمل idempotent نباشد، ارجاع‌های مدل به منبع اشتباه اشاره می‌کنند.
  const raw = [
    si("https://a.example.com/1", "Alpha result", "x".repeat(300)),
    si("https://b.example.com/2", "Beta result", "y".repeat(120)),
    si("https://c.example.com/3", "Gamma result", "z".repeat(40)),
    si("https://d.example.com/4", "Delta result", "w".repeat(200)),
    si("https://ads.example.com/5", "Junk", "q".repeat(300)),
    si("https://e.example.com/6", "Epsilon result", "v".repeat(80)),
    si("https://f.example.com/7", "Zeta result", "u".repeat(260)),
  ];
  const once = rankSearchItems(raw, 6);
  const twice = rankSearchItems(once, 6);
  assert.deepEqual(twice.map(r => r.link), once.map(r => r.link), "re-ranking must not reorder or drop");
  assert.ok(!once.some(r => r.link.includes("ads.example.com")), "junk must not survive the first rank");
});

test("web search: domain quota is only charged for kept results", () => {
  // سه نتیجه از یک دامنه مجاز است. قبلاً یک نتیجه‌ی «تکراریِ تقریبی» هم یکی از آن
  // سه سهم را مصرف می‌کرد و نتیجه‌ی چهارمِ سالم بی‌دلیل حذف می‌شد.
  const dupSnippet = "the exact same descriptive snippet text repeated across two results here";
  const items = [
    si("https://one.example.com/a", "Completely distinct alpha heading", dupSnippet),
    si("https://one.example.com/b", "Totally different beta heading", dupSnippet),
    si("https://one.example.com/c", "Wholly separate gamma heading", "quarterly revenue figures broken down by region and product category"),
    si("https://one.example.com/d", "Entirely other delta heading", "an interview transcript discussing the history of the manufacturing plant"),
  ];
  const kept = rankSearchItems(items, 10).filter(r => r.link.startsWith("https://one.example.com"));
  assert.equal(kept.length, 3, "three non-duplicate results from one domain must be kept");
});

test("web search: normalizeSearchItems rejects unsafe and duplicate links", () => {
  const items = normalizeSearchItems([
    si("javascript:alert(1)", "bad", "snippet"),
    si("https://user:pass@example.com/x", "creds", "snippet"),
    si("https://ok.example.com/x", "good", "snippet"),
    si("https://ok.example.com/x", "dup", "snippet"),
    si("https://nofields.example.com/y", "", ""),
  ], 10);
  assert.deepEqual(items.map(i => i.link), ["https://ok.example.com/x"]);
});

/* ══════════════════════════════════════════════════════════════════════════
   SEARCH — the canonical adaptive engine (src/search.ts) and the routing that
   reaches it. The engine must be a *single* call that always comes back with
   prose: no limit, dead provider or dead model may turn into a thrown error,
   because the loop above it has nothing to retry with.
   ══════════════════════════════════════════════════════════════════════════ */
function stubDeps(over = {}) {
  const calls = { search: 0, read: 0, think: 0, queries: [], opts: [] };
  const deps = {
    lang: "fa",
    calls,
    async search(q, num, opts) {
      calls.search++; calls.queries.push(q); calls.opts.push(opts ?? null);
      return Array.from({ length: Math.min(num, 4) }, (_, i) => ({
        title: `t${calls.search}-${i}`,
        link: `https://site${i}.example.com/a${calls.search}`,
        snippet: `شواهد ${q} عدد ${100 + i}`,
      }));
    },
    async readPage(url, maxChars) { calls.read++; return `متن کامل صفحه ${url}`.slice(0, maxChars); },
    async think(system, user) {
      calls.think++;
      if (system.startsWith("You are the planning stage")) {
        return JSON.stringify({
          effort: "deep", recency: "days", complexity: 6, want_sources: false,
          goals: ["g1"], queries: [{ q: "q1", goal: "g1", recency: "days" }, { q: "q2", goal: "g1" }],
          stop_when: "enough",
        });
      }
      if (system.startsWith("You are the sufficiency check")) {
        return JSON.stringify({ enough: true, missing: [], next_queries: [] });
      }
      if (system.startsWith("You are the verification stage")) {
        return JSON.stringify({ conflicts: [], weak: [], confidence: "high" });
      }
      return "پاسخ نهایی: عدد ۱۰۰ در روز جاری.";
    },
    ...over,
  };
  return deps;
}

test("engine returns a finished answer from one call", async () => {
  const deps = stubDeps();
  const out = await runSearch("قیمت دلار امروز چنده", "auto", deps);
  assert.equal(out.degraded, null, `unexpected degrade: ${out.degraded}`);
  assert.ok(out.answer.includes("پاسخ نهایی"), out.answer);
  assert.equal(out.wantSources, false, "sources stay hidden unless asked");
  assert.ok(out.sources.length > 0);
  assert.equal(out.effort, "deep", "planner effort is honoured for auto");
  assert.ok(deps.calls.opts.some(o => o && o.dateRestrict), "freshness window must reach the provider");
  assert.match(describeSearchRun(out), /deep/);
});

test("explicit effort hint overrides the planner", async () => {
  const out = await runSearch("سوپر دیپ سرچ درباره قیمت دلار در چند سال اخیر", "super", stubDeps());
  assert.equal(out.effort, "super");
  assert.ok(out.answer.length > 0);
});

test("a dead provider degrades instead of throwing", async () => {
  const out = await runSearch("نرخ تورم ایران", "fast", stubDeps({ async search() { return []; } }));
  assert.equal(out.sources.length, 0);
  assert.equal(out.degraded, "no_sources");
  assert.ok(out.answer.trim().length > 0, "must still say something honest");
});

test("model failures never sink the run", async () => {
  const out = await runSearch("نرخ تورم ایران", "deep", stubDeps({ async think() { throw new Error("model down"); } }));
  assert.ok(out.answer.trim().length > 0);
  assert.ok(out.sources.length > 0, "retrieval still happened via the structural fallback plan");
});

test("garbage plan JSON falls back structurally", async () => {
  const deps = stubDeps({ async think(system) {
    if (system.startsWith("You are the planning stage")) return "not json at all";
    return "answer text";
  } });
  const out = await runSearch("تورم ایران", "auto", deps);
  assert.ok(deps.calls.queries.includes("تورم ایران"), "raw request becomes the query");
  assert.ok(out.answer.length > 0);
});

test("cancellation is the only thrown outcome", async () => {
  await assert.rejects(
    () => runSearch("نرخ تورم ایران", "fast", stubDeps({ isCancelled: async () => true })),
    /CANCELLED_BY_USER/,
  );
});

test("normalizeEffort maps legacy depth names", () => {
  assert.equal(normalizeEffort("quick"), "fast");
  assert.equal(normalizeEffort("standard"), "deep");
  assert.equal(normalizeEffort("super"), "super");
  assert.equal(normalizeEffort(undefined), "auto");
  assert.equal(normalizeEffort("nonsense"), "auto");
});

test("want_sources from the plan turns the footer on", async () => {
  const out = await runSearch("منبع هم بده", "deep", stubDeps({ async think(system) {
    if (system.startsWith("You are the planning stage")) {
      return JSON.stringify({ effort: "deep", recency: "any", complexity: 4, want_sources: true, goals: [], queries: [{ q: "a" }], stop_when: "" });
    }
    if (system.startsWith("You are the sufficiency check")) return JSON.stringify({ enough: true });
    if (system.startsWith("You are the verification stage")) return JSON.stringify({ confidence: "medium" });
    return "با منبع";
  } }));
  assert.equal(out.wantSources, true);
});

/* ══════════════════════════════════════════════════════════════════════════
   SEARCH ROUTING — the router only forces research when the user names the act.
   Deciding that a *topic* (prices, news, crypto) needs the web is the model's
   job, and the old keyword tables that made that decision are gone.
   ══════════════════════════════════════════════════════════════════════════ */
const SELF = ["نوا", "nova"];
const PERSONAS = [{ id: "sarcastic", aliases: ["نیش", "طعنه‌زن"] }];

function route(text, extra = {}) {
  return classifyRequestIntent({
    text, isGroup: false, isReply: false,
    selfNames: SELF, personaAliases: PERSONAS,
    ...extra,
  });
}

test("named search acts route to research with forced tool", () => {
  for (const t of [
    "نوا یه سوپر دیپ سرچ بزن درباره قیمت دلار تو ایران توی چند سال اخیر تحقیق کن",
    "نوا سرچ کن ببین امروز چه خبره",
    "یه تحقیق کن درباره انرژی هسته‌ای",
    "please search the web for the latest on this",
    "can you google it for me",
    "do a deep dive on tesla earnings",
    "منبع هم بده",
  ]) {
    const d = route(t);
    assert.equal(d.category, "research", `expected research for: ${t} (got ${d.category}/${d.reason})`);
    assert.equal(d.forceToolCall, true, `expected forced tool for: ${t}`);
    assert.ok(d.allowedTools?.includes("search"), "search must be allowed");
    assert.ok(!d.allowedTools?.includes("deep_search"), "no legacy tool name");
  }
});

test("volatile topics are no longer keyword-routed to search", () => {
  for (const t of [
    "قیمت دلار چنده",
    "قیمت بیت کوین امروز چند شد؟",
    "آخرین خبرهای ایران چیه",
    "what's the weather like today",
    "who won the match last night",
    "bitcoin price now",
  ]) {
    const d = route(t);
    assert.notEqual(d.category, "research", `must not force research for: ${t}`);
    assert.ok(
      d.category === "general_knowledge" || d.category === "conversation",
      `expected model-judged category for "${t}", got ${d.category}/${d.reason}`,
    );
  }
});

test("non-search deterministic routing is unchanged", () => {
  const cases = [
    ["این عکس رو سیاه سفید کن", { hasAttachedImage: true }, "image_edit"],
    ["یه عکس از یه گربه فضایی بکش", {}, "image_generate"],
    ["نوا اسمت رو بذار آوا", {}, "name_switch"],
    ["برو تو حالت نیش", {}, "persona_switch"],
    ["میوتش کن برای یه ساعت", { isReply: true, repliedUserId: 42, isChatAdmin: true }, "moderation"],
    ["یه بازی مافیا بساز", {}, "game_create"],
    ["نوا هر روز صبح ساعت ۸ بهم بگو آب بخورم", {}, "scheduling"],
  ];
  for (const [text, extra, expected] of cases) {
    const d = route(text, extra);
    assert.equal(d.category, expected, `"${text}" → ${d.category}/${d.reason}, expected ${expected}`);
  }
});

test("calling Nova by name is never a persona/search command", () => {
  for (const t of ["نوا", "نوا؟", "نوا جان", "nova"]) {
    const d = route(t);
    assert.ok(
      d.category !== "persona_switch" && d.category !== "persona_info" && d.category !== "research",
      `"${t}" → ${d.category}`,
    );
  }
});

/* ── Search engine: latency optimisations ──────────────────────────────────
   These three pin the behaviour added when the engine was tuned for real-world
   speed. They are ordering/budget properties, not output assertions, so they
   fail loudly if a later refactor quietly serialises the pipeline again. */

test("page reads run concurrently with the gap analysis", async () => {
  // Proof by construction: the sufficiency-check call blocks until the first
  // page read has *started*. If reads only began after the gap analysis
  // returned (the old, serial order) this would deadlock, so the race below
  // would lose to the 3s guard.
  let firstReadStarted;
  const readStarted = new Promise(res => { firstReadStarted = res; });

  const deps = stubDeps({
    async readPage(url, maxChars) {
      firstReadStarted();
      return `متن کامل صفحه ${url}`.slice(0, maxChars);
    },
    async think(system) {
      if (system.startsWith("You are the planning stage")) {
        return JSON.stringify({
          effort: "deep", recency: "days", complexity: 6, want_sources: false,
          goals: ["g1"], queries: [{ q: "q1", goal: "g1" }, { q: "q2", goal: "g1" }],
          stop_when: "enough",
        });
      }
      if (system.startsWith("You are the sufficiency check")) {
        await readStarted;
        return JSON.stringify({ enough: true, missing: [], next_queries: [] });
      }
      if (system.startsWith("You are the verification stage")) {
        return JSON.stringify({ conflicts: [], weak: [], confidence: "high" });
      }
      return "پاسخ نهایی.";
    },
  });

  const out = await Promise.race([
    runSearch("نرخ تورم ایران", "deep", deps),
    new Promise((_, rej) => setTimeout(() => rej(new Error("reads are still serialised after the gap analysis")), 3000)),
  ]);
  assert.ok(out.answer.includes("پاسخ نهایی"), out.answer);
});

test("read-ahead cannot exhaust the page-read budget", async () => {
  // deep allows 4 reads over 2 rounds. The round-1 read-ahead may take at most
  // half of them, so a gap-filling round still gets to read its own findings.
  let round = 0;
  const deps = stubDeps({
    async think(system) {
      if (system.startsWith("You are the planning stage")) {
        return JSON.stringify({
          effort: "deep", recency: "any", complexity: 7, want_sources: false,
          goals: ["g1"], queries: [{ q: "q1", goal: "g1" }],
          stop_when: "enough",
        });
      }
      if (system.startsWith("You are the sufficiency check")) {
        round++;
        return round === 1
          ? JSON.stringify({ enough: false, missing: ["m1"], next_queries: [{ q: "q3", goal: "g1" }] })
          : JSON.stringify({ enough: true, missing: [], next_queries: [] });
      }
      if (system.startsWith("You are the verification stage")) {
        return JSON.stringify({ conflicts: [], weak: [], confidence: "medium" });
      }
      return "پاسخ نهایی.";
    },
  });

  await runSearch("تحلیل کامل بازار مسکن", "deep", deps);
  assert.ok(deps.calls.read > 0, "nothing was read at all");
  assert.ok(deps.calls.read <= 4, `read budget overspent: ${deps.calls.read}`);
});

test("caller voice is injected into the synthesis prompt", async () => {
  let synthSystem = "";
  const deps = stubDeps({
    voice: "You are Nova. Voice: warm and direct.",
    async think(system) {
      if (system.startsWith("You are the planning stage")) {
        return JSON.stringify({
          effort: "fast", recency: "live", complexity: 2, want_sources: false,
          goals: ["g1"], queries: [{ q: "q1", goal: "g1" }], stop_when: "enough",
        });
      }
      if (system.startsWith("You are the sufficiency check") || system.startsWith("You are the verification stage")) {
        return JSON.stringify({ enough: true, missing: [], next_queries: [], conflicts: [], weak: [], confidence: "high" });
      }
      synthSystem = system;
      return "پاسخ نهایی.";
    },
  });

  await runSearch("قیمت دلار", "fast", deps);
  assert.match(synthSystem, /WHO YOU ARE/, "synthesis prompt lost the persona block");
  assert.match(synthSystem, /warm and direct/, "the caller's voice never reached the writer");
});
