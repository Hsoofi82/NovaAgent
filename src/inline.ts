/**
 * Inline mode (@Nova in any chat) — pure logic.
 *
 * WHAT THIS FIXES
 * ───────────────
 * Inline support existed but was a demo: three hard-coded "type /img in the DM"
 * cards, a translate prefix, and a single Gemini call that produced one plain
 * article. It had no pagination (Telegram's `offset` was ignored), no reuse of
 * the agent's search path, no cache of its own, no formatting (raw `**stars**`
 * were delivered literally) and no way to actually *continue* a request — the
 * cards told the user to go and type it again by hand.
 *
 * Everything in this module is pure so the behaviour can be pinned by tests
 * without a Worker, a network or a Telegram client:
 *
 *   · `parseInlineCommand` — one grammar for the inline surface. Nova's own
 *     question router is deliberately NOT reused here: inline must answer in a
 *     few seconds, so the kind decides a *strategy* (`search`, one model call,
 *     KV lookup), and a bare question stays `ask`. Heavy work is never started
 *     inline; it is handed to private chat (`handoffPrompt`).
 *   · `markdownToTelegramHtml` — the model answers in Markdown and Telegram
 *     renders HTML, and nothing in the Worker converted between the two. Only
 *     tags that have been in the Bot API for years are emitted (b/i/u/s/code/
 *     pre/a/tg-spoiler), and link targets are allow-listed, so a model answer
 *     can never turn into `javascript:` markup or an unparseable entity.
 *   · `safeHtmlSlice` — Telegram rejects a message whose entities do not parse
 *     ("can't parse entities"), and the previous implementation truncated with
 *     `.slice(0, 4000)`, which cuts tags in half. This closes what it opens.
 *   · `paginateInline` / `parseInlineOffset` — Telegram passes back the
 *     `next_offset` we returned; a long answer becomes real pages instead of
 *     being silently clipped at 4096 characters.
 *   · `inlineCacheKey` / `isCacheableKind` — repeated queries are the common
 *     case in groups (several people typing the same thing), so stateless kinds
 *     are cached in KV and marked `is_personal: false` for Telegram's own cache.
 *   · `buildInlinePayload` / `parseInlinePayload` / `handoffRequestText` — the
 *     handoff: a result carries a `t.me/<bot>?start=ih<token>` link, the token
 *     resolves to the stored request, and private chat expands it into exactly
 *     what the user would have typed. Nothing is executed for a chat or a user
 *     id that the inline query did not come from.
 */

/* ── kinds ────────────────────────────────────────────────────────────────── */

export type InlineKind =
  | "help"      // no query at all
  | "ask"       // a question → one short model answer
  | "translate"
  | "search"    // full research answer, reusing the agent's search engine
  | "summarize"
  | "explain"
  | "code"
  | "image"     // needs generation → handoff
  | "build";    // needs a build → handoff

export interface InlineCommand {
  kind: InlineKind;
  /** The payload the kind operates on. Empty for `help`. */
  arg: string;
  /** Translate target, when the query names one. */
  target?: string;
  /** True when a prefix/command was written rather than a bare question. */
  explicit: boolean;
}

/** Kinds whose answer is a pure function of (text, lang) — safe to cache. */
export function isCacheableKind(kind: InlineKind): boolean {
  return kind === "translate" || kind === "search" || kind === "summarize"
    || kind === "explain" || kind === "code";
}

/** Kinds that cannot run inline at all and must be handed to private chat. */
export function isHandoffKind(kind: InlineKind): boolean {
  return kind === "image" || kind === "build";
}

/** Languages the inline translator accepts, mapped to their English name. */
const TRANSLATE_TARGETS: Record<string, string> = {
  fa: "Persian (فارسی)", en: "English", ar: "Arabic (العربية)", de: "German",
  fr: "French", es: "Spanish", ru: "Russian", tr: "Turkish", it: "Italian",
  zh: "Chinese", ja: "Japanese", hi: "Hindi", nl: "Dutch", pt: "Portuguese",
  sv: "Swedish", ko: "Korean", he: "Hebrew", ur: "Urdu", az: "Azerbaijani",
};

export function translateTargetName(code: string): string | null {
  return TRANSLATE_TARGETS[code.toLowerCase()] ?? null;
}

export function translateTargets(): string[] {
  return Object.keys(TRANSLATE_TARGETS);
}

/** Whitespace/zero-width normalisation, bounded. Cheaper than sanitizeInput and
 *  identical for the shapes an inline query can take. */
function normalize(text: string): string {
  return String(text ?? "")
    .replace(/[\u200b-\u200f\u202a-\u202e]/g, "")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * One grammar for the inline surface.
 *
 * Order matters: the heavy prefixes are matched before the catch-all, and a
 * prefix only counts when followed by a space or a colon, so the ordinary word
 * "image" inside a question ("what is an image?") is not mistaken for a command.
 */
export function parseInlineCommand(raw: string): InlineCommand {
  const query = normalize(raw);
  if (!query) return { kind: "help", arg: "", explicit: false };

  const prefixed = (patterns: RegExp): string | null => {
    const m = query.match(patterns);
    return m ? normalize(m[1] ?? "") : null;
  };

  // ── heavy: never attempted inline ──
  const image = prefixed(/^(?:img|image|photo|picture|draw|paint)\s*:\s*(.+)$/i)
    ?? prefixed(/^(?:\/img|\/image)\s+(.+)$/i)
    ?? prefixed(/^(?:تصویر|عکس|نقاشی|بکش|رسم)\s*[::]\s*(.+)$/);
  if (image) return { kind: "image", arg: image, explicit: true };
  const build = prefixed(/^(?:build|web|webapp|app|site|website|game)\s*:\s*(.+)$/i)
    ?? prefixed(/^(?:بساز|سایت|وباپ|بازی)\s*[::]\s*(.+)$/);
  if (build && build.length > 3) return { kind: "build", arg: build, explicit: true };

  // ── translate: `tr:fa <text>`, `translate to de: <text>`, `ترجمه <text>` ──
  // Both spellings are tried as a list rather than with `??`, because the loose
  // form can match a two-letter word that is not a language at all
  // ("translate to de: …" first parses as target="to").
  const targeted = [
    query.match(/^translate\s+to\s+([a-z]{2})\s*(?::|：){0,2}\s*(.+)$/i),
    query.match(/^(?:tr|translate|trans)\s*[:\s]\s*([a-z]{2})\s*(?::|：){0,2}\s*(.+)$/i),
  ].find((m): m is RegExpMatchArray => Boolean(m && translateTargetName(m[1])));
  if (targeted) {
    return { kind: "translate", arg: normalize(targeted[2]), target: targeted[1].toLowerCase(), explicit: true };
  }
  const untargeted = prefixed(/^(?:translate|ترجمه|ترجمه\s*کن)\s*(?::|：){1,2}\s*(.+)$/i)
    ?? prefixed(/^(?:translate|ترجمه)\s+(.+)$/i);
  if (untargeted) return { kind: "translate", arg: untargeted, explicit: true };

  // ── lookups ──
  // Both a colon separator and a plain space are accepted (`search: x` and
  // `search x`), and `::` is tolerated because it is what people actually type.
  const search = prefixed(/^(?:search|google|find|deepsearch)\s*(?::|：){1,2}\s*(.+)$/i)
    ?? prefixed(/^(?:search|google|find|deepsearch)\s+(.+)$/i)
    ?? prefixed(/^(?:\/s|s:)\s*(.+)$/i)
    ?? prefixed(/^(?:جستجو|جست‌وجو|بگرد|پیدا\s*کن)\s*[::]?\s*(.+)$/);
  if (search) return { kind: "search", arg: search, explicit: true };

  const summarize = prefixed(/^(?:summarize|summarise|tldr|summary|خلاصه)\s*(?::|：){1,2}\s*(.+)$/i)
    ?? prefixed(/^(?:summarize|summarise|tldr|summary|خلاصه)\s+(.+)$/i);
  if (summarize) return { kind: "summarize", arg: summarize, explicit: true };

  const explain = prefixed(/^(?:explain|توضیح|شرح)\s*[::]?\s*(.+)$/i);
  if (explain) return { kind: "explain", arg: explain, explicit: true };

  const code = prefixed(/^(?:code|کد)\s*(?::|：){1,2}\s*(.+)$/i)
    ?? prefixed(/^(?:code|کد)\s+(.+)$/i);
  if (code) return { kind: "code", arg: code, explicit: true };

  return { kind: "ask", arg: query, explicit: false };
}

/* ── caching ──────────────────────────────────────────────────────────────── */

/**
 * Cache identity: the kind, the target language and the *normalised* argument.
 * No user id — the cached kinds are stateless transformations, so sharing them
 * is the whole point (a group asked the same question five times should cost
 * one model call). Personal kinds are filtered out by `isCacheableKind` before
 * this is even called.
 */
export function inlineCacheKey(cmd: InlineCommand, lang: string): string | null {
  if (!isCacheableKind(cmd.kind)) return null;
  const arg = normalize(cmd.arg).toLowerCase().slice(0, 240);
  if (!arg) return null;
  return `${cmd.kind}|${cmd.target ?? "-"}|${lang}|${arg}`;
}

/* ── pagination ───────────────────────────────────────────────────────────── */

/** Telegram echoes `next_offset` back verbatim; anything else is page 0. */
export function parseInlineOffset(offset: string | undefined): number {
  const page = Number.parseInt(String(offset ?? ""), 10);
  return Number.isFinite(page) && page > 0 && page < 100 ? Math.trunc(page) : 0;
}

export function inlineNextOffset(page: number): string {
  return String(page + 1);
}

/**
 * Splits an answer for paging at a paragraph boundary. Pages are only produced
 * when the text genuinely does not fit: a short answer must stay one result.
 */
export function paginateInline(text: string, offset: number, pageSize = 3200): { page: string; nextOffset: string | null; pageIndex: number } {
  const body = String(text ?? "");
  if (body.length <= pageSize) return { page: body, nextOffset: null, pageIndex: 0 };
  const pages: string[] = [];
  let rest = body;
  while (rest.length > pageSize) {
    const window = rest.slice(0, pageSize);
    // Prefer a paragraph break, then a line break, then a space — never mid-word
    // unless the "word" is longer than a page. Priority, not `Math.max`: the
    // furthest space is usually *later* than a paragraph break, and taking it
    // would split a sentence instead of ending one.
    const floor = pageSize * 0.4;
    const paragraph = window.lastIndexOf("\n\n");
    const line = window.lastIndexOf("\n");
    const space = window.lastIndexOf(" ");
    let at = paragraph > floor ? paragraph : line > floor ? line : space > floor ? space : pageSize;
    // A page boundary may never land inside a tag or an entity. Pages arrive
    // here as rendered HTML, and `<a href="…">` contains a space that looks like
    // a perfectly good break — but a fragment Telegram cannot parse is rejected
    // as a whole, so the boundary backs off to the last safe position instead.
    const fragment = rest.slice(0, at);
    const openAngle = fragment.lastIndexOf("<");
    if (openAngle > fragment.lastIndexOf(">")) at = openAngle > floor ? openAngle : pageSize;
    const bound = rest.slice(0, at);
    const openEntity = bound.lastIndexOf("&");
    if (openEntity > bound.lastIndexOf(";") && bound.length - openEntity <= 8 && openEntity > floor) at = openEntity;
    pages.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\s+/, "");
  }
  pages.push(rest);
  const index = Math.min(Math.max(0, offset), pages.length - 1);
  return {
    page: pages[index],
    nextOffset: index + 1 < pages.length ? inlineNextOffset(index) : null,
    pageIndex: index,
  };
}

/* ── HTML rendering ───────────────────────────────────────────────────────── */

/** Same escaping the Worker already uses for every outbound HTML message. */
export function escapeInlineHtml(text: string): string {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Only these navigations may become links. `javascript:` and `data:` are the
 *  reason this exists — a model answer is untrusted input. */
export function safeInlineUrl(url: string): string | null {
  const trimmed = String(url ?? "").trim();
  if (!/^https?:\/\/[^\s<>"']{3,}$/i.test(trimmed)) return null;
  // Vertical bars and parentheses terminate a Telegram HTML href.
  if (/[()|]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Markdown → the HTML subset Telegram has supported for years.
 *
 * Deliberately conservative: fenced blocks, inline code, bold, italic, strike,
 * links, ATX headings flattened to bold, and bullets/quotes re-prefixed with a
 * character. Every newer tag (`blockquote expandable`, tables, `<details>`) is
 * left out on purpose — an unknown tag is a hard 400 on send, and this code
 * cannot verify which of those the deployed Bot API accepts.
 */
export function markdownToTelegramHtml(markdown: string): string {
  const source = String(markdown ?? "").replace(/\r\n/g, "\n");
  const out: string[] = [];
  // Fenced blocks must survive untouched, so they are lifted out first and
  // restored at the end — the inline pass would otherwise italicise `*` inside
  // code and destroy it.
  const fences: string[] = [];
  let text = source.replace(/```([a-z0-9+#.-]*)\n?([\s\S]*?)```/gi, (_m, _lang, body: string) => {
    fences.push(`<pre>${escapeInlineHtml(body.replace(/\n+$/, ""))}</pre>`);
    return `\u0000F${fences.length - 1}\u0000`;
  });

  text = escapeInlineHtml(text);

  // Links: [label](url) — validated, and the label is already escaped.
  // An unsafe target keeps the label and loses the address entirely: leaving the
  // text in place would still show a `javascript:` string to the reader.
  text = text.replace(/\[([^\]\n]{1,120})\]\(([^\s)]{4,300})\)/g, (_whole, label: string, url: string) => {
    const safe = safeInlineUrl(url.replace(/&amp;/g, "&"));
    return safe ? `<a href="${escapeInlineHtml(safe)}">${label}</a>` : label;
  });

  text = text
    .replace(/`([^`\n]{1,200})`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]{1,400})\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]{1,400})__/g, "<b>$1</b>")
    .replace(/~~([^~\n]{1,400})~~/g, "<s>$1</s>")
    .replace(/(^|[\s(])\*([^*\n]{1,400})\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>")
    .replace(/(^|[\s(])_([^_\n]{1,400})_(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>")
    // Headings: Telegram has no heading markup, and `#` reads as noise.
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/^\s*[-*•]\s+/gm, "• ")
    // The quote marker is already escaped by this point, so both spellings are
    // matched — `&gt;` is what a `>` in the source looks like here.
    .replace(/^\s*(?:&gt;|>)\s?/gm, "❝ ");

  return text.replace(/\u0000F(\d+)\u0000/g, (_m, i: string) => fences[Number(i)] ?? "");
}

const SELF_CLOSING = new Set(["br"]);

/**
 * Truncates rendered HTML without breaking it.
 *
 * Walks the string so a cut can never land inside a tag or an entity, then
 * closes whatever is still open — in reverse order, which is what makes
 * `<b><i>x</i></b>` truncate to `<b><i>x</i></b>` rather than to a 400.
 */
export function safeHtmlSlice(html: string, max: number): string {
  const source = String(html ?? "");
  if (source.length <= max) return balanceHtml(source);
  const limit = Math.max(16, max);
  let cut = trimPartial(source.slice(0, limit));
  // Closing tags add characters, so the result can exceed the caller's limit.
  // Re-cut until it fits (the loop converges in one step in practice): a bad
  // entity is a rejected message, so the bound matters more than the last word.
  for (let i = 0; i < 3; i++) {
    const balanced = balanceHtml(cut);
    if (balanced.length <= limit) return balanced;
    cut = trimPartial(cut.slice(0, Math.max(16, cut.length - (balanced.length - limit) - 1)));
  }
  // Pathological nesting: fall back to plain text rather than emit invalid HTML.
  return escapeInlineHtml(trimPartial(source.slice(0, limit)).replace(/<[^>]*>/g, ""));
}

/** Drops a trailing partial tag, a trailing partial entity and trailing space. */
export function trimPartial(cut: string): string {
  let out = cut;
  const openAngle = out.lastIndexOf("<");
  if (openAngle > out.lastIndexOf(">")) out = out.slice(0, openAngle);
  const openEntity = out.lastIndexOf("&");
  if (openEntity > out.lastIndexOf(";") && out.length - openEntity <= 8) out = out.slice(0, openEntity);
  return out.length > 20 ? out.replace(/[\s<]+$/, "") : out;
}

const INLINE_TAGS = /<\/?([a-z]+)(?:\s[^>]*)?>/gi;

/** Closes every tag left open, and drops stray closers. */
export function balanceHtml(html: string): string {
  const open: string[] = [];
  const source = String(html ?? "");
  let str = source.replace(INLINE_TAGS, (whole, name: string) => {
    const tag = String(name).toLowerCase();
    if (!/^(b|i|u|s|code|pre|a|tg-spoiler)$/.test(tag)) return escapeInlineHtml(whole);
    if (SELF_CLOSING.has(tag)) return whole;
    if (whole.startsWith("</")) {
      const at = open.lastIndexOf(tag);
      // A closer for a tag that was never opened is invalid HTML; drop it.
      if (at < 0) return "";
      open.splice(at, 1);
      return `</${tag}>`;
    }
    open.push(tag);
    return whole;
  });
  if (open.length) str += open.reverse().map(tag => `</${tag}>`).join("");
  return str;
}

/**
 * Does this text look Persian/Arabic? Used for the cards that must be answered
 * *before* a session (and therefore a language) is available — the rate-limit
 * and budget notices. Deliberately script-based, not a language detector: the
 * only decision it drives is which of two fixed strings to send.
 */
export function looksRtlScript(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(String(text ?? ""));
}

/** The picker title for a kind, localized. */
export function inlineKindLabel(kind: InlineKind, lang: string): string {
  const fa = lang === "fa";
  const ar = lang === "ar";
  switch (kind) {
    case "translate": return fa ? "🌐 ترجمه" : ar ? "🌐 ترجمة" : "🌐 Translation";
    case "search": return fa ? "🔎 نتیجهٔ جست‌وجو" : ar ? "🔎 نتيجة البحث" : "🔎 Search result";
    case "summarize": return fa ? "🧾 خلاصه" : ar ? "🧾 ملخص" : "🧾 Summary";
    case "explain": return fa ? "💡 توضیح" : ar ? "💡 شرح" : "💡 Explanation";
    case "code": return fa ? "💻 کد" : ar ? "💻 كود" : "💻 Code";
    case "image": return fa ? "🎨 ساخت تصویر در پیوی" : ar ? "🎨 إنشاء صورة في الخاص" : "🎨 Generate an image in private chat";
    case "build": return fa ? "🛠 ساخت پروژه در پیوی" : ar ? "🛠 بناء مشروع في الخاص" : "🛠 Build a project in private chat";
    case "help": return fa ? "🤖 راهنمای نوا" : ar ? "🤖 دليل نوفا" : "🤖 Nova guide";
    default: return fa ? "💬 پاسخ نوا" : ar ? "💬 رد نوفا" : "💬 Nova's answer";
  }
}

/* ── result shaping ───────────────────────────────────────────────────────── */

export interface InlineCard { title: string; description: string; text: string }

/**
 * One result's visible text. The title is what the user sees in the picker, so
 * it is derived from the answer's first meaningful line rather than from the
 * query — the query is already on screen.
 */
export function inlineCardTitle(text: string, fallback: string, max = 56): string {
  const cleaned = markdownToTelegramHtml(String(text ?? ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/[•❝]|\s{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback.slice(0, max);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** Plain-text (no markup) description for the picker's second line. */
export function inlineCardDescription(text: string, max = 160): string {
  const plain = markdownToTelegramHtml(String(text ?? ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** Static help cards — no model call, no KV read. */
export function inlineHelpCards(lang: string): InlineCard[] {
  if (lang === "fa") {
    return [
      { title: "💬 سوال بپرس", description: "مثلاً: تفاوت HTTP و HTTPS چیست؟", text: "نوا را در هر چتی صدا بزن و همین‌جا بپرس — نیازی به عضو بودن ربات در آن چت نیست." },
      { title: "🔎 جست‌وجو", description: "search: آخرین اخبار هوش مصنوعی", text: "🔎 برای جست‌وجوی واقعی بنویس: <code>search: موضوع</code>" },
      { title: "🌐 ترجمه", description: "tr:en سلام دنیا", text: "🌐 برای ترجمه بنویس: <code>tr:fa متن</code> یا <code>tr:en text</code>" },
      { title: "🧾 خلاصه کن", description: "summarize: <متن یا موضوع>", text: "🧾 برای خلاصه‌سازی بنویس: <code>summarize: متن</code>" },
      { title: "🎨 ساخت تصویر", description: "img: یک گربه در فضا", text: "🎨 ساخت تصویر سنگین است و داخل اینلاین اجرا نمی‌شود؛ دکمه‌ی «در پیوی اجرا کن» را بزن." },
      { title: "🛠 ساخت سایت/بازی", description: "build: یک سایت فروشگاه", text: "🛠 ساخت پروژه در پیوی نوا انجام می‌شود؛ دکمه‌ی «در پیوی اجرا کن» را بزن." },
    ];
  }
  if (lang === "ar") {
    return [
      { title: "💬 اسأل أي شيء", description: "مثال: ما الفرق بين HTTP و HTTPS؟", text: "نوفا متاحة في أي محادثة — لا حاجة لإضافة البوت." },
      { title: "🔎 بحث", description: "search: آخر الأخبار", text: "🔎 اكتب: <code>search: الموضوع</code>" },
      { title: "🌐 ترجمة", description: "tr:ar hello", text: "🌐 اكتب: <code>tr:ar text</code>" },
      { title: "🧾 تلخيص", description: "summarize: <نص>", text: "🧾 اكتب: <code>summarize: النص</code>" },
      { title: "🎨 إنشاء صورة", description: "img: قطة في الفضاء", text: "🎨 إنشاء الصور ثقيل ولا يعمل داخل الـ inline؛ اضغط «تشغيل في الخاص»." },
      { title: "🛠 بناء موقع/لعبة", description: "build: متجر إلكتروني", text: "🛠 البناء يتم في الخاص؛ اضغط «تشغيل في الخاص»." },
    ];
  }
  return [
    { title: "💬 Ask anything", description: "e.g. what is the difference between HTTP and HTTPS?", text: "Summon Nova in any chat and ask right here — the bot does not need to be a member." },
    { title: "🔎 Search", description: "search: latest AI news", text: "🔎 For a real lookup type: <code>search: your topic</code>" },
    { title: "🌐 Translate", description: "tr:fa hello world", text: "🌐 Type: <code>tr:en text</code> or <code>tr:fa متن</code>" },
    { title: "🧾 Summarize", description: "summarize: <text or topic>", text: "🧾 Type: <code>summarize: text</code>" },
    { title: "🎨 Generate an image", description: "img: a cat in space", text: "🎨 Image generation is heavy and cannot run inline; press “Run in private chat”." },
    { title: "🛠 Build a site/game", description: "build: an online shop", text: "🛠 Projects are built in private chat; press “Run in private chat”." },
  ];
}

/* ── the handoff (inline → private chat) ──────────────────────────────────── */

/**
 * The payload Telegram will echo back in `/start <payload>`.
 *
 * Telegram limits the deep-link payload to `A-Za-z0-9_-` and ~64 characters, so
 * a prompt can never travel in the link itself: the link carries a reference and
 * the text lives in KV for a few minutes.
 */
export function buildInlineToken(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

export function buildInlinePayload(token: string): string {
  return `ih${token}`;
}

const PAYLOAD_RE = /^ih([A-Za-z0-9_-]{4,40})$/;

/** Returns the token, or null when this is not an inline handoff link. */
export function parseInlinePayload(payload: string): string | null {
  const m = String(payload ?? "").trim().match(PAYLOAD_RE);
  return m ? m[1] : null;
}

/**
 * The request text a handoff turns into.
 *
 * Phrased as a natural request on purpose: the message then goes through the
 * normal pipeline (router, limits, progress panel, cancel button) exactly as if
 * the user had typed it, which is what keeps inline from growing a second brain.
 */
export function handoffRequestText(kind: InlineKind, prompt: string, lang: string): string {
  const arg = normalize(prompt).slice(0, 1_500);
  const fa = lang === "fa";
  if (kind === "image") {
    return fa ? `یک تصویر از ${arg} بساز` : `Generate an image of ${arg}`;
  }
  return fa ? `یک وب‌اپلیکیشن بساز: ${arg}` : `Build a web app: ${arg}`;
}

/* ── rate policy ──────────────────────────────────────────────────────────── */

/** Sliding window, per user. */
export const INLINE_PER_MINUTE = 6;
/** Per isolate per day — a cheap abuse ceiling, not a billing meter. */
export const INLINE_DAILY_CAP = 80;

export function allowsInlineQuery(recentTimestamps: readonly number[], now: number): boolean {
  return recentTimestamps.filter(ts => now - ts < 60_000).length < INLINE_PER_MINUTE;
}

/** Kind names are part of a result id, so the chosen-result handler can count
 *  what people actually pick without storing anything. */
export function inlineResultId(kind: InlineKind, index: number): string {
  return `ink:${kind}:${index}`;
}

export function kindFromResultId(resultId: string): InlineKind | null {
  const m = String(resultId ?? "").match(/^ink:([a-z]+):\d+$/);
  const kind = m?.[1] as InlineKind | undefined;
  return kind && ["help", "ask", "translate", "search", "summarize", "explain", "code", "image", "build"].includes(kind)
    ? kind
    : null;
}

/** How long Telegram itself may cache a result set (seconds). */
export function inlineCacheTime(kind: InlineKind, fromKvCache: boolean): number {
  if (kind === "help") return 86_400;
  if (!isCacheableKind(kind)) return 2;
  return fromKvCache ? 600 : 60;
}
