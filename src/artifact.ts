/**
 * Nova artifact classifier — WHAT is the user actually asking for?
 *
 * WHY THIS EXISTS
 * ───────────────
 * Two independent pieces of the build pipeline used to answer that question
 * with substring tests:
 *
 *   · `isGameRequest()` matched `/\b(game|بازی|...)/` *anywhere*, and its only
 *     "guard" was `explicitUtility && !explicitGame` — which does nothing once
 *     the word "game" also appears, because `explicitGame` is then true anyway.
 *   · The engine dispatch read the two booleans as
 *     `explicitWebApp = isWebAppRequest(t) && !isGameRequest(t)` then
 *     `wantGame = !explicitWebApp && (tool === "create_game" || isGameRequest(t))`.
 *
 * The result was the exact failure users reported, one line of code away from
 * the model's own (correct) choice:
 *
 *   "Create a website about a game"      → "website" AND "game" both match, the
 *                                          game boolean won → GAME ENGINE.
 *   "Make a calculator with a game theme"→ "calculator" is dethroned the moment
 *                                          "game" is in the sentence → GAME.
 *   "یه سایت درباره بازی شطرنج بساز"     → same → GAME for a website request.
 *
 * Those are the product's canonical wrong-artifact cases, and they are not
 * ambiguity — they are the *topic* being read as the *deliverable*. "About a
 * game", "with a game theme", "game-theme", "بازی‌محور" and "سایت بازی" all name
 * a subject; the thing being built is the website/calculator/dashboard.
 *
 * So this module answers the goal question structurally, in three steps:
 *
 *   1. MASK   the theme clauses — every game reference that is syntactically a
 *             topic ("about a game", "game-themed", "game website") is blanked
 *             out, and so is a web noun that appears inside a theme clause
 *             ("a game about a dashboard", which is a game).
 *   2. SCORE  the surviving evidence: deliverable nouns (website/dashboard/
 *             calculator/quiz), document formats (pdf/docx/pptx/xlsx) and game
 *             signals (the word "game" itself, plus genre nouns — tetris, puzzle,
 *             شطرنج, رانندگی) each carry a weight.
 *   3. DECIDE by cascade, with the *uncontested* cases resolved confidently and
 *             everything genuinely mixed resolved conservatively (a tie goes to
 *             the non-game reading, because "game" is this product's single most
 *             common theme word).
 *
 * A genre noun deliberately outranks the bare word "game" but not an explicit
 * deliverable: "make a tetris" ⇒ a game, while "a chess website" ⇒ a website.
 *
 * Deliberately pure: no env, no I/O, no mutable module state, so the whole
 * table is unit-testable — the same contract `intent.ts`, `core.ts` and
 * `agentPlan.ts` follow.
 */

export type BuildTarget = "game" | "webapp" | "document" | "ambiguous";

export interface BuildVerdict {
  target: BuildTarget;
  /** 0..1. ≥0.9 only for uncontested evidence. */
  confidence: number;
  /** The deliverable noun that decided it, when one was found. */
  goalNoun?: string;
  /** The game reference that was demoted to a theme, when one was found. */
  demotedTheme?: string;
  /** Compact machine-readable evidence line, for logs. */
  reason: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   WORD-BOUNDARY HELPERS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `\b` is ASCII-only, so it never sits beside Persian text: in `/بازی\b/` both
 * `ی` and a following space are non-word characters for the regex engine, so
 * "بازیگر" ("actor") would match as "بازی" ("game"). Persian stems therefore
 * assert "no adjacent Arabic-script letter or ZWNJ" explicitly.
 */
const FA_CLASS = "\u0600-\u06FF\u200c";
const FA_L = `(?<![${FA_CLASS}])`;
const FA_R = `(?![${FA_CLASS}])`;

/** Wraps a Persian stem in both guards. */
function fa(stem: string): string {
  return FA_L + stem + FA_R;
}

/** Builds a global, case-insensitive regex from raw fragments. */
function all(source: string): RegExp {
  return new RegExp(source, "gi");
}

/* ══════════════════════════════════════════════════════════════════════════
   THEME MASKING — what makes "about a game" different from "a game"
   ══════════════════════════════════════════════════════════════════════════ */

/** The ways a topic is introduced: "about X", "درباره X", "به سبک X". */
const ABOUT = String.raw`(?:about|around|regarding|based\s+on|inspired\s+by|in\s+the\s+style\s+of|themed?\s+(?:around|on)|on\s+the\s+theme\s+of|درباره|در\s*باره|راجع\s*به|در\s*مورد|به\s*سبک|بر\s*اساس|طبق|با\s*حال\s*و\s*هوای|با\s*تم)`;
const ARTICLES = String.raw`(?:a|an|the|some|my|our|یه|یک|این|آن)?`;

/** "a game" cited as a subject: "a website **about a game**". */
const GAME_AS_SUBJECT = all(
  `${ABOUT}\\s+${ARTICLES}\\s*(?:mini[- ]?games?|gameplay|games|gaming|game|بازی|گیم)(?![a-z])`,
);
/** "game-themed", "game-style", "بازی‌وار" — the adjective form of a subject. */
const GAME_AS_ADJECTIVE = all(
  String.raw`(?<![a-z])(?:game|gaming)[- ](?:theme[d]?|style[d]?|like|esque|inspired|based|vibes?|mood|feel)(?![a-z])`,
);
/**
 * English attributive: "**game** website", "game web app", "game dashboard".
 * The lookahead keeps the *noun* out of the masked span, so the deliverable is
 * still seen — only the game word is demoted. Filler is restricted to
 * determiners/adjectives so "a game about a website" is not mistaken for one.
 */
const GAME_AS_MODIFIER_EN = all(
  String.raw`(?<![a-z])(?:game|gaming)(?=\s+(?:(?:the|a|an|new|simple|small|mini|web|online)\s+){0,2}?(?:website|web\s?site|web\s?app|webapp|web\s?page|webpage|landing\s+page|dashboard|calculator|converter|tool|form|editor|portal|store|shop|marketplace|blog|wiki|quiz)(?![a-z]))`,
);
/**
 * Persian attributive: the noun comes first and the game word follows it as an
 * ezafe modifier — "سایت بازی" (a game site). Again only the game word is
 * masked, so `سایت` survives as the deliverable.
 */
const GAME_AS_MODIFIER_FA = all(
  `(?<=${String.raw`(?:سایت|وبسایت|وب\s?اپ|وباپ|اپلیکیشن|اپ|داشبورد|پنل|ماشین\s?حساب|حسابگر|مبدل|ابزار|فرم|ویرایشگر|صفحه|فروشگاه|پورتال|وبلاگ|کوییز|آزمون)\s*[یِه]?\s*`})${fa("(?:بازی|گیم)")}`,
);
/** A web/app noun cited as a subject: "a **game** about a dashboard". */
const WEB_AS_SUBJECT = all(
  `${ABOUT}\\s+${ARTICLES}\\s*(?:website|web\\s?site|web\\s?app|webapp|website|web\\s?page|webpage|landing\\s+page|dashboard|calculator|converter|tool|form|editor|portal|store|shop|marketplace|blog|wiki|quiz|سایت|وبسایت|وب\\s?اپ|اپلیکیشن|اپ|داشبورد|پنل|ماشین\\s?حساب|مبدل|ابزار|فرم|صفحه|فروشگاه|پورتال|وبلاگ|کوییز|آزمون)`,
);

const MASKERS: readonly RegExp[] = [
  GAME_AS_ADJECTIVE,
  GAME_AS_SUBJECT,
  GAME_AS_MODIFIER_EN,
  GAME_AS_MODIFIER_FA,
  WEB_AS_SUBJECT,
];

/** Blanks every demoted span in place (same length, so indices stay valid). */
function maskThemes(text: string): string {
  let out = text;
  for (const re of MASKERS) {
    re.lastIndex = 0;
    out = out.replace(re, m => " ".repeat(m.length));
  }
  return out;
}

/** First match of a pattern, for naming the deciding noun in logs. */
function firstMatch(text: string, re: RegExp): string | undefined {
  re.lastIndex = 0;
  const m = re.exec(text);
  return m ? m[0].trim() : undefined;
}

function countMatches(text: string, re: RegExp): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) {
    n++;
    if (n > 40) break; // a pathological input cannot spin here
  }
  return n;
}

/* ══════════════════════════════════════════════════════════════════════════
   EVIDENCE TABLES
   ══════════════════════════════════════════════════════════════════════════ */

/** The word itself. `game`/`gameplay`/`minigame`, Persian `بازی`/`گیم`. */
const GAME_TOKEN = all(
  String.raw`(?<![a-z])(?:mini[- ]?game|gameplay|game|gaming)(?![a-z])|` + fa("(?:بازی|گیم)"),
);

/**
 * Genre nouns: a request that names a genre is a game request even when the
 * word "game" never appears ("make a tetris", "یه شطرنج بساز"). Weight 2 each,
 * which deliberately loses to an explicit deliverable noun (3) — that asymmetry
 * is what makes "a chess website" a website.
 */
const GAME_GENRE = all(
  [
    String.raw`(?<![a-z])(?:platformer|platform\s+game|shmup|shooter|bullet\s+hell|endless\s+runner|runner|snake|tetris|pong|flappy|breakout|maze|rpg|roguelike|rogue[- ]like|tower\s+defense|match[- ]?3|minesweeper|2048|arcade|fighter|fighting\s+game|dungeon\s+crawler|space\s+invaders|pac[- ]?man|pinball|billiards|solitaire|mahjong|sudoku|chess|checkers|backgammon|sokoban|jigsaw)(?![a-z])`,
    fa("(?:پلتفرمر|تیراندازی|دونده|مار|تتریس|پینگ\\s?پونگ|پازل|فکری|جدول|شطرنج|تخته\\s?نرد|ورق|سودوکو|مین\\s?یاب|معما|دفاع\\s+از\\s+برج|رانندگی|فوتبال|بسکتبال|والیبال|مبارزه|شبیه\\s?ساز|ماجراجویی|نبرد)"),
  ].join("|"),
);

/**
 * Deliverable nouns for a web app. Weight 3: these name the artifact itself, so
 * they outrank every topic word. `quiz` lives here rather than under games
 * because this product treats a quiz as an interactive page, not a game.
 */
const WEB_STRONG = all(
  [
    String.raw`(?<![a-z])(?:website|web\s?site|web\s?app|webapp|web\s?page|webpage|site|landing\s+page|dashboard|admin\s+panel|calculator|converter|todo|task\s+manager|tracker|tool|form|editor|portal|store|shop|e-?\s?commerce|marketplace|blog|wiki|quiz|trivia|booking|crm|kanban|portfolio|showcase|spreadsheet\s+app)(?![a-z])`,
    fa("(?:سایت|وبسایت|وب\\s?اپ|وباپ|داشبورد|پنل|ماشین\\s?حساب|حسابگر|مبدل|ابزار|فرم|ویرایشگر|فروشگاه|پورتال|وبلاگ|کوییز|آزمون|ترتیب\\s?تست|صفحه\\s?وب)"),
  ].join("|"),
);

/** Generic application nouns, and a bare "web". Weight 1 — real but weak. */
const WEB_GENERIC = all(
  [
    String.raw`(?<![a-z])(?:application|app|web|platform)(?![a-z])`,
    fa("(?:اپلیکیشن|اپ|پلتفرم|وب)"),
  ].join("|"),
);

/** Explicit file formats. Unambiguous, so weight 4. */
const DOC_EXPLICIT = all(
  [
    String.raw`(?<![a-z])(?:pdf|docx|xlsx|pptx|powerpoint|spreadsheet|ppt|word\s+(?:document|file|doc)|microsoft\s+word|slide\s+deck|presentation\s+slides|google\s+slides|report\s+file)(?![a-z])`,
    fa("(?:پی\\s?دی\\s?اف|پاورپوینت|اکسل|اسلاید|فایل\\s?ورد|سند\\s?ورد|فایل\\s?اکسل)"),
  ].join("|"),
);

/** Document-ish nouns that are weaker because the words have other uses. */
const DOC_SOFT = all(
  [
    String.raw`(?<![a-z])(?:report|document|cv|resume|whitepaper|newsletter)(?![a-z])`,
    fa("(?:گزارش|سند|مقاله|جزوه|رزومه)"),
  ].join("|"),
);

/* ══════════════════════════════════════════════════════════════════════════
   THE CLASSIFIER
   ══════════════════════════════════════════════════════════════════════════ */

function verdict(
  target: BuildTarget,
  confidence: number,
  reason: string,
  extra: { goalNoun?: string; demotedTheme?: string } = {},
): BuildVerdict {
  return { target, confidence, reason, ...extra };
}

/**
 * Classifies a build request by its GOAL, not by the keywords inside it.
 *
 * Returns `ambiguous` when nothing names a buildable artifact — the caller then
 * keeps whatever the model chose, which is the honest answer when the request
 * carries no evidence either way.
 */
export function classifyBuildTarget(text: string): BuildVerdict {
  const raw = String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!raw) return verdict("ambiguous", 0, "empty");

  const masked = maskThemes(raw);
  const demotedTheme = MASKERS.map(re => firstMatch(raw, re)).find(Boolean);

  const gameTokens = countMatches(masked, GAME_TOKEN);
  const genreHits = countMatches(masked, GAME_GENRE);
  const strongWeb = firstMatch(masked, WEB_STRONG);
  const genericWeb = firstMatch(masked, WEB_GENERIC);
  const explicitDoc = firstMatch(masked, DOC_EXPLICIT);
  const softDoc = firstMatch(masked, DOC_SOFT);

  const gameScore = (gameTokens ? 2 : 0) + (genreHits ? 2 : 0);
  const webScore = (strongWeb ? 3 : 0) + (genericWeb ? 1 : 0);
  const docScore = (explicitDoc ? 4 : 0) + (softDoc ? 2 : 0);

  const evidence = `game=${gameScore} web=${webScore} doc=${docScore}`;
  const extra = { goalNoun: strongWeb || explicitDoc || undefined, demotedTheme };

  // 1 · A document format with nothing else naming an artifact.
  if (docScore > 0 && webScore === 0 && gameScore === 0) {
    return verdict("document", 0.95, `document-only (${evidence})`, extra);
  }
  // 2 · A game signal with no competing artifact noun.
  if (gameScore > 0 && webScore === 0 && docScore === 0) {
    return verdict("game", 0.95, `game-only (${evidence})`, extra);
  }
  // 3 · A web goal with no competing game goal. This is the branch that fixes
  //     "website about a game" and "game-themed calculator".
  if (webScore > 0 && gameScore === 0 && docScore === 0) {
    return verdict("webapp", 0.95, `webapp-only (${evidence})`, {
      goalNoun: strongWeb || genericWeb || undefined,
      demotedTheme,
    });
  }
  // 4 · Contests. A tie goes to the non-game reading on purpose: "game" is the
  //     most common *topic* word in this product's own failure reports.
  if (gameScore > 0 && webScore > 0) {
    const margin = webScore - gameScore;
    return webScore >= gameScore
      ? verdict("webapp", margin >= 3 ? 0.85 : 0.75, `webapp-beats-game (${evidence})`, {
          goalNoun: strongWeb || undefined, demotedTheme,
        })
      : verdict("game", margin <= -3 ? 0.85 : 0.75, `game-beats-webapp (${evidence})`, extra);
  }
  if (docScore > 0 && gameScore > 0) {
    return verdict("document", 0.7, `document-beats-game (${evidence})`, extra);
  }
  if (docScore > 0 && webScore > 0) {
    // "a website that exports a PDF" is a website; a bare report is a document.
    return strongWeb
      ? verdict("webapp", 0.8, `explicit-webapp-over-format (${evidence})`, extra)
      : verdict("document", 0.7, `document-over-generic-web (${evidence})`, extra);
  }
  if (docScore > 0) return verdict("document", 0.6, `document-weak (${evidence})`, extra);
  if (webScore > 0) return verdict("webapp", 0.6, `webapp-weak (${evidence})`, extra);
  if (gameScore > 0) return verdict("game", 0.6, `game-weak (${evidence})`, extra);

  return verdict("ambiguous", 0.3, "no-artifact-noun");
}

/**
 * Resolves which heavy engine should build a request, from the tool the model
 * chose plus the request text.
 *
 * Precedence is intentional: deterministic evidence about the *goal* beats the
 * model's tool choice (that is the fix for "website about a game" being built by
 * the game engine), while a request that carries no artifact evidence at all
 * leaves the model's choice untouched instead of second-guessing it.
 */
export function resolveBuildEngine(
  toolName: string | undefined,
  text: string,
): { engine: "game" | "webapp"; verdict: BuildVerdict; overridden: boolean } {
  const v = classifyBuildTarget(text);
  const toolSaysGame = toolName === "create_game";
  const game = v.target === "game" ? true : v.target === "webapp" ? false : toolSaysGame;
  return {
    engine: game ? "game" : "webapp",
    verdict: v,
    overridden: (v.target === "game" || v.target === "webapp") && game !== toolSaysGame,
  };
}
