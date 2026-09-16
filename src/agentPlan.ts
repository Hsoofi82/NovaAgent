/**
 * Nova agent intelligence core.
 *
 * This module holds the deterministic half of the agent loop — the parts that
 * must NEVER depend on the model remembering a rule:
 *
 *   1. PLAN      — every turn gets an execution plan (objective → steps →
 *                  verify) derived from the router's decision. The plan is
 *                  carried through the turn for observability and reused as
 *                  the conversation's task state.
 *   2. VERIFY    — deliverables are scored (structure + design quality +
 *                  intent match) BEFORE success is claimed. An unverified
 *                  deliverable is never reported as "completed".
 *   3. REPAIR    — a failed attempt is classified so the pipeline can decide
 *                  between one bounded repair attempt, a model fallback, or
 *                  an honest user report. No unbounded retries.
 *   4. TASK STATE— a tiny per-scope record of the current goal, decisions and
 *                  pending items, so a conversation can span messages without
 *                  the user re-explaining. Strictly lower priority than the
 *                  live message and history.
 *   5. CONTEXT   — low-information turns (greetings, bare acknowledgements)
 *                  are dropped from model history so context tokens are spent
 *                  on content.
 *
 * Everything here is pure or pure-over-data: no I/O, no env access, so the
 * whole layer is unit-testable without a Worker runtime.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * 1. EXECUTION PLANNING
 * ══════════════════════════════════════════════════════════════════════════ */

/** The kind of work a turn implies. Mirrors the router's decision, not the model's guess. */
export type PlanKind =
  | "build_webapp"   // heavy: needs verification + repair loop
  | "build_game"     // heavy: needs verification + repair loop
  | "make_document"  // heavy: validated before delivery
  | "research"       // multi-step retrieval; search engine verifies itself
  | "media"          // image/audio generation; delivery = verification
  | "conversation";  // plain answer, no tools needed

/**
 * Deterministic turn plan. Produced BEFORE any tool runs; recorded for
 * observability and folded into the conversation task state afterwards.
 */
export interface TurnPlan {
  /** What the user is trying to achieve, in one clause. */
  objective: string;
  kind: PlanKind;
  /** Ordered steps the pipeline will actually enforce. */
  steps: string[];
  /** How "done" is verified before anything is claimed as success. */
  verify: string;
  /** Bounded repair policy for this kind of work. */
  repair: "rebuild-once" | "regenerate-content" | "none";
}

/** The only inputs needed from the router — keeps this layer decoupled. */
export interface PlanRouterHint {
  tool?: string;
  force?: boolean;
}

const RESEARCH_TOOLS = new Set(["search", "deep_search", "read_web_page", "search_images"]);
const MEDIA_TOOLS = new Set(["generate_image", "edit_image", "voice_response"]);

/** Map a tool name (from the router hint or a forced call) to a plan kind. */
function kindForTool(tool: string | undefined): PlanKind | null {
  if (!tool) return null;
  if (tool === "host_web_app") return "build_webapp";
  if (tool === "create_game") return "build_game";
  if (tool === "create_pdf") return "make_document";
  if (tool === "create_code_file") return "make_document";
  if (RESEARCH_TOOLS.has(tool)) return "research";
  if (MEDIA_TOOLS.has(tool)) return "media";
  return null;
}

/** Public alias so callers can classify an EXECUTED tool after the fact. */
export function planKindForTool(tool: string): PlanKind | null {
  return kindForTool(tool);
}

export function planFromRequest(request: string, router?: PlanRouterHint): TurnPlan {
  const objective = request.trim().slice(0, 200) || "answer the user";
  const forced = kindForTool(router?.tool);
  if (forced === "build_webapp" || forced === "build_game" || forced === "make_document" || forced === "research" || forced === "media") {
    return planForKind(forced, objective);
  }
  return planForKind("conversation", objective);
}

function planForKind(kind: PlanKind, objective: string): TurnPlan {
  switch (kind) {
    case "build_webapp":
      return {
        objective, kind,
        steps: ["understand", "pick app category + design", "generate app", "verify structure & quality", "repair if needed", "deploy"],
        verify: "app parses, is complete, scored by the design system, and matches the request",
        repair: "rebuild-once",
      };
    case "build_game":
      return {
        objective, kind,
        steps: ["understand", "pick genre + design intent", "generate game", "verify structure & quality", "repair if needed", "wrap shell"],
        verify: "game boots (menu/play scenes), honours the design intent, and matches the request",
        repair: "rebuild-once",
      };
    case "make_document":
      return {
        objective, kind,
        steps: ["understand", "draft content", "render document", "validate content", "deliver"],
        verify: "file renders in the requested format with the requested content intact",
        repair: "regenerate-content",
      };
    case "research":
      return {
        objective, kind,
        steps: ["understand", "search", "synthesise with sources"],
        verify: "answer is grounded in retrieved sources (search engine owns this check)",
        repair: "none",
      };
    case "media":
      return {
        objective, kind,
        steps: ["understand", "generate", "deliver"],
        verify: "media was generated and successfully delivered to the user",
        repair: "none",
      };
    case "conversation":
      return {
        objective, kind,
        steps: ["understand", "answer"],
        verify: "answer addresses the current message",
        repair: "none",
      };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. SELF-VERIFICATION — deliverable scoring BEFORE success is claimed
 * ══════════════════════════════════════════════════════════════════════════ */

export interface DeliverableScore {
  /** 0–100. ≥70 means shippable; below means attempt repair first. */
  score: number;
  verdict: "shippable" | "needs-repair" | "failed";
  issues: string[];
}

/**
 * Combine the structural gate, the advisory design report and an intent-match
 * check into one delivery decision.
 *
 * `intentMatch` is a cheap keyword-overlap check between the user's request and
 * the generated code: the strongest remaining signal that the engine built what
 * was ASKED for, not merely something valid. It is intentionally lenient — the
 * cost of a false "mismatch" is one wasted rebuild, the cost of missing a
 * totally-off brief is shipping the wrong app.
 */
export function scoreDeliverable(input: {
  request: string;
  /** Structural gate result (isComplete) — mandatory. */
  structurallyComplete: boolean;
  /** Design-system report, when the engine produced one. */
  quality?: { pass: boolean; score: number; issues: string[] };
  /** Rough size of the deliverable in bytes. */
  sizeBytes?: number;
  /**
   * The produced artifact's own text (HTML/JS/document body). REQUIRED for the
   * intent-match check to mean anything — see the fix note inside.
   */
  deliverableText?: string;
}): DeliverableScore {
  const issues: string[] = [];
  if (!input.structurallyComplete) {
    return { score: 0, verdict: "failed", issues: ["structure-incomplete"] };
  }

  let score = 70; // structural completeness is the floor, not the ceiling

  const q = input.quality;
  if (q) {
    if (q.pass) score = Math.max(score, 85);
    else {
      score = Math.min(score, Math.max(40, 30 + q.score * 4));
      issues.push(...q.issues.slice(0, 4));
    }
  }

  if (typeof input.sizeBytes === "number") {
    // Narrowest test FIRST. The original order put `< 1_500` in an `else if`
    // after `< 2_500`, which made it unreachable: a truncated artifact was
    // penalised 20 instead of 30 and "output-truncated" was never reported.
    if (input.sizeBytes < 1_500) { score -= 30; issues.push("output-truncated"); }
    else if (input.sizeBytes < 2_500) { score -= 20; issues.push("output-suspiciously-small"); }
  }

  // ── Intent match: does the deliverable talk about what was requested? ────
  const request = String(input.request ?? "");
  const sig = significantTerms(request);
  if (sig.terms.length >= 2) {
    // FIX: the haystack must be the DELIVERABLE. It used to be `sig.bilingual`,
    // i.e. the request compared against itself, so `matched` always equalled
    // `sig.terms` and the intent-mismatch signal was dead code. When a caller
    // cannot supply the artifact we degrade to the old (harmless) behaviour
    // instead of inventing a mismatch.
    const deliverable = String(input.deliverableText ?? "").toLowerCase();
    const haystack = deliverable
      ? `${deliverable} ${deliverable.replace(/[\u0600-\u06FF]/g, " ")}`
      : sig.bilingual;
    const matched = sig.terms.filter(t => haystack.includes(t));
    if (matched.length === 0) {
      // Nothing from the brief appears anywhere in the output.
      score -= 25;
      issues.push("possible-intent-mismatch");
    } else if (matched.length === 1 && sig.terms.length >= 4) {
      score -= 8;
      issues.push("weak-intent-match");
    }
  }

  const verdict: DeliverableScore["verdict"] = score >= 70 ? "shippable" : score >= 45 ? "needs-repair" : "failed";
  return { score: Math.max(0, Math.min(100, score)), verdict, issues };
}

/**
 * Extract meaningful, lowercase terms from a request, keeping Persian terms so
 * the check works on bilingual briefs. Stops words, generic UI filler and
 * formatting noise are dropped.
 */
function significantTerms(request: string): { terms: string[]; bilingual: string } {
  const text = String(request ?? "").toLowerCase();
  const raw = text
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3);
  const stop = new Set([
    "the", "and", "for", "with", "that", "this", "have", "has", "into", "from",
    "please", "make", "build", "create", "want", "need", "like", "some", "very",
    "site", "page", "app", "game", "برای", "که", "را", "با", "این", "یک", "از",
    "بساز", "کن", "باشه", "چیز", "داشته", "شود",
  ]);
  const terms = [...new Set(raw.filter(w => !stop.has(w)))].slice(0, 10);
  // The haystack includes a Persian-stripped copy so an English term inside a
  // Persian brief still matches (and vice versa is unnecessary: Persian output
  // for a Persian brief shares the script).
  return { terms, bilingual: `${text} ${text.replace(/[\u0600-\u06FF]/g, " ")}` };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. FAILURE CLASSIFICATION — recover, repair, or report (no endless retries)
 * ══════════════════════════════════════════════════════════════════════════ */

export type FailureClass =
  | "transient"   // timeout / 5xx / rate limit — retry with backoff is right
  | "quota"       // daily limits exhausted — retries are destructive, cool down
  | "permanent"   // malformed input / policy block — retrying cannot help
  | "content";    // model produced unusable output — repair or regenerate once

export function classifyFailure(message: string): FailureClass {
  const m = String(message ?? "").toLowerCase();
  if (!m) return "transient";
  // "exceeded" alone is NOT a quota signal ("generation deadline exceeded" is a
  // content failure) — the match must tie to a quota/limit/rate phrase.
  if (/(quota|daily row write|rate.?limit|429|resource.?exhausted|usage limit|exceeded.{0,24}(limit|quota)|limit.{0,24}exceeded)/.test(m)) return "quota";
  if (/(timeout|timed out|503|502|500|overloaded|network|fetch failed|econn)/.test(m)) return "transient";
  if (/(cancel)/.test(m)) return "permanent";
  if (/(flagged|blocked|safety|policy|invalid api key|401|403|unauthenticated|permission)/.test(m)) return "permanent";
  if (/(empty|too short|truncated|validation|salvage|not valid|parse|unfinished|deadline)/.test(m)) return "content";
  return "transient";
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. DOCUMENT CONTENT VALIDATION — cheap checks before a file is rendered
 * ══════════════════════════════════════════════════════════════════════════ */

export interface DocumentValidation {
  ok: boolean;
  issues: string[];
}

/**
 * Validate the SOURCE CONTENT of a document request before export. Catches the
 * failure mode where a model hands over an empty, truncated or HTML-junk body
 * and the file ships as a beautiful rendering of nothing.
 */
export function validateDocumentText(content: string, format: string, lang?: string): DocumentValidation {
  const issues: string[] = [];
  const text = String(content ?? "");
  const trimmed = text.trim();

  if (trimmed.length < 40) issues.push("content-too-short");
  if (format === "pdf" && /<html|<body|<!doctype/i.test(trimmed)) issues.push("html-into-pdf");
  // Mostly-binary blob: high share of replacement chars or control bytes means
  // corrupted content that would render as garbage in every format.
  const sample = trimmed.slice(0, 2_000);
  const bad = [...sample].filter(ch => {
    const c = ch.codePointAt(0)!;
    return c === 0xFFFD || (c < 32 && c !== 9 && c !== 10 && c !== 13);
  }).length;
  if (sample.length > 0 && bad / sample.length > 0.1) issues.push("corrupted-text");

  // RTL sanity: if the UI language is Persian the requested document is almost
  // certainly Persian too; content that is pure Latin is worth flagging so the
  // renderer is at least told to use LTR chrome rather than mojibake it.
  if (lang === "fa" && trimmed.length > 120 && !/[\u0600-\u06FF]/.test(trimmed)) {
    issues.push("expected-persian-content");
  }

  return { ok: issues.length === 0, issues };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. CONVERSATION TASK STATE — what is the user actually working on?
 * ══════════════════════════════════════════════════════════════════════════ */

export interface TaskState {
  /** Bumped on every structural change so prompt injection can be cached safely. */
  version: number;
  /** The current objective, kept fresh by the most recent plan. */
  currentGoal: string;
  kind: PlanKind;
  /** Deliverables produced for the current goal (bounded, newest wins). */
  outputs: string[];
  /** Durable decisions made in this conversation (user-stated or agent-committed). */
  decisions: string[];
  /** Things acknowledged but not finished. */
  pending: string[];
  /**
   * What this conversation has actually PRODUCED, newest first — see
   * {@link ArtifactEntry}. This is what makes "همون سایتی که ساختی" answerable
   * without re-reading history or guessing.
   */
  artifacts?: ArtifactEntry[];
  updatedAt: number;
}

/** Kinds of artifact a turn can leave behind. */
export type ArtifactKind = "webapp" | "game" | "image" | "voice" | "document" | "search" | "file";

/**
 * One produced object, compressed to the few bytes that make it referable.
 *
 * Deliberately NOT a log: no prompt text, no model output, no timings. A label a
 * human would recognise, an optional locator (URL / filename / asset id) and
 * when it happened. Six of these cost less than one history turn, which is why
 * the ledger can be injected on every request without inflating the prompt.
 */
export interface ArtifactEntry {
  kind: ArtifactKind;
  /** Short human name, e.g. "website: restaurant" / "image: logo". */
  label: string;
  /** URL, filename or asset id — whatever lets the next turn re-open it. */
  ref?: string;
  /** Epoch ms. */
  at: number;
}

/** Bounded on purpose: a ledger longer than the history it summarises is noise. */
export const MAX_ARTIFACTS = 6;
const ARTIFACT_LABEL_MAX = 72;
const ARTIFACT_REF_MAX = 96;

/** Trims a value to something safe to put in a prompt line. */
function clip(value: string, max: number): string {
  const s = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Records a produced artifact, newest first, deduplicated by kind+locator.
 *
 * Dedupe matters because rebuilding the same app reuses the same URL: without
 * it the ledger filled with three identical rows and the genuinely older
 * artifact ("the logo image") fell off the end of the list.
 */
export function recordArtifact(
  ts: TaskState,
  entry: { kind: ArtifactKind; label: string; ref?: string },
  at: number = Date.now(),
): void {
  if (!entry?.kind || !entry.label) return;
  const item: ArtifactEntry = {
    kind: entry.kind,
    label: clip(entry.label, ARTIFACT_LABEL_MAX),
    ...(entry.ref ? { ref: clip(entry.ref, ARTIFACT_REF_MAX) } : {}),
    at,
  };
  const existing = ts.artifacts ?? [];
  const deduped = existing.filter(a =>
    !(a.kind === item.kind && ((item.ref && a.ref === item.ref) || a.label === item.label)),
  );
  ts.artifacts = [item, ...deduped].slice(0, MAX_ARTIFACTS);
}

export function initTaskState(): TaskState {
  return {
    version: 0, currentGoal: "", kind: "conversation",
    outputs: [], decisions: [], pending: [], artifacts: [], updatedAt: 0,
  };
}

const MAX_OUTPUTS = 3;
const MAX_DECISIONS = 5;
const MAX_PENDING = 5;

/** Merge a completed turn into the conversation's task state (mutates `ts`). */
export function updateTaskState(ts: TaskState, plan: TurnPlan, opts?: {
  output?: string;
  /** Structured form of the same fact — preferred; also fills `outputs`. */
  artifact?: { kind: ArtifactKind; label: string; ref?: string };
  decisions?: string[];
  pending?: string[];
}): void {
  ts.version++;
  ts.currentGoal = plan.objective;
  ts.kind = plan.kind;
  ts.updatedAt = Date.now();
  if (opts?.artifact) {
    recordArtifact(ts, opts.artifact);
  }
  if (opts?.output) {
    ts.outputs = [opts.output, ...ts.outputs].slice(0, MAX_OUTPUTS);
  } else if (opts?.artifact) {
    // One fact, one representation: a caller that passed the structured form
    // still gets a human line, so `outputs` never silently stays stale.
    const a = opts.artifact;
    ts.outputs = [`${a.kind}: ${a.label}${a.ref ? ` (${a.ref})` : ""}`, ...ts.outputs].slice(0, MAX_OUTPUTS);
  }
  if (opts?.decisions?.length) {
    ts.decisions = [...opts.decisions, ...ts.decisions].slice(0, MAX_DECISIONS);
  }
  if (opts?.pending?.length) {
    ts.pending = [...opts.pending, ...ts.pending].slice(0, MAX_PENDING);
  }
}

const GOAL_MAX_AGE_MS = 24 * 60 * 60 * 1000; // a "current goal" older than a day is not current

/** "۲ ساعت پیش" / "2h ago" — the model needs recency, not a timestamp. */
export function artifactAge(at: number, nowMs: number, lang: string): string {
  const mins = Math.max(0, Math.round((nowMs - at) / 60_000));
  const fa = lang === "fa";
  if (mins < 1) return fa ? "همین حالا" : "just now";
  if (mins < 60) return fa ? `${mins} دقیقه پیش` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return fa ? `${hours} ساعت پیش` : `${hours}h ago`;
  return fa ? `${Math.round(hours / 24)} روز پیش` : `${Math.round(hours / 24)}d ago`;
}
const KIND_FA: Record<PlanKind, string> = {
  build_webapp: "ساخت وب‌اپ", build_game: "ساخت بازی", make_document: "ساخت سند",
  research: "تحقیق", media: "تولید رسانه", conversation: "گفتگو",
};

/**
 * Render the task state for prompt injection. Empty string when there is
 * nothing current — never inject stale noise. A single line states the
 * priority contract so old state can never out-argue the live message.
 */
export function formatTaskState(ts: TaskState | undefined, lang: string): string {
  if (!ts || !ts.currentGoal) return "";
  if (Date.now() - (ts.updatedAt || 0) > GOAL_MAX_AGE_MS) return "";
  const kindLabel = lang === "fa" ? (KIND_FA[ts.kind] ?? ts.kind) : ts.kind.replace(/_/g, " ");
  const lines: string[] = [];
  lines.push(lang === "fa"
    ? `📌 وضعیت کار جاری — هدف: ${ts.currentGoal} (${kindLabel})`
    : `📌 Current task — goal: ${ts.currentGoal} (${kindLabel})`);
  if (ts.outputs.length) lines.push(lang === "fa" ? `│ خروجی‌ها: ${ts.outputs.join(" | ")}` : `│ Outputs: ${ts.outputs.join(" | ")}`);
  if (ts.decisions.length) lines.push(lang === "fa" ? `│ تصمیم‌ها: ${ts.decisions.join(" | ")}` : `│ Decisions: ${ts.decisions.join(" | ")}`);
  if (ts.pending.length) lines.push(lang === "fa" ? `│ در انتظار: ${ts.pending.join(" | ")}` : `│ Pending: ${ts.pending.join(" | ")}`);
  const artifacts = ts.artifacts ?? [];
  if (artifacts.length) {
    const now = Date.now();
    // The kind is printed here, so a label never has to repeat it.
    const items = artifacts.slice(0, 4).map(a =>
      `[${artifactAge(a.at, now, lang)}] ${a.kind}: ${a.label}${a.ref ? ` → ${a.ref}` : ""}`,
    );
    lines.push(lang === "fa"
      ? `│ 🧰 ساخته‌شده‌های همین گفتگو (تازه‌ترین اول): ${items.join(" | ")}`
      : `│ 🧰 Produced in this conversation (newest first): ${items.join(" | ")}`);
  }
  lines.push(lang === "fa"
    ? "╰ اولویت: پیام فعلی کاربر > این وضعیت. اگر پیام تازه خلاف آن بود، پیام تازه ملاک است."
    : "╰ Priority: the user's current message wins over this state. If they contradict, follow the message.");
  if (artifacts.length) {
    lines.push(lang === "fa"
      ? "╰ اشارهٔ کاربر به «همون قبلی» / «اون تصویری که ساختی» یعنی جدیدترین موردِ همان نوع در فهرست بالا؛ نوع ذکر نشد یعنی جدیدترین مورد. اگر مطمئن نبودی، به‌جای حدس یک سؤال کوتاه بپرس."
      : "╰ When the user says \"that one\" / \"the image you made\" they mean the newest entry of that kind above; with no kind named, the newest entry overall. If it is still unclear, ask instead of guessing.");
  }
  return `\n\n${lines.join("\n")}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5b. ARTIFACT REFERENCES — "همون قبلی", "that site you made"
 * ══════════════════════════════════════════════════════════════════════════ */

/** Nouns that name one kind of artifact, in both scripts. */
const ARTIFACT_NOUNS: Array<{ kind: ArtifactKind; re: RegExp }> = [
  { kind: "image", re: /(?:تصویر|عکس|نقاشی|لوگو|آواتار|image|picture|photo|logo|art|wallpaper)/iu },
  { kind: "game", re: /(?<![\p{L}\u200c])(?:بازی|گیم)(?![\p{L}\u200c])|(?<![a-z])games?(?![a-z])/iu },
  { kind: "webapp", re: /(?:سایت|وبسایت|وب‌سایت|وب\s?اپ|وباپ|اپلیکیشن|داشبورد|پنل|website|web\s?site|web\s?app|webapp|dashboard|panel|app)/iu },
  { kind: "document", re: /(?:سند|فایل|پی\s?دی\s?اف|پاورپوینت|اکسل|گزارش|document|file|pdf|docx|pptx|xlsx|report|slides?|spreadsheet)/iu },
  { kind: "voice", re: /(?:ویس|صدا(?:ت)?|voice|audio)/iu },
  { kind: "search", re: /(?:جستجو|جست‌وجو|سرچ|تحقیق|گشتی|گشت|نتیجه(?:‌?)ها|search|research|results?)/iu },
];

/**
 * Words that make a message *about* something already produced.
 *
 * A kind noun alone is NOT enough: "یه سایت بساز" mentions a website but asks
 * for a new one, and treating that as a reference to the previous site would
 * rebuild the old app instead of the requested one. The deictic marker is what
 * separates referring from requesting.
 */
const DEICTIC_RE = new RegExp(
  "(?:همون|همان|همین|قبلی|قبلیش|قبلی‌اش|اخیر|آخرین|اون\\s|آن\\s" +
  "|که\\s*(?:ساختی|ساخت|درست\\s*کردی|درست\\s*کرد|فرستادی|فرستاد|نوشتی|تولید\\s*کردی)" +
  "|بالا|قبل\\s*تر" +
  "|(?:the|that|this|same|previous|last|earlier|aforementioned)\\s" +
  "|you\\s(?:made|built|created|sent|wrote|generated)|the\\sone)",
  "iu",
);

export interface ArtifactReference {
  entry: ArtifactEntry;
  /** The kind the wording pointed at, when it named one. */
  kind: ArtifactKind | null;
}

/**
 * Answers "which of the things we built is the user talking about?".
 *
 * Returns `null` far more often than not, and that is the point: the caller adds
 * a hint only when the sentence genuinely points backwards. Long messages are
 * excluded outright — a 300-character brief is new work, not a reference.
 */
export function resolveArtifactReference(
  text: string,
  ts: TaskState | undefined,
  lang: string,
): ArtifactReference | null {
  void lang;
  const artifacts = ts?.artifacts ?? [];
  if (!artifacts.length) return null;
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 300) return null;
  if (!DEICTIC_RE.test(raw)) return null;
  let namedMissingKind = false;
  for (const { kind, re } of ARTIFACT_NOUNS) {
    if (!re.test(raw)) continue;
    // `artifacts` is newest-first, so the first hit is the most recent of its kind.
    const entry = artifacts.find(a => a.kind === kind);
    if (entry) return { entry, kind };
    // FIX: a message can name two kinds ("همون عکس و سایتی که ساختی"). Keep
    // scanning instead of giving up on the first missing kind.
    namedMissingKind = true;
  }
  // The sentence names only kinds this conversation never produced ("همون سند…"
  // when only a website exists). Pointing at the newest artifact anyway would
  // hand the model a confidently wrong object, so decline and let it ask.
  if (namedMissingKind) return null;
  return { entry: artifacts[0], kind: null };
}

/** Compact prompt line making a resolved reference explicit. */
export function formatArtifactReferenceHint(
  ref: ArtifactReference,
  text: string,
  lang: string,
): string {
  const { entry, kind } = ref;
  const age = artifactAge(entry.at, Date.now(), lang);
  const where = entry.ref ? ` — ${entry.ref}` : "";
  const quoted = clip(text, 60);
  if (lang === "fa") {
    return `\n\n↪ «${quoted}» به آخرین خروجیِ هم‌نوع برمی‌گردد: ${entry.label} (${kind ?? entry.kind}، ${age})${where}.`
      + " اگر همین را می‌خواست، همان را ادامه بده یا بازش کن؛ اگر چیز دیگری منظورش بود، یک سؤال کوتاه بپرس.";
  }
  return `\n\n↪ "${quoted}" most likely refers to: ${entry.label} (${kind ?? entry.kind}, ${age})${where}.`
    + " Continue with or re-open that one; if something else was meant, ask one short question.";
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6. CONTEXT COMPRESSION — drop low-information turns from model history
 * ══════════════════════════════════════════════════════════════════════════ */

// MERGE FIX: the wrapper classes used to be `\W`, but JavaScript's `\w`/`\W`
// are ASCII-only even with the /u flag — so every Persian letter counted as a
// non-word character and "سلام، یه سایت فروشگاهی می‌خوام" matched the greeting
// pattern and was trimmed out of the model history. Only punctuation, symbols
// and emoji may wrap a noise turn now.
// `[^\p{L}\p{N}]` already covers emoji, punctuation and whitespace, so no
// separate emoji class is needed — and nesting one inside a character class
// would be a syntax error ("lone quantifier brackets").
const NOISE_WRAP = "[^\\p{L}\\p{N}]";
const GREETINGS = new RegExp(
  `^(?:${NOISE_WRAP}*)` +
  "(hi+|hello+|hey+|yo+|salam|سلام|درود|هی|good\\s*(morning|evening|afternoon)|عصر بخیر|صبح بخیر|شب بخیر|خوبی|چطوری|چه خبر|how\\s*are\\s*you|w?sup)" +
  `(?:${NOISE_WRAP}*)$`,
  "iu",
);

const MODEL_ACKS = new RegExp(
  `^(?:${NOISE_WRAP}*)` +
  "(thanks?|thank you|got it|ok(ay)?|sure|مرسی|ممنون|تشکر|اوکی|خواهش)" +
  `(?:${NOISE_WRAP}*)$`,
  "iu",
);

/** Pure-noise model turns: bare acknowledgements with no content. */
export function isNoiseText(text: string, role: "user" | "model"): boolean {
  const t = String(text ?? "").trim();
  if (!t || t.length > 48) return false;
  if (t.includes("?") || /؟/.test(t)) return false; // questions always carry intent
  return role === "user" ? GREETINGS.test(t) : MODEL_ACKS.test(t);
}

/**
 * Trim pure-noise turns (greetings, bare acknowledgements) from history while
 * preserving: tool-call traffic, the most recent turn, and everything else
 * that carries information. This runs on the model-bound copy only — the
 * persisted session history is untouched.
 *
 * Pairing safety: a turn is dropped only when it is NOT adjacent to a
 * functionResponse turn that refers to it (functionResponse-bearing turns are
 * never dropped, and neither are their callers).
 */
export function trimHistoryNoise<
  T extends { role: string; parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }> },
>(history: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < history.length; i++) {
    const turn = history[i];
    const hasTool = turn.parts.some(p => p.functionCall || p.functionResponse);
    if (hasTool) { out.push(turn); continue; }
    // Protect the tail — the current exchange must never be trimmed.
    if (i >= history.length - 2) { out.push(turn); continue; }
    const firstText = turn.parts.find(p => typeof p.text === "string")?.text;
    if (firstText === undefined) { out.push(turn); continue; }
    const role = turn.role === "model" ? "model" : "user";
    if (isNoiseText(firstText, role)) continue;
    out.push(turn);
  }
  return out;
}
