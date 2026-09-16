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

/* ── emoji vocabulary ───────────────────────────────────────────────────── */

/**
 * Emoji -> mood, and the only such table in the codebase.
 *
 * index.ts used to carry its own 40-entry `EMOJI_TO_CATEGORY`, which was the
 * sole route by which a user's sticker got learned. A sticker whose emoji was
 * not one of those 40 — which is most of them — was silently dropped, so the
 * library only ever grew in the handful of moods someone had thought to list.
 * That is the "manual sticker management" the whole design is trying to avoid,
 * so the table lives here next to the moods it maps to and is much wider.
 */
/*
 * One emoji may appear in only ONE row. Entries are normalised with
 * `baseEmoji` before indexing, so a ZWJ sequence collapses to its first code
 * point — listing "❤️‍🩹" under thanks silently stole "❤️" from love, and
 * "😮‍💨" under facepalm stole "😮" from wow. Both are gone; `stickerTableCollisions`
 * exists so the next one fails a test instead of quietly mis-routing a mood.
 */
const EMOJI_CATEGORY_TABLE: Array<[StickerCategory, string]> = [
  ["greeting",  "👋🙋🤝🫡🖖🤗😊🙂🌞☀️"],
  ["farewell",  "🌙😴🥱💤🛌🫶🌃🌚"],
  ["thanks",    "🙏🥺💐🌹🤲🫰"],
  ["laugh",     "😂🤣😆😹😄😃😁😸🙃😝😜🤪💀"],
  ["celebrate", "🎉🥳🎊🎈🍾🏆🥇🎂🎁✨🌟🎇🎆👏🙌🔥"],
  ["love",      "❤️😍🥰💕😘💖💗💘💝💞💓♥️😻🫀🤍💜💙💚🧡"],
  ["sad",       "😢😭💔😞😔☹️🙁😿😥😪🥀😓"],
  ["facepalm",  "🤦🙄😑😒😤😖😣🫠🥴"],
  ["agree",     "👍✅👌💯🆗☑️🤙✔️"],
  ["no",        "👎❌🚫⛔🙅🤚✋🛑"],
  ["wow",       "😮😱🤯😲😳🫢😯🤩‼️❗"],
  ["thinking",  "🤔🧐🤨💭🫤😶❓❔"],
];

/**
 * Strip the modifiers Telegram happily includes but that make an exact lookup
 * fail: variation selectors, skin tones, and everything after a ZWJ. "🙋‍♀️"
 * and "👍🏽" must both find their base emoji.
 */
function baseEmoji(raw: string): string {
  if (!raw) return "";
  const noZwj = raw.split("\u200D")[0];
  return [...noZwj]
    .filter(ch => {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp === 0xFE0E || cp === 0xFE0F) return false;          // variation selectors
      if (cp >= 0x1F3FB && cp <= 0x1F3FF) return false;          // skin tones
      return true;
    })
    .join("");
}

const EMOJI_INDEX: Map<string, StickerCategory> = (() => {
  const m = new Map<string, StickerCategory>();
  for (const [cat, chars] of EMOJI_CATEGORY_TABLE) {
    // Splitting by code point keeps multi-code-point emoji like ❤️ intact once
    // normalised, and `set` only when absent so the first listed mood wins for
    // emoji that legitimately belong to two (👋 is greeting before farewell).
    for (const ch of splitEmoji(chars)) {
      const b = baseEmoji(ch);
      if (b && !m.has(b)) m.set(b, cat);
    }
  }
  return m;
})();

/** Split a run of emoji into individual ones, keeping ZWJ sequences together. */
function splitEmoji(run: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of run) {
    const cp = ch.codePointAt(0) ?? 0;
    const isModifier = cp === 0xFE0E || cp === 0xFE0F || cp === 0x200D || (cp >= 0x1F3FB && cp <= 0x1F3FF);
    if (isModifier || (cur.endsWith("\u200D") && cur)) { cur += ch; continue; }
    if (cur) out.push(cur);
    cur = ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Any emoji claimed by more than one mood, after normalisation. Must be empty:
 * a collision means one of the two moods silently loses its emoji.
 */
export function stickerTableCollisions(): Array<{ emoji: string; moods: StickerCategory[] }> {
  const claims = new Map<string, StickerCategory[]>();
  for (const [cat, chars] of EMOJI_CATEGORY_TABLE) {
    for (const ch of splitEmoji(chars)) {
      const b = baseEmoji(ch);
      if (!b) continue;
      const list = claims.get(b) ?? [];
      if (!list.includes(cat)) list.push(cat);
      claims.set(b, list);
    }
  }
  return [...claims.entries()]
    .filter(([, moods]) => moods.length > 1)
    .map(([emoji, moods]) => ({ emoji, moods }));
}

/** The mood an emoji belongs to, or null. Tolerant of skin tones and ZWJ. */
export function categoryForEmoji(emoji: string): StickerCategory | null {
  const b = baseEmoji((emoji ?? "").trim());
  if (!b) return null;
  return EMOJI_INDEX.get(b) ?? EMOJI_INDEX.get([...b][0] ?? "") ?? null;
}

/** Every emoji in a string, normalised — used to read the user's own register. */
export function extractEmoji(text: string): string[] {
  const matches = (text ?? "").match(/\p{Extended_Pictographic}(\uFE0F|\uFE0E)?(\u200D\p{Extended_Pictographic}(\uFE0F|\uFE0E)?)*/gu) ?? [];
  return matches.map(baseEmoji).filter(Boolean);
}

/* ── selection ──────────────────────────────────────────────────────────── */

/** What the moment looks like, for ranking candidates within a mood. */
export interface StickerSignals {
  /** Ids this chat has seen recently; hard-excluded while alternatives exist. */
  recentIds?: readonly string[];
  /** The user's message text, for tag/set-name matching. */
  text?: string;
  /** The mood being served, so an on-mood emoji can be preferred. */
  category?: StickerCategory;
}

/**
 * How well one entry fits this particular moment.
 *
 * Selection used to be a pure least-used rotation: within a mood bucket every
 * sticker was interchangeable and the entry's own emoji, set and tags were
 * never read at all. So "😂 that's hilarious" and "😹 lol" drew from the same
 * bucket in the same fixed order regardless of what the user actually sent.
 * Ranking is now semantic first and rotation second, which keeps the anti-
 * repetition property (equal-scoring entries still rotate least-used-first)
 * while letting an exact emoji match win when there is one.
 */
export function scoreSticker(item: StickerItem, signals: StickerSignals): number {
  const text = (signals.text ?? "").toLowerCase();
  const userEmoji = new Set(extractEmoji(signals.text ?? ""));
  const own = baseEmoji(item.emoji ?? "");
  let score = 0;

  // The user literally sent this emoji: the strongest possible match.
  if (own && userEmoji.has(own)) score += 4;
  // Failing that, an entry whose own emoji agrees with the mood we are serving
  // beats one that landed in the bucket for some other reason.
  else if (own && signals.category && categoryForEmoji(own) === signals.category) score += 2;
  // An entry with no emoji at all is not penalised, just not boosted — most of
  // the pre-existing library is bare ids and must stay reachable.

  if (text) {
    const tags = item.tags ?? [];
    let tagHits = 0;
    for (const t of tags) {
      const tag = t.trim().toLowerCase();
      if (tag.length >= 3 && text.includes(tag)) tagHits++;
    }
    score += Math.min(tagHits, 2);
    const set = (item.setName ?? "").toLowerCase();
    if (set.length >= 4 && text.includes(set)) score += 1;
  }
  return score;
}

/**
 * Pick one entry, avoiding anything the chat has seen recently and anything
 * disabled. Highest semantic score first, then least-used so a freshly learned
 * sticker still surfaces, then oldest-lastUsed — a ranked rotation, not a dice
 * roll, and fully deterministic for a given library and moment.
 *
 * Back-compatible: passing an id array (or nothing) behaves exactly as before,
 * because with no text and no category every candidate scores 0 and the order
 * collapses to the original least-used-first rotation.
 */
export function chooseSticker(
  list: StickerItem[],
  signalsOrRecent: StickerSignals | readonly string[] = [],
): StickerItem | null {
  const signals: StickerSignals = Array.isArray(signalsOrRecent)
    ? { recentIds: signalsOrRecent }
    : (signalsOrRecent as StickerSignals);

  const usable = list.filter(i => i.enabled !== false);
  if (!usable.length) return null;
  const recent = new Set(signals.recentIds ?? []);
  const fresh = usable.filter(i => !recent.has(i.id));
  const pool = fresh.length ? fresh : usable;

  const scored = pool.map(i => ({ i, s: scoreSticker(i, signals) }));
  scored.sort((a, b) =>
    (b.s - a.s) ||
    (a.i.uses - b.i.uses) ||
    (a.i.lastUsed - b.i.lastUsed) ||
    (a.i.id < b.i.id ? -1 : 1));
  return scored[0]?.i ?? null;
}

/**
 * Fall back across the whole library when the requested mood's bucket is empty
 * or entirely disabled.
 *
 * Previously an empty bucket meant `pickReactionMedia` returned null and the
 * turn was simply lost — a library with 200 stickers could still fail to
 * produce one because the model happened to name "facepalm". Neighbouring
 * moods are tried in a fixed order of emotional adjacency before giving up.
 */
const MOOD_NEIGHBOURS: Record<StickerCategory, StickerCategory[]> = {
  greeting:  ["love", "celebrate", "agree", "laugh"],
  farewell:  ["love", "thanks", "greeting", "sad"],
  thanks:    ["love", "agree", "celebrate", "greeting"],
  laugh:     ["celebrate", "wow", "agree", "love"],
  celebrate: ["laugh", "love", "wow", "agree"],
  love:      ["thanks", "celebrate", "greeting", "laugh"],
  sad:       ["love", "facepalm", "thinking", "farewell"],
  facepalm:  ["thinking", "sad", "no", "laugh"],
  agree:     ["thanks", "celebrate", "greeting", "laugh"],
  no:        ["facepalm", "thinking", "sad", "agree"],
  wow:       ["celebrate", "laugh", "thinking", "agree"],
  thinking:  ["wow", "facepalm", "no", "agree"],
};

export function neighbouringMoods(category: StickerCategory): StickerCategory[] {
  return MOOD_NEIGHBOURS[category] ?? [];
}

/* ── "send me a sticker" vs "send me a picture of a cat" ────────────────── */

/**
 * Which system should answer an explicit media request.
 *
 * The routing guide used to say that ANY explicit ask for a sticker — right
 * down to "send me a sticker to test you" — was `search_images`. So Nova ran a
 * Google image search for the word "sticker" while a perfectly good local
 * sticker library sat unused, which is exactly the complaint that "sticker
 * requests must be understood as sticker requests".
 *
 * The real discriminator is not whether the word "sticker" appears, it is
 * whether the request names a SUBJECT:
 *   "send me a sticker"              -> library  (no subject)
 *   "یه استیکر خنده‌دار بفرست"          -> library  (a mood, not a subject)
 *   "send me a sticker of a cat"     -> subject  (search can find a cat)
 *   "استیکر گربه بفرست"                -> subject
 */
export type StickerAsk =
  | { kind: "library"; category: StickerCategory | null }
  | { kind: "subject"; subject: string }
  | null;

/** The ask itself: a media word next to a send-verb, in either language. */
const ASK_RE = /(استیکر|گیف|اموجی متحرک|sticker|gif)/i;
const SEND_VERB_RE = /(بفرست|بفرس|بده|بزن|میفرستی|می‌فرستی|میدی|ارسال کن|send|show|give|drop|post)/i;

/**
 * U+200C (ZWNJ) joins Persian compounds like "خنده‌دار". It is a format
 * character, so `\p{L}` does not match it — treating it as punctuation split
 * that word into "خنده دار" and broke every mood regex written with `‌?`.
 * It counts as part of a word everywhere below.
 */
const WORDISH = "\\p{L}\\p{N}\\u200c";

/**
 * Words that are part of the asking, not part of what is being asked for.
 * Without these, "send me a sticker to test you" looks like it names the
 * subject "to test you" and gets routed to a web search.
 *
 * The lookarounds are load-bearing: unanchored, the one-letter entries matched
 * *inside* words and "cat" came out as "c t", "dancing" as "d ncing".
 */
const ASK_FILLER_RE = new RegExp(
  `(?<![${WORDISH}])(?:` + [
    // the media words and the verbs themselves
    "استیکر", "گیف", "اموجی متحرک", "sticker", "stickers", "gif", "gifs",
    "بفرست", "بفرس", "بده", "بزن", "میفرستی", "می‌فرستی", "میدی", "ارسال", "کن",
    "send", "show", "give", "drop", "post",
    // determiners, politeness, pronouns, prepositions
    "یه", "یک", "یدونه", "دونه", "برام", "برای", "من", "به", "لطفا", "لطفاً", "میشه", "می‌شه", "از",
    "please", "pls", "plz", "me", "us", "a", "an", "one", "some", "the", "to", "for", "my", "of",
    // purpose and vagueness — "to test you", "just any", "هر چی"
    "تست", "ببینم", "بذار", "هر", "چی", "هرچی", "چیزی", "یچیزی",
    "test", "testing", "just", "any", "random", "whatever", "something", "anything",
    "you", "your", "let", "s", "see", "now", "quick", "quickly", "here", "there", "it", "that", "this",
  ].join("|") + `)(?![${WORDISH}])`,
  "giu",
);

/**
 * Mood adjectives as they appear in a *request*. Deliberately separate from
 * `MOMENTS`: those detect a mood Nova is reacting to ("خخخ" -> laugh), these
 * read a mood the user is ordering ("send me a funny sticker" -> laugh).
 * Folding one into the other would make every message containing "funny"
 * register as a laughing moment.
 */
const ASK_MOOD: Array<[StickerCategory, RegExp]> = [
  ["laugh",     /خنده‌?دار|بامزه|خنده|funny|funniest|lol|laughing|haha/i],
  ["sad",       /غمگین|ناراحت|گریه|غم|sad|crying|depress/i],
  ["love",      /عاشقانه|عشقی|قلب|love|romantic|heart/i],
  ["celebrate", /تبریک|جشن|شاد|تولد|celebrat|party|congrat|happy/i],
  ["thanks",    /تشکر|ممنون|مرسی|thank/i],
  ["greeting",  /سلام|خوشامد|greeting|hello|hi/i],
  ["farewell",  /خداحافظ|شب بخیر|bye|goodbye|good ?night/i],
  // No "angry" mood exists; irritation lands on facepalm.
  ["facepalm",  /کلافه|عصبانی|فیس‌?پالم|facepalm|annoyed|frustrat|angry|mad/i],
  ["wow",       /شوکه|تعجب|wow|shocked|surprised|amazed/i],
  ["thinking",  /فکر|متفکر|thinking|thoughtful|confused/i],
  ["agree",     /موافق|تایید|agree|approv|yes/i],
  ["no",        /مخالف|رد|disagree|no|nope/i],
];

function askMood(residue: string): StickerCategory | null {
  for (const [cat, re] of ASK_MOOD) {
    if (!isStickerCategory(cat)) continue;
    if (re.test(residue)) return cat;
  }
  return null;
}

export function classifyStickerAsk(rawText: string): StickerAsk {
  const text = (rawText ?? "").trim();
  if (!text) return null;
  if (!ASK_RE.test(text) || !SEND_VERB_RE.test(text)) return null;

  // Whatever survives stripping the ask is the subject, if anything does.
  const residue = text
    .replace(ASK_FILLER_RE, " ")
    .replace(/[^\p{L}\p{N}\s\u200c]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!residue) return { kind: "library", category: null };

  // A mood word is not a subject — it tells the library WHICH sticker to pick.
  const mood = askMood(residue) ?? detectStickerCategory(residue);
  if (mood) return { kind: "library", category: mood };
  if (residue.length >= 3) return { kind: "subject", subject: residue.slice(0, 80) };
  return { kind: "library", category: null };
}

/* ── health & diagnostics ───────────────────────────────────────────────── */

export interface StickerHealth {
  /** 0-100. How well the library can actually serve the moods it claims to. */
  score: number;
  status: "healthy" | "degraded" | "empty";
  /** Moods with no usable entry at all — these are the ones that fail live. */
  emptyCategories: StickerCategory[];
  /** Moods with fewer than 3 usable entries, so repetition is likely. */
  thinCategories: StickerCategory[];
  /** Same file id filed under more than one mood. */
  duplicateIds: Array<{ id: string; categories: StickerCategory[] }>;
  /** Entries carrying no emoji, so semantic selection cannot rank them. */
  withoutEmoji: number;
  /** Added over a week ago and still never used. */
  staleUnused: number;
  usableTotal: number;
  issues: string[];
}

const THIN_CATEGORY_THRESHOLD = 3;

/**
 * What the admin panel should show instead of a manual mapping grid: whether
 * the library can actually do its job, and precisely where it cannot.
 */
export function stickerHealth(all: StickerRecord[]): StickerHealth {
  const usable = all.filter(s => s.enabledResolved);
  const byCat = new Map<StickerCategory, StickerRecord[]>();
  for (const c of STICKER_CATEGORIES) byCat.set(c, []);
  for (const s of usable) byCat.get(s.category)?.push(s);

  const emptyCategories = STICKER_CATEGORIES.filter(c => (byCat.get(c)?.length ?? 0) === 0);
  const thinCategories = STICKER_CATEGORIES.filter(c => {
    const n = byCat.get(c)?.length ?? 0;
    return n > 0 && n < THIN_CATEGORY_THRESHOLD;
  });

  const idHomes = new Map<string, Set<StickerCategory>>();
  for (const s of all) {
    const set = idHomes.get(s.id) ?? new Set<StickerCategory>();
    set.add(s.category);
    idHomes.set(s.id, set);
  }
  const duplicateIds = [...idHomes.entries()]
    .filter(([, cats]) => cats.size > 1)
    .map(([id, cats]) => ({ id, categories: [...cats] }))
    .slice(0, 20);

  const withoutEmoji = usable.filter(s => !s.emoji).length;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const staleUnused = usable.filter(s => s.uses === 0 && s.addedAt > 0 && s.addedAt < weekAgo).length;

  // Coverage is what actually matters at send time, so it dominates the score.
  const covered = STICKER_CATEGORIES.length - emptyCategories.length;
  let score = Math.round((covered / STICKER_CATEGORIES.length) * 70);
  score += Math.round(((STICKER_CATEGORIES.length - thinCategories.length) / STICKER_CATEGORIES.length) * 15);
  if (usable.length) score += Math.round(((usable.length - withoutEmoji) / usable.length) * 15);
  if (duplicateIds.length) score -= 5;
  score = Math.max(0, Math.min(100, score));

  const issues: string[] = [];
  if (emptyCategories.length) {
    issues.push(`${emptyCategories.length} mood(s) have no usable sticker and will fall back to a neighbouring mood: ${emptyCategories.join(", ")}`);
  }
  if (thinCategories.length) {
    issues.push(`${thinCategories.length} mood(s) have fewer than ${THIN_CATEGORY_THRESHOLD} stickers, so repeats are likely: ${thinCategories.join(", ")}`);
  }
  if (withoutEmoji) issues.push(`${withoutEmoji} entries carry no emoji, so they cannot be ranked semantically.`);
  if (staleUnused) issues.push(`${staleUnused} entries are over a week old and have never been used.`);
  if (duplicateIds.length) issues.push(`${duplicateIds.length} file id(s) are filed under more than one mood.`);

  return {
    score,
    status: usable.length === 0 ? "empty" : score >= 70 ? "healthy" : "degraded",
    emptyCategories, thinCategories, duplicateIds,
    withoutEmoji, staleUnused,
    usableTotal: usable.length,
    issues,
  };
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
