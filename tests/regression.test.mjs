/**
 * Nova regression suite.
 *
 * Runs on plain `node` with no dependencies (Workers code cannot be imported
 * directly — it has top-level Cloudflare bindings — so pure, self-contained
 * logic is extracted from src/index.ts and exercised here).
 *
 * Every test below pins a bug that was actually found and fixed, so a
 * regression fails loudly instead of silently returning to the old behaviour.
 *
 *   node --test tests/regression.test.mjs
 * or
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "src/index.ts"), "utf8");

/* Pure primitives are imported directly — no source scraping, no eval. Node
   strips the TypeScript types natively. */
import {
  safeCalculateExpression,
  timingSafeEqualStr,
  numericHostIsPrivate,
  assertPublicHttpUrl,
  historyTrimCount,
  toolCallKey,
  HISTORY_MAX_TURNS,
} from "../src/core.ts";

/** Strip comments so structural assertions only ever see real code. */
function stripComments(code) {
  const BLOCK = /\/\*[\s\S]*?\*\//g;
  const LINE = new RegExp("(^|[^:'\"\\\\])//[^\\n]*", "g");
  return code.replace(BLOCK, " ").replace(LINE, "$1");
}

/** Pull one function's source text out of index.ts for structural assertions. */
function fnSource(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found in src/index.ts`);
  const open = SRC.indexOf("{", start);
  let depth = 0, i = open, inStr = null, inComment = null;
  for (; i < SRC.length; i++) {
    const c = SRC[i], n = SRC[i + 1];
    if (inComment === "line") { if (c === "\n") inComment = null; continue; }
    if (inComment === "block") { if (c === "*" && n === "/") { inComment = null; i++; } continue; }
    if (inStr) { if (c === "\\") { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "/" && n === "/") { inComment = "line"; i++; continue; }
    if (c === "/" && n === "*") { inComment = "block"; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return SRC.slice(start, i);
}

/* ══════════════════════════════════════════════════════════════════════════
   BUG #1 — `calculate` used Function("return "+expr), which ALWAYS throws on
   Cloudflare Workers (code generation from strings is disallowed). Replaced
   with a recursive-descent parser.
   ══════════════════════════════════════════════════════════════════════════ */
test("calculate: no dynamic code generation anywhere in the worker", () => {
  // The Workers runtime forbids eval/new Function at runtime.
  assert.equal(/\bnew Function\s*\(/.test(SRC), false, "new Function() is not allowed on Workers");
  assert.equal(/[^.\w]eval\s*\(/.test(SRC), false, "eval() is not allowed on Workers");
  assert.equal(
    /\bFunction\s*\(\s*[`'"]/.test(SRC),
    false,
    "Function(string) constructor is not allowed on Workers",
  );
});

test("calculate: arithmetic, precedence, associativity", () => {
  const calc = safeCalculateExpression;
  assert.equal(calc("2+3"), 5);
  assert.equal(calc("2+3*4"), 14, "must respect precedence");
  assert.equal(calc("(2+3)*4"), 20, "must respect parentheses");
  assert.equal(calc("10-2-3"), 5, "subtraction is left-associative");
  assert.equal(calc("100/4/5"), 5, "division is left-associative");
  assert.equal(calc("2^3^2"), 512, "exponentiation is RIGHT-associative");
  assert.equal(calc("-5+8"), 3, "leading unary minus");
  assert.equal(calc("2^-2"), 0.25, "signed exponent");
  assert.equal(calc("10%3"), 1);
  assert.equal(calc("1,500+500"), 2000, "thousands separators are stripped");
  assert.equal(calc(" 1.5 * 2 "), 3, "whitespace tolerated");
  assert.equal(calc(".5+.5"), 1, "leading-dot decimals");
});

test("calculate: rejects malicious and malformed input", () => {
  const calc = safeCalculateExpression;
  for (const bad of [
    "alert(1)", "globalThis", "1;2", "2+", "*2", "(1+2", "1+2)",
    "[]", "{}", "1..2", "", "   ", "1 2", "0x10", "process.exit",
    "constructor", "__proto__",
  ]) {
    assert.throws(() => calc(bad), /INVALID_EXPRESSION|INVALID_RESULT/, `must reject: ${JSON.stringify(bad)}`);
  }
  assert.throws(() => calc("1/0"), /DIVISION_BY_ZERO/);
  assert.throws(() => calc("5%0"), /DIVISION_BY_ZERO/);
  assert.throws(() => calc("x".repeat(201)), /INVALID_EXPRESSION/);
});

/* ══════════════════════════════════════════════════════════════════════════
   BUG #16 — SSRF: assertPublicHttpUrl missed decimal/hex/octal/short-form IP
   encodings, so 0x7f000001 and 2130706433 reached loopback.
   ══════════════════════════════════════════════════════════════════════════ */
test("SSRF: numericHostIsPrivate blocks every encoding of a private address", () => {
  const isPriv = numericHostIsPrivate;
  const blocked = [
    "127.0.0.1", "127.1", "127.0.1",           // loopback + short forms
    "2130706433", "0x7f000001", "017700000001", // decimal / hex / octal
    "0x7f.1", "10.0.0.1", "10.1",
    "192.168.1.1", "172.16.0.1", "172.31.255.255",
    "169.254.169.254",                          // cloud metadata
    "0.0.0.0", "100.64.0.1", "224.0.0.1",
  ];
  for (const host of blocked) {
    assert.equal(isPriv(host), true, `must block ${host}`);
  }
  const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1", "11.0.0.1"];
  for (const host of allowed) {
    assert.equal(isPriv(host), false, `must allow public ${host}`);
  }
});

test("SSRF: all untrusted fetches route through the guarded helper", () => {
  // sendPhoto's fallback download and the asset-downloader HEAD probe both took
  // model/search-supplied URLs straight to a raw fetch with no host validation.
  const idx = SRC.indexOf("sendPhoto direct URL failed");
  assert.notEqual(idx, -1, "sendPhoto fallback comment not found");
  const window = SRC.slice(idx, idx + 900);
  assert.match(window, /fetchExternalSafe\(/, "sendPhoto fallback must use fetchExternalSafe");
  assert.doesNotMatch(window, /fetchWithTimeout\(\s*photo/, "must not raw-fetch a model-supplied photo URL");
  assert.doesNotMatch(SRC, /fetchWithTimeout\(item\.link/, "search-result links must not be raw-fetched");
});

/* ══════════════════════════════════════════════════════════════════════════
   BUG #13 — initData HMAC compared with `!==`, which short-circuits and leaks
   how many leading hex chars matched. This is the only auth gate on the
   owner-only admin API.
   ══════════════════════════════════════════════════════════════════════════ */
test("auth: HMAC comparison is constant-time and length-safe", () => {
  const eq = timingSafeEqualStr;
  assert.equal(eq("abc123", "abc123"), true);
  assert.equal(eq("abc123", "abc124"), false);
  assert.equal(eq("abc123", "xbc123"), false, "difference in first char");
  assert.equal(eq("", ""), true);
  assert.equal(eq("short", "longer-value"), false, "length mismatch must not throw");
  assert.equal(eq("longer-value", "short"), false);
  // The implementation must not early-return on the first mismatch.
  const body = readFileSync(join(ROOT, "src/core.ts"), "utf8");
  const fnBody = body.slice(body.indexOf("export function timingSafeEqualStr"), body.indexOf("SSRF ADDRESS"));
  assert.doesNotMatch(fnBody, /return\s+false/, "must fold differences, not early-return");
});

test("auth: validateTelegramInitData uses the constant-time compare", () => {
  const body = fnSource("validateTelegramInitData");
  assert.match(body, /timingSafeEqualStr\(/, "must use the constant-time comparator");
  assert.doesNotMatch(body, /computed\s*!==\s*hash/, "must not use !== on the digest");
  assert.match(body, /typeof candidate\.id !== "number"/, "must validate the user id type");
});

/* ══════════════════════════════════════════════════════════════════════════
   BUG #29 — group memory leaked across users: when a user's own entry was
   missing it fell back to `Object.values(mems)[0]`, i.e. some other member's
   personality / key facts / relationship graph.
   ══════════════════════════════════════════════════════════════════════════ */
test("memory: no arbitrary cross-user memory fallback remains", () => {
  const code = stripComments(SRC);
  const offenders = [...code.matchAll(/Object\.values\((?:mems|memoryMap)[^)]*\)\s*\[0\]/g)];
  assert.equal(
    offenders.length, 0,
    "memory lookups must be keyed strictly by userId, never fall back to another user's profile",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   BUG #21 — kv_store (which backs ALL worker state) was never created, so on a
   fresh D1 database every read returned null and update-claiming threw 503.
   ══════════════════════════════════════════════════════════════════════════ */
test("schema: kv_store is auto-migrated before any state access", () => {
  assert.match(SRC, /CREATE TABLE IF NOT EXISTS kv_store/, "kv_store must be created");
  assert.match(SRC, /CREATE INDEX IF NOT EXISTS idx_kv_expires/, "expires_at needs an index for the TTL sweep");
  assert.match(SRC, /function ensureCoreSchema/, "migration helper must exist");
  // Must be awaited on BOTH entry points, before the first KV touch.
  const fetchIdx = SRC.indexOf("async fetch(request");
  const schedIdx = SRC.indexOf("async scheduled(");
  assert.ok(fetchIdx !== -1 && schedIdx !== -1);
  assert.match(SRC.slice(fetchIdx, fetchIdx + 2000), /await ensureCoreSchema\(env\)/, "fetch must await migration");
  assert.match(SRC.slice(schedIdx, schedIdx + 2000), /await ensureCoreSchema\(env\)/, "cron must await migration");
});

/* ══════════════════════════════════════════════════════════════════════════
   BUG #22 — `DELETE ... LIMIT n` is unsupported on D1; the statement always
   errored (swallowed by .catch), so expired rows were never removed.
   ══════════════════════════════════════════════════════════════════════════ */
test("housekeeping: no unsupported DELETE ... LIMIT statements", () => {
  const bad = [...SRC.matchAll(/DELETE FROM \w+[\s\S]{0,200}?LIMIT/g)]
    .filter(m => !/IN \(\s*SELECT/i.test(m[0]));
  assert.equal(bad.length, 0, "D1 requires DELETE ... WHERE key IN (SELECT ... LIMIT n)");
});

/* ══════════════════════════════════════════════════════════════════════════
   BUG #7/#8 — getOrCreateSession read the cache then discarded it (every call
   hit D1, and object identity broke), and registered its in-flight lock after
   the promise could already have deleted it.
   ══════════════════════════════════════════════════════════════════════════ */
test("session: cache hits are returned instead of re-reading D1", () => {
  const body = fnSource("getOrCreateSession");
  assert.match(body, /return ensureUserScaffolding\(cached, user\)/, "a cache hit must be returned");
  assert.match(body, /sessionLoadLocks\.set\(chat\.id, guarded\)/, "in-flight load must be registered");
  // The lock must be cleared exactly once, via finally on the guarded promise.
  assert.match(body, /\.finally\(\(\) => \{ sessionLoadLocks\.delete\(chat\.id\); \}\)/);
});

test("session: per-user scaffolding still runs on the cache-hit path", () => {
  // Returning the shared cached object skips hydrateSession, which is where a
  // group's second speaker used to get their userMemories/userHistories entry.
  const body = fnSource("ensureUserScaffolding");
  assert.match(body, /userMemories\.has\(user\.id\)/);
  assert.match(body, /userHistories\.has\(user\.id\)/);
});

/* ══════════════════════════════════════════════════════════════════════════
   BUG #9 — HeavyTaskGate.release() did slots.shift(), dropping the OLDEST
   slot rather than the finishing job's own. After prune() reclaimed a stale
   entry, a finishing job evicted a *running* job's slot and the pool
   under-counted, allowing unbounded concurrent heavy generation.
   ══════════════════════════════════════════════════════════════════════════ */
test("heavy gate: releases the caller's own slot, not the oldest", () => {
  const cls = stripComments(SRC.slice(SRC.indexOf("class HeavyTaskGate"), SRC.indexOf("const HEAVY_ENGINE_BUSY")));
  assert.doesNotMatch(cls, /slots\.shift\(\)/, "must not shift() — slots are not fungible");
  assert.match(cls, /release\(token[^)]*\)/, "release must take the acquired token");
  assert.match(cls, /slots\.delete\(token\)/, "must delete that specific slot");
  // Acquire must hand back an identifier the caller can return.
  assert.match(cls, /tryAcquire\(\)\s*:\s*number \| null/);
  // And the call site must actually thread it through.
  assert.match(SRC, /const heavySlot = heavyTaskGate\.tryAcquire\(\)/);
  assert.match(SRC, /heavyTaskGate\.release\(heavySlot\)/);
});

/* ══════════════════════════════════════════════════════════════════════════
   BUG #2/#3/#4 — the agent loop's `finally` deleted the message it had just
   edited into the final answer, and loop exhaustion produced total silence.
   ══════════════════════════════════════════════════════════════════════════ */
test("agent loop: delivering a reply releases the loading message", () => {
  const start = SRC.indexOf("async function processAIRequestUnlocked");
  const body = SRC.slice(start, SRC.indexOf("\nfunction formatThinkingTags", start));
  assert.notEqual(start, -1);

  // The single delivery helper must clear the id before sending.
  assert.match(body, /const deliverFinalResponse = async/, "delivery must go through one helper");
  const helper = body.slice(body.indexOf("const deliverFinalResponse"), body.indexOf("const geminiBudget"));
  assert.match(helper, /loadingState\.id = undefined;[\s\S]{0,200}?await sendStreamingResponse/,
    "must clear loadingState.id BEFORE handing the message to sendStreamingResponse");

  // No direct sendStreamingResponse calls may bypass the helper.
  const direct = [...body.matchAll(/await sendStreamingResponse\(/g)];
  assert.equal(direct.length, 1, "only deliverFinalResponse may call sendStreamingResponse");

  // Loop exhaustion must produce a visible message.
  assert.match(body, /if \(!responseDelivered\) \{/, "must detect an undelivered turn");
  assert.match(body, /Agent loop finished without delivering a response/);
});

test("agent loop: retry hands off message ownership", () => {
  const start = SRC.indexOf("async function processAIRequestUnlocked");
  const body = SRC.slice(start, SRC.indexOf("\nfunction formatThinkingTags", start));
  // The recursive retry must not pass loadingState.id while still owning it.
  assert.doesNotMatch(body, /retryCount \+ 1, loadingState\.id/, "must hand off, not share, the message id");
  assert.match(body, /const handoffMsgId = loadingState\.id;/);
});

test("agent loop: usage increment is never a floating promise", () => {
  const start = SRC.indexOf("async function processAIRequestUnlocked");
  const body = SRC.slice(start, SRC.indexOf("\nfunction formatThinkingTags", start));
  // The original defect was a bare `incrementUsageWithUser(...)` with nothing
  // holding onto it, so the isolate could return before the counter landed and
  // usage was silently undercounted. Awaiting it fixed that but put a mutex and
  // a D1 write inside aiChatMutex *after* the answer was already delivered, so
  // the chat's next message queued behind bookkeeping. `runBackground` is the
  // third option: the promise is registered and drained by
  // drainBackgroundTasks() in ctx.waitUntil, so it still cannot be lost.
  const calls = [...body.matchAll(/(await\s+|runBackground\(\(\)\s*=>\s*)?incrementUsageWithUser\(/g)];
  assert.ok(calls.length > 0, "expected usage increments in the agent loop");
  for (const m of calls) {
    assert.ok(m[1], "incrementUsageWithUser must be awaited or handed to runBackground, never left floating");
  }
  assert.match(SRC, /await drainBackgroundTasks\(8000\)/, "background tasks must still be drained post-response");
});

test("agent loop: deferred session writes are guaranteed to be flushed", () => {
  const start = SRC.indexOf("async function processAIRequestUnlocked");
  const body = SRC.slice(start, SRC.indexOf("\nfunction formatThinkingTags", start));
  assert.match(body, /deferSessionSave\(session\)/, "the agent loop must defer its bookkeeping write");
  const helper = SRC.slice(
    SRC.indexOf("function deferSessionSave"),
    SRC.indexOf("async function flushPendingSessions"),
  );
  assert.match(helper, /sessionCache\.set\(/, "the isolate cache must stay authoritative for read-your-writes");
  assert.match(helper, /_pendingSessionFlush\.set\(/, "the write must be queued, not dropped");
  // The drain is what turns "deferred" into "persisted"; force=true is required
  // or saveSession's coalescing window simply re-buffers the session forever.
  assert.match(SRC, /await flushPendingSessions\(env, true\)/, "the post-response drain must force-flush");
});

/* ══════════════════════════════════════════════════════════════════════════
   BUG #6 — tool calls were only de-duplicated within one model response, so
   the same web_search/generate_image could re-run on each loop iteration.
   ══════════════════════════════════════════════════════════════════════════ */
test("agent loop: identical tool calls are suppressed across iterations", () => {
  assert.match(SRC, /class ToolCallLedger/, "a per-turn ledger must exist");
  assert.match(SRC, /const toolLedger = new ToolCallLedger\(\)/, "the loop must instantiate it");
  assert.match(SRC, /toolLedger\.partition\(functionCalls\)/, "calls must be partitioned before execution");
  assert.match(SRC, /toolLedger\.record\(executed, freshCalls\)/, "results must be recorded");
  const cls = SRC.slice(SRC.indexOf("class ToolCallLedger"), SRC.indexOf("async function executeStructuredTools"));
  assert.match(cls, /repeated_call: true/, "repeats must be flagged back to the model");
});

/* ══════════════════════════════════════════════════════════════════════════
   BUG #28 — the 40-turn history cap spliced blindly and could orphan a
   functionResponse whose matching functionCall had just been trimmed away.
   ══════════════════════════════════════════════════════════════════════════ */
test("history: trimming never leaves an orphaned functionResponse at the head", () => {
  // Mirrors addToHistory's retention step using the shared helper it calls.
  const history = [];
  const push = (role, parts) => {
    history.push({ role, parts, timestamp: history.length });
    const cut = historyTrimCount(history, HISTORY_MAX_TURNS);
    if (cut > 0) history.splice(0, cut);
  };
  // A long conversation whose turns are mostly tool traffic, so the naive
  // "slice to the last N" cut lands on a functionResponse very often.
  for (let i = 0; i < 60; i++) {
    push("user", [{ text: `q${i}` }]);
    push("model", [{ functionCall: { name: "web_search", args: {} } }]);
    push("user", [{ functionResponse: { name: "web_search", response: {} } }]);
  }
  assert.ok(history.length <= HISTORY_MAX_TURNS, `history must stay capped, got ${history.length}`);
  assert.equal(
    history[0].parts.some(p => p.functionResponse), false,
    "the retained window must not start with an orphaned tool response",
  );

  // Direct check: a window boundary landing on a response must advance past it.
  const turns = [
    { parts: [{ text: "old" }] },
    { parts: [{ functionResponse: { name: "t" } }] },
    { parts: [{ text: "keep" }] },
  ];
  assert.equal(historyTrimCount(turns, 2), 2, "must skip the orphan rather than retain it");
  assert.equal(historyTrimCount(turns, 99), 0, "nothing to trim when under the cap");
});

test("tool identity: keys are argument-order independent", () => {
  const a = toolCallKey({ name: "web_search", args: { query: "x", lang: "fa" } });
  const b = toolCallKey({ name: "web_search", args: { lang: "fa", query: "x" } });
  assert.equal(a, b, "reordered arguments must produce the same identity");
  assert.notEqual(a, toolCallKey({ name: "web_search", args: { query: "y", lang: "fa" } }));
  assert.notEqual(a, toolCallKey({ name: "deep_search", args: { query: "x", lang: "fa" } }));
  assert.equal(toolCallKey({ name: "list_reminders" }), "list_reminders:{}");
});

test("SSRF: assertPublicHttpUrl rejects non-public targets end-to-end", () => {
  for (const bad of [
    "http://127.0.0.1/x", "http://localhost/x", "https://[::1]/x",
    "http://169.254.169.254/latest/meta-data/", "http://2130706433/",
    "http://0x7f000001/", "http://10.0.0.5/", "http://192.168.1.1/",
    "http://metadata.google.internal/", "http://foo.internal/",
    "ftp://example.com/x", "http://user:pass@example.com/",
    "https://[fe80::1]/", "https://[fc00::1]/",
  ]) {
    assert.throws(() => assertPublicHttpUrl(bad), /blocked|not allowed|unsupported/, `must reject ${bad}`);
  }
  for (const good of ["https://example.com/a?b=c", "http://8.8.8.8/", "https://api.telegram.org/bot123/x"]) {
    assert.doesNotThrow(() => assertPublicHttpUrl(good), `must allow ${good}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   BUG #34 — ~13 admin endpoints the dashboard calls did not exist server-side,
   leaving half the Control Center silently broken.
   ══════════════════════════════════════════════════════════════════════════ */
test("admin API: every endpoint the dashboard calls is implemented", () => {
  const html = readFileSync(join(ROOT, "src/adminDashboard.html"), "utf8");
  const admin = SRC.slice(SRC.indexOf("async function handleAdminAPI"), SRC.indexOf("async function handleWebAppAPI"));
  assert.ok(admin.length > 1000, "admin handler not located");

  // Collect the concrete route segments the dashboard requests.
  const called = new Set();
  for (const m of html.matchAll(/api\(\s*["'`]\/api\/admin\/([a-z0-9/_-]*)/gi)) {
    const seg = m[1].replace(/\/+$/, "");
    if (seg) called.add(seg);
  }
  // Routes reached by string concatenation (users/<id>/...) plus static ones.
  const dynamic = [...html.matchAll(/\/api\/admin\/([a-z]+)\/"\s*\+/gi)].map(m => m[1]);
  for (const d of dynamic) called.add(d);

  const missing = [];
  for (const route of called) {
    const head = route.split("/")[0];
    const literal = new RegExp(`path === "${route.replace(/[/]/g, "\\/")}"`);
    const prefixed = new RegExp(`path === "${head}"|path\\.match\\(/\\^${head}\\\\?`);
    if (!literal.test(admin) && !prefixed.test(admin)) missing.push(route);
  }
  assert.deepEqual(missing, [], `admin endpoints called by the dashboard but not implemented: ${missing.join(", ")}`);
});

test("admin API: personas/config/message/broadcast-status routes exist", () => {
  const admin = SRC.slice(SRC.indexOf("async function handleAdminAPI"), SRC.indexOf("async function handleWebAppAPI"));
  for (const route of [
    'path === "personas"', 'path === "config"', 'path === "message"',
    'path === "broadcast"', 'path === "broadcast/cancel"', 'path === "assets"',
  ]) {
    assert.ok(admin.includes(route), `missing route: ${route}`);
  }
  assert.match(admin, /users\\\/\(-\?\\d\+\)\\\/history/, "user history route must exist");
  assert.match(admin, /groups\\\/\(-\?\\d\+\)/, "group detail route must exist");
  // Config writes must reuse the shared validator, not trust the client.
  assert.match(admin, /normalizeConfigChange\(/, "config POST must validate through normalizeConfigChange");
});

/* ══════════════════════════════════════════════════════════════════════════
   Prompt architecture: trust boundaries + a single non-contradictory policy.
   ══════════════════════════════════════════════════════════════════════════ */
test("prompt: trust boundaries are stated and attached to both prompt paths", () => {
  assert.match(SRC, /function trustBoundaryDirective/, "trust-boundary directive must exist");
  const d = fnSource("trustBoundaryDirective");
  assert.match(d, /INSTRUCTION HIERARCHY/);
  assert.match(d, /DATA ONLY/, "tool/external output must be marked data-only");
  assert.match(d, /never instructions to follow/i);
  // Applied to the default prompt AND the custom-persona prompt.
  assert.match(SRC, /basePrompt \+= trustBoundaryDirective\(\)/);
  assert.match(SRC, /\$\{confidentialityDirective\(lang\)\}\$\{trustBoundaryDirective\(\)\}/);
});

test("prompt: tool policy states the minimum-tool principle without contradiction", () => {
  const idx = SRC.indexOf("const TOOL_ROUTING_GUIDE");
  assert.notEqual(idx, -1, "the shared tool routing guide must exist");
  const policy = SRC.slice(idx, idx + 8000);
  assert.match(policy, /Tool availability does not imply tool necessity/i);
  assert.match(policy, /A direct answer is the DEFAULT/i);
  // The old prompt told the model both "never ask" and "ask if unclear" with no
  // resolution; the rewrite must scope "never ask" to the clear-intent case.
  assert.match(policy, /But do ask when the request is genuinely ambiguous/i);
  assert.match(policy, /Never repeat a tool call with the same arguments/i);
});

test("prompt: the tool routing guide is the single source of truth", () => {
  // It used to exist twice — once inside buildNovaAgentSystemPrompt as
  // `toolInstructions` and once inside getActivePrompt's persona branch as
  // `toolContext` — as two DIFFERENT and incomplete lists, so each prompt path
  // shipped tools the model had no routing guidance for.
  const code = stripComments(SRC);
  assert.doesNotMatch(code, /const toolInstructions\b/, "the default-prompt copy must not come back");
  assert.doesNotMatch(code, /const toolContext\b/, "the persona-prompt copy must not come back");

  const declarations = (code.match(/const TOOL_ROUTING_GUIDE\b/g) ?? []).length;
  assert.equal(declarations, 1, "exactly one routing guide may be declared");

  // Both prompt paths must consume it.
  assert.match(code, /basePrompt \+= TOOL_ROUTING_GUIDE;/, "default Nova prompt must include the guide");
  assert.match(code, /\$\{custom\}\$\{TOOL_ROUTING_GUIDE\}/, "custom-persona prompt must include the guide");
});

test("prompt: every user-facing tool appears in the routing guide", () => {
  // Coverage used to be split: the default prompt described `calculate` and
  // `get_current_time` but not the reaction tools; the persona prompt described
  // the reaction tools but not `calculate`. A tool the model is handed but never
  // routed to gets guessed at or ignored, so assert full coverage instead.
  const declStart = SRC.indexOf("const NOVA_TOOL_DECLARATIONS = [");
  const declEnd = SRC.indexOf("const ADMIN_TOOL_DECLARATIONS = [");
  assert.ok(declStart !== -1 && declEnd > declStart);
  const names = [...SRC.slice(declStart, declEnd).matchAll(/^\s*name: "([a-z_]+)",/gm)].map(m => m[1]);
  assert.ok(names.length >= 20, `expected the full user tool set, parsed ${names.length}`);

  const guideStart = SRC.indexOf("const TOOL_ROUTING_GUIDE");
  const guide = SRC.slice(guideStart, SRC.indexOf("function confidentialityDirective", guideStart));
  const missing = names.filter(n => !guide.includes(n));
  assert.deepEqual(missing, [], `tools with no entry in the routing guide: ${missing.join(", ")}`);
});

test("prompt: a persona cannot outrank the system rules or refuse system requests", () => {
  // A custom persona prompt is user-supplied text prepended to the system
  // instruction. Nothing used to tell the model where that text sits in the
  // instruction hierarchy, so "never break character" competed with genuine
  // persona/language/memory change requests.
  const start = SRC.indexOf("function trustBoundaryDirective");
  const directive = SRC.slice(start, SRC.indexOf("function getActivePrompt", start));
  assert.match(directive, /Where a persona sits/i);
  assert.match(directive, /never break character/i);
  assert.match(directive, /style/i);
});

test("tools: tool execution is lazy so batching actually serializes it", () => {
  // The batches built by orderedToolBatches only isolate stateful/heavy tools if
  // the work has not already started. It used to be kicked off eagerly with
  // `promise: (async () => …)()` during the .map, which made the isolation
  // comment false: two stateful tools in one response raced on the same session.
  const code = stripComments(SRC);
  assert.doesNotMatch(code, /promise: \(async \(\): Promise<ToolResult> => \{/);
  assert.match(code, /let started: Promise<ToolResult> \| null = null;/);
  assert.match(code, /start: \(\): Promise<ToolResult> => \(started \?\?= run\(\)\)/);
  assert.match(code, /result: await task\.start\(\)/);
});

test("tools: read-only fast tools have no side effects", () => {
  // Anything listed here is allowed to run concurrently with its siblings, so a
  // tool that sends a message or mutates state must never be added.
  const start = SRC.indexOf("const READ_ONLY_FAST_TOOLS");
  const set = SRC.slice(start, SRC.indexOf("const STATEFUL_TOOLS", start));
  const listed = [...set.matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
  const forbidden = [
    "voice_response", "react_to_message", "send_reaction_media", "resend_last_media",
    "generate_image", "edit_image", "create_game", "host_web_app", "create_pdf",
    "create_code_file", "switch_persona", "set_own_language", "set_call_name",
    "clear_own_memory", "schedule_reminder", "cancel_reminder", "broadcast_message",
  ];
  for (const name of forbidden) {
    assert.ok(!listed.includes(name), `${name} has side effects and must not be a parallel fast read`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Config / deployment hygiene.
   ══════════════════════════════════════════════════════════════════════════ */
test("config: wrangler.toml is valid TOML with no placeholder keys", () => {
  const toml = readFileSync(join(ROOT, "wrangler.toml"), "utf8");
  for (const [n, line] of toml.split(/\r?\n/).entries()) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    assert.ok(
      /^\[.+\]$/.test(t) || /^[A-Za-z0-9_.-]+\s*=/.test(t),
      `wrangler.toml:${n + 1} is neither a table header, an assignment, nor a comment: ${JSON.stringify(t)}`,
    );
  }
  assert.match(toml, /\[\[d1_databases\]\]/, "D1 binding must be declared");
  assert.match(toml, /database_id\s*=/, "D1 database_id must be present");
});

test("config: no credentials are committed as plaintext vars", () => {
  const toml = readFileSync(join(ROOT, "wrangler.toml"), "utf8");
  // Strip comments, then ensure no secret-ish key is assigned in [vars].
  const live = toml.split(/\r?\n/).filter(l => !l.trim().startsWith("#")).join("\n");
  for (const key of ["TOKEN", "GEMINI_KEY_1", "WEBHOOK_SECRET", "CF_TOKEN_1", "ELEVENLABS_KEY_1", "GOOGLE_SEARCH_API_KEY"]) {
    assert.doesNotMatch(
      live, new RegExp(`^\\s*${key}\\s*=`, "m"),
      `${key} is a secret and must be set with 'wrangler secret put', not in [vars]`,
    );
  }
});

test("config: Env declares every binding read from env.*", () => {
  const envBlock = SRC.slice(SRC.indexOf("interface Env {"), SRC.indexOf("interface BotConfig"));
  const used = new Set();
  for (const m of SRC.matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})\b/g)) used.add(m[1]);
  const missing = [...used].filter(k => !envBlock.includes(k));
  assert.deepEqual(missing, [], `env bindings used but not declared on Env: ${missing.join(", ")}`);
});

/* ══════════════════════════════════════════════════════════════════════════
   Dashboard integrity — these are shipped as text and parsed at runtime, so a
   syntax error would only surface in production.
   ══════════════════════════════════════════════════════════════════════════ */
for (const file of ["src/dashboard.html", "src/adminDashboard.html"]) {
  test(`ui: ${file} inline scripts parse and markup is balanced`, () => {
    const html = readFileSync(join(ROOT, file), "utf8");

    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0, "expected at least one inline script");
    for (const m of scripts) {
      assert.doesNotThrow(() => new Function(m[1]), `inline script in ${file} must parse`);
    }

    const VOID = new Set(["meta", "link", "br", "hr", "img", "input", "area", "base", "col",
      "embed", "source", "track", "wbr", "path", "circle", "rect", "line",
      "polygon", "polyline", "ellipse", "use", "stop"]);
    const markup = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    const stack = [];
    for (const m of markup.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
      const [, close, rawTag, self] = m;
      const tag = rawTag.toLowerCase();
      if (VOID.has(tag) || self === "/") continue;
      if (!close) stack.push(tag);
      else assert.equal(stack.pop(), tag, `mismatched </${tag}> in ${file}`);
    }
    assert.deepEqual(stack, [], `unclosed tags in ${file}: ${stack.join(" > ")}`);
  });
}

test("ui: admin dashboard meets baseline accessibility requirements", () => {
  const html = readFileSync(join(ROOT, "src/adminDashboard.html"), "utf8");
  assert.match(html, /class="skip-link"/, "needs a skip-to-content link");
  assert.match(html, /\.sr-only\s*\{/, "needs a screen-reader-only utility");
  assert.match(html, /:focus-visible\s*\{/, "needs visible keyboard focus");
  assert.match(html, /prefers-reduced-motion/, "must honour reduced-motion");
  assert.match(html, /role="status"[^>]*aria-live/, "toast must be announced");
  assert.match(html, /<th scope="col">/, "table headers need scope");
  assert.match(html, /aria-current="page"/, "active nav item must be announced");
  assert.match(html, /aria-modal="true"/, "modal/drawer must be marked");
  assert.match(html, /e\.key\s*!==\s*"Escape"|e\.key\s*===\s*"Escape"/, "Escape must close overlays");
  // Nav state must be driven by aria-current, not a class the CSS ignores.
  assert.doesNotMatch(html, /classList\.toggle\("active", b\.dataset\.tab/, "nav state must use aria-current");
});

test("ui: dashboards use logical properties instead of dir-duplicated rules", () => {
  const html = readFileSync(join(ROOT, "src/dashboard.html"), "utf8");
  // The sidebar previously needed a duplicated [dir="rtl"] block; the logical
  // version needs none.
  assert.doesNotMatch(html, /\[dir="rtl"\]\s*#sidebar\s*\{/, "sidebar must not need a dir-specific override");
  assert.match(html, /#sidebar\s*\{[^}]*inset-inline-start/, "sidebar must position logically");
  assert.match(html, /\.audioTrack i\s*\{[^}]*inset-inline-start/, "audio progress must fill from the start edge");
  assert.match(html, /class="skipLink"/, "needs a skip link");
  assert.match(html, /role="log"/, "chat transcript should be a live log region");
});

test("ui: admin dashboard polls without overlapping or running hidden", () => {
  const html = readFileSync(join(ROOT, "src/adminDashboard.html"), "utf8");
  assert.match(html, /visibilitychange/, "polling must react to visibility");
  // The guard may carry extra conditions (e.g. a dead auth session), but both
  // the overlap check and the visibility check must be in it.
  const guard = /if\(\s*polling(\s*\|\|\s*[A-Za-z.]+)*\s*\)\s*return/.exec(html);
  assert.ok(guard, "poll must bail out when a previous poll is still running");
  assert.match(guard[0], /document\.hidden/, "poll must bail out while the document is hidden");
  assert.match(html, /clearInterval\(pollTimer\)/, "timer must be torn down when hidden");
});

/* ══════════════════════════════════════════════════════════════════════════
   PERF — the search engine synthesizes its own final answer, so relaying it
   through the outer model cost a second full generation on top of a run that
   could already have taken a minute. The short-circuit must stay narrow: only
   a turn whose entire tool workload was a *successful* search may skip the
   relay, and it must do the same bookkeeping the normal success path does.
   ══════════════════════════════════════════════════════════════════════════ */
test("agent loop: search short-circuit is narrow and complete", () => {
  const start = SRC.indexOf("async function processAIRequestUnlocked");
  const body = SRC.slice(start, SRC.indexOf("\nfunction formatThinkingTags", start));

  const guard = body.slice(body.indexOf("const searchOnlyTurn ="), body.indexOf("const searchDirect ="));
  assert.match(guard, /toolResults\.every\(tr => tr\.name === "search"\)/, "a mixed tool turn must still go through the model");
  assert.match(guard, /success\?\?: boolean|success\?: boolean/, "the guard must read the success flag");
  assert.match(guard, /=== true/, "a failed search must still be explained by the model");

  const branch = body.slice(body.indexOf("if (searchDirect) {"), body.indexOf("const webAppResult ="));
  assert.match(branch, /addToHistory\(engine\.history, "model"/, "the delivered answer must be recorded as a model turn");
  assert.match(branch, /session\.statistics\.geminiMessages\+\+/, "counters must match the normal success path");
  assert.match(branch, /recordRequest\(session\)/);
  // Delivery precedes bookkeeping everywhere else in this function; the
  // short-circuit must not regress to persist-then-send.
  assert.ok(
    branch.indexOf("deliverFinalResponse") < branch.indexOf("deferSessionSave"),
    "the answer must be delivered before any persistence work",
  );
});

test("agent loop: a verbatim search answer is not stored twice", () => {
  const start = SRC.indexOf("async function processAIRequestUnlocked");
  const body = SRC.slice(start, SRC.indexOf("\nfunction formatThinkingTags", start));
  const fr = body.slice(body.indexOf("const frParts: Part[] ="), body.indexOf('addToHistory(engine.history, "user", frParts'));
  assert.match(fr, /searchDirect && tr\.name === "search"/, "the functionResponse must be slimmed when the answer is sent verbatim");
  assert.match(fr, /delivered: true/);
  assert.match(fr, /compactToolResponseForModel\(tr\.name, tr\.response\)/, "every other tool result must still be passed through intact");
});
