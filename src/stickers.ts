/* ─────────────────────────────────────────────────────────────────────────────
 * STICKER LIBRARY + CONTEXTUAL STICKER JUDGEMENT
 *
 * Two jobs live here, and they are deliberately separate:
 *
 *  1. MANAGEMENT — a real library on top of the existing `reaction_media:*`
 *     KV entries: metadata, categories, tags, enable/disable, search, stats,
 *     add/remove/move. The storage format is the same JSON array it always
 *     was; every new field is optional, so old entries keep working untouched
 *     and no migration is needed.
 *
 *  2. JUDGEMENT — deciding whether this particular moment deserves a sticker
 *     at all. Previously the only guard was a 45-second throttle, so the model
 *     could fire `send_reaction_media` whenever it felt like it and the bot
 *     would comply — stickers arrived because the library had one, not because
 *     the conversation asked for one. `decideStickerMoment` scores the actual
 *     emotional and conversational context and returns "no" for the many cases
 *     where a sticker would be noise (mid-research answer, technical question,
 *     a group where the last sticker is still on screen, repeating the same
 *     category twice in a row).
 *
 * No imports from index.ts: storage is injected, exactly like DeepSearchDeps.
 * ────────────────────────────────────────────────────────────────────────── */

export const STICKER_CATEGORIES = [
  "greeting", "farewell", "thanks", "laugh", "celebrate",
  "love", "sad", "facepalm", "agree", "no", "wow", "thinking",
] as const;
export type StickerCategory = typeof STICKER_CATEGORIES[number];

export function isStickerCategory(v: unknown): v is StickerCategory {
  return typeof v === "string" && (STICKER_CATEGORIES as readonly string[]).includes(v);
}

/** Human labels for the admin panel — Persian first, English alongside. */
export const CATEGORY_LABELS: Record<StickerCategory, { fa: string; en: string; emoji: string }> = {
  greeting:  { fa: "سلام و احوال‌پرسی", en: "Greeting",   emoji: "👋" },
  farewell:  { fa: "خداحافظی",           en: "Farewell",   emoji: "🌙" },
  thanks:    { fa: "تشکر",               en: "Thanks",     emoji: "🙏" },
  laugh:     { fa: "خنده",               en: "Laugh",      emoji: "😂" },
  celebrate: { fa: "جشن و تبریک",        en: "Celebrate",  emoji: "🎉" },
  love:      { fa: "محبت",               en: "Affection",  emoji: "❤️" },
  sad:       { fa: "غم و همدلی",         en: "Sad",        emoji: "😢" },
  facepalm:  { fa: "کلافگی",             en: "Facepalm",   emoji: "🤦" },
  agree:     { fa: "تأیید",              en: "Agree",      emoji: "👍" },
  no:        { fa: "مخالفت",             en: "Disagree",   emoji: "👎" },
  wow:       { fa: "شوک و شگفتی",        en: "Wow",        emoji: "😮" },
  thinking:  { fa: "فکر کردن",           en: "Thinking",   emoji: "🤔" },
};

/** The safe emoji to fall back to when a sticker is not the right move. */
export const CATEGORY_EMOJI_FALLBACK: Record<StickerCategory, string> = {
  greeting: "👋", farewell: "🙏", thanks: "🙏", laugh: "🤣", celebrate: "🎉",
  love: "🥰", sad: "😢", facepalm: "🤔", agree: "👍", no: "👎",
  wow: "🤯", thinking: "🤔",
};

/* ── data model ─────────────────────────────────────────────────────────── */

/**
 * One library entry. `id`/`type`/`uses`/`addedAt`/`lastUsed` are the original
 * fields and are still written in exactly the same shape; everything below
 * them is optional metadata added by the management layer.
 */
export interface StickerItem {
  id: string;
  type: "sticker" | "animation";
  uses: number;
  addedAt: number;
  lastUsed: number;
  /** Emoji the sticker itself carries, when Telegram reported one. */
  emoji?: string;
  /** Sticker-set shortname, for grouping and re-import. */
  setName?: string;
  /** Free-form searchable tags set by the admin. */
  tags?: string[];
  /** Admin note, shown in the panel only. */
  note?: string;
  /** `false` disables the entry without deleting it. Missing = enabled. */
  enabled?: boolean;
  /** Where it came from. Missing = "learned" (the original behaviour). */
  source?: "learned" | "seeded" | "manual";
  /** Animated/video stickers cannot be previewed as a still image. */
  format?: "static" | "animated" | "video";
}

/** An item plus the category it was found in — what the admin panel renders. */
export interface StickerRecord extends StickerItem {
  category: StickerCategory;
  enabledResolved: boolean;
}

export const STICKERS_PER_CATEGORY_MAX = 60;

function key(category: StickerCategory): string { return `reaction_media:${category}`; }

/** Minimal storage surface, injected so this module never imports the Worker. */
export interface StickerStore {
  get(key: string): Promise<unknown | null>;
  put(key: string, value: string): Promise<void>;
}

function normalize(raw: unknown): StickerItem[] {
  if (!Array.isArray(raw)) return [];
  const out: StickerItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      type: o.type === "animation" ? "animation" : "sticker",
      uses: Number(o.uses) || 0,
      addedAt: Number(o.addedAt) || 0,
      lastUsed: Number(o.lastUsed) || 0,
      emoji: typeof o.emoji === "string" ? o.emoji : undefined,
      setName: typeof o.setName === "string" ? o.setName : undefined,
      tags: Array.isArray(o.tags) ? o.tags.filter(t => typeof t === "string").slice(0, 12) as string[] : undefined,
      note: typeof o.note === "string" ? o.note.slice(0, 200) : undefined,
      enabled: o.enabled === false ? false : undefined,
      source: o.source === "seeded" || o.source === "manual" ? o.source : undefined,
      format: o.format === "animated" || o.format === "video" ? o.format : (o.format === "static" ? "static" : undefined),
    });
  }
  return out;
}

export async function loadCategory(store: StickerStore, category: StickerCategory): Promise<StickerItem[]> {
  try { return normalize(await store.get(key(category))); } catch { return []; }
}

export async function saveCategory(store: StickerStore, category: StickerCategory, list: StickerItem[]): Promise<void> {
  // Strip undefined so the stored JSON stays as small as the original format.
  const clean = list.slice(0, STICKERS_PER_CATEGORY_MAX).map(i => {
    const o: Record<string, unknown> = { id: i.id, type: i.type, uses: i.uses, addedAt: i.addedAt, lastUsed: i.lastUsed };
    if (i.emoji) o.emoji = i.emoji;
    if (i.setName) o.setName = i.setName;
    if (i.tags?.length) o.tags = i.tags;
    if (i.note) o.note = i.note;
    if (i.enabled === false) o.enabled = false;
    if (i.source) o.source = i.source;
    if (i.format) o.format = i.format;
    return o;
  });
  await store.put(key(category), JSON.stringify(clean));
}

export async function loadLibrary(store: StickerStore): Promise<StickerRecord[]> {
  const all: StickerRecord[] = [];
  for (const category of STICKER_CATEGORIES) {
    for (const item of await loadCategory(store, category)) {
      all.push({ ...item, category, enabledResolved: item.enabled !== false });
    }
  }
  return all;
}

export interface StickerFilter {
  category?: string;
  q?: string;
  type?: "sticker" | "animation";
  state?: "enabled" | "disabled";
  sort?: "recent" | "used" | "unused";
}

/** Search + filter over the whole library. Cheap: the library is ~700 entries max. */
export function filterStickers(all: StickerRecord[], f: StickerFilter): StickerRecord[] {
  const q = (f.q ?? "").trim().toLowerCase();
  let out = all;
  if (f.category && isStickerCategory(f.category)) out = out.filter(s => s.category === f.category);
  if (f.type) out = out.filter(s => s.type === f.type);
  if (f.state === "enabled") out = out.filter(s => s.enabledResolved);
  if (f.state === "disabled") out = out.filter(s => !s.enabledResolved);
  if (q) {
    out = out.filter(s =>
      s.id.toLowerCase().includes(q) ||
      (s.emoji ?? "").includes(q) ||
      (s.setName ?? "").toLowerCase().includes(q) ||
      (s.note ?? "").toLowerCase().includes(q) ||
      (s.tags ?? []).some(t => t.toLowerCase().includes(q)) ||
      s.category.includes(q) ||
      CATEGORY_LABELS[s.category].fa.includes(q) ||
      CATEGORY_LABELS[s.category].en.toLowerCase().includes(q));
  }
  const sort = f.sort ?? "recent";
  return [...out].sort((a, b) =>
    sort === "used"   ? b.uses - a.uses :
    sort === "unused" ? (a.uses - b.uses) || (b.addedAt - a.addedAt) :
                        (b.addedAt - a.addedAt) || (b.lastUsed - a.lastUsed));
}

export interface StickerStats {
  total: number;
  enabled: number;
  disabled: number;
  animations: number;
  neverUsed: number;
  byCategory: Array<{ category: StickerCategory; label: string; emoji: string; total: number; enabled: number }>;
}

export function computeStats(all: StickerRecord[]): StickerStats {
  const byCategory = STICKER_CATEGORIES.map(category => {
    const rows = all.filter(s => s.category === category);
    return {
      category,
      label: CATEGORY_LABELS[category].fa,
      emoji: CATEGORY_LABELS[category].emoji,
      total: rows.length,
      enabled: rows.filter(s => s.enabledResolved).length,
    };
  });
  return {
    total: all.length,
    enabled: all.filter(s => s.enabledResolved).length,
    disabled: all.filter(s => !s.enabledResolved).length,
    animations: all.filter(s => s.type === "animation").length,
    neverUsed: all.filter(s => s.uses === 0).length,
    byCategory,
  };
}

/* ── mutations ──────────────────────────────────────────────────────────── */

export async function addSticker(
  store: StickerStore,
  category: StickerCategory,
  item: Partial<StickerItem> & { id: string },
): Promise<{ ok: boolean; reason?: string }> {
  const list = await loadCategory(store, category);
  if (list.some(i => i.id === item.id)) return { ok: false, reason: "duplicate" };
  const next: StickerItem = {
    id: item.id,
    type: item.type === "animation" ? "animation" : "sticker",
    uses: 0,
    addedAt: Date.now(),
    lastUsed: 0,
    emoji: item.emoji,
    setName: item.setName,
    tags: item.tags,
    note: item.note,
    enabled: item.enabled === false ? false : undefined,
    source: item.source ?? "manual",
    format: item.format,
  };
  list.unshift(next);
  await saveCategory(store, category, list);
  return { ok: true };
}

export async function removeSticker(store: StickerStore, category: StickerCategory, id: string): Promise<boolean> {
  const list = await loadCategory(store, category);
  const next = list.filter(i => i.id !== id);
  if (next.length === list.length) return false;
  await saveCategory(store, category, next);
  return true;
}

export async function updateSticker(
  store: StickerStore,
  category: StickerCategory,
  id: string,
  patch: { enabled?: boolean; tags?: string[]; note?: string; emoji?: string },
): Promise<boolean> {
  const list = await loadCategory(store, category);
  const item = list.find(i => i.id === id);
  if (!item) return false;
  if (patch.enabled !== undefined) item.enabled = patch.enabled ? undefined : false;
  if (patch.tags !== undefined) item.tags = patch.tags.map(t => t.trim()).filter(Boolean).slice(0, 12);
  if (patch.note !== undefined) item.note = patch.note.trim().slice(0, 200) || undefined;
  if (patch.emoji !== undefined) item.emoji = patch.emoji.trim().slice(0, 8) || undefined;
  await saveCategory(store, category, list);
  return true;
}

/** Move an entry to a different mood category, keeping its usage history. */
export async function moveSticker(
  store: StickerStore, from: StickerCategory, to: StickerCategory, id: string,
): Promise<boolean> {
  if (from === to) return true;
  const src = await loadCategory(store, from);
  const item = src.find(i => i.id === id);
  if (!item) return false;
  const dst = await loadCategory(store, to);
  if (!dst.some(i => i.id === id)) { dst.unshift(item); await saveCategory(store, to, dst); }
  await saveCategory(store, from, src.filter(i => i.id !== id));
  return true;
}

/** Bulk enable/disable/delete for a whole category — the panel's cleanup tool. */
export async function bulkCategory(
  store: StickerStore, category: StickerCategory, action: "enable" | "disable" | "clear" | "prune",
): Promise<number> {
  const list = await loadCategory(store, category);
  if (action === "clear") { await saveCategory(store, category, []); return list.length; }
  if (action === "prune") {
    // Drop never-used entries that have been sitting in the library for a week.
    const cutoff = Date.now() - 7 * 86_400_000;
    const next = list.filter(i => i.uses > 0 || i.addedAt > cutoff);
    await saveCategory(store, category, next);
    return list.length - next.length;
  }
  for (const i of list) i.enabled = action === "enable" ? undefined : false;
  await saveCategory(store, category, list);
  return list.length;
}

/* ── selection ──────────────────────────────────────────────────────────── */

/**
 * Pick one entry, avoiding anything the chat has seen recently and anything
 * disabled. Least-used first so a freshly learned sticker actually gets used,
 * then oldest-lastUsed as the tiebreak — a rotation, not a dice roll.
 */
export function chooseSticker(list: StickerItem[], recentIds: readonly string[] = []): StickerItem | null {
  const usable = list.filter(i => i.enabled !== false);
  if (!usable.length) return null;
  const recent = new Set(recentIds);
  const fresh = usable.filter(i => !recent.has(i.id));
  const pool = fresh.length ? fresh : usable;
  return [...pool].sort((a, b) => (a.uses - b.uses) || (a.lastUsed - b.lastUsed) || (a.id < b.id ? -1 : 1))[0] ?? null;
}

/* ── contextual judgement ───────────────────────────────────────────────── */

/** Minimum gap between two stickers in the same chat. */
export const STICKER_MIN_INTERVAL_MS = 45_000;
/** A repeat of the same mood needs a much longer gap than a different mood. */
export const STICKER_SAME_CATEGORY_INTERVAL_MS = 6 * 60_000;

export interface StickerContext {
  /** The user's message text (or caption) for this turn. */
  text: string;
  lang: string;
  isGroup: boolean;
  /** The turn itself was a sticker/GIF from the user. */
  userSentSticker?: boolean;
  /** ms since this chat last received a sticker/GIF from Nova. */
  msSinceLastSticker: number;
  /** Category of that last sticker, if known. */
  lastCategory?: string;
  /** The model is also producing a substantive written answer this turn. */
  hasTextAnswer?: boolean;
  /** Category the model asked for, if any. */
  requested?: string;
  /** The user explicitly asked to be sent a sticker/GIF. */
  explicitAsk?: boolean;
  /** Rough length of the answer Nova is about to give, in characters. */
  answerLength?: number;
}

export interface StickerDecision {
  send: boolean;
  category: StickerCategory;
  /** What to do instead when `send` is false and something is still warranted. */
  emojiFallback: string;
  /** true = send the cheap emoji reaction instead of nothing at all. */
  preferEmoji: boolean;
  score: number;
  reason: string;
}

/**
 * Emotional / intentional hooks. A sticker is only ever the right answer when
 * the message carries one of these, so this table is the gate — not a bonus.
 * `weight` reflects how sticker-worthy the moment is: a celebration invites one
 * far more than a mild "ok".
 */
const MOMENTS: Array<{ cat: StickerCategory; weight: number; re: RegExp }> = [
  { cat: "celebrate", weight: 4, re: /تبریک|مبارک|قبول شدم|برنده شدم|موفق شدم|جشن|تولدم?|congrats?|congratulations|i (won|passed|got the job)|happy birthday|🎉|🥳|🎂/i },
  { cat: "laugh",     weight: 4, re: /خخ+|هه+ه|جوک|بامزه|خنده‌?دار|مسخره‌?بازی|روده‌?بر|lmao|lmfao|rofl|haha+|hehe+|😂|🤣|😹/ },
  { cat: "sad",       weight: 4, re: /ناراحتم|غمگین|دلم گرفته|افسرده|گریه|از دست دادم|مرد(ه)?|فوت (کرد|شد)|تسلیت|خسته‌?ام|حالم بده|i'?m (so )?(sad|depressed|devastated)|passed away|condolence|😢|😭|💔/i },
  { cat: "love",      weight: 3, re: /دوستت دارم|عاشقت|عزیزم|قربونت|جیگرت?ی|بوس|i love you|love ya|❤|🥰|😍|😘|💕/i },
  { cat: "greeting",  weight: 3, re: /^\s*(سلام|درود|های|هلو|صبح بخیر|سلام علیکم|hi|hey|hello|yo|good morning)\b/i },
  { cat: "farewell",  weight: 3, re: /خداحافظ|بدرود|فعلا?ً? خدافظ|شب بخیر|میرم بخوابم|بای بای|good ?night|bye( bye)?|see ya|talk later|🌙/i },
  { cat: "thanks",    weight: 3, re: /ممنون|مرسی|سپاس|تشکر|دستت درد نکنه|لطف کردی|thanks?|thank you|thx|appreciate it|🙏/i },
  { cat: "wow",       weight: 3, re: /باورم نمیشه|عجب|واقعا[؟?]|چه خفن|خفنه|دیوونه‌?کننده|شوکه شدم|no way|unbelievable|whoa|insane|holy|😮|😱|🤯|😲/i },
  { cat: "facepalm",  weight: 3, re: /کلافه|خسته شدم از|چه گیری|بدبختی|گند زدم|خرابش کردم|ای بابا|اه+ه|ugh+|facepalm|i messed up|what a mess|🤦|🙄/i },
  { cat: "no",        weight: 2, re: /^\s*(نه|نه بابا|اصلا|هرگز|قطعا نه|no way|nope|absolutely not)\b|مخالفم|قبول ندارم/i },
  { cat: "agree",     weight: 2, re: /^\s*(آره|بله|دقیقا|حق با توئه|موافقم|اوکی|okay|ok|yes|exactly|agreed|deal)\b|درست میگی|👍|👌|💯/i },
  { cat: "thinking",  weight: 1, re: /نمیدونم|شک دارم|فکر کنم|یعنی|هوم+|hmm+|not sure|i wonder|🤔/i },
];

/** Signals that a sticker would be actively wrong, however warm the message. */
const STICKER_HOSTILE_RE =
  /\b(error|bug|exception|stack ?trace|traceback|deploy|migration|schema|sql|typescript|regex|api key|token|password|invoice|contract|deadline|lawsuit)\b|ارور|باگ|خطا|کرش|دیباگ|کد|اسکریپت|پایگاه.?داده|قرارداد|فاکتور|بیمار(ی|ستان)|تشخیص پزشکی|تصادف|دعوا|طلاق|قتل|خودکشی/i;

/** A question wants an answer, not a picture. */
const QUESTION_RE = /[?؟]\s*$|چطور|چگونه|چرا|کدام|کدوم|توضیح بده|بگو که|how do|why does|what is|explain/i;

function detectMoment(text: string): { cat: StickerCategory; weight: number } | null {
  let best: { cat: StickerCategory; weight: number } | null = null;
  for (const m of MOMENTS) {
    if (!m.re.test(text)) continue;
    if (!best || m.weight > best.weight) best = { cat: m.cat, weight: m.weight };
  }
  return best;
}

/** Detect a mood from arbitrary text — also used to route learned media. */
export function detectStickerCategory(text: string): StickerCategory | null {
  return detectMoment(text)?.cat ?? null;
}

/**
 * The gate. Returns `send: false` for the overwhelming majority of turns; a
 * sticker has to be earned by the moment, not merely permitted by a timer.
 */
export function decideStickerMoment(ctx: StickerContext): StickerDecision {
  const text = (ctx.text ?? "").trim();
  const requested = isStickerCategory(ctx.requested) ? ctx.requested : null;
  const moment = detectMoment(text);
  const category: StickerCategory = requested ?? moment?.cat ?? "laugh";
  const emojiFallback = CATEGORY_EMOJI_FALLBACK[category];
  const no = (reason: string, preferEmoji = false, score = 0): StickerDecision =>
    ({ send: false, category, emojiFallback, preferEmoji, score, reason });

  // An explicit "send me a sticker" is a direct command and outranks everything
  // except the anti-spam floor.
  if (ctx.explicitAsk) {
    if (ctx.msSinceLastSticker < 8_000) return no("explicit-ask-but-just-sent", true, 0);
    return { send: true, category, emojiFallback, preferEmoji: false, score: 10, reason: "explicit-request" };
  }

  if (ctx.msSinceLastSticker < STICKER_MIN_INTERVAL_MS) return no("too-soon", true);
  // Resolved category, not just the requested one: the same beat detected twice
  // in a row is a repeat whether the model named it or the text implied it.
  if (ctx.lastCategory === category && ctx.msSinceLastSticker < STICKER_SAME_CATEGORY_INTERVAL_MS) {
    return no("same-category-repeat", true);
  }
  if (STICKER_HOSTILE_RE.test(text)) return no("serious-or-technical-context");

  let score = 0;
  const notes: string[] = [];

  if (moment) { score += moment.weight; notes.push(`moment:${moment.cat}+${moment.weight}`); }
  // The model asking for a category is a weak signal on its own — it is the
  // conversation that has to justify the sticker, not the model's enthusiasm.
  if (requested && moment && requested === moment.cat) { score += 1; notes.push("model-agrees"); }
  if (requested && !moment) { score -= 1; notes.push("model-only"); }

  // The user's own register: someone who sends stickers and emoji is inviting them.
  if (ctx.userSentSticker) { score += 2; notes.push("user-sent-sticker"); }
  const emojiCount = (text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length;
  if (emojiCount >= 2) { score += 1; notes.push("emoji-heavy"); }

  // Short, expressive turns suit a sticker; long ones want words.
  if (text.length <= 40) { score += 1; notes.push("short-turn"); }
  if (text.length > 220) { score -= 1; notes.push("long-turn"); }
  if (QUESTION_RE.test(text)) { score -= 2; notes.push("question"); }

  // A sticker stapled onto a long written answer reads as decoration.
  const answerLen = ctx.answerLength ?? 0;
  if (ctx.hasTextAnswer && answerLen > 700) { score -= 3; notes.push("essay-answer"); }
  else if (ctx.hasTextAnswer && answerLen > 400) { score -= 2; notes.push("long-answer"); }
  else if (!ctx.hasTextAnswer) { score += 1; notes.push("standalone"); }

  // Groups are noisier and a sticker there interrupts more people.
  const threshold = ctx.isGroup ? 5 : 4;
  if (ctx.isGroup) notes.push("group-threshold");

  // Persian conversation leans on stickers more than English does; a small,
  // honest nudge rather than pretending the two registers are identical.
  if (ctx.lang === "fa" && moment) { score += 1; notes.push("fa-register"); }

  // Recency decay: the longer it has been, the more welcome a sticker is.
  if (ctx.msSinceLastSticker > 10 * 60_000) { score += 1; notes.push("long-gap"); }

  if (!moment) return no(`no-emotional-hook [${notes.join(" ")}]`, score >= 2);
  if (score < threshold) return no(`below-threshold ${score}/${threshold} [${notes.join(" ")}]`, score >= threshold - 1, score);

  return { send: true, category, emojiFallback, preferEmoji: false, score, reason: notes.join(" ") };
}

/** One-line explanation for logs and the admin panel. */
export function describeStickerDecision(d: StickerDecision): string {
  return `${d.send ? "send" : d.preferEmoji ? "emoji" : "skip"}:${d.category} (${d.score}) ${d.reason}`;
}
