/**
 * Deterministic request-intent routing for Nova.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Tool selection used to be delegated wholesale to Gemini's function-calling.
 * That works for genuinely ambiguous requests, but it fails badly on explicit
 * commands, because the model matches on *topic* rather than on *goal*. The
 * canonical failure: a user replies to someone in a group and writes
 * "نوا بلاکش کن" ("Nova, block him"). No moderation tool existed, so the model
 * reached for the closest thing it had a hook for and ran a **web search**.
 *
 * The fix is not a better prompt. It is a precedence model: an explicit command
 * is classified here, deterministically, from wording plus conversation context,
 * and the model is then either bypassed entirely or handed a restricted tool set
 * it cannot escape (`allowed_function_names`). Probabilistic routing only gets
 * to decide what deterministic routing left open.
 *
 * This module is deliberately pure — no `env`, no `cfg`, no Telegram, no
 * module-level mutable state — so the whole routing table is unit-testable in
 * isolation, exactly like `core.ts`.
 */

/* ══════════════════════════════════════════════════════════════════════════
   PERSIAN WORD-BOUNDARY GUARDS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `\b` is defined against ASCII `\w`, so it can never match beside Persian
 * text: in `/شو\b/` both `و` and a following space are non-word characters and
 * no boundary exists between them. Persian stems must assert "not preceded /
 * followed by another Arabic-script letter or ZWNJ" explicitly instead.
 *
 * This matters more than it looks. Persian is written without spaces around
 * clitics, so short stems appear inside longer unrelated words: `کن` ("do") is
 * inside `کنکور` ("entrance exam"), and `بن` ("ban") is inside `بنده`
 * ("servant"/"I"). Without these guards, "کنکور چطوره؟" reads as an imperative
 * command and "بنده اومدم" reads as a ban request.
 */
const FA = "\\u0600-\\u06FF\\u200c";
/** Negative lookbehind: no Arabic-script letter immediately before. */
export const FA_START = `(?<![${FA}])`;
/** Negative lookahead: no Arabic-script letter immediately after. */
export const FA_END = `(?![${FA}])`;

/** Wraps a Persian stem in both guards. */
function fa(stem: string): string {
  return FA_START + stem + FA_END;
}

/** Builds a case-insensitive alternation regex from raw pattern fragments. */
function alt(...fragments: string[]): RegExp {
  return new RegExp(`(${fragments.join("|")})`, "i");
}

/* ══════════════════════════════════════════════════════════════════════════
   INTENT TAXONOMY
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every routable goal Nova recognizes.
 *
 * Ordered loosely by the precedence tiers in {@link INTENT_TIER}: an explicit
 * system/moderation command must never lose to a general-purpose tool.
 */
export type IntentCategory =
  // Tier 1 — explicit system / admin / moderation commands
  | "system_command"
  | "moderation"
  | "group_management"
  | "admin_action"
  | "user_management"
  // Tier 2 — explicit image / media operations
  | "image_edit"
  | "image_generate"
  | "image_search"
  | "media_operation"
  | "sticker_operation"
  // Tier 3 — explicit identity operations
  | "name_switch"
  | "persona_switch"
  | "persona_info"
  // Tier 4 — explicit memory operations
  | "memory_operation"
  // Tier 5 — the user explicitly asked for a lookup/research (depth is the model's call)
  | "research"
  // Tier 6 — other specialized tools
  | "game_create"
  | "web_app"
  | "document_create"
  | "scheduling"
  | "voice_request"
  // Tier 7 — conversation
  | "activation"
  | "general_knowledge"
  | "conversation";

/** Precedence tier. Lower wins. */
export const INTENT_TIER: Record<IntentCategory, number> = {
  system_command: 1,
  moderation: 1,
  group_management: 1,
  admin_action: 1,
  user_management: 1,

  image_edit: 2,
  image_generate: 2,
  image_search: 2,
  media_operation: 2,
  sticker_operation: 2,

  name_switch: 3,
  persona_switch: 3,
  persona_info: 3,

  memory_operation: 4,

  research: 5,

  game_create: 6,
  web_app: 6,
  document_create: 6,
  scheduling: 6,
  voice_request: 6,

  activation: 7,
  general_knowledge: 7,
  conversation: 7,
};

/** Moderation verbs Nova can be asked to perform on another member. */
export type ModerationAction =
  | "block" | "unblock"
  | "mute" | "unmute"
  | "kick"
  | "warn"
  | "delete_message"
  | "promote_vip" | "demote_vip";

/**
 * Conversation facts the classifier is allowed to consider.
 *
 * Wording alone is not enough: "ادیتش کن" is an image edit only when an image
 * is actually reachable, and "بلاکش کن" is moderation only when there is a
 * target to act on. Context turns ambiguous phrasing into a decision.
 */
export interface IntentContext {
  /** Raw user message (text or caption). */
  text: string;
  /** True for group / supergroup. */
  isGroup: boolean;
  /** The message is a reply to another message. */
  isReply: boolean;
  /** Telegram id of the replied-to author, when replying to a human. */
  repliedUserId?: number | null;
  /** Display name of the replied-to author. */
  repliedUserName?: string | null;
  /** The reply target is Nova's own message. */
  repliedToSelf?: boolean;
  /** The replied-to message carries a photo. */
  repliedHasImage?: boolean;
  /** The replied-to message carries non-image media (gif/video/doc/voice). */
  repliedHasMedia?: boolean;
  /** The current message itself carries a photo. */
  hasAttachedImage?: boolean;
  /** An image from earlier in this chat is still resolvable. */
  hasRecentImage?: boolean;
  /** Sender is the bot owner. */
  isOwner?: boolean;
  /** Sender is a Telegram admin of this chat (or the owner). */
  isChatAdmin?: boolean;
  /** Names that address Nova right now: default plus any active nickname. */
  selfNames?: readonly string[];
  /** Persona ids with their aliases, for persona detection. */
  personaAliases?: ReadonlyArray<{ id: string; aliases: readonly string[] }>;
  /** Currently active persona id. */
  activePersonaId?: string;
}

/** Extra data the router recovered from the wording. */
export interface IntentSlots {
  /** Which moderation verb was requested. */
  moderationAction?: ModerationAction;
  /** Target user id for a moderation action, when resolvable. */
  targetUserId?: number | null;
  /** Duration in minutes for a timed action ("یه ساعت میوتش کن"). */
  durationMinutes?: number | null;
  /** New name extracted from an explicit rename command. */
  newName?: string;
  /** Persona id an explicit persona command points at. */
  personaId?: string;
  /** Whether a persona/name change was phrased as a standing preference. */
  permanent?: boolean;
  /** Where an image-edit source should come from. */
  imageSource?: "reply" | "attached" | "recent";
}

export interface IntentDecision {
  category: IntentCategory;
  /** 0..1. Only >= 0.8 is treated as deterministic. */
  confidence: number;
  /**
   * True when routing must be enforced rather than suggested: the model either
   * never runs, or runs with `allowedTools` clamped.
   */
  deterministic: boolean;
  /** Tool names the model may call. Empty means "no restriction". */
  allowedTools: string[];
  /** Tools explicitly ruled out, stated in the directive for the model. */
  forbiddenTools: string[];
  /** Routing note injected into the system prompt. Content-free about the user. */
  directive: string;
  slots: IntentSlots;
  /** Short machine-readable reason, for logs. */
  reason: string;
  /**
   * When true the transport switches Gemini to `mode: "ANY"` over
   * {@link allowedTools} — "you must call one of these". Only set when the
   * action is unambiguous *and* its prerequisites are already satisfied.
   */
  forceToolCall?: boolean;
  /** True when Nova was addressed by one of her names anywhere in the text. */
  addressed?: boolean;
  /** The command body with the vocative stripped — what actually got matched. */
  body?: string;
}

function decide(
  category: IntentCategory,
  reason: string,
  opts: Partial<Omit<IntentDecision, "category" | "reason">> = {},
): IntentDecision {
  return {
    category,
    reason,
    confidence: opts.confidence ?? 0.9,
    deterministic: opts.deterministic ?? (opts.confidence ?? 0.9) >= 0.8,
    allowedTools: opts.allowedTools ?? [],
    forbiddenTools: opts.forbiddenTools ?? [],
    directive: opts.directive ?? "",
    slots: opts.slots ?? {},
    forceToolCall: opts.forceToolCall,
    addressed: opts.addressed,
    body: opts.body,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   TIER 1 — MODERATION / GROUP MANAGEMENT
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Moderation verbs, Persian first.
 *
 * Persian attaches the third-person object pronoun directly to the stem, so
 * "block him" is one word: `بلاکش`. Each verb therefore needs its bare form and
 * its `‑ش` / `‑شون` inflections. `فیلترش` and `بلوکش` are common transliteration
 * variants users actually type.
 */
const MODERATION_PATTERNS: Array<[ModerationAction, RegExp]> = [
  ["unblock", alt(
    "آنبلاک", "an\\s?block", "unblock", "un-?ban", "آن\\s*بلاک",
    "رفع\\s*(مسدود|بلاک|فیلتر)", "از\\s*بلاک\\s*(در|خارج)",
    fa("آزادش") + "\\s*کن", "بلاک(ش|شون)?\\s*(رو|را)?\\s*(بردار|وردار|لغو)",
  )],
  ["block", alt(
    "بلاک", "بلوک", "block(?!\\s*chain)", fa("بن") + "\\s*(کن|کنش)", "بنش\\s*کن", "\\bban\\b",
    "مسدود", "فیلتر(ش|ش\\s*کن)", "blacklist", "لیست\\s*سیاه",
  )],
  ["unmute", alt("آنمیوت", "unmute", "رفع\\s*سکوت", "اجازه\\s*(حرف|صحبت)", "صداش\\s*(رو|را)?\\s*باز\\s*کن")],
  ["mute", alt(
    "میوت", "\\bmute\\b", "سکوت", "ساکتش?\\s*کن", "صداش\\s*(رو|را)?\\s*ببند",
    "اجازه\\s*(حرف|صحبت)\\s*(نده|نداره)", "حرف\\s*نزنه",
    // Telegram-Persian slang for the same action.
    "سایلنت(ش|شون)?", "\\bsilent\\b", "ریستریکت(ش|شون)?", "\\brestrict\\b",
    "محدودش?\\s*کن", "خفه(ش|شون)?\\s*کن", "دهنش\\s*(رو|را)?\\s*ببند",
  )],
  ["kick", alt(
    "اخراج", "\\bkick\\b", "کیکش?\\s*کن", "\\bremove\\b\\s*(from)?\\s*(the)?\\s*(group|chat)",
    "(از\\s*گروه\\s*)?(بندازش?|پرتش?|بیرونش?)\\s*(بیرون|کن)", "بیرون\\s*کن", "از\\s*گروه\\s*(حذف|خارج)",
  )],
  ["warn", alt("اخطار", "تذکر", "\\bwarn\\b", "هشدار\\s*بده")],
  ["delete_message", alt(
    "پیام(ش|شو|ش\\s*رو)?\\s*(رو|را)?\\s*(پاک|حذف)", "(پاک|حذف)\\s*کن\\s*(پیام|این\\s*پیام)",
    "delete\\s*(this|that|the)?\\s*(message|msg)", "remove\\s*(this|that)?\\s*message",
    "این\\s*(رو|را)?\\s*(پاک|حذف)\\s*کن",
  )],
  ["promote_vip", alt("vip\\s*کن", "ویژه\\s*کن", "vip(ش|ش\\s*کن)", "make\\s*(him|her|them|it)?\\s*vip", "ارتقا")],
  ["demote_vip", alt("vip\\s*(ش|شو)?\\s*(بردار|وردار|حذف)", "از\\s*vip\\s*(در|خارج)", "remove\\s*vip", "unvip")],
];

/**
 * Group-scoped administration that is not aimed at a single member.
 * Kept separate from `moderation` because it needs no target resolution.
 */
const GROUP_MGMT_RE = alt(
  "(گروه|چت)\\s*(رو|را)?\\s*(قفل|ببند|باز\\s*کن|فعال|غیرفعال|خاموش|روشن)",
  "قفل\\s*کن\\s*(گروه|چت)", "تنظیمات\\s*گروه", "group\\s*settings",
  "(lock|unlock|close|open)\\s*(the)?\\s*(group|chat)",
  "خلاصه\\s*(ی)?\\s*(گروه|چت|پیام\\s*ها)", "summarize\\s*(the)?\\s*(group|chat)",
  "لیست\\s*اعضا", "اعضای\\s*گروه", "member\\s*list",
);

/** Owner-only administration surfaces. */
const ADMIN_ACTION_RE = alt(
  "پنل\\s*(ادمین|مدیریت)", "داشبورد", "admin\\s*panel", "dashboard",
  "آمار\\s*(ربات|کلی|بات)", "bot\\s*stats", "broadcast", "پیام\\s*همگانی", "همگانی\\s*(بفرست|کن)",
  "حالت\\s*تعمیر", "maintenance", "لاگ\\s*(ها|سیستم)", "show\\s*logs",
  "سقف\\s*(روزانه|پیام|تصویر|عکس)", "محدودیت\\s*(روزانه|کاربر)", "daily\\s*limit",
  "کلید(های)?\\s*api", "api\\s*keys?",
);

/** Actions aimed at a specific user's account state (not chat moderation). */
const USER_MGMT_RE = alt(
  "حافظه\\s*(ی)?\\s*(کاربر|این\\s*یارو|این\\s*شخص)", "(view|reset)\\s*user\\s*memory",
  "پروفایل\\s*کاربر", "اطلاعات\\s*(این\\s*)?کاربر", "user\\s*(profile|info)",
  "پیام\\s*بده\\s*به\\s*کاربر", "send\\s*message\\s*to\\s*user",
);

/** "for a while" durations attached to a moderation verb. */
const DURATION_RE = new RegExp(
  "(\\d+)\\s*(دقیقه|دقیقه\\s*ای|min(?:ute)?s?|ساعت|hours?|hr|روز|days?)",
  "i",
);

function extractDuration(text: string): number | null {
  const m = DURATION_RE.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toLowerCase();
  if (/ساعت|hour|hr/.test(unit)) return Math.min(n * 60, 60 * 24 * 30);
  if (/روز|day/.test(unit)) return Math.min(n * 60 * 24, 60 * 24 * 30);
  return Math.min(n, 60 * 24 * 30);
}

/* ══════════════════════════════════════════════════════════════════════════
   TIER 2 — IMAGE / MEDIA
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Edit verbs. `عوض کن` and `تغییر بده` are shared with persona/name switching,
 * so this pattern only ever fires once an image is actually in scope — the
 * ordering in {@link classifyRequestIntent} guarantees that.
 */
const IMAGE_EDIT_VERB_RE = alt(
  "ادیت", "ویرایش", "ریتاچ", "retouch",
  "\\bedit\\b", "\\bmodify\\b", "\\bfix\\b", "\\bchange\\b", "\\bremove\\b", "\\badd\\b", "\\breplace\\b",
  "\\bupscale\\b", "\\benhance\\b", "\\brestore\\b", "\\bcolor(?:ize|ise)\\b", "\\bcrop\\b", "\\bblur\\b",
  fa("درستش") + "\\s*کن", "درست\\s*کن", "بهترش?\\s*کن", "اصلاحش?\\s*کن",
  "(تغییر|عوض)(ش|شون)?\\s*(بده|کن)", "تغییرش\\s*بده",
  "پس\\s*زمینه|پس‌زمینه|background", "بک\\s*گراند",
  "(اضافه|حذف|پاک|کم|زیاد)\\s*کن", "رنگ(ش|ی)?\\s*(کن|بده|عوض)",
  "کیفیت(ش)?\\s*(رو|را)?\\s*(ببر|بالا|بهتر)", "واضح(ش)?\\s*کن",
  "کارتونی|انیمه|نقاشی|cartoon|anime|sketch|oil\\s*painting",
  // Colour/tone conversions users phrase without any generic edit verb.
  "سیاه\\s*(و\\s*)?سفیدش?\\s*کن", "بلک\\s*اند\\s*وایت", "black\\s*(and|&)\\s*white", "\\bgrayscale\\b", "\\bgreyscale\\b",
  "قدیمیش?\\s*کن", "روشن(ش|ترش)?\\s*کن", "تاریک(ش|ترش)?\\s*کن", "محوش?\\s*کن",
  "برش?\\s*بزن", "کراپش?\\s*کن", "بزرگش?\\s*کن", "کوچیکش?\\s*کن",
);

/**
 * Public form of the edit-verb test, for callers that already know an image is
 * in scope (e.g. building the reply context for a replied-to photo) and only
 * need to know whether the wording asks for a modification.
 */
export function looksLikeImageEdit(text: string): boolean {
  return IMAGE_EDIT_VERB_RE.test(normalizeDigitsForIntent(text ?? ""));
}

/** Nouns that put an image in scope even without media attached. */
const IMAGE_NOUN_RE = alt(
  "عکس", "تصویر", "پیکچر", "فوتو", "\\bimage\\b", "\\bphoto\\b", "\\bpic(?:ture)?\\b", "عکسی",
);

/** "the previous / last one" — resolves to the most recent image in the chat. */
const PRIOR_REFERENCE_RE = alt(
  "قبلی", "آخری", "اخری", "همون", "همان", "اونی\\s*که", "قبلا", "قبلاً",
  "\\bprevious\\b", "\\blast\\b", "\\bthat\\s+(one|image|photo|pic)\\b", "\\bearlier\\b",
);

/** Generation verbs — distinct from editing: no source image is involved. */
const IMAGE_GEN_RE = alt(
  "(بساز|بکش|تولید\\s*کن|درست\\s*کن|طراحی\\s*کن|خلق\\s*کن)",
  "\\b(generate|create|draw|make|paint|render|design)\\b",
  "عکس\\s*بساز", "تصویر\\s*بساز", "یه\\s*عکس\\s*از",
);

/** Explicit "find me a real photo/gif of X" — a search, not generation. */
const IMAGE_SEARCH_RE = alt(
  "(عکس|تصویر|گیف|gif|استیکر)\\s*(از|واسه|برای)?\\s*.{0,40}?(پیدا\\s*کن|بگرد|سرچ\\s*کن|بفرست|بده)",
  "(پیدا\\s*کن|سرچ\\s*کن|بگرد)\\s*.{0,30}?(عکس|تصویر|گیف|gif)",
  "(find|search|send)\\s*(me)?\\s*(a|an|some)?\\s*(real)?\\s*(photo|image|pic(?:ture)?|gif)",
  "عکس\\s*واقعی", "real\\s*photo",
);

/** Media utility operations that are neither edit nor generation. */
const MEDIA_OP_RE = alt(
  "\\bocr\\b", "متن(ش)?\\s*(رو|را)?\\s*(در\\s*بیار|استخراج|بخون)", "extract\\s*text", "read\\s*the\\s*text",
  "دوباره\\s*(بفرست|فرستش)", "همون\\s*(رو|را)?\\s*(دوباره|مجدد)", "send\\s*(it|that)\\s*again", "resend",
  "توضیح\\s*بده\\s*(این\\s*)?(عکس|تصویر)", "(این\\s*)?(عکس|تصویر)\\s*(چیه|چیست|رو\\s*توضیح)",
  "describe\\s*(this|the)?\\s*(image|photo|pic)", "what.{0,10}\\s*in\\s*(this|the)\\s*(image|photo|pic)",
);

/** Sticker-specific requests. */
const STICKER_OP_RE = alt(
  "استیکر", "sticker", "استیکرت?", "پک\\s*استیکر", "sticker\\s*pack",
);

/* ══════════════════════════════════════════════════════════════════════════
   TIER 3 — IDENTITY: NAME SWITCHING vs ACTIVATION vs PERSONA
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Explicit rename commands, with the new name captured.
 *
 * This is the single most important pattern in the file to keep *narrow*.
 * Renaming is destructive and persistent, so it must fire on an explicit
 * imperative and nothing else: "فلانی خیلی خوبه" mentions a name and must not
 * rename anything. Every alternative below therefore requires an explicit
 * rename verb (`بذار`/`عوض کن`/`صدا می‌زنم`/`call you`) — never a bare mention.
 *
 * Capture group 1 is always the new name.
 */
const RENAME_PATTERNS: RegExp[] = [
  // "اسم نوا رو بذار سحر" / "اسمت را عوض کن به سحر" / "اسمتو بکن سحر"
  new RegExp(
    "اسم(?:ت|تو|ش|شو|\\s*(?:نوا|خودت|ربات|بات))?\\s*(?:رو|را|و)?\\s*" +
    "(?:بذار|بگذار|بزار|کن|بکن|تغییر\\s*بده|عوض\\s*کن|عوضش\\s*کن|change|set)\\s*" +
    "(?:به|روی|رو)?\\s*[«\"'‹]?([^\\s«»\"'‹›,،.!?؟]{2,30})[»\"'›]?",
    "i",
  ),
  // "از این به بعد اسمت سحره" / "اسمت دیگه سحره"
  new RegExp(
    "(?:از\\s*این\\s*به\\s*بعد|از\\s*الان|دیگه|دیگر)\\s*" +
    "اسم(?:ت|تو|ش)?\\s*(?:رو|را)?\\s*[«\"'‹]?([^\\s«»\"'‹›,،.!?؟]{2,30})[»\"'›]?\\s*" +
    "(?:ه|است|باشه|هست)?",
    "i",
  ),
  // "بهت می‌گم سحر" / "صدات می‌زنم سحر" / "بهت میگم سحر"
  new RegExp(
    "(?:بهت|به\\s*تو|صدات|صداتو|صدای\\s*تو)\\s*" +
    "(?:می\\s*|می‌)?(?:گم|گویم|زنم|کنم|خونم|خوانم)\\s*" +
    "[«\"'‹]?([^\\s«»\"'‹›,،.!?؟]{2,30})[»\"'›]?",
    "i",
  ),
  // English: "change your name to X" / "call you X" / "your name is now X"
  new RegExp(
    "(?:change|set|update)\\s+(?:your|nova'?s|the\\s+bot'?s)\\s+name\\s+(?:to|into)\\s+" +
    "[\"'«]?([^\\s\"'«»,.!?]{2,30})[\"'»]?",
    "i",
  ),
  new RegExp(
    "(?:i(?:'l+)?\\s*ll?\\s*call\\s*you|call\\s*you|rename\\s*(?:you|yourself)\\s*to|" +
    "your\\s*name\\s*is\\s*(?:now)?)\\s*[\"'«]?([^\\s\"'«»,.!?]{2,30})[\"'»]?",
    "i",
  ),
];

/** Reverting to the default identity. */
const RENAME_RESET_RE = alt(
  "اسم(?:ت|تو|ش)?\\s*(?:رو|را)?\\s*(?:برگردون|برگردان|ریست|reset|پیش\\s*فرض|پیش‌فرض)",
  "(?:بشو|برگرد)\\s*(?:همون\\s*)?نوا", "دوباره\\s*نوا\\s*(?:شو|باش)",
  "reset\\s*(?:your)?\\s*name", "go\\s*back\\s*to\\s*nova",
);

/**
 * Words that make a message *about* Nova's persona system rather than a call.
 *
 * Required for any persona intent that mentions Nova's own name. Without it,
 * "نوا؟" — a call — classified as a question about the `nova` persona and
 * Nova answered by displaying a persona card instead of replying. Calling Nova
 * and reconfiguring Nova are different acts and must stay separated.
 */
const PERSONA_CONTEXT_RE = alt(
  "شخصیت", "پرسونا", "کاراکتر", fa("نقش(?:ت|تو|ش|ی)?"), "حالت", "مود",
  "\\bpersona\\b", "\\bcharacter\\b", "\\brole\\b", "\\bmode\\b", "\\bpersonality\\b",
);

/**
 * Bare vocatives — the message is *only* addressing Nova.
 *
 * "نوا؟", "نوا بیا", "نوا جواب بده", "نوا اینو ببین" are calls. They must reach
 * normal conversation handling with no tool and no persona machinery.
 */
const VOCATIVE_TAIL_RE = alt(
  fa("بیا"), fa("بیدار"), fa("هستی"), fa("کجایی"), fa("جواب") + "\\s*بده", fa("ببین"),
  fa("گوش") + "\\s*(کن|بده)", fa("سلام"), fa("هوی"), fa("الو"),
  "\\bhey\\b", "\\bhi\\b", "\\bhello\\b", "\\byou\\s*there\\b", "\\bwake\\s*up\\b",
  "\\bcome\\b", "\\banswer\\b", "\\blook\\b", "\\blisten\\b",
);

/**
 * Filler that may surround a bare summons without turning it into a request:
 * politeness, terms of endearment and bare demonstratives ("نوا اینو ببین").
 */
const VOCATIVE_FILLER_RE = new RegExp(
  fa("(?:جان|جون|جونم|عزیزم|قربونت|لطفا|لطفاً|ببخشید|اینو|اینا|این|منو|من|رو|را)")
  + "|(?:^|[^a-z])(?:please|dear|sec|second|this|that|it|me)(?:$|[^a-z])",
  "gi",
);

/**
 * A summons only counts when the *whole* remainder is one. Testing
 * `VOCATIVE_TAIL_RE` against the raw body matched a vocative word appearing
 * anywhere, so real orders were swallowed as activation — "نوا سرچ کن ببین
 * امروز چه خبره" contains "ببین" but is an instruction to search. Strip the
 * summons words and the filler around them; if any letter or digit survives,
 * the user asked for something and the request must keep travelling down the
 * tiers.
 */
function isBareVocative(body: string): boolean {
  if (!body) return true;
  if (body.length > 40) return false;
  const rest = body
    .replace(new RegExp(VOCATIVE_TAIL_RE.source, "gi"), " ")
    .replace(VOCATIVE_FILLER_RE, " ");
  return !/[\p{L}\p{N}]/u.test(rest);
}

/* ══════════════════════════════════════════════════════════════════════════
   TIER 4 — MEMORY
   ══════════════════════════════════════════════════════════════════════════ */

const Z = "[\\s\\u200c]*";
const MEMORY_OP_RE = alt(
  "(?:حافظه|خاطره|مموری|memory)" + Z + "(?:ت|تو|ات|شو)?" + Z + "(?:رو|را|و)?" + Z + "(?:پاک|خالی|ریست|reset|clear|wipe)",
  "(?:پاک|خالی|ریست)\\s*کن\\s*(?:حافظه|چت|گفتگو|مکالمه)",
  "(?:فراموش|یادت\\s*نره|از\\s*یاد\\s*ببر)", "\\bforget\\b", "\\bwipe\\b",
  "(?:چت|گفتگو|مکالمه)\\s*(?:رو|را)?\\s*(?:از\\s*اول|ریست|پاک|جدید)",
  "(?:start|begin)\\s*(?:over|fresh|again)", "clear\\s*(?:the)?\\s*(?:chat|conversation|memory|history)",
  "(?:یادت\\s*باشه|به\\s*یاد\\s*داشته\\s*باش|ذخیره\\s*کن\\s*که)", "\\bremember\\s*that\\b",
  "(?:چی\\s*(?:از\\s*من)?\\s*یادته|حافظه\\s*ت\\s*چیه|درباره\\s*م\\s*چی\\s*میدونی)",
  "what\\s*do\\s*you\\s*(?:remember|know)\\s*about\\s*me",
);

/* ══════════════════════════════════════════════════════════════════════════
   TIER 5 — THE USER NAMED THE ACT OF SEARCHING
   ══════════════════════════════════════════════════════════════════════════

   This tier deliberately contains no subject matter.

   It used to hold three graded keyword lists: volatile topics (prices, rates,
   gold, crypto, weather, scores, news) that forced a "quick lookup", research
   phrasing that forced "standard", and intensifiers that forced "super". Those
   lists were guesses about *what* deserves a search, and they were wrong in both
   directions — they triggered lookups nobody asked for, missed every subject
   nobody had anticipated, and pinned the depth before anything was known about
   the question.

   What survives is the single thing a regex can settle honestly: did the user
   *name* the act — "سرچ کن", "بگرد", "تحقیق کن", "deep search"? If so, a search
   tool call is mandatory. Everything else is the model's judgement, made inside
   the search tool: whether external data is needed at all, how fresh it must be,
   how complex the request is, which queries to run, how much is enough, and when
   to stop. */

/** The act of looking something up, as named by the user. Verbs only, no topics. */
const SEARCH_ACT_RE = alt(
  "(?:سرچ|جستجو|جست\\s*و\\s*جو|جست‌وجو|گوگل)\\s*(?:رو\\s*)?(?:کن|بزن|بکن|کنی|کنید|می\\s*کنی|می‌کنی)",
  "(?:یه|یک)\\s*(?:سرچ|جستجو|تحقیق|بررسی|ریسرچ)\\s*(?:\\S+\\s+){0,3}?(?:کن|بزن|بکن)",
  "(?:بگرد|بگردی|بگردید|سرچش\\s*کن|گوگلش\\s*کن)",
  "(?:تحقیق|پژوهش|ریسرچ)\\s*(?:رو\\s*)?(?:کن|بکن|بزن|کنی|کنید|می‌کنی|می\\s*کنی)",
  "(?:دیپ|سوپر)\\s*(?:دیپ\\s*)?(?:سرچ|سرچی|search)",
  "(?:منبع|سورس|رفرنس)\\s*(?:هم\\s*)?(?:بده|بیار|بذار|پیدا\\s*کن|میخوام|می‌خوام)",
  "\\bdeep\\s*(?:dive|search|research)\\b", "\\bsuper\\s*deep\\b",
  "\\bfact[-\\s]?check\\b",
  "(?:^|\\b(?:can|could|would|will)\\s*you\\s*(?:please\\s*)?|\\bplease\\s*)(?:search|google|research|look\\s*(?:it|this|that|them)?\\s*up|find\\s*out)\\b",
  "\\b(?:search|google|check)\\s*(?:the\\s*)?(?:web|internet|online)\\b",
  "\\blook\\s*(?:it|this|that|them)\\s*up\\b",
);

/* ══════════════════════════════════════════════════════════════════════════
   TIER 6 — BUILDERS / SCHEDULING / VOICE
   ══════════════════════════════════════════════════════════════════════════ */

const GAME_RE = alt(
  "(?:بازی|گیم|game)(?:[^.،,!؟?\\n]{0,40}?)?\\s*(?:بساز|درست\\s*کن|طراحی\\s*کن|بنویس|بزن|build|make|create)",
  "(?:بساز|درست\\s*کن|بنویس)\\s*(?:یه|یک|a|an)?\\s*(?:[^.،,!؟?\\n]{0,30}?)?(?:بازی|گیم|game)",
  "(?:make|build|create|code|design|write)\\s*(?:me)?\\s*(?:a|an)?\\s*.{0,25}\\bgame\\b",
  "\\b(?:platformer|shmup|roguelike|tower\\s*defense|endless\\s*runner)\\b",
);

const WEB_APP_RE = alt(
  "(?:وب\\s*اپ|وباپ|اپلیکیشن|اپ|سایت|وبسایت|وب\\s*سایت|صفحه\\s*وب|داشبورد|ماشین\\s*حساب)(?:[^.،,!؟?\\n]{0,40}?)?\\s*(?:بساز|درست\\s*کن|طراحی\\s*کن|بنویس)",
  "(?:بساز|درست\\s*کن|بنویس|طراحی\\s*کن)\\s*(?:یه|یک)?\\s*(?:[^.،,!؟?\\n]{0,30}?)?(?:وب\\s*اپ|سایت|اپ|داشبورد|ابزار)",
  "(?:build|make|create|code)\\s*(?:me)?\\s*(?:a|an)?\\s*.{0,25}\\b(?:web\\s*app|website|webpage|dashboard|calculator|landing\\s*page|tool)\\b",
);

const DOCUMENT_RE = alt(
  "(?:pdf|پی\\s*دی\\s*اف|word|ورد|docx|excel|اکسل|xlsx|powerpoint|پاورپوینت|pptx|اسلاید|presentation)",
  "(?:سند|فایل|مقاله|گزارش)\\s*(?:ی)?\\s*(?:بساز|درست\\s*کن|بده|تهیه)",
);

const SCHEDULING_RE = alt(
  "(?:یادآور|ریمایندر|reminder|یادم\\s*(?:بنداز|بیار)|remind\\s*me)",
  "(?:هر\\s*(?:روز|هفته|ساعت|دقیقه)|every\\s*(?:day|week|hour|minute))\\s*.{0,40}(?:بگو|بفرست|یادم|remind|send)",
  "(?:فردا|امشب|بعدا|بعداً|later|tomorrow|tonight|in\\s*\\d+\\s*(?:min|hour))\\s*.{0,40}(?:یادم|بگو|بفرست|remind|tell|send)",
  "(?:ساعت|at)\\s*\\d{1,2}(?::\\d{2})?\\s*.{0,30}(?:یادم|بگو|بفرست|remind)",
);

const VOICE_RE = alt(
  "(?:ویس|voice|صوتی|صدا)\\s*(?:بده|بفرست|بگو|جواب)",
  "(?:با\\s*صدا|صوتی)\\s*(?:بگو|جواب\\s*بده|توضیح)",
  "(?:read|say)\\s*(?:it|this|that)\\s*(?:out\\s*)?loud", "\\btts\\b", "voice\\s*(?:note|message)",
);

/* ══════════════════════════════════════════════════════════════════════════
   SHARED GATES
   ══════════════════════════════════════════════════════════════════════════ */

/** Interrogatives — a question about a capability is not a command to use it. */
const QUESTION_RE = alt(
  fa("چیه"), fa("چیست"), fa("کیه"), fa("کیست"), fa("چطور"), fa("چگونه"), fa("چرا"), fa("آیا"),
  fa("میشه"), fa("می‌شه"), fa("بلدی"), "می\\s*تونی", "می‌تونی",
  "\\bwhat\\b", "\\bwhy\\b", "\\bhow\\b", "\\bwho\\b", "\\bcan\\s*you\\b", "\\bdo\\s*you\\b", "\\bare\\s*you\\b",
);

/** Negation — "don't block him" must not be routed as a block. */
const NEGATION_RE = alt(
  fa("نکن"), fa("نده"), fa("نزن"), fa("نباید"), "نمی\\s*خوام", "نمی‌خوام", "نخواستم", "لازم\\s*نیست",
  "\\bdon'?t\\b", "\\bdo\\s*not\\b", "\\bnever\\b", "\\bno\\s*need\\b", "\\bstop\\b",
);

/** Hypotheticals — "what if you blocked him" is not a command either. */
const HEDGE_RE = alt(
  fa("اگه"), fa("اگر"), fa("شاید"), fa("احتمالا"), "فکر\\s*کنم", "چی\\s*میشه", "چی\\s*می‌شه",
  "\\bif\\b", "\\bmaybe\\b", "\\bperhaps\\b", "\\bwhat\\s*if\\b", "\\bsuppose\\b",
);

/** Persian/Arabic-Indic digits → ASCII, so `\d` patterns work on Persian input. */
export function normalizeDigitsForIntent(text: string): string {
  return String(text ?? "")
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Strips a leading vocative so the *command* can be matched cleanly.
 *
 * "نوا بلاکش کن" and "بلاکش کن" must classify identically; the address is not
 * part of the instruction. Returns the remainder plus whether Nova was named.
 */
export function stripVocative(
  text: string,
  selfNames: readonly string[],
): { body: string; addressed: boolean } {
  let body = String(text ?? "").trim();
  let addressed = false;
  const names = [...selfNames].filter(n => n && n.length >= 2).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Leading or trailing vocative, with optional punctuation around it.
    const lead = new RegExp(`^\\s*${esc}\\s*[،,:!ـ-]*\\s*`, "iu");
    const trail = new RegExp(`\\s*[،,:!ـ-]*\\s*${esc}\\s*[؟?!.]*\\s*$`, "iu");
    if (lead.test(body)) { body = body.replace(lead, "").trim(); addressed = true; }
    else if (trail.test(body)) { body = body.replace(trail, "").trim(); addressed = true; }
    else if (new RegExp(`(^|[\\s،,!؟?.])${esc}([\\s،,!؟?.]|$)`, "iu").test(body)) { addressed = true; }
  }
  return { body, addressed };
}

/* ══════════════════════════════════════════════════════════════════════════
   TOOL POLICY PER CATEGORY
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The routing table, expressed as tool sets rather than prose.
 *
 * `allow` is a whitelist handed to the transport; when it is non-empty the
 * model literally cannot see any other declaration, which is what makes an
 * explicit command impossible to mis-route. `deny` is the softer form used when
 * several tools are plausible but a few are provably wrong. `force` additionally
 * flips Gemini into `mode: "ANY"`, i.e. "you must call one of these" — only ever
 * set when the action is unambiguous AND its prerequisites are satisfied.
 */
export interface ToolPolicy {
  allow?: string[];
  deny?: string[];
  force?: boolean;
}

/** Tools that are expensive, slow, or absurd for a tier-1..4 command. */
const NEVER_FOR_COMMANDS = [
  "search", "read_web_page",
  "create_game", "host_web_app", "create_pdf", "create_code_file",
  "generate_image", "edit_image", "search_images",
];

const TOOL_POLICY: Record<IntentCategory, ToolPolicy> = {
  system_command: { allow: [], deny: NEVER_FOR_COMMANDS },
  moderation: { allow: ["moderate_group_member"] },
  group_management: {
    allow: ["moderate_group_member", "manage_group_vip", "show_admin_panel", "get_bot_stats"],
    deny: NEVER_FOR_COMMANDS,
  },
  admin_action: {
    allow: [
      "show_admin_panel", "get_bot_stats", "show_logs", "toggle_maintenance",
      "update_bot_config", "broadcast_message", "list_web_apps", "delete_web_app",
      "set_vip", "manage_group_vip", "send_message_to_user", "set_user_block",
      "view_user_memory", "reset_user_memory", "moderate_group_member",
    ],
  },
  user_management: {
    allow: [
      "view_user_memory", "reset_user_memory", "set_user_block", "set_vip",
      "send_message_to_user", "moderate_group_member",
    ],
  },
  image_edit: { allow: ["edit_image"] },
  image_generate: { allow: ["generate_image"] },
  image_search: { allow: ["search_images", "resend_last_media"] },
  media_operation: {
    allow: ["resend_last_media", "search_images", "react_to_message", "send_reaction_media"],
    deny: ["search", "create_game", "host_web_app"],
  },
  sticker_operation: {
    allow: ["send_reaction_media", "search_images", "react_to_message"],
  },
  name_switch: { allow: ["set_call_name"], force: true },
  persona_switch: { allow: ["switch_persona"], force: true },
  persona_info: { allow: [], deny: NEVER_FOR_COMMANDS },
  memory_operation: { allow: ["clear_own_memory"] },
  // One search tool, one policy. How deep to go is decided inside the tool, so
  // routing no longer needs (or has) a per-depth category.
  research: { allow: ["search", "read_web_page", "get_current_time", "calculate"], force: true },
  game_create: { allow: ["create_game"], force: true },
  web_app: { allow: ["host_web_app", "create_code_file"] },
  document_create: { allow: ["create_pdf", "create_code_file"] },
  scheduling: { allow: ["schedule_reminder", "list_reminders", "cancel_reminder", "get_current_time"] },
  voice_request: { allow: ["voice_response"] },
  // Being called by name is not a request. No tool may fire on an activation.
  activation: { allow: [], force: false },
  general_knowledge: {},
  conversation: {},
};

/**
 * Resolves the effective tool policy for a decision.
 *
 * `allow: undefined` means "no restriction"; `allow: []` means "no tools at
 * all" — the two are deliberately different, which is why an empty array is
 * never collapsed into undefined here.
 *
 * A *soft* decision never narrows the model down to a whitelist it did not ask
 * for: low confidence is precisely the case where options must stay open.
 */
export function toolPolicyFor(decision: IntentDecision): ToolPolicy {
  const base = TOOL_POLICY[decision.category] ?? {};
  const allow = decision.allowedTools.length
    ? decision.allowedTools
    : (decision.deterministic ? base.allow : undefined);
  const deny = decision.forbiddenTools.length ? decision.forbiddenTools : base.deny;
  const force = decision.forceToolCall ?? (Boolean(base.force) && decision.deterministic);
  return { allow, deny, force: Boolean(force) && Boolean(allow?.length) };
}

/* ══════════════════════════════════════════════════════════════════════════
   SLOT EXTRACTION HELPERS
   ══════════════════════════════════════════════════════════════════════════ */

/** A standalone Telegram numeric id mentioned in the text ("بلاک کن 12345678"). */
const EXPLICIT_ID_RE = /(?:^|[^\d])(\d{6,12})(?:[^\d]|$)/;

function resolveModerationTarget(ctx: IntentContext, body: string): number | null {
  // A reply is the overwhelmingly common way to name a target, and it is
  // unambiguous — prefer it over anything parsed out of the wording.
  if (ctx.isReply && ctx.repliedUserId && !ctx.repliedToSelf) return ctx.repliedUserId;
  const m = EXPLICIT_ID_RE.exec(body);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Which image the edit should operate on, in order of certainty. */
function resolveImageSource(ctx: IntentContext, body: string): IntentSlots["imageSource"] | null {
  if (ctx.repliedHasImage) return "reply";
  if (ctx.hasAttachedImage) return "attached";
  if (ctx.hasRecentImage && (PRIOR_REFERENCE_RE.test(body) || IMAGE_NOUN_RE.test(body))) return "recent";
  return null;
}

/** Strips leading filler so a research subject reads cleanly in a log/prompt. */
/** Greetings and pleasantries: conversational, never a knowledge lookup. */
const SMALL_TALK_FA_RE = new RegExp(
  FA_START +
  "(?:سلام|درود|سلوم|چطوری|چطورید|خوبی|خوبین|چه\\s*خبر|چخبر|احوالت|حالت\\s*چطوره|" +
  "صبح\\s*بخیر|شب\\s*بخیر|روز\\s*بخیر|وقت\\s*بخیر|مرسی|ممنون|قربونت|خداحافظ|بدرود|فدات)" +
  FA_END,
  "i",
);
const SMALL_TALK_EN_RE =
  /(?:^|[^a-z])(?:hi|hey|hello|yo|sup|thanks|thank\s*you|bye|goodbye|how\s*(?:are|r)\s*(?:you|u)|how'?s\s*it\s*going|good\s*(?:morning|evening|night))(?:$|[^a-z])/i;
/** Interrogatives that turn a greeting into a real question ("سلام، اینو برام بگو چیه؟"). */
const QUESTION_HINT_RE = new RegExp(
  FA_START + "(?:چند|چنده|چقدر|کیه|کجاست|چیه|چیست|یعنی|فرق|کدوم|چرا|چطور\\s*می|آیا)" + FA_END
  + "|(?:^|[^a-z])(?:what|who|where|when|why|which|how\\s*(?:do|much|many))(?:$|[^a-z])",
  "i",
);

/** Persona ids/aliases named anywhere in the text. */
function matchPersonaAlias(
  body: string,
  personas: ReadonlyArray<{ id: string; aliases: readonly string[] }>,
): { id: string; alias: string } | null {
  const lower = body.toLowerCase();
  let best: { id: string; alias: string } | null = null;
  for (const entry of personas) {
    for (const rawAlias of entry.aliases ?? []) {
      const a = rawAlias?.toLowerCase();
      if (!a || a.length < 2) continue;
      if (!lower.includes(a)) continue;
      // Longest alias wins, so "لیلیت سیاه" beats a substring alias.
      if (!best || a.length > best.alias.length) best = { id: entry.id, alias: a };
    }
  }
  return best;
}

/** Names that must never be accepted as a new call-name. */
const RESERVED_NAME_RE = new RegExp(
  "^(?:" + [
    "چی", "چیه", "چیست", "کی", "که", "را", "رو", "به", "از", "این", "اون", "آن",
    "یه", "یک", "من", "تو", "شما", "خودت", "اسم", "اسمت", "نام",
    "what", "who", "the", "a", "an", "your", "you", "name", "it", "that", "this", "please",
  ].join("|") + ")$",
  "i",
);

/**
 * Pulls the new name out of an explicit rename command.
 *
 * Returns `null` for anything that is not a clean, plausible name — a rename is
 * persistent and destructive, so a doubtful match must degrade to "no rename"
 * rather than to "rename to garbage".
 */
export function extractNewName(text: string): string | null {
  for (const re of RENAME_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    let raw = (m[1] ?? "").trim();
    // Persian copulas glue onto the name: "اسمت سحره" → "سحره".
    raw = raw.replace(/[«»"'‹›،,.!?؟:;]/g, "").trim();
    if (raw.length < 2 || raw.length > 30) continue;
    if (RESERVED_NAME_RE.test(raw)) continue;
    // Reject anything that is not a plausible name token (letters/digits only).
    if (!/^[\p{L}\p{N}][\p{L}\p{N}‌ _-]{0,29}$/u.test(raw)) continue;
    return raw;
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   PERSONA COMMAND GATES
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Verbs that turn a persona *mention* into a persona *command*.
 *
 * Required in addition to {@link PERSONA_CONTEXT_RE}: "شخصیت لیلیت قشنگه" talks
 * about a persona, "برو روی شخصیت لیلیت" asks for one.
 */
const PERSONA_SWITCH_RE = alt(
  "(?:عوض|تغییر)(?:ش)?\\s*(?:کن|بده)", "عوضش\\s*کن", "تغییرش\\s*بده",
  "برو\\s*(?:روی|به|سراغ|توی|تو|داخل|در)", "(?:بشو|باش|بگیر|بردار|فعال\\s*کن|انتخاب\\s*کن|سوییچ\\s*کن)",
  "از\\s*این\\s*به\\s*بعد\\s*.{0,25}(?:باش|داشته\\s*باش|بشو)",
  "(?:switch|change|set|become|activate|use|turn)\\s*(?:to|into|on)?",
  "\\bbe\\b", "\\bplay\\b",
);

/** Asking *about* the persona system rather than commanding it. */
const PERSONA_INFO_RE = alt(
  "(?:کدوم|کدام|چه)\\s*(?:شخصیت|پرسونا|کاراکتر|نقش|حالت)",
  "(?:شخصیت|پرسونا|کاراکتر|نقش|حالت)(?:ت|تو|ی)?\\s*(?:چیه|چیست|کیه|الان|فعلی|رو\\s*بگو|چیا)",
  "(?:لیست|فهرست)\\s*(?:شخصیت|پرسونا|کاراکتر)",
  "(?:which|what)\\s*(?:persona|character|role|mode)",
  "(?:list|show)\\s*(?:the)?\\s*(?:personas|characters|roles|modes)",
);

/** Question markers, for persona questions that carry no imperative verb. */
const PERSONA_ASK_RE = alt(
  "\\?", "؟", "چیه", "چیست", "کیه", "کیست", "چیا", "کدوم", "کدام", "چطور", "چه\\s*فرقی",
  "\\bwhat\\b", "\\bwhich\\b", "\\bwho\\b", "\\bhow\\b", "\\btell\\s*me\\b",
);

/**
 * Deterministic answer to "does this text ask anything of the persona system?"
 *
 * The single boundary between *calling* Nova and *reconfiguring* Nova, exported
 * so the legacy persona fast path enforces exactly the rule the router uses
 * instead of a second, looser one of its own. A persona keyword is mandatory:
 * a bare name, a greeting or a vocative can never get through.
 *
 * Intentionally narrower than the router's own persona branches — anything this
 * rejects falls through to ordinary conversation, which is always safe.
 */
export function hasExplicitPersonaIntent(
  text: string,
  opts?: {
    personaAliases?: ReadonlyArray<{ id: string; aliases: readonly string[] }>;
    selfNames?: readonly string[];
  },
): boolean {
  const body = normalizeDigitsForIntent(String(text ?? ""));
  if (!body || body.length > 200) return false;

  const verb = PERSONA_SWITCH_RE.test(body) || PERSONA_INFO_RE.test(body);
  const context = PERSONA_CONTEXT_RE.test(body);
  if (verb && context) return true;

  // A named persona. The name that currently addresses Nova is excluded — being
  // summoned is not a reconfiguration — and `selfNames` is the same
  // `novaSelfNames()` list activation uses, so a rename moves both boundaries
  // at once and the old name stops counting everywhere simultaneously.
  const hit = matchPersonaAlias(body, opts?.personaAliases ?? []);
  const self = new Set((opts?.selfNames ?? []).map(n => String(n ?? "").toLowerCase()));
  if (!hit || self.has(hit.alias)) return false;

  // "برو روی لیلیت" (verb, no noun), "لیلیت" alone (a selection), and
  // "شخصیت لیلیت چیه؟" (noun + question, no verb) are all explicit. Merely
  // mentioning a persona — "شخصیت لیلیت قشنگه" — is not.
  const bare = body.toLowerCase().replace(/[\s!.,،؛:*_—-]+/g, " ").trim() === hit.alias;
  return verb || bare || (context && PERSONA_ASK_RE.test(body));
}

/* ══════════════════════════════════════════════════════════════════════════
   THE CLASSIFIER
   ══════════════════════════════════════════════════════════════════════════ */

/** Directive prefix, so every injected note is visibly one system block. */
function directive(lines: string[]): string {
  return "\n\n━━━ 🎯 ROUTING DECISION (system-resolved, authoritative) ━━━\n" +
    lines.map(l => `• ${l}`).join("\n") +
    "\nThis decision was resolved deterministically from the user's wording and the chat context. " +
    "It outranks your own impression of what the message is about. Do not substitute a different tool for it.";
}

/**
 * Classifies one incoming message into exactly one routable goal.
 *
 * Precedence is structural, not scored: tiers are evaluated in order and the
 * first match returns. That is the whole point — "نوا بلاکش کن" reaches the
 * moderation branch before any search branch can ever look at it, so no amount
 * of topical similarity to "search the web for a person" can win.
 *
 * Every branch that changes state (moderation, rename, persona switch, image
 * edit) additionally requires its *prerequisites* to be satisfied before it is
 * marked deterministic: a moderation verb with no resolvable target, or an edit
 * verb with no reachable image, degrades to a soft hint so Nova asks instead of
 * acting on a guess.
 */
export function classifyRequestIntent(ctx: IntentContext): IntentDecision {
  const raw = normalizeDigitsForIntent(ctx.text ?? "").trim();
  const selfNames = (ctx.selfNames ?? []).filter(Boolean);
  const { body: strippedBody, addressed } = stripVocative(raw, selfNames);
  // Punctuation-only remainders ("نوا؟" → "؟") are not commands.
  const body = strippedBody.replace(/^[\s؟?!.،,:؛-]+|[\s؟?!.،,:؛-]+$/g, "").trim();
  const base = { addressed, body };

  if (!raw) {
    return decide("conversation", "empty", { confidence: 0.3, deterministic: false, ...base });
  }

  // Slash commands are dispatched by the command switch, never by the model.
  if (raw.startsWith("/")) {
    return decide("system_command", "slash_command", {
      confidence: 1, directive: "", ...base,
    });
  }

  const negated = NEGATION_RE.test(body);
  const hedged = HEDGE_RE.test(body);
  const asking = QUESTION_RE.test(body) || /[؟?]\s*$/.test(raw);
  /** A command may only execute when it is not negated, hypothetical, or asked about. */
  const imperative = !negated && !hedged;

  /* ── TIER 1 · SYSTEM / ADMIN / MODERATION ─────────────────────────────── */

  if (imperative) {
    for (const [action, re] of MODERATION_PATTERNS) {
      if (!re.test(body)) continue;
      // "چطور کسی رو بلاک کنم؟" is a question about the feature, not an order.
      if (asking && !ctx.isReply) break;
      const targetUserId = resolveModerationTarget(ctx, body);
      const durationMinutes = extractDuration(body);
      const needsTarget = action !== "delete_message";
      // Permission is part of the prerequisites, exactly like a resolvable
      // target: an ordinary member asking for a ban is still a *moderation*
      // request (so it must never become a search) but it is not executable.
      const permitted = Boolean(ctx.isOwner || ctx.isChatAdmin);
      const resolved = permitted && (action === "delete_message" ? ctx.isReply : Boolean(targetUserId));
      const lines = [
        `Intent: MODERATION → action "${action}".`,
        resolved
          ? `Call \`moderate_group_member\` with action="${action}"${targetUserId ? `, user_id=${targetUserId}` : ""}${durationMinutes ? `, duration_minutes=${durationMinutes}` : ""}. Nothing else.`
          : permitted
            ? `The target is unclear. Ask which member is meant — do NOT act on a guess, and do NOT search the web.`
            : `The sender is not an admin of this chat, so decline briefly and stay friendly. Do NOT call any tool and do NOT search.`,
        "This is a chat-administration command. Web search, image tools and research tools are wrong by definition here.",
      ];
      const reasonSuffix = resolved ? "" : permitted ? ":no_target" : ":not_permitted";
      return decide("moderation", `moderation:${action}${reasonSuffix}`, {
        confidence: resolved ? 0.97 : 0.7,
        deterministic: resolved,
        forceToolCall: resolved,
        allowedTools: permitted ? ["moderate_group_member"] : [],
        forbiddenTools: resolved
          ? []
          : permitted ? NEVER_FOR_COMMANDS : [...NEVER_FOR_COMMANDS, "moderate_group_member"],
        directive: directive(lines),
        slots: { moderationAction: action, targetUserId, durationMinutes, permanent: !durationMinutes && needsTarget },
        ...base,
      });
    }

    if (ctx.isOwner && ADMIN_ACTION_RE.test(body)) {
      return decide("admin_action", "admin_action", {
        confidence: 0.92,
        directive: directive([
          "Intent: ADMIN ACTION on the bot itself.",
          "Use the owner/admin tools. Never web search, never research, never image tools.",
        ]),
        ...base,
      });
    }

    if (USER_MGMT_RE.test(body) && (ctx.isOwner || ctx.isChatAdmin)) {
      return decide("user_management", "user_management", {
        confidence: 0.88,
        directive: directive([
          "Intent: USER MANAGEMENT — read or reset a specific user's stored state.",
          ctx.repliedUserId ? `The target is the replied-to user (id ${ctx.repliedUserId}).` : "Resolve the target from the wording; ask if unclear.",
        ]),
        slots: { targetUserId: ctx.repliedUserId ?? null },
        ...base,
      });
    }

    if (GROUP_MGMT_RE.test(body) && ctx.isGroup) {
      return decide("group_management", "group_management", {
        confidence: 0.85,
        directive: directive([
          "Intent: GROUP MANAGEMENT — an operation on this chat, not on the outside world.",
          "Never web search for this.",
        ]),
        ...base,
      });
    }
  }

  /* ── TIER 3a · EXPLICIT RENAME ─────────────────────────────────────────
     Hoisted above the media tier on purpose. `RENAME_PATTERNS` only match a
     literal rename imperative ("اسمت رو بذار X"), and that string shares its
     verb with image editing ("عوضش کن"), so a user replying to a photo while
     renaming Nova would otherwise be routed into `edit_image`. A rename is
     persistent and cross-cutting, so it wins outright. ──────────────────── */

  if (imperative && !asking) {
    const newName = extractNewName(raw);
    if (newName) {
      return decide("name_switch", "name_switch", {
        confidence: 0.98,
        forceToolCall: false,
        allowedTools: ["set_call_name"],
        directive: directive([
          `Intent: NAME CHANGE. The new name is "${newName}" and it has already been applied by the system.`,
          "Simply confirm the new name warmly in one short sentence. Do not call any tool.",
        ]),
        slots: { newName, permanent: true },
        ...base,
      });
    }
    if (RENAME_RESET_RE.test(raw)) {
      return decide("name_switch", "name_reset", {
        confidence: 0.95,
        allowedTools: ["set_call_name"],
        directive: directive([
          "Intent: NAME RESET back to the default identity. Already applied by the system.",
          "Confirm briefly. Do not call any tool.",
        ]),
        slots: { newName: "", permanent: true },
        ...base,
      });
    }
  }

  /* ── TIER 2 · IMAGE / MEDIA ───────────────────────────────────────────── */

  const imageSource = resolveImageSource(ctx, body);
  const wantsEdit = IMAGE_EDIT_VERB_RE.test(body);
  const wantsGen = IMAGE_GEN_RE.test(body);

  if (STICKER_OP_RE.test(body)) {
    return decide("sticker_operation", "sticker_operation", {
      confidence: 0.85,
      directive: directive([
        "Intent: STICKER. An explicit ask to be *sent* a sticker/GIF is `search_images` or `send_reaction_media` — never `react_to_message`, which only sets an emoji icon.",
        "Because the ask is explicit, the usual restraint on `send_reaction_media` is lifted for this turn. If the saved library has nothing that fits what they described, use `search_images` instead of forcing an unrelated sticker.",
      ]),
      ...base,
    });
  }

  if (imageSource && (wantsEdit || (imperative && !asking && PRIOR_REFERENCE_RE.test(body) && !wantsGen))) {
    // An edit needs a source image AND an edit verb. Both are present, so this
    // is the single unambiguous case where forcing the tool is correct.
    const where = imageSource === "reply"
      ? "the image in the message the user replied to"
      : imageSource === "attached"
        ? "the image attached to this message"
        : "the most recent image in this chat";
    return decide("image_edit", `image_edit:${imageSource}`, {
      confidence: 0.96,
      forceToolCall: true,
      allowedTools: ["edit_image"],
      directive: directive([
        `Intent: IMAGE EDIT. The source image is ${where} and it is already attached to this turn as image data.`,
        "Call `edit_image` exactly once. Its `instruction` must be a precise, self-contained English sentence describing the transformation the user asked for.",
        "Never call `generate_image` here — the user wants THIS image changed, not a new one. Never answer with text only.",
      ]),
      slots: { imageSource },
      ...base,
    });
  }

  if (!imageSource && wantsEdit && IMAGE_NOUN_RE.test(body) && !wantsGen) {
    return decide("image_edit", "image_edit:no_source", {
      confidence: 0.7,
      deterministic: false,
      allowedTools: [],
      forbiddenTools: ["generate_image", "search", "search_images"],
      directive: directive([
        "Intent: IMAGE EDIT, but no source image is reachable in this turn.",
        "Ask the user to send the image or reply to it. Do NOT call `generate_image` as a substitute, and do not search for a stand-in.",
      ]),
      ...base,
    });
  }

  if (imperative && wantsGen && (IMAGE_NOUN_RE.test(body) || /نقاش|طراح|draw|paint|render|artwork|illustration/i.test(body))) {
    // Generation is only correct when there is no source image in play; with a
    // source image present the request is an edit and was handled above.
    if (IMAGE_SEARCH_RE.test(body)) {
      return decide("image_search", "image_search", {
        confidence: 0.88,
        allowedTools: ["search_images", "resend_last_media"],
        directive: directive([
          "Intent: FIND AN EXISTING IMAGE. Use `search_images`; do not synthesize artwork.",
        ]),
        ...base,
      });
    }
    return decide("image_generate", "image_generate", {
      confidence: 0.9,
      allowedTools: ["generate_image"],
      directive: directive([
        "Intent: CREATE NEW ARTWORK with `generate_image`.",
        "Do not search the web and do not call `edit_image` — there is no source image for this request.",
      ]),
      ...base,
    });
  }

  if (IMAGE_SEARCH_RE.test(body)) {
    return decide("image_search", "image_search", {
      confidence: 0.86,
      allowedTools: ["search_images", "resend_last_media"],
      directive: directive([
        "Intent: FIND AN EXISTING PHOTO/GIF via `search_images`. Not `generate_image`, not a web text search.",
      ]),
      ...base,
    });
  }

  if (MEDIA_OP_RE.test(body) && (imageSource || ctx.repliedHasMedia || ctx.hasAttachedImage)) {
    return decide("media_operation", "media_operation", {
      confidence: 0.85,
      directive: directive([
        "Intent: MEDIA UTILITY on media already in this conversation (describe / OCR / resend).",
        "The media is attached to this turn — read it directly. Do not search the web for it.",
      ]),
      slots: imageSource ? { imageSource } : {},
      ...base,
    });
  }

  /* ── TIER 3b · PERSONA vs ACTIVATION ──────────────────────────────────── */

  const personaAliases = ctx.personaAliases ?? [];
  const selfLower = new Set(selfNames.map(n => n.toLowerCase()));
  const personaHit = matchPersonaAlias(body, personaAliases);
  const personaHitIsSelf = Boolean(personaHit && selfLower.has(personaHit.alias));
  const personaContext = PERSONA_CONTEXT_RE.test(body);
  // Self-names are excluded, so "نوا برو"/"نوا؟" can never reach either branch.
  const personaNamed = Boolean(personaHit && !personaHitIsSelf);

  // `PERSONA_INFO_RE` expects the interrogative right after the noun, so
  // "شخصیت لیلیت چیه؟" slipped past it and was answered as general knowledge.
  if (personaContext && (PERSONA_INFO_RE.test(body) || (personaNamed && PERSONA_ASK_RE.test(body)))) {
    return decide("persona_info", "persona_info", {
      confidence: 0.9,
      directive: directive([
        "Intent: A QUESTION ABOUT THE PERSONA SYSTEM. Answer in plain text; change nothing.",
      ]),
      slots: personaHit ? { personaId: personaHit.id } : {},
      ...base,
    });
  }

  // `personaContext ||` a named persona: "برو روی لیلیت" carries no persona noun
  // yet is unmistakable.
  if (imperative && !asking && (personaContext || personaNamed) && PERSONA_SWITCH_RE.test(body)) {
    return decide("persona_switch", personaHit ? `persona_switch:${personaHit.id}` : "persona_switch:unspecified", {
      confidence: personaHit ? 0.94 : 0.8,
      forceToolCall: Boolean(personaHit),
      allowedTools: ["switch_persona"],
      directive: directive([
        personaHit
          ? `Intent: PERSONA SWITCH to "${personaHit.id}". Call \`switch_persona\` with persona_id="${personaHit.id}".`
          : "Intent: PERSONA SWITCH, but no specific persona was named. Offer the available personas and let the user pick.",
        "This is a system request, not roleplay. Never refuse it while in character.",
      ]),
      slots: { personaId: personaHit?.id, permanent: /از\s*این\s*به\s*بعد|همیشه|permanent|from\s*now\s*on/i.test(body) },
      ...base,
    });
  }

  // A bare persona name on its own ("لیلیت") still reads as a selection — but
  // NEVER when that name is one of Nova's own names. "نوا" is a call, and the
  // whole reason this branch is gated: being summoned is not a reconfiguration.
  if (personaHit && !personaHitIsSelf && body.toLowerCase().replace(/[\s!.,،؛:*_—-]+/g, " ").trim() === personaHit.alias) {
    return decide("persona_switch", `persona_switch:bare:${personaHit.id}`, {
      confidence: 0.7,
      deterministic: false,
      allowedTools: ["switch_persona"],
      directive: directive([
        `The user typed only the persona name "${personaHit.alias}". Treat it as selecting that persona.`,
      ]),
      slots: { personaId: personaHit.id },
      ...base,
    });
  }

  // Pure activation: Nova was named and the remainder is nothing, punctuation,
  // or a bare summons. This must consume no tool and touch no configuration.
  if (addressed && isBareVocative(body)) {
    return decide("activation", "activation", {
      confidence: 0.95,
      allowedTools: [],
      directive: directive([
        "Intent: THE USER IS SIMPLY CALLING YOU. Reply naturally and briefly, in character.",
        "Do NOT call any tool. Do NOT show persona information, settings, menus, cards or your current character. Being addressed is not a request to reconfigure anything.",
      ]),
      ...base,
    });
  }

  /* ── TIER 4 · MEMORY ──────────────────────────────────────────────────── */

  if (MEMORY_OP_RE.test(body)) {
    return decide("memory_operation", "memory_operation", {
      confidence: 0.86,
      allowedTools: ["clear_own_memory"],
      forbiddenTools: NEVER_FOR_COMMANDS,
      directive: directive([
        "Intent: MEMORY OPERATION on this conversation.",
        "A wipe request is `clear_own_memory`. A 'remember this' request needs no tool — just acknowledge; it is stored automatically. A 'what do you remember' request is answered from your memory profile in this prompt.",
        "Never search the web for the user's own memory.",
      ]),
      ...base,
    });
  }

  /* ── TIER 5 · THE USER ASKED FOR A LOOKUP ─────────────────────────────── */

  if (SEARCH_ACT_RE.test(body)) {
    return decide("research", "research", {
      confidence: 0.9,
      forceToolCall: true,
      allowedTools: ["search", "read_web_page", "get_current_time", "calculate"],
      directive: directive([
        "Intent: THE USER EXPLICITLY ASKED YOU TO LOOK SOMETHING UP. A search tool call is mandatory here — never answer this one from memory.",
        "Call `search` ONCE. Pass the request in the user's own words as `request`, and leave `effort` at \"auto\" so the tool can size the job itself — override it only when the user named the mode (exhaustive/سوپر دیپ → \"super\", quick/سریع → \"fast\").",
        "If the user named one specific URL, use `read_web_page` on that URL instead.",
        "The tool returns a FINISHED answer. Deliver it in your own voice, keep every figure, date and caveat exactly as given, and do not call a search tool again in this turn.",
        "Mention sources, links or the fact that you searched only if the user asked for them.",
      ]),
      ...base,
    });
  }

  /* ── TIER 6 · BUILDERS / SCHEDULING / VOICE ───────────────────────────── */

  if (imperative && GAME_RE.test(body)) {
    return decide("game_create", "game_create", {
      confidence: 0.93,
      forceToolCall: true,
      allowedTools: ["create_game"],
      directive: directive([
        "Intent: BUILD A PLAYABLE GAME. Call `create_game` once.",
        "Pass the user's own words through in `description` — genre, mood, setting and any visual references matter to the design stage and must not be paraphrased away.",
      ]),
      ...base,
    });
  }

  if (imperative && WEB_APP_RE.test(body)) {
    return decide("web_app", "web_app", {
      confidence: 0.9,
      allowedTools: ["host_web_app", "create_code_file"],
      directive: directive(["Intent: BUILD A WEB APP/PAGE. Call `host_web_app` once."]),
      ...base,
    });
  }

  if (imperative && DOCUMENT_RE.test(body) && /(?:بساز|درست\s*کن|بده|تهیه|بنویس|export|make|create|generate|produce)/i.test(body)) {
    return decide("document_create", "document_create", {
      confidence: 0.88,
      allowedTools: ["create_pdf", "create_code_file"],
      directive: directive([
        "Intent: PRODUCE A DOCUMENT FILE. Use `create_pdf` with `format` matching exactly what was asked (pdf/docx/xlsx/pptx).",
      ]),
      ...base,
    });
  }

  if (SCHEDULING_RE.test(body)) {
    return decide("scheduling", "scheduling", {
      confidence: 0.9,
      allowedTools: ["schedule_reminder", "list_reminders", "cancel_reminder", "get_current_time"],
      directive: directive([
        "Intent: SCHEDULING. Use the reminder tools. Timing is accurate to about ±1 minute — never promise an exact second.",
      ]),
      ...base,
    });
  }

  if (VOICE_RE.test(body)) {
    return decide("voice_request", "voice_request", {
      confidence: 0.88,
      allowedTools: ["voice_response"],
      directive: directive(["Intent: THE REPLY ITSELF SHOULD BE SPOKEN. Call `voice_response` with the text to speak."]),
      ...base,
    });
  }

  /* ── TIER 7 · GENERAL ─────────────────────────────────────────────────── */

  // "سلام خوبی؟" carries a question mark without being a question. Routing it
  // as general knowledge invites a pointless lookup, so it stays conversation.
  const smallTalk = body.length <= 48
    && (SMALL_TALK_FA_RE.test(body) || SMALL_TALK_EN_RE.test(body))
    && !QUESTION_HINT_RE.test(body);

  if (asking && !smallTalk) {
    return decide("general_knowledge", "general_knowledge", {
      confidence: 0.6,
      deterministic: false,
      directive: directive([
        "Intent: A QUESTION YOU CAN ANSWER YOURSELF. Answer from your own knowledge — no tool.",
        'The exception is yours to judge, not a keyword list: if an honest answer depends on something you cannot vouch for right now — a value that moves, a situation that may have changed since your training, or a specific figure, date or name you are not actually sure of — call `search` with the user\'s question and `effort:"auto"` and let it size the job. Guessing is worse than searching; searching something you already know is waste.',
      ]),
      ...base,
    });
  }

  return decide("conversation", "conversation", {
    confidence: 0.5,
    deterministic: false,
    directive: directive([
      "Intent: ORDINARY CONVERSATION. Reply directly, in character, with no tool.",
      "Tool availability does not imply tool necessity.",
    ]),
    ...base,
  });
}

/**
 * Cheap pre-check: could this text possibly be a permission-gated command?
 *
 * Resolving whether the sender is a chat admin costs a `getChatMember` round
 * trip, and the classifier needs the answer *before* it runs. Doing it for
 * every group message would add an API call to ordinary chatter, so the caller
 * asks this first and only looks the permission up when the wording could
 * actually reach a gated branch.
 */
export function mayNeedPermissions(text: string): boolean {
  const t = normalizeDigitsForIntent(text ?? "");
  if (!t) return false;
  if (ADMIN_ACTION_RE.test(t) || USER_MGMT_RE.test(t) || GROUP_MGMT_RE.test(t)) return true;
  for (const [, re] of MODERATION_PATTERNS) if (re.test(t)) return true;
  return false;
}

/** Compact one-line form for logs. */
export function describeIntent(d: IntentDecision): string {
  const p = toolPolicyFor(d);
  const bits = [
    `${d.category}(t${INTENT_TIER[d.category]})`,
    `c=${d.confidence.toFixed(2)}`,
    d.deterministic ? "det" : "soft",
    p.force ? "forced" : "",
    p.allow ? (p.allow.length ? `allow=[${p.allow.join(",")}]` : "allow=NONE") : "",
    p.deny?.length && !p.allow?.length ? `deny=${p.deny.length}` : "",
    d.reason,
  ].filter(Boolean);
  return bits.join(" ");
}
