/**
 * Pure, dependency-free primitives shared by the worker.
 *
 * Everything here is deliberately free of Cloudflare bindings, module-level
 * state and `env` access so it can be imported directly by the test suite (and
 * reasoned about in isolation). Anything needing `env`, `cfg` or the Telegram
 * API belongs in index.ts, not here.
 */

/* ══════════════════════════════════════════════════════════════════════════
   ARITHMETIC
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Evaluates an arithmetic expression with a recursive-descent parser.
 *
 * Cloudflare Workers forbids runtime code generation, so the previous
 * `Function("return (" + expr + ")")` implementation threw
 * `EvalError: Code generation from strings disallowed` on *every* call — the
 * `calculate` tool could never succeed, and the model silently fell back to
 * estimating arithmetic instead of computing it.
 *
 * Grammar (lowest precedence first):
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/' | '%') unary)*
 *   unary   := ('+' | '-')* power
 *   power   := primary ('^' unary)?          // right-associative
 *   primary := number | '(' expr ')'
 *
 * @throws INVALID_EXPRESSION | DIVISION_BY_ZERO | INVALID_RESULT
 */
export function safeCalculateExpression(raw: string): number {
  const expr = String(raw ?? "").trim().replace(/,/g, "");
  if (!expr || expr.length > 200) throw new Error("INVALID_EXPRESSION");
  // Whitelist: digits, operators, parentheses, decimal points, whitespace.
  if (!/^[0-9+\-*/%^().\s]+$/.test(expr)) throw new Error("INVALID_EXPRESSION");

  let pos = 0;
  const skipWs = (): void => { while (pos < expr.length && /\s/.test(expr[pos])) pos++; };
  const peek = (): string => { skipWs(); return pos < expr.length ? expr[pos] : ""; };

  const parseExpr = (): number => {
    let value = parseTerm();
    for (;;) {
      const op = peek();
      if (op !== "+" && op !== "-") return value;
      pos++;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
  };

  const parseTerm = (): number => {
    let value = parseUnary();
    for (;;) {
      const op = peek();
      if (op !== "*" && op !== "/" && op !== "%") return value;
      pos++;
      const rhs = parseUnary();
      if ((op === "/" || op === "%") && rhs === 0) throw new Error("DIVISION_BY_ZERO");
      value = op === "*" ? value * rhs : op === "/" ? value / rhs : value % rhs;
    }
  };

  const parseUnary = (): number => {
    const op = peek();
    if (op === "+") { pos++; return parseUnary(); }
    if (op === "-") { pos++; return -parseUnary(); }
    return parsePower();
  };

  const parsePower = (): number => {
    const base = parsePrimary();
    if (peek() !== "^") return base;
    pos++;
    // Right-associative; the exponent may itself be signed (2^-2).
    return Math.pow(base, parseUnary());
  };

  const parsePrimary = (): number => {
    if (peek() === "(") {
      pos++;
      const value = parseExpr();
      if (peek() !== ")") throw new Error("INVALID_EXPRESSION");
      pos++;
      return value;
    }
    skipWs();
    const match = /^\d+(?:\.\d+)?|^\.\d+/.exec(expr.slice(pos));
    if (!match) throw new Error("INVALID_EXPRESSION");
    pos += match[0].length;
    return Number.parseFloat(match[0]);
  };

  const result = parseExpr();
  skipWs();
  if (pos !== expr.length) throw new Error("INVALID_EXPRESSION"); // trailing junk
  if (!Number.isFinite(result)) throw new Error("INVALID_RESULT");
  return result;
}

/* ══════════════════════════════════════════════════════════════════════════
   CONSTANT-TIME COMPARISON
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Length-independent, constant-time string comparison.
 *
 * `a !== b` on hex digests short-circuits at the first differing character,
 * leaking how many leading characters an attacker guessed correctly. This is
 * used to verify the Telegram initData HMAC — the only authentication gate in
 * front of the owner-only admin API.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  // Fold the length difference into the accumulator instead of returning early.
  let diff = ba.length ^ bb.length;
  const max = Math.max(ba.length, bb.length);
  for (let i = 0; i < max; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   SSRF ADDRESS CLASSIFICATION
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * True when a numeric host falls inside a blocked range.
 *
 * Handles the encodings `new URL()` accepts but a naive `/^127\./` test misses:
 * decimal (`2130706433`), hex (`0x7f000001`), octal (`0177.0.0.1`) and short
 * forms (`127.1`, `10.1`) — all of which reach loopback.
 */
export function numericHostIsPrivate(host: string): boolean {
  const partsRaw = String(host ?? "").split(".");
  if (partsRaw.length === 0 || partsRaw.length > 4) return false;

  const parseOctet = (rawPart: string): number | null => {
    if (!rawPart) return null;
    let value: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(rawPart)) value = Number.parseInt(rawPart.slice(2), 16);
    else if (/^0[0-7]+$/.test(rawPart)) value = Number.parseInt(rawPart.slice(1), 8);
    else if (/^\d+$/.test(rawPart)) value = Number.parseInt(rawPart, 10);
    else return null;
    return Number.isFinite(value) ? value : null;
  };

  const parsed = partsRaw.map(parseOctet);
  if (parsed.some(p => p === null)) return false; // not a numeric host at all
  const nums = parsed as number[];

  // Collapse to one 32-bit address per inet_aton rules: the final part absorbs
  // all remaining low-order bytes, so "127.1" === 127.0.0.1.
  let addr: number;
  if (nums.length === 1) {
    addr = nums[0];
  } else {
    const head = nums.slice(0, -1);
    const tail = nums[nums.length - 1];
    if (head.some(n => n > 255)) return false;
    const maxTail = Math.pow(256, 4 - head.length);
    if (tail >= maxTail) return false;
    addr = tail;
    for (let i = 0; i < head.length; i++) addr += head[i] * Math.pow(256, 3 - i);
  }
  if (!Number.isFinite(addr) || addr < 0 || addr > 0xffffffff) return false;

  const a = Math.floor(addr / 0x1000000) % 256;
  const b = Math.floor(addr / 0x10000) % 256;

  return (
    a === 0 ||                              // 0.0.0.0/8
    a === 10 ||                             // private
    a === 127 ||                            // loopback
    (a === 100 && b >= 64 && b <= 127) ||   // CGNAT 100.64/10
    (a === 169 && b === 254) ||             // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||    // private
    (a === 192 && b === 168) ||             // private
    (a === 192 && b === 0) ||               // 192.0.0/24, 192.0.2/24
    (a === 198 && (b === 18 || b === 19)) ||// benchmarking
    a >= 224                                // multicast + reserved
  );
}

/**
 * Validates an outbound URL and returns it, throwing when it targets a
 * non-public destination. Callers must additionally pin redirects — hostname
 * validation alone cannot stop a redirect to an internal address.
 */
export function assertPublicHttpUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported external URL scheme");
  if (url.username || url.password) throw new Error("external URL credentials are not allowed");

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) throw new Error("external URL host missing");

  if (host === "localhost" || host === "localhost.localdomain"
    || host.endsWith(".localhost") || host.endsWith(".local")
    || host.endsWith(".internal") || host.endsWith(".home.arpa")
    || host.endsWith(".onion")
    || host === "metadata.google.internal" || host === "metadata") {
    throw new Error("private external hostname blocked");
  }

  // IPv6: block loopback, unspecified, link-local (fe80::/10) and unique-local
  // (fc00::/7), plus IPv4-mapped forms of any blocked range.
  if (host.includes(":")) {
    const v6 = host.replace(/%.*$/, ""); // strip zone id
    if (v6 === "::1" || v6 === "::" || /^fe[89ab]/i.test(v6) || /^f[cd]/i.test(v6)) {
      throw new Error("private external address blocked");
    }
    const mapped = /(?:^|:)(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(v6);
    if (mapped && numericHostIsPrivate(mapped[1])) {
      throw new Error("private external address blocked");
    }
    return url;
  }

  // IPv4 in any encoding, including bare-decimal and hex/octal forms.
  if (/^[0-9a-fA-FxX.]+$/.test(host) && numericHostIsPrivate(host)) {
    throw new Error("private external address blocked");
  }

  return url;
}

/* ══════════════════════════════════════════════════════════════════════════
   CONVERSATION HISTORY RETENTION
   ══════════════════════════════════════════════════════════════════════════ */

/** Max conversation turns retained per history array. */
export const HISTORY_MAX_TURNS = 40;

/**
 * Computes how many leading turns to drop so the retained window never begins
 * with an orphaned tool response.
 *
 * Trimming blindly to the last N turns could cut between a model turn holding a
 * `functionCall` and the user turn holding its matching `functionResponse`,
 * leaving the orphan as the new head. Gemini rejects that shape, so the
 * sanitizer had to discard turns to repair it — silently losing context in the
 * middle of a tool chain.
 *
 * @param turns  Turn list, oldest first. Only `parts` is inspected.
 * @param maxTurns Retention window.
 * @returns Number of turns to remove from the front (0 when nothing to trim).
 */
export function historyTrimCount(
  turns: ReadonlyArray<{ parts?: ReadonlyArray<{ functionResponse?: unknown }> }>,
  maxTurns: number = HISTORY_MAX_TURNS,
): number {
  if (turns.length <= maxTurns) return 0;
  let cut = turns.length - maxTurns;
  while (cut < turns.length && (turns[cut].parts ?? []).some(p => p.functionResponse)) {
    cut++;
  }
  return cut;
}

/* ══════════════════════════════════════════════════════════════════════════
   SESSION SIZE BUDGETING
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Hard ceiling D1 enforces on a single string/BLOB value. Exceeding it raises
 * `D1_ERROR: string or blob too big: SQLITE_TOOBIG`, which is what took session
 * persistence down in production: the KV binding is a D1-backed shim, so every
 * `SESSIONS.put` is a D1 row write bound by this limit.
 */
export const D1_VALUE_MAX_BYTES = 2_000_000;

/**
 * Refuse-to-grow threshold, 5% under D1's limit.
 *
 * The previous guard compared `json.length > 2 * 1024 * 1024` (2,097,152) — a
 * threshold *above* the limit it was meant to protect, measured in UTF-16 code
 * units rather than UTF-8 bytes. For a Persian-language bot that is decisive:
 * Persian text costs 2 bytes per code unit and emoji 4, so a payload of 1.0M
 * code units can be 2.0M+ bytes and sail straight through the check.
 */
export const SESSION_HARD_MAX_BYTES = 1_900_000;

/**
 * Post-compaction target. Deliberately well below the hard max so a session
 * that had to be compacted does not re-trip the budget on its very next turn
 * (which would make every subsequent write pay the compaction cost).
 */
export const SESSION_COMPACT_TARGET_BYTES = 1_100_000;

/** Exact UTF-8 byte length of a string, without allocating an encode buffer. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      // A well-formed surrogate pair is one 4-byte code point spanning 2 units.
      // A lone surrogate is replaced by U+FFFD, which costs 3 bytes.
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * True when `value` needs more than `budget` UTF-8 bytes.
 *
 * Short-circuits on the two bounds that hold for every string — at least 1 and
 * at most 3 UTF-8 bytes per UTF-16 code unit — so the common case (a normal
 * session, far below budget) costs one integer compare instead of a full scan.
 */
export function exceedsUtf8Budget(value: string, budget: number): boolean {
  const units = value.length;
  if (units > budget) return true;         // ≥ 1 byte per unit
  if (units * 3 <= budget) return false;   // ≤ 3 bytes per unit
  return utf8ByteLength(value) > budget;
}

/** A conversation turn as it appears inside a serialized session. */
interface RawTurn {
  role?: unknown;
  parts?: unknown;
  timestamp?: unknown;
  [key: string]: unknown;
}

interface RawPart {
  text?: unknown;
  inline_data?: { mime_type?: unknown; data?: unknown };
  functionCall?: { name?: unknown; args?: unknown };
  functionResponse?: { name?: unknown; response?: unknown };
  thoughtSignature?: unknown;
  [key: string]: unknown;
}

export interface SessionCompactionResult {
  /** Canonical JSON payload, guaranteed ≤ `hardMaxBytes` unless `overBudget`. */
  json: string;
  /**
   * Measured UTF-8 size of `json`, or 0 when the payload was already within
   * budget and therefore never scanned (`actions` empty ⟺ no compaction ran).
   */
  bytes: number;
  /** Stage names applied, in order — safe to log (no user content). */
  actions: string[];
  /** True when even the last-resort stage could not get under the ceiling. */
  overBudget: boolean;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Every history array reachable from a serialized session, main history first. */
function collectHistories(data: Record<string, unknown>): unknown[][] {
  const out: unknown[][] = [];
  const engines = asRecord(data.engines);
  if (engines) {
    for (const engine of Object.values(engines)) {
      const state = asRecord(engine);
      if (!state) continue;
      const history = asArray(state.history);
      if (history) out.push(history);
      const perUser = asRecord(state.userHistories);
      if (perUser) {
        for (const turns of Object.values(perUser)) {
          const arr = asArray(turns);
          if (arr) out.push(arr);
        }
      }
    }
  }
  const groupContext = asArray(data.groupContext);
  if (groupContext) out.push(groupContext);
  return out;
}

/**
 * Replaces `inline_data` payloads with a short descriptor, in place.
 *
 * Incoming photos, voice notes, videos and PDFs are attached to the model
 * request as base64 `inline_data` parts, and `addToHistory` accepted them
 * verbatim — so a single 1.5MB photo became a ~2MB base64 string inside the
 * session JSON and permanently wedged `saveSession` for that chat. Media bytes
 * belong in the live request only; stored history keeps a metadata reference.
 *
 * @returns Number of parts rewritten.
 */
export function stripInlineMediaFromHistories(data: Record<string, unknown>): number {
  let stripped = 0;
  for (const history of collectHistories(data)) {
    for (const rawTurn of history) {
      const turn = asRecord(rawTurn) as RawTurn | null;
      if (!turn) continue;
      const parts = asArray(turn.parts);
      if (!parts) continue;
      for (let i = 0; i < parts.length; i++) {
        const part = asRecord(parts[i]) as RawPart | null;
        if (!part?.inline_data) continue;
        const mime = typeof part.inline_data.mime_type === "string" ? part.inline_data.mime_type : "media";
        const b64 = typeof part.inline_data.data === "string" ? part.inline_data.data : "";
        const approxKb = Math.round((b64.length * 3 / 4) / 1024);
        const label = approxKb > 0
          ? `[media omitted from stored history: ${mime} ~${approxKb}KB]`
          : `[media omitted from stored history: ${mime}]`;
        // Preserve any sibling text so the turn keeps its meaning.
        const text = typeof part.text === "string" && part.text ? `${part.text}\n${label}` : label;
        parts[i] = { text } as RawPart;
        stripped++;
      }
    }
  }
  return stripped;
}

/** Truncates a long string to head+tail with an explicit elision marker. */
function elide(value: string, keep: number): string {
  if (value.length <= keep) return value;
  const head = Math.ceil(keep * 0.7);
  const tail = keep - head;
  return `${value.slice(0, head)}\n…[${value.length - keep} chars trimmed]…\n${value.slice(value.length - tail)}`;
}

/** Trims a history array from the front without orphaning a tool response. */
function trimHistory(history: unknown[], maxTurns: number): void {
  if (history.length <= maxTurns) return;
  const shaped = history.map(turn => {
    const parts = asArray(asRecord(turn)?.parts) ?? [];
    return { parts: parts.map(p => ({ functionResponse: asRecord(p)?.functionResponse })) };
  });
  const cut = historyTrimCount(shaped, maxTurns);
  if (cut > 0) history.splice(0, cut);
}

/** Keeps the `keep` newest entries of a `{ id: { <tsField>: number } }` map. */
function pruneNewest(map: Record<string, unknown>, keep: number, tsField: string): number {
  const keys = Object.keys(map);
  if (keys.length <= keep) return 0;
  const scored = keys.map(key => {
    const ts = Number(asRecord(map[key])?.[tsField] ?? 0);
    return { key, ts: Number.isFinite(ts) ? ts : 0 };
  }).sort((a, b) => b.ts - a.ts);
  let removed = 0;
  for (const entry of scored.slice(keep)) { delete map[entry.key]; removed++; }
  return removed;
}

function capStringArray(container: Record<string, unknown>, field: string, max: number): void {
  const arr = asArray(container[field]);
  if (arr && arr.length > max) container[field] = arr.slice(-max);
}

/**
 * Progressively sheds disposable state until the serialized session fits the
 * storage budget, preserving what the model actually needs for as long as
 * possible.
 *
 * Escalation order — disposable first, durable memory last:
 *   1. media bytes  2. transient/underscore fields  3. bulky tool payloads
 *   4. very long text parts  5. per-user group histories  6. group context
 *   7. main history  8. group-member facts  9. orphaned per-user config
 *  10. long-term memory arrays  11. long-term memory owners  12. last resort
 *
 * `data` is mutated in place; callers pass a throwaway serialization copy.
 * Nothing here logs or returns user content — only stage names and sizes.
 */
export function compactSessionForStorage(
  data: Record<string, unknown>,
  opts?: { hardMaxBytes?: number; targetBytes?: number },
): SessionCompactionResult {
  const hardMax = opts?.hardMaxBytes ?? SESSION_HARD_MAX_BYTES;
  const target = Math.min(opts?.targetBytes ?? SESSION_COMPACT_TARGET_BYTES, hardMax);
  const actions: string[] = [];

  let json = JSON.stringify(data);
  if (!exceedsUtf8Budget(json, hardMax)) {
    return { json, bytes: 0, actions, overBudget: false };
  }

  const engines = asRecord(data.engines);
  const engineStates = engines
    ? Object.values(engines).map(asRecord).filter((s): s is Record<string, unknown> => Boolean(s))
    : [];
  const mainHistories = engineStates.map(s => asArray(s.history)).filter((h): h is unknown[] => Boolean(h));
  const perUserHistoryMaps = engineStates
    .map(s => asRecord(s.userHistories))
    .filter((m): m is Record<string, unknown> => Boolean(m));

  const stages: Array<{ name: string; run: () => void }> = [
    {
      name: "media",
      run: () => { stripInlineMediaFromHistories(data); },
    },
    {
      name: "transient",
      run: () => {
        // Anything underscore-prefixed is per-isolate scratch state that was
        // never meant to be persisted, and rate-limit stamps older than the
        // current window carry no information.
        for (const key of Object.keys(data)) if (key.startsWith("_")) delete data[key];
        const rl = asRecord(data.rateLimiting);
        const requests = rl && asArray(rl.requests);
        if (rl && requests && requests.length > 20) rl.requests = requests.slice(-20);
      },
    },
    {
      name: "tool-payloads",
      run: () => {
        // Web pages, search results and generated-code blobs come back as tool
        // responses. Recent ones stay intact; older ones keep a readable stub.
        for (const history of collectHistories(data)) {
          const protectedFrom = Math.max(0, history.length - 6);
          for (let t = 0; t < protectedFrom; t++) {
            const parts = asArray(asRecord(history[t])?.parts);
            if (!parts) continue;
            for (const rawPart of parts) {
              const part = asRecord(rawPart) as RawPart | null;
              const fr = part?.functionResponse;
              if (!fr) continue;
              const encoded = JSON.stringify(fr.response ?? null);
              if (encoded && encoded.length > 1_500) {
                fr.response = { summary: elide(encoded, 1_200), trimmed: true };
              }
            }
          }
        }
      },
    },
    {
      name: "long-text",
      run: () => {
        for (const history of collectHistories(data)) {
          const protectedFrom = Math.max(0, history.length - 8);
          for (let t = 0; t < protectedFrom; t++) {
            const parts = asArray(asRecord(history[t])?.parts);
            if (!parts) continue;
            for (const rawPart of parts) {
              const part = asRecord(rawPart) as RawPart | null;
              if (part && typeof part.text === "string" && part.text.length > 4_000) {
                part.text = elide(part.text, 3_000);
              }
            }
          }
        }
      },
    },
    {
      name: "user-histories-cap",
      run: () => {
        for (const map of perUserHistoryMaps) {
          for (const key of Object.keys(map)) {
            const turns = asArray(map[key]);
            if (turns) trimHistory(turns, 12);
          }
        }
      },
    },
    {
      name: "user-histories-prune",
      run: () => {
        // Drop the least recently active members' private threads first.
        for (const map of perUserHistoryMaps) {
          const keys = Object.keys(map);
          if (keys.length <= 25) continue;
          const scored = keys.map(key => {
            const turns = asArray(map[key]) ?? [];
            const lastTs = Number(asRecord(turns[turns.length - 1])?.timestamp ?? 0);
            return { key, ts: Number.isFinite(lastTs) ? lastTs : 0 };
          }).sort((a, b) => b.ts - a.ts);
          for (const entry of scored.slice(25)) delete map[entry.key];
        }
      },
    },
    {
      name: "group-context",
      run: () => {
        const ctx = asArray(data.groupContext);
        if (ctx) trimHistory(ctx, 20);
      },
    },
    {
      name: "main-history",
      run: () => { for (const history of mainHistories) trimHistory(history, 20); },
    },
    {
      name: "group-member-facts",
      run: () => {
        const members = asRecord(data.groupMembers);
        if (!members) return;
        for (const value of Object.values(members)) {
          const profile = asRecord(value);
          if (profile) capStringArray(profile, "facts", 4);
        }
        pruneNewest(members, 60, "lastSeen");
      },
    },
    {
      name: "orphan-user-config",
      run: () => {
        // Per-user persona / call-name / custom-prompt entries for people who
        // are no longer tracked in this chat at all.
        const known = new Set<string>([
          ...Object.keys(asRecord(data.groupMembers) ?? {}),
          ...Object.keys(asRecord(data.userMemories) ?? {}),
        ]);
        if (!known.size) return;
        for (const field of ["userPersonaId", "userCallName", "userCustomPrompts", "userCustomPromptSource"]) {
          const map = asRecord(data[field]);
          if (!map) continue;
          for (const key of Object.keys(map)) if (!known.has(key)) delete map[key];
        }
      },
    },
    {
      name: "memory-arrays",
      run: () => {
        const memories = asRecord(data.userMemories);
        if (!memories) return;
        for (const value of Object.values(memories)) {
          const mem = asRecord(value);
          if (!mem) continue;
          capStringArray(mem, "topics", 12);
          capStringArray(mem, "preferences", 10);
          capStringArray(mem, "entities", 15);
          capStringArray(mem, "ongoingProjects", 8);
          capStringArray(mem, "keyFacts", 20);
          capStringArray(mem, "relationshipGraph", 30);
        }
      },
    },
    {
      name: "memory-owners",
      run: () => {
        const memories = asRecord(data.userMemories);
        if (memories) pruneNewest(memories, 40, "lastSeen");
      },
    },
    {
      name: "last-resort",
      run: () => {
        for (const state of engineStates) state.userHistories = {};
        data.groupContext = [];
        const members = asRecord(data.groupMembers);
        if (members) pruneNewest(members, 15, "lastSeen");
        const memories = asRecord(data.userMemories);
        if (memories) pruneNewest(memories, 10, "lastSeen");
        for (const history of mainHistories) trimHistory(history, 6);
      },
    },
  ];

  for (const stage of stages) {
    stage.run();
    actions.push(stage.name);
    json = JSON.stringify(data);
    if (!exceedsUtf8Budget(json, target)) break;
  }

  const bytes = utf8ByteLength(json);
  return { json, bytes, actions, overBudget: bytes > hardMax };
}

/* ══════════════════════════════════════════════════════════════════════════
   TOOL CALL IDENTITY
   ══════════════════════════════════════════════════════════════════════════ */

/** Order-insensitive canonical form of a tool call's arguments. */
export function canonicalizeToolArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "{}";
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === "object") {
      return Object.keys(value as Record<string, unknown>).sort().reduce((acc, key) => {
        acc[key] = sort((value as Record<string, unknown>)[key]);
        return acc;
      }, {} as Record<string, unknown>);
    }
    return value;
  };
  try { return JSON.stringify(sort(args)); } catch { return "{}"; }
}

/** Stable identity for a tool invocation — same name + same normalized args. */
export function toolCallKey(call: { name: string; args?: Record<string, unknown> }): string {
  return `${call.name}:${canonicalizeToolArgs(call.args)}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   HYPERLINK SAFETY (shared by every generated artifact)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * URI schemes safe to embed in a document or generated page.
 *
 * Everything else — notably `javascript:`, `data:`, `vbscript:` and `file:` — is
 * an active-content or local-file-disclosure vector. This matters because link
 * targets originate from model output and from fetched web pages, and the
 * artifacts Nova produces (PDF link annotations, exported HTML) are opened by
 * real viewers/browsers that will happily execute them.
 */
const SAFE_URI_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Returns a safe href, or `null` when the URI must not be linked at all.
 *
 * Handles the evasions a naive `startsWith("javascript:")` check misses:
 *  • leading/trailing whitespace and control characters (`  javascript:…`)
 *  • embedded tab/newline inside the scheme (`java\tscript:`) — browsers strip
 *    these before parsing, so the string must be normalized before testing
 *  • mixed case (`JaVaScRiPt:`)
 *  • protocol-relative (`//evil.com`) which inherits the opener's scheme
 *
 * Fragment-only (`#anchor`) and root-relative (`/path`) links are preserved
 * because in-document anchors are legitimate and carry no scheme.
 */
export function sanitizeHyperlink(raw: unknown): string | null {
  const original = String(raw ?? "").trim();
  if (!original) return null;

  // Remove ASCII control characters and ALL whitespace before inspecting the
  // scheme. Browsers and PDF viewers ignore these inside a scheme, so
  // "java	script:alert(1)" would otherwise defeat a naive prefix check.
  const cleaned = original.replace(/[\u0000-\u0020\u007f]+/g, "");
  if (!cleaned) return null;

  // In-document anchor: no scheme, always safe.
  if (cleaned.startsWith("#")) return original;

  // Protocol-relative ("//host/path") silently inherits the opener's scheme.
  if (cleaned.startsWith("//")) return null;

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  if (!schemeMatch) return original; // relative path, no scheme to abuse

  const scheme = schemeMatch[1].toLowerCase() + ":";
  return SAFE_URI_SCHEMES.has(scheme) ? original : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   SCHEDULING: RECURRENCE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Recurrence descriptor for a scheduled job.
 *
 * `tzOffsetMinutes` is the *user's* offset from UTC (Tehran = +210). Wall-clock
 * rules must be evaluated in the user's timezone or "every day at 8 PM" drifts
 * to 8 PM UTC — off by hours for every non-UTC user.
 */
export type RecurrenceRule =
  | { kind: "daily"; hour: number; minute: number; tzOffsetMinutes: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number; tzOffsetMinutes: number }
  | { kind: "monthly"; day: number; hour: number; minute: number; tzOffsetMinutes: number }
  | { kind: "interval"; everyMinutes: number; anchorMs?: number };

/** Shortest interval a 1-minute cron can honour without piling up duplicates. */
export const MIN_RECURRENCE_INTERVAL_MINUTES = 2;

const DAY_MS = 86_400_000;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Next fire time strictly after `afterMs`, or `null` for an unusable rule.
 *
 * Timezone handling works on a shifted clock: adding the offset turns local
 * wall-clock arithmetic into plain UTC arithmetic, and subtracting it at the end
 * returns a real instant. This intentionally ignores DST transitions — a fixed
 * offset is what the bot stores, and Iran (the primary audience) has no DST.
 */
export function computeNextOccurrence(rule: RecurrenceRule, afterMs: number): number | null {
  if (!Number.isFinite(afterMs)) return null;

  if (rule.kind === "interval") {
    const step = Math.max(MIN_RECURRENCE_INTERVAL_MINUTES, clampInt(rule.everyMinutes, 1, 525_600, 0)) * 60_000;
    if (!Number.isFinite(step) || step <= 0) return null;
    const anchor = Number.isFinite(rule.anchorMs as number) ? Number(rule.anchorMs) : afterMs;
    if (anchor > afterMs) return anchor;
    // Advance in whole steps from the anchor so a long outage cannot leave the
    // schedule permanently offset (and cannot queue a burst of catch-up runs).
    const steps = Math.floor((afterMs - anchor) / step) + 1;
    return anchor + steps * step;
  }

  const tz = clampInt((rule as { tzOffsetMinutes?: unknown }).tzOffsetMinutes, -840, 840, 0) * 60_000;
  const hour = clampInt(rule.hour, 0, 23, 9);
  const minute = clampInt(rule.minute, 0, 59, 0);
  const localAfter = afterMs + tz;
  const cursor = new Date(localAfter);
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const day = cursor.getUTCDate();

  if (rule.kind === "daily") {
    let local = Date.UTC(year, month, day, hour, minute, 0, 0);
    if (local <= localAfter) local += DAY_MS;
    return local - tz;
  }

  if (rule.kind === "weekly") {
    const weekday = clampInt(rule.weekday, 0, 6, 0);
    let local = Date.UTC(year, month, day, hour, minute, 0, 0);
    const shift = (weekday - new Date(local).getUTCDay() + 7) % 7;
    local += shift * DAY_MS;
    if (local <= localAfter) local += 7 * DAY_MS;
    return local - tz;
  }

  if (rule.kind === "monthly") {
    const wanted = clampInt(rule.day, 1, 31, 1);
    for (let advance = 0; advance <= 12; advance++) {
      const y = year + Math.floor((month + advance) / 12);
      const m = (month + advance) % 12;
      // Clamp to the month's real length so "the 31st" still fires in February.
      const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const local = Date.UTC(y, m, Math.min(wanted, lastDay), hour, minute, 0, 0);
      if (local > localAfter) return local - tz;
    }
    return null;
  }

  return null;
}

/** Human-safe, content-free description of a rule (for logs and confirmations). */
export function describeRecurrence(rule: RecurrenceRule): string {
  switch (rule.kind) {
    case "daily": return `daily ${String(rule.hour).padStart(2, "0")}:${String(rule.minute).padStart(2, "0")}`;
    case "weekly": return `weekly d${rule.weekday} ${String(rule.hour).padStart(2, "0")}:${String(rule.minute).padStart(2, "0")}`;
    case "monthly": return `monthly d${rule.day} ${String(rule.hour).padStart(2, "0")}:${String(rule.minute).padStart(2, "0")}`;
    case "interval": return `every ${rule.everyMinutes}m`;
    default: return "unknown";
  }
}

const ISO_DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Parses an ISO-8601 date-time as a *wall-clock* reading in `tzOffsetMinutes`.
 *
 * `new Date("2026-08-15T09:00:00")` resolves against the host's local zone,
 * which on Workers is UTC — so a model that (correctly, per the tool schema)
 * emitted Tehran wall-clock produced an instant 3.5 hours late. An explicit
 * `Z` or `±HH:MM` in the input is authoritative and honoured as written.
 * Returns `null` for anything unparseable so callers can fall back instead of
 * scheduling a job at `NaN`.
 */
export function parseWallClockIso(raw: string, tzOffsetMinutes: number): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const m = ISO_DATE_TIME_RE.exec(text);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;

  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  if (!Number.isFinite(asUtc)) return null;
  // Reject calendar overflow (e.g. 2026-02-31 → March 3rd).
  const check = new Date(asUtc);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  const explicit = m[7];
  if (!explicit) return asUtc - clampInt(tzOffsetMinutes, -840, 840, 0) * 60_000;
  if (explicit.toUpperCase() === "Z") return asUtc;
  const sign = explicit[0] === "-" ? -1 : 1;
  const digits = explicit.slice(1).replace(":", "");
  const offMinutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4));
  if (!Number.isFinite(offMinutes)) return null;
  return asUtc - sign * offMinutes * 60_000;
}

export type RecurrenceKind = "hourly" | "daily" | "weekly" | "monthly";

/**
 * Derives a recurrence rule from the job's *first* run instant.
 *
 * Keeping the tool surface to a single `repeat` word (plus an optional explicit
 * interval) avoids asking the model to restate an hour/minute/weekday it has
 * already encoded in the first due time — a duplicated field is a field that
 * can disagree with itself.
 */
export function buildRecurrenceFromFirstRun(
  kind: RecurrenceKind | "interval",
  firstRunMs: number,
  tzOffsetMinutes: number,
  everyMinutes?: number,
): RecurrenceRule | null {
  if (!Number.isFinite(firstRunMs)) return null;
  const tz = clampInt(tzOffsetMinutes, -840, 840, 0);
  const local = new Date(firstRunMs + tz * 60_000);
  const hour = local.getUTCHours();
  const minute = local.getUTCMinutes();

  switch (kind) {
    case "interval":
      return {
        kind: "interval",
        everyMinutes: Math.max(MIN_RECURRENCE_INTERVAL_MINUTES, clampInt(everyMinutes, 1, 525_600, 60)),
        anchorMs: firstRunMs,
      };
    case "hourly":
      return { kind: "interval", everyMinutes: 60, anchorMs: firstRunMs };
    case "daily":
      return { kind: "daily", hour, minute, tzOffsetMinutes: tz };
    case "weekly":
      return { kind: "weekly", weekday: local.getUTCDay(), hour, minute, tzOffsetMinutes: tz };
    case "monthly":
      return { kind: "monthly", day: local.getUTCDate(), hour, minute, tzOffsetMinutes: tz };
    default:
      return null;
  }
}

/** Narrows untrusted stored JSON back into a `RecurrenceRule`. */
export function parseRecurrenceRule(raw: unknown): RecurrenceRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tz = clampInt(r.tzOffsetMinutes, -840, 840, 0);
  switch (r.kind) {
    case "interval": {
      const every = clampInt(r.everyMinutes, MIN_RECURRENCE_INTERVAL_MINUTES, 525_600, 0);
      if (!every) return null;
      const anchor = Number(r.anchorMs);
      return Number.isFinite(anchor)
        ? { kind: "interval", everyMinutes: every, anchorMs: anchor }
        : { kind: "interval", everyMinutes: every };
    }
    case "daily":
      return { kind: "daily", hour: clampInt(r.hour, 0, 23, 9), minute: clampInt(r.minute, 0, 59, 0), tzOffsetMinutes: tz };
    case "weekly":
      return {
        kind: "weekly",
        weekday: clampInt(r.weekday, 0, 6, 0),
        hour: clampInt(r.hour, 0, 23, 9),
        minute: clampInt(r.minute, 0, 59, 0),
        tzOffsetMinutes: tz,
      };
    case "monthly":
      return {
        kind: "monthly",
        day: clampInt(r.day, 1, 31, 1),
        hour: clampInt(r.hour, 0, 23, 9),
        minute: clampInt(r.minute, 0, 59, 0),
        tzOffsetMinutes: tz,
      };
    default:
      return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   PERSONA INTENT CLASSIFICATION
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * What the user actually meant when a persona name (or a tone word) appeared.
 *
 * These five outcomes were previously collapsed into one regex test, so
 * "شخصیت لیلیت چیه؟" ("what is the Lilith persona?") *switched* to Lilith, and
 * "maybe you should be more serious" was treated the same as an explicit,
 * permanent switch command.
 */
export type PersonaIntent =
  /** Nothing persona-related. */
  | { kind: "none" }
  /** Asking *about* a persona — answer the question, change nothing. */
  | { kind: "question"; personaId: string | null }
  /** "show me the personas" — open the picker, change nothing. */
  | { kind: "list" }
  /** A tone/style nudge for this conversation only — no persistent switch. */
  | { kind: "style" }
  /**
   * A real switch request. Still requires explicit confirmation.
   * `permanent` distinguishes a standing preference ("from now on always be X")
   * from a one-off switch, so agentic adaptation can leave the former alone.
   */
  | { kind: "switch"; personaId: string; confidence: number; permanent: boolean };

export interface PersonaAlias {
  id: string;
  /** Lowercase alias forms, both scripts. */
  aliases: readonly string[];
}

// Interrogatives in both languages. Presence of any of these anywhere in a
// short message means the user is asking, not commanding.
// `\blist\b` rather than bare `list`, or "listen, be Jax" reads as a question.
const PERSONA_QUESTION_RE = /(چیه|چیست|کیه|کیست|چی\s*هست|چه\s*کسی|چطوریه|چگونه|یعنی\s*چی|توضیح\s*بده|معرفی\s*کن|فرق|تفاوت|کدوم|کدام|چند\s*تا|چیا|چه\s*شخصیت|what\s+(is|are|does)|who\s+(is|are)|tell\s+me\s+about|explain|difference|which\s+one|how\s+many|\blist\b)/i;

/**
 * Negative lookbehind for "another Arabic-script letter precedes".
 *
 * The mirror of {@link FA_END}, and just as necessary: Persian is written
 * without spaces around clitics, so a short stem shows up inside longer,
 * unrelated words. `میشه` ("it's possible" — a hedge) is a substring of
 * `همیشه` ("always" — the strongest *permanence* marker there is), so without
 * this guard the single most explicit standing request a user can make,
 * "از این به بعد همیشه ویکتوریا باش", classified as a vague style nudge and did
 * nothing at all. Likewise `اگر` sits inside `شاگرد`.
 */
const FA_START = "(?<![\\u0600-\\u06FF\\u200c])";

// Hedged / hypothetical phrasing. Never a persistent switch.
const PERSONA_HEDGE_RE = new RegExp(
  "(شاید|احتمالا|فکر\\s*کنم|بهتره|بهتر\\s*بود|کاش" +
  // Guarded stems: harmless-looking, but each is embedded in a common word
  // whose meaning is unrelated (or opposite) to hedging.
  "|" + FA_START + "اگه|" + FA_START + "اگر|" + FA_START + "میشه|" + FA_START + "می‌شه" +
  "|میتونی|می‌تونی|چطوره|نظرت|دوست\\s*داشتم" +
  "|maybe|perhaps|might|could\\s+you|what\\s+if|i\\s+wish|kind\\s+of|sort\\s+of|a\\s+bit\\s+more)",
  "i",
);


// Tone adjustments that are NOT persona identities.
const PERSONA_STYLE_RE = /(جدی.?تر|مهربون.?تر|مهربان.?تر|رسمی.?تر|خودمونی.?تر|صمیمی.?تر|مختصر.?تر|کوتاه.?تر|کامل.?تر|آروم.?تر|باحال.?تر|خشک|لحن|طرز\s*حرف|جور\s*دیگه|متفاوت\s*حرف|more\s+(serious|formal|casual|friendly|concise|brief|polite|relaxed|fun)|less\s+(formal|serious)|tone|talk\s+differently|speak\s+differently|act\s+like)/i;

const PERSONA_LIST_RE = /(لیست\s*شخصیت|شخصیت.?ها|پرسونا.?ها|چه\s*شخصیت.?هایی|منوی\s*شخصیت|list\s+personas|show\s+personas|available\s+personas|which\s+personas)/i;

/**
 * Negative lookahead for "another Arabic-script letter follows".
 *
 * `\b` is useless next to Persian text: JavaScript word boundaries are defined
 * against ASCII `\w`, so in `/شو\b/` both `و` and the following space are
 * non-word characters and there is no boundary between them — the pattern can
 * never match Persian input at all. Persian verb stems therefore assert "not
 * followed by another letter or a ZWNJ" explicitly, which is what `\b` was
 * meant to express (`شو` matches, `شود` and `نشون` do not).
 */
const FA_END = "(?![\\u0600-\\u06FF\\u200c])";

// Imperative switch verbs. Persian first (the primary language), then English.
const PERSONA_SWITCH_VERB_RE = new RegExp(
  "(بشو|شو" + FA_END + "|باش" + FA_END + "|برو\\s*رو|عوض\\s*کن|تغییر\\s*بده|تغییرش\\s*بده|فعال\\s*کن" +
  "|سوییچ|سویچ|از\\s*این\\s*به\\s*بعد|همیشه|بمون" +
  "|switch\\s+to|change\\s+to|become|activate|turn\\s+into|use\\s+persona|set\\s+persona" +
  "|from\\s+now\\s+on|stay\\s+as)",
  "i",
);

/**
 * Explicit refusal of a switch ("لیلیت نشو", "don't become Jax").
 *
 * Without this, the switch verb inside a negated clause reads as a command and
 * the user gets a confirmation card for the exact opposite of what they asked.
 */
const PERSONA_NEGATION_RE = new RegExp(
  "(نشو" + FA_END + "|نباش|نکن" + FA_END + "|نمیخوام|نمی‌خوام|نخواستم" +
  "|don'?t|do\\s+not|never\\s+switch|no\\s+need)",
  "i",
);

/** Markers that the user wants the choice to stand, not just apply once. */
const PERSONA_PERMANENT_RE = /(از\s*این\s*به\s*بعد|از\s*الان|همیشه|همیشگی|بمون|دیگه\s*همین|from\s+now\s+on|permanently|always|stay\s+as|keep\s+being)/i;

/**
 * Classifies a message against the known persona aliases.
 *
 * Deliberately conservative: `switch` is only returned for an explicit
 * imperative or a bare persona name, and even then the caller must confirm with
 * the user before persisting anything. Everything ambiguous degrades to
 * `question` or `style`, which are non-destructive.
 *
 * @param raw   User message text.
 * @param known Persona ids with their aliases.
 */
export function classifyPersonaIntent(raw: string, known: readonly PersonaAlias[]): PersonaIntent {
  const text = String(raw ?? "").trim();
  // Long messages are conversation, not commands. A switch command is short.
  if (!text || text.length > 120) return { kind: "none" };
  const lower = text.toLowerCase();

  let matched: string | null = null;
  let matchedAlias = "";
  for (const persona of known) {
    for (const alias of persona.aliases) {
      if (!alias) continue;
      if (lower.includes(alias)) {
        // Prefer the longest alias so "nova ai" does not lose to "nova".
        if (alias.length > matchedAlias.length) { matched = persona.id; matchedAlias = alias; }
      }
    }
  }

  const isQuestion = PERSONA_QUESTION_RE.test(text) || text.includes("?") || text.includes("؟");
  if (PERSONA_LIST_RE.test(text) && !PERSONA_SWITCH_VERB_RE.test(text)) return { kind: "list" };
  if (isQuestion) return matched ? { kind: "question", personaId: matched } : { kind: "none" };
  // Checked after the list/question branches so "شخصیت‌ها رو نشون بده" is still
  // recognised as a listing request rather than swallowed as a negation.
  if (PERSONA_NEGATION_RE.test(text)) return { kind: "none" };

  // A tone word with no persona identity is a style nudge, never a switch.
  if (!matched) return PERSONA_STYLE_RE.test(text) ? { kind: "style" } : { kind: "none" };

  // Persona named, but hedged ("maybe be Lilith?") — treat as style, not switch.
  if (PERSONA_HEDGE_RE.test(text)) return { kind: "style" };

  const permanent = PERSONA_PERMANENT_RE.test(text);
  if (PERSONA_SWITCH_VERB_RE.test(text)) {
    return { kind: "switch", personaId: matched, confidence: 0.92, permanent };
  }

  // A bare persona name on its own line ("لیلیت") reads as a selection.
  const stripped = lower.replace(/[\s!.,،؛:*_—-]+/g, " ").trim();
  if (stripped === matchedAlias) return { kind: "switch", personaId: matched, confidence: 0.7, permanent };

  // Persona mentioned mid-sentence with no switch verb: just conversation.
  return { kind: "none" };
}

/* ══════════════════════════════════════════════════════════════════════════
   AGENTIC PERSONA ADAPTATION (hysteresis)
   ══════════════════════════════════════════════════════════════════════════ */

/** Minimum dwell time before agentic mode may switch persona again. */
export const AGENTIC_PERSONA_COOLDOWN_MS = 15 * 60_000;
/** Confidence a candidate must beat to displace the active persona. */
export const AGENTIC_PERSONA_MIN_CONFIDENCE = 0.75;
/** Consecutive agreeing signals required before the switch is applied. */
export const AGENTIC_PERSONA_STREAK = 2;

export interface AgenticPersonaState {
  /** Persona the chat is currently using. */
  activeId: string;
  /** When the active persona was last changed. */
  lastSwitchAt: number;
  /** Candidate the recent signals point at, if any. */
  candidateId?: string;
  /** How many consecutive signals have agreed on `candidateId`. */
  candidateStreak?: number;
}

export interface AgenticPersonaDecision {
  /** Persona to switch to, or null to stay put. */
  switchTo: string | null;
  /** Updated state the caller must persist. */
  state: AgenticPersonaState;
  /** Content-free reason, for diagnostics. */
  reason: "same" | "cooldown" | "low-confidence" | "building-streak" | "switch";
}

/**
 * Decides whether agentic mode should adapt the persona now.
 *
 * Three independent brakes prevent the oscillation that makes dynamic switching
 * feel broken: a dwell-time cooldown, a confidence floor, and a streak
 * requirement so one off-topic message cannot flip the personality.
 */
export function decideAgenticPersona(
  state: AgenticPersonaState,
  candidateId: string | null,
  confidence: number,
  nowMs: number,
): AgenticPersonaDecision {
  const base: AgenticPersonaState = {
    activeId: state.activeId,
    lastSwitchAt: state.lastSwitchAt,
    candidateId: state.candidateId,
    candidateStreak: state.candidateStreak ?? 0,
  };

  if (!candidateId || candidateId === state.activeId) {
    return { switchTo: null, state: { ...base, candidateId: undefined, candidateStreak: 0 }, reason: "same" };
  }
  if (!Number.isFinite(confidence) || confidence < AGENTIC_PERSONA_MIN_CONFIDENCE) {
    return { switchTo: null, state: { ...base, candidateId: undefined, candidateStreak: 0 }, reason: "low-confidence" };
  }
  if (nowMs - (state.lastSwitchAt || 0) < AGENTIC_PERSONA_COOLDOWN_MS) {
    // Keep accumulating evidence during the cooldown, but do not act on it.
    const streak = state.candidateId === candidateId ? (state.candidateStreak ?? 0) + 1 : 1;
    return { switchTo: null, state: { ...base, candidateId, candidateStreak: streak }, reason: "cooldown" };
  }

  const streak = state.candidateId === candidateId ? (state.candidateStreak ?? 0) + 1 : 1;
  if (streak < AGENTIC_PERSONA_STREAK) {
    return { switchTo: null, state: { ...base, candidateId, candidateStreak: streak }, reason: "building-streak" };
  }
  return {
    switchTo: candidateId,
    state: { activeId: candidateId, lastSwitchAt: nowMs, candidateId: undefined, candidateStreak: 0 },
    reason: "switch",
  };
}

