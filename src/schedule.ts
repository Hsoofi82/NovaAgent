/**
 * Nova scheduling intelligence — WHAT time did the user actually mean?
 *
 * WHY THIS EXISTS
 * ───────────────
 * Every "reminder fired at the wrong time" report traced back to the same
 * division of labour: the *model* was the only thing that ever interpreted the
 * user's time expression. It read "فردا ساعت ۵" and emitted `due_at_iso`, and
 * the pipeline stored whatever instant it produced. Three failure classes
 * followed directly from that:
 *
 *   · "ساعت ۵" is 17:00 in Persian, not 05:00 — a model that reads the digits
 *     literally schedules a reminder 12 hours early, at an hour the user is
 *     asleep. The same asymmetry exists for "9 tonight" in English.
 *   · A relative phrase ("۲۰ دقیقه دیگه", "in an hour") depends on the value of
 *     *now* at the moment the tool runs, which is exactly the value a language
 *     model does not have. It guesses, and the guess is off by the whole
 *     round-trip.
 *   · "هر روز ساعت ۹ صبح" is a recurring schedule. If the model omitted
 *     `repeat`, the job was stored as a one-shot and fired exactly once — a
 *     recurring task silently created as a plain reminder.
 *
 * So time interpretation is moved here: a pure, deterministic, bilingual
 * parser that owns the *arithmetic* (what instant does this sentence name, and
 * does it repeat) while the model keeps the job it is actually good at —
 * understanding the sentence at all. The pipeline calls this parser and uses
 * its answer as the authority whenever the parse is confident, falling back to
 * the model's ISO value only when the text carries no readable time.
 *
 * Design rules, each of which is pinned by a test:
 *   1. Wall-clock arithmetic happens in Asia/Tehran (fixed +03:30 — Iran has
 *      had no DST since 2022), never in the Worker's own UTC zone.
 *   2. A bare hour 1–11 with no period word is PM ("ساعت ۵" → 17:00).
 *   3. A named period always wins over the bare-hour rule.
 *   4. A clock time that has already passed moves to the next day instead of
 *      firing immediately.
 *   5. Recurrence words are only honoured when they sit in the *same clause* as
 *      the time ("هر روز ورزش میکنم، فردا ساعت ۸ یادم کن" is a one-shot).
 *   6. The parser never returns an instant in the past.
 *
 * Pure by construction — no I/O, no env, no module state — so the whole table
 * is unit-testable, the same contract core.ts / intent.ts / agentPlan.ts follow.
 */

import {
  buildRecurrenceFromFirstRun,
  computeNextOccurrence,
  type RecurrenceKind,
  type RecurrenceRule,
} from "./core";

/** Asia/Tehran, UTC+03:30. Iran abolished DST in 2022, so a fixed offset is exact. */
export const TEHRAN_OFFSET_MINUTES = 210;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Beyond this a "time expression" is a date, and the model's ISO is better. */
const MAX_PLAUSIBLE_DELAY_MS = 400 * DAY_MS;

export type ScheduleConfidence = "high" | "medium" | "low";

export interface ScheduleParse {
  /** Absolute instant of the FIRST run, in epoch ms. */
  dueAt: number;
  /** Recurrence implied by the wording; `null` for a genuine one-shot. */
  recurrence: RecurrenceRule | null;
  /**
   * `high` — the text names a usable time and the arithmetic is unambiguous.
   * `medium` — a time was read but a default had to be filled in (a bare
   *            "فردا" with no hour, or a recurrence word in another clause).
   * The caller overrides the model's own answer only for `high`.
   */
  confidence: ScheduleConfidence;
  /** Which fragment produced the instant — logs and tests only. */
  evidence: string;
  mode: "relative" | "clock" | "default";
}

/* ══════════════════════════════════════════════════════════════════════════
   TEXT NORMALISATION
   ══════════════════════════════════════════════════════════════════════════ */

/** Persian ۰-۹, Arabic-Indic ٠-٩ and the Persian decimal separator → ASCII. */
const DIGIT_MAP: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "٫": ".", "،": ",",
};

/**
 * Canonicalises a user message for parsing.
 *
 * Arabic variants of the Persian letters are folded (`ي`→`ی`, `ك`→`ک`) because
 * Persian users type them interchangeably and a missed fold means the word
 * simply never matches. ZWNJ is kept (it is part of "همیشه"-style compounds and
 * of "سه‌شنبه"), but a space is also accepted by every pattern that needs one.
 */
export function normalizeScheduleText(raw: string): string {
  let text = String(raw ?? "");
  let out = "";
  for (const ch of text) out += DIGIT_MAP[ch] ?? ch;
  text = out
    .replace(/[يﻯﻰ]/g, "ی")
    .replace(/[كﻙ]/g, "ک")
    .replace(/[ۀهٔ]/g, "ه")
    .replace(/[‌‏‎]/g, "‌")
    .replace(/[أإآ]/g, "ا")
    .replace(/[\u200B-\u200F\u202A-\u202E]/g, "")
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text;
}

/* ══════════════════════════════════════════════════════════════════════════
   PERSIAN CLOCK ARITHMETIC — the whole point of this module
   ══════════════════════════════════════════════════════════════════════════ */

export interface TehranClock {
  year: number;
  month: number;   // 1-12
  day: number;     // 1-31
  hour: number;    // 0-23
  minute: number;  // 0-59
  /** 0 = Sunday … 6 = Saturday (JS `getUTCDay` convention). */
  weekday: number;
}

/**
 * Reads an instant as Tehran wall-clock.
 *
 * The shift-then-read trick: adding the offset turns local wall-clock reading
 * into plain UTC reading, and the offset is subtracted again only when an
 * instant is built (see {@link tehranInstant}).
 */
export function tehranClock(ms: number, tzOffsetMinutes = TEHRAN_OFFSET_MINUTES): TehranClock {
  const shifted = new Date(ms + tzOffsetMinutes * MINUTE_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/** Inverse of {@link tehranClock}: a Tehran wall-clock reading → epoch ms. */
export function tehranInstant(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  tzOffsetMinutes = TEHRAN_OFFSET_MINUTES,
): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0)
    - tzOffsetMinutes * MINUTE_MS;
}

/** `Date.UTC` day arithmetic that survives month/year boundaries. */
function addDays(clock: TehranClock, days: number): { year: number; month: number; day: number } {
  const base = Date.UTC(clock.year, clock.month - 1, clock.day) + days * DAY_MS;
  const d = new Date(base);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, sun: 0, یکشنبه: 0,
  monday: 1, mon: 1, دوشنبه: 1,
  tuesday: 2, tue: 2, tues: 2, سه‌شنبه: 2, "سه شنبه": 2,
  wednesday: 3, wed: 3, چهارشنبه: 3, "چهار شنبه": 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, پنجشنبه: 4, "پنج شنبه": 4,
  friday: 5, fri: 5, جمعه: 5, آدینه: 5,
  saturday: 6, sat: 6, شنبه: 6,
};

/* ══════════════════════════════════════════════════════════════════════════
   NUMBER WORDS
   ══════════════════════════════════════════════════════════════════════════ */

const NUMBER_WORDS: Record<string, number> = {
  یک: 1, "یه": 1, دو: 2, سه: 3, چهار: 4, چار: 4, پنج: 5, شش: 6, شیش: 6,
  هفت: 7, هشت: 8, نه: 9, ده: 10, یازده: 11, دوازده: 12, سیزده: 13,
  چهارده: 14, پانزده: 15, شانزده: 16, هفده: 17, هجده: 18, نوزده: 19,
  بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90,
  نیم: 0.5, ربع: 0.25,
  one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, seventy: 70, ninety: 90,
  half: 0.5, quarter: 0.25,
};

const NUM_TOKEN = `(?:\\d+(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join("|")})`;

function numberValue(token: string): number {
  const t = String(token ?? "").trim().toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return NUMBER_WORDS[t] ?? NaN;
}

/* ══════════════════════════════════════════════════════════════════════════
   DURATIONS ("in 20 minutes", "نیم ساعت دیگه")
   ══════════════════════════════════════════════════════════════════════════ */

/** Unit → milliseconds, for a duration (not a clock reading). */
const DURATION_UNITS: Array<[RegExp, number]> = [
  [/^(?:ثانیه|ثانیه‌ای|seconds?|secs?|sec)$/, 1_000],
  [/^(?:دقیقه|دقیقه‌ای|دقیقه ای|mins?|minutes?|m)$/, MINUTE_MS],
  [/^(?:ساعت‌ها|ساعتها|ساعت|ساعته|hours?|hrs?|hr|h)$/, 60 * MINUTE_MS],
  [/^(?:روزها|روز|روزه|days?)$/, DAY_MS],
  [/^(?:هفته‌ها|هفته|هفته‌ای|weeks?|wks?|wk)$/, 7 * DAY_MS],
  [/^(?:ماه‌ها|ماه|ماهه|months?|mos?)$/, 30 * DAY_MS],
];

function unitMs(word: string): number | null {
  const w = String(word ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  for (const [re, ms] of DURATION_UNITS) if (re.test(w)) return ms;
  return null;
}

const DURATION_RE = new RegExp(
  `(${NUM_TOKEN})\\s*([\\p{L}‌]+)` +                       // main component
  `(?:\\s*(?:و|and)\\s*(${NUM_TOKEN})\\s*([\\p{L}‌]+))?`,   // optional "and 30 minutes"
  "giu",
);

interface Duration {
  ms: number;
  text: string;
  index: number;
  end: number;
}

/**
 * Finds the first *duration* in the text — a length of time, not an hour.
 *
 * A cue word is required for the ambiguous units. "۵ دقیقه" is a duration on
 * its own (nobody names a clock minute that way), but "ساعت ۵" is a clock, so
 * the hour unit only counts as a duration when a cue ("in", "after", "دیگه",
 * "بعد", "later") is present. Without that split, "ساعت ۵" would be read as a
 * five-hour delay.
 */
function findDuration(text: string): Duration | null {
  DURATION_RE.lastIndex = 0;
  for (let m = DURATION_RE.exec(text); m !== null; m = DURATION_RE.exec(text)) {
    const firstMs = unitMs(m[2]);
    if (firstMs === null) continue;
    const first = numberValue(m[1]);
    if (!Number.isFinite(first) || first <= 0) continue;
    let total = first * firstMs;
    let end = m.index + m[0].length;
    if (m[3] !== undefined && m[4] !== undefined) {
      const secondMs = unitMs(m[4]);
      const second = numberValue(m[3]);
      if (secondMs !== null && Number.isFinite(second) && second >= 0) {
        total += second * secondMs;
        end = m.index + m[0].length;
      }
    }
    const isMinutesOrSeconds = firstMs <= MINUTE_MS && /^(?:دقیقه|ثانیه)/.test(m[2]);
    const before = text.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    const after = text.slice(end, end + 16).toLowerCase();
    const cued =
      /(?:in|after|within|بعد\s*از|بعد|دیگه|دیگر|دیگر|بعدتر|later|from\s+now)\s*$/.test(before)
      || /^\s*(?:دیگه|دیگر|بعد|بعدتر|بعدی|later|from\s+now|هی|دیگر)/.test(after)
      || /(?:in|after|بعد\s*از)\s*$/.test(before);
    if (!cued && !isMinutesOrSeconds) continue;
    return { ms: total, text: m[0].trim(), index: m.index, end };
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   CLOCK TIMES ("ساعت ۵", "at 9:30pm", "۹ شب")
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Period words, with the reach each one is allowed to have.
 *
 * Two details are load-bearing:
 *  · The English am/pm forms use letter lookarounds, not `\b`. `\bam\b` can
 *    never match "9:30am": the "0" before it is a word character too, so no
 *    boundary exists between them — and the glued form is the most common way
 *    English speakers write it. The pattern also tolerates the dotted forms.
 *  · English markers reach only 4 characters, because "am" is also the verb:
 *    "I am free at 9" must not make that 09:00. Persian words are unambiguous,
 *    so they keep the wider window.
 */
const PERIOD_MARKERS: Array<{
  re: RegExp;
  period: "am" | "pm" | "noon" | "night";
  ms: number;
  maxDistance: number;
}> = [
  { re: /قبل\s*از\s*ظهر|صبح|بامداد|سحر/gi, period: "am", ms: 120, maxDistance: 24 },
  { re: /(?<![a-z])a\.?m\.?(?![a-z])/gi, period: "am", ms: 120, maxDistance: 4 },
  { re: /بعد\s*از\s*ظهر|بعدازظهر|عصر/gi, period: "pm", ms: 110, maxDistance: 24 },
  { re: /(?<![a-z])p\.?m\.?(?![a-z])/gi, period: "pm", ms: 110, maxDistance: 4 },
  { re: /شب|لیل/gi, period: "night", ms: 100, maxDistance: 24 },
  { re: /(?<![a-z])(?:tonight|night)(?![a-z])/gi, period: "night", ms: 100, maxDistance: 12 },
  { re: /ظهر|(?<![a-z])(?:noon|midday)(?![a-z])/gi, period: "noon", ms: 80, maxDistance: 12 },
];

interface PeriodMatch {
  period: "am" | "pm" | "noon" | "night";
  /** The literal word that matched — `12 صبح` is noon, `12am` is midnight. */
  marker: string;
}

/**
 * Nearest period word to a clock reading wins.
 *
 * "Nearest" rather than "first" because one message can hold two clauses with
 * different periods ("صبح بیدار شو، شب ساعت ۱۰ یادم کن") and the clock belongs to
 * whichever period word sits closest to it.
 */
function periodNear(text: string, start: number, end: number): PeriodMatch | null {
  let best: { match: PeriodMatch; distance: number; rank: number } | null = null;
  for (const marker of PERIOD_MARKERS) {
    marker.re.lastIndex = 0;
    for (let m = marker.re.exec(text); m !== null; m = marker.re.exec(text)) {
      const mStart = m.index;
      const mEnd = m.index + m[0].length;
      // Distance in characters between the two spans (0 when they touch).
      const distance = mStart >= end ? mStart - end : start - mEnd > 0 ? start - mEnd : 0;
      if (distance > marker.maxDistance) continue; // a period word a clause away is someone else's
      const candidate = { match: { period: marker.period, marker: m[0] }, distance, rank: marker.ms };
      if (!best || candidate.distance < best.distance
        || (candidate.distance === best.distance && candidate.rank > best.rank)) {
        best = candidate;
      }
      if (m[0].length === 0) marker.re.lastIndex++;
    }
  }
  return best?.match ?? null;
}

interface ClockReading {
  hour: number;
  minute: number;
  period: PeriodMatch | null;
  text: string;
  index: number;
  end: number;
  /** True when the period had to be inferred from the bare hour. */
  inferredPeriod: boolean;
  /** True for a bare 7–11, where morning and evening readings are both normal. */
  ambiguousHour?: boolean;
}

const CLOCK_PATTERNS: RegExp[] = [
  // "ساعت ۹:۳۰", "at 9:30", "ساعت 21:00"
  /(?:ساعت|at)\s*(\d{1,2})\s*:\s*(\d{2})/iu,
  // "9:30"
  /(\d{1,2})\s*:\s*(\d{2})/u,
  // "ساعت ۵", "ساعت 5 و 30 دقیقه", "at 9"
  new RegExp(`(?:ساعت|at)\\s*(${NUM_TOKEN})(?:\\s*(?:و|و\\s*|:)\\s*(${NUM_TOKEN})\\s*(?:دقیقه|min))?`, "iu"),
  // "۵ بعد از ظهر", "9pm", "۹ شب"
  new RegExp(`(${NUM_TOKEN})\\s*(صبح|بامداد|قبل\\s*از\\s*ظهر|ظهر|بعد\\s*از\\s*ظهر|بعدازظهر|عصر|شب|am|pm)`, "iu"),
];

function readClock(text: string): ClockReading | null {
  for (const re of CLOCK_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) continue;
    const rawHour = numberValue(m[1]);
    if (!Number.isFinite(rawHour)) continue;
    const hasMinuteGroup = m[2] !== undefined;
    let minute = 0;
    if (hasMinuteGroup) {
      const mm = numberValue(m[2]);
      if (!Number.isFinite(mm)) continue;
      // A two-digit minute is a real minute; otherwise it is a *number word*
      // ("ساعت ۵ و نیم" already split, so only plain digits survive here).
      if (/^\d/.test(m[2].trim())) { if (mm > 59) continue; minute = mm; }
      else minute = mm >= 60 ? mm % 60 : Math.round(mm);
    }
    const hour = Math.trunc(rawHour);
    if (hour > 24) continue;
    const start = m.index;
    const end = m.index + m[0].length;
    const period = periodNear(text, start, end);
    return {
      hour: hour === 24 ? 0 : hour,
      minute,
      period,
      text: m[0].trim(),
      index: start,
      end,
      inferredPeriod: false,
    };
  }
  return null;
}

/**
 * Resolves a clock reading to a 24-hour hour using the Persian convention.
 *
 * The ordering matters and is the fix for the flagship bug: **the period word
 * wins**, and only when there is no period word at all does the bare-hour rule
 * apply — a bare 1–11 means the evening ("ساعت ۵" → 17:00), because that is how
 * the phrase is actually used in a reminder.
 *
 * `rollsDay` reports the one case where the resolved hour belongs to the *next*
 * calendar day: the small hours of "شب", which in Persian covers 17:00–04:00.
 * "ساعت ۲ شب" is 02:00 tomorrow, not 02:00 today.
 */
function resolveClockHour(reading: ClockReading): { hour: number; rollsDay: boolean } {
  const { hour } = reading;
  const match = reading.period;
  if (!match) {
    // The bare-hour convention, split at the boundary speakers actually use:
    // 1–6 means the afternoon/evening ("ساعت ۵" = 17:00, "ساعت ۳" = 15:00),
    // while 7–11 reads as the morning. The split is not symmetric in
    // confidence: 1–6 is a strong convention, 7–11 is genuinely ambiguous
    // ("ساعت ۸" is 08:00 to one user and 20:00 to another), so those are marked
    // ambiguous and the model's own reading is kept for them.
    if (hour >= 1 && hour <= 6) { reading.inferredPeriod = true; return { hour: hour + 12, rollsDay: false }; }
    if (hour >= 7 && hour <= 11) { reading.inferredPeriod = true; reading.ambiguousHour = true; return { hour, rollsDay: false }; }
    return { hour, rollsDay: false };  // 0, 12 and 13–23 read literally
  }
  switch (match.period) {
    case "am":
      // "12am" is midnight; "۱۲ صبح" is noon. The two languages disagree, so the
      // matched word decides rather than the period alone.
      if (hour === 12) return { hour: /^a/i.test(match.marker) ? 0 : 12, rollsDay: false };
      return { hour, rollsDay: false };
    case "noon":
      return { hour, rollsDay: false };
    case "pm":
      if (hour === 12) return { hour: 12, rollsDay: false };
      if (hour > 12) return { hour, rollsDay: false };
      return { hour: hour + 12, rollsDay: false };
    case "night":
      if (hour === 12) return { hour: 0, rollsDay: true };
      if (hour >= 1 && hour <= 4) return { hour, rollsDay: true };
      if (hour >= 5 && hour <= 11) return { hour: hour + 12, rollsDay: false };
      return { hour, rollsDay: false }; // "۲۲ شب" — already 24-hour
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   DAY OFFSET ("tomorrow", "فردا", "دوشنبه")
   ══════════════════════════════════════════════════════════════════════════ */

interface DayHint {
  /** Days to add to today's Tehran date. */
  offset: number;
  /** A named weekday (JS convention, 0=Sunday) — overrides `offset` when set. */
  weekday: number | null;
  /** Evening/night bias from a day word like "امشب" / "tonight". */
  period: "am" | "pm" | "night" | null;
  text: string;
  distance: number;
}

/**
 * `فردا` carries a left guard so it cannot match *inside* `پس‌فردا` (which is
 * two days out, not one). Without it the shorter word won on distance and
 * "پس‌فردا ساعت ۸ صبح" was scheduled a full day too early.
 */
const DAY_WORDS: Array<{ re: RegExp; offset: number; period: DayHint["period"] }> = [
  { re: /پس\s*فردا|پس‌فردا|the\s+day\s+after\s+tomorrow/giu, offset: 2, period: null },
  { re: /(?<![\p{L}\u200c])فردا|(?<![a-z])tomorrow(?![a-z])/giu, offset: 1, period: null },
  { re: /(?<![\p{L}\u200c])امشب|(?<![a-z])tonight(?![a-z])/giu, offset: 0, period: "night" },
  { re: /(?<![\p{L}\u200c])امروز|(?<![a-z])today(?![a-z])/giu, offset: 0, period: null },
  { re: /هفته\s*(?:ی\s*)?(?:آینده|بعد|دیگر)|next\s+week/giu, offset: 7, period: null },
];

function dayHintNear(text: string, anchor: number): DayHint | null {
  const candidates: DayHint[] = [];
  for (const word of DAY_WORDS) {
    word.re.lastIndex = 0;
    for (let m = word.re.exec(text); m !== null; m = word.re.exec(text)) {
      candidates.push({
        offset: word.offset,
        weekday: null,
        period: word.period,
        text: m[0].trim(),
        distance: Math.abs(m.index - anchor),
      });
    }
  }
  for (const [name, weekday] of Object.entries(WEEKDAY_INDEX)) {
    const re = new RegExp(`(?<![\\p{L}‌])${name.replace(/ /g, "\\s+")}(?![\\p{L}‌])`, "giu");
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      candidates.push({ offset: 0, weekday, period: null, text: m[0].trim(), distance: Math.abs(m.index - anchor) });
    }
  }
  if (!candidates.length) return null;
  // Nearest wins; on a tie the longer word is the more specific one.
  candidates.sort((a, b) => a.distance - b.distance || b.text.length - a.text.length);
  return candidates[0];
}

/* ══════════════════════════════════════════════════════════════════════════
   RECURRENCE WORDS
   ══════════════════════════════════════════════════════════════════════════ */

const DAILY_RE = /(?:هر\s*روز|همه\s*روز|روزانه|هرروز|\bdaily\b|every\s*(?:single\s*)?day)/iu;
const WEEKLY_RE = /(?:هر\s*هفته|هفتگی|\bweekly\b|every\s*week)/iu;
const MONTHLY_RE = /(?:هر\s*ماه|ماهانه|ماهی\s*یک\s*بار|\bmonthly\b|every\s*month)/iu;
// "هر ساعت" as a *frequency* — guarded so "ساعت ۹" (a clock) never matches.
const HOURLY_RE = /(?:هر\s*ساعت(?!\s*\d)|ساعتی\s*یک\s*بار|\bhourly\b|every\s*hour)/iu;
const INTERVAL_RE = new RegExp(`(?:هر|every)\\s*(${NUM_TOKEN})\\s*([\\p{L}‌]+)`, "iu");

interface RecurrenceHint {
  kind: "daily" | "weekly" | "monthly" | "hourly" | "interval";
  everyMinutes?: number;
  weekday?: number;
  text: string;
  index: number;
}

/** The weekday named in a segment, if any (a later, longer word wins). */
function weekdayIn(segment: string): number | null {
  let found: number | null = null;
  let longest = 0;
  for (const [name, weekday] of Object.entries(WEEKDAY_INDEX)) {
    const re = new RegExp(`(?<![\\p{L}\\u200c])${name.replace(/ /g, "\\s+")}(?![\\p{L}\\u200c])`, "iu");
    const m = re.exec(segment);
    if (m && m[0].length > longest) {
      longest = m[0].length;
      found = weekday;
    }
  }
  return found;
}

function recurrenceIn(segment: string): RecurrenceHint | null {
  const interval = INTERVAL_RE.exec(segment);
  if (interval) {
    const value = numberValue(interval[1]);
    const ms = unitMs(interval[2]);
    if (ms !== null && Number.isFinite(value) && value > 0) {
      // "هر روز/هفته/ماه" must not be read as "every 1 day" — the named forms
      // carry their own wall-clock semantics below.
      const unitText = interval[2].toLowerCase();
      if (/^(?:روز|هفته|ماه)/.test(unitText)) {
        if (value === 1) {
          const named = DAILY_RE.test(unitText) ? "daily" : WEEKLY_RE.test(unitText) ? "weekly" : "monthly";
          return { kind: named as RecurrenceHint["kind"], text: interval[0], index: interval.index };
        }
      } else {
        return {
          kind: "interval",
          everyMinutes: Math.max(1, Math.round((value * ms) / MINUTE_MS)),
          text: interval[0],
          index: interval.index,
        };
      }
    }
  }
  if (HOURLY_RE.test(segment)) return { kind: "hourly", text: "hourly", index: 0 };
  if (DAILY_RE.test(segment)) return { kind: "daily", text: "daily", index: 0 };
  if (MONTHLY_RE.test(segment)) return { kind: "monthly", text: "monthly", index: 0 };
  // "هر هفته دوشنبه ساعت ۱۰" and "هر دوشنبه ساعت ۱۰" both name a weekday, and it
  // must be the *named* one — deriving the weekday from the first run instead
  // silently moved a Monday reminder to whatever day the message was sent.
  const weekday = weekdayIn(segment);
  if (/(?:هر|every)\s+[\p{L}‌]+/iu.test(segment)) {
    if (WEEKLY_RE.test(segment) || weekday !== null) {
      return { kind: "weekly", weekday: weekday ?? undefined, text: weekday !== null ? String(weekday) : "weekly", index: 0 };
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   CLAUSES
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Splits a message into clauses on punctuation and Persian conjunctions.
 *
 * This is what keeps recurrence words honest. "هر روز ورزش میکنم، فردا ساعت ۸
 * یادم کن" is a one-shot reminder with a habit mentioned in front of it; both
 * words live in the same message but different clauses. Only a recurrence word
 * inside the clause that states the time is treated as describing THIS job.
 */
export function splitClauses(text: string): string[] {
  return String(text ?? "")
    .split(/[.!?؟\n؛;،,]+|\s+(?:اما|ولی|و بعد|و سپس|then|but)\s+/giu)
    .map(s => s.trim())
    .filter(Boolean);
}

/* ══════════════════════════════════════════════════════════════════════════
   THE PARSER
   ══════════════════════════════════════════════════════════════════════════ */

interface SegmentParse {
  dueAt: number;
  confidence: ScheduleConfidence;
  evidence: string;
  recurrence: RecurrenceHint | null;
  /** Local wall-clock of `dueAt`, for building a recurrence. */
  clock: TehranClock;
}

function parseSegment(
  segment: string,
  nowMs: number,
  tzOffsetMinutes: number,
  fallbackClock: TehranClock | null,
): SegmentParse | null {
  const text = segment.trim();
  if (!text) return null;
  const recurrence = recurrenceIn(text);

  // ── 1 · Duration: "in 20 minutes", "نیم ساعت دیگه" ──────────────────────
  const duration = findDuration(text);
  if (duration) {
    const dueAt = nowMs + duration.ms;
    if (dueAt - nowMs > MAX_PLAUSIBLE_DELAY_MS) return null;
    return {
      dueAt,
      confidence: "high",
      evidence: `relative:${duration.text}`,
      recurrence,
      clock: tehranClock(dueAt, tzOffsetMinutes),
    };
  }

  // ── 2 · Clock reading ──────────────────────────────────────────────────
  const reading = readClock(text);
  const dayHint = dayHintNear(text, reading ? reading.index : 0);

  if (reading) {
    // An evening day word biases a bare hour the same way an explicit period
    // word does: "امشب ساعت ۱۰" is 22:00, exactly like "ساعت ۱۰ شب".
    if (!reading.period && dayHint?.period) {
      reading.period = { period: dayHint.period, marker: dayHint.text };
    }
    const { hour, rollsDay } = resolveClockHour(reading);
    const nowClock = tehranClock(nowMs, tzOffsetMinutes);
    let day = addDays(nowClock, dayHint?.offset ?? 0);
    if (dayHint?.weekday !== null && dayHint?.weekday !== undefined) {
      const delta = (dayHint.weekday - nowClock.weekday + 7) % 7;
      day = addDays(nowClock, delta);
    }
    // The small hours of the night belong to the following calendar day.
    if (rollsDay) day = addDays({ ...nowClock, ...day }, 1);
    let dueAt = tehranInstant({ ...day, hour, minute: reading.minute }, tzOffsetMinutes);
    // A time already gone means the next occurrence, never "fire right now".
    // For a named weekday that occurrence is the SAME weekday next week, not
    // tomorrow — "دوشنبه ساعت ۱۰" said on Monday afternoon is next Monday.
    if (dueAt <= nowMs + 30_000) {
      const step = dayHint?.weekday !== null && dayHint?.weekday !== undefined ? 7 : 1;
      const bumped = addDays(tehranClock(dueAt, tzOffsetMinutes), step);
      dueAt = tehranInstant({ ...bumped, hour, minute: reading.minute }, tzOffsetMinutes);
    }
    const confidence: ScheduleConfidence = reading.ambiguousHour === true ? "medium" : "high";
    return {
      dueAt,
      confidence,
      evidence: `clock:${reading.text}${reading.inferredPeriod ? "(pm-inferred)" : ""}${dayHint ? `+${dayHint.text}` : ""}`,
      recurrence,
      clock: tehranClock(dueAt, tzOffsetMinutes),
    };
  }

  // ── 3 · Day word with no clock: "فردا یادم کن" → 09:00 local, medium ────
  if (dayHint) {
    const nowClock = tehranClock(nowMs, tzOffsetMinutes);
    let day = addDays(nowClock, dayHint.offset);
    if (dayHint.weekday !== null) {
      const delta = (dayHint.weekday - nowClock.weekday + 7) % 7;
      day = addDays(nowClock, delta);
    }
    const hour = dayHint.period === "night" ? 21 : 9;
    let dueAt = tehranInstant({ ...day, hour, minute: 0 }, tzOffsetMinutes);
    if (dueAt <= nowMs) {
      const step = dayHint.weekday !== null ? 7 : 1;
      const bumped = addDays(tehranClock(dueAt, tzOffsetMinutes), step);
      dueAt = tehranInstant({ ...bumped, hour, minute: 0 }, tzOffsetMinutes);
    }
    return {
      dueAt,
      confidence: "medium",
      evidence: `day-only:${dayHint.text}`,
      recurrence,
      clock: tehranClock(dueAt, tzOffsetMinutes),
    };
  }

  // ── 4 · Recurrence with no time of its own: anchor on the other clause ──
  if (recurrence && fallbackClock) {
    return {
      dueAt: tehranInstant(fallbackClock, tzOffsetMinutes),
      confidence: "medium",
      evidence: `recurrence-only:${recurrence.text}`,
      recurrence,
      clock: fallbackClock,
    };
  }

  return null;
}

/**
 * Interprets a scheduling sentence. Returns `null` when the text names no time
 * at all — the caller then keeps whatever the model produced, which is the
 * honest answer when there is nothing to check the model against.
 */
export function parseScheduleText(
  raw: string,
  nowMs: number,
  tzOffsetMinutes = TEHRAN_OFFSET_MINUTES,
): ScheduleParse | null {
  const text = normalizeScheduleText(raw);
  if (!text) return null;
  const clauses = splitClauses(text);
  if (!clauses.length) return null;

  let best: SegmentParse | null = null;
  let bestRank = -1;
  let bestIndex = -1;

  for (let i = 0; i < clauses.length; i++) {
    const parsed = parseSegment(clauses[i], nowMs, tzOffsetMinutes, best?.clock ?? null);
    if (!parsed) continue;
    // Rank: a clause with a recurrence word wins (it separates "reminder" from
    // "recurring task"), then a clause with its own time, then leftmost.
    const rank = (parsed.recurrence ? 2 : 0)
      + (parsed.evidence.startsWith("relative") || parsed.evidence.startsWith("clock") ? 1 : 0);
    if (rank > bestRank || (rank === bestRank && i < bestIndex)) {
      best = parsed;
      bestRank = rank;
      bestIndex = i;
    }
  }
  if (!best) return null;
  if (!Number.isFinite(best.dueAt) || best.dueAt <= nowMs - MINUTE_MS) return null;
  if (best.dueAt - nowMs > MAX_PLAUSIBLE_DELAY_MS) return null;

  return {
    dueAt: best.dueAt,
    confidence: best.confidence,
    evidence: best.evidence,
    mode: best.evidence.startsWith("relative") ? "relative" : "clock",
    recurrence: recurrenceToRule(best.recurrence, best.dueAt, tzOffsetMinutes, best.clock),
  };
}

function recurrenceToRule(
  hint: RecurrenceHint | null,
  dueAt: number,
  tzOffsetMinutes: number,
  clock: TehranClock,
): RecurrenceRule | null {
  if (!hint) return null;
  if (hint.kind === "interval") {
    return buildRecurrenceFromFirstRun("interval", dueAt, tzOffsetMinutes, hint.everyMinutes ?? 60);
  }
  if (hint.kind === "hourly") {
    return buildRecurrenceFromFirstRun("hourly", dueAt, tzOffsetMinutes);
  }
  if (hint.kind === "weekly" && hint.weekday !== null && hint.weekday !== undefined) {
    return {
      kind: "weekly",
      weekday: hint.weekday,
      hour: clock.hour,
      minute: clock.minute,
      tzOffsetMinutes,
    };
  }
  return buildRecurrenceFromFirstRun(hint.kind as RecurrenceKind, dueAt, tzOffsetMinutes);
}

/**
 * Does the wording itself ask for a repeating schedule?
 *
 * Exposed separately from {@link parseScheduleText} because it answers the
 * other half of the "reminder vs recurring task" question: the parser returns
 * the whole parse, while callers sometimes only need to know whether the user
 * asked for repetition at all.
 */
export function wantsRecurrence(raw: string): boolean {
  const text = normalizeScheduleText(raw);
  // Same clause coupling the parser applies: a frequency word only describes
  // THIS job when its own clause also says when. "هر روز ورزش میکنم، فردا ساعت ۸
  // یادم کن" is a one-shot, and answering "true" here would contradict the
  // parse the reminder is actually stored from.
  return splitClauses(text).some(clause =>
    recurrenceIn(clause) !== null
    && Boolean(readClock(clause) || findDuration(clause) || dayHintNear(clause, 0)),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   USER-FACING LABELS
   ══════════════════════════════════════════════════════════════════════════ */

const WEEKDAY_FA = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
function toFaDigits(s: string): string {
  return s.replace(/\d/g, d => FA_DIGITS[Number(d)]);
}

/**
 * Tehran-local calendar date as the user would read it.
 *
 * `nowMs` is a parameter (not `Date.now()`) so "tomorrow" in a label is
 * testable and never flickers between renders.
 */
export function formatLocalDate(ms: number, lang: string, nowMs: number, tzOffsetMinutes = TEHRAN_OFFSET_MINUTES): string {
  const clock = tehranClock(ms, tzOffsetMinutes);
  const today = tehranClock(nowMs, tzOffsetMinutes);
  const daysAway = Math.round(
    (Date.UTC(clock.year, clock.month - 1, clock.day)
      - Date.UTC(today.year, today.month - 1, today.day)) / DAY_MS,
  );
  if (lang === "fa") {
    if (daysAway === 0) return "امروز";
    if (daysAway === 1) return "فردا";
    if (daysAway === 2) return "پس‌فردا";
    return `${WEEKDAY_FA[clock.weekday]} ${toFaDigits(`${clock.year}/${String(clock.month).padStart(2, "0")}/${String(clock.day).padStart(2, "0")}`)}`;
  }
  if (daysAway === 0) return "today";
  if (daysAway === 1) return "tomorrow";
  if (daysAway === 2) return "the day after tomorrow";
  return `${WEEKDAY_EN[clock.weekday]} ${clock.year}-${String(clock.month).padStart(2, "0")}-${String(clock.day).padStart(2, "0")}`;
}

/** "17:00" in the user's script. ASCII for English, Persian digits for fa. */
export function formatClock(hour: number, minute: number, lang: string): string {
  const raw = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return lang === "fa" ? toFaDigits(raw) : raw;
}

/**
 * A single human-readable line for one schedule — used by the progress panel
 * and by the confirmation the model is told to send, so the user always sees
 * the SAME resolved time the job was stored with.
 */
export function describeScheduleForUser(
  dueAt: number,
  recurrence: RecurrenceRule | null,
  lang: string,
  nowMs: number = Date.now(),
  tzOffsetMinutes = TEHRAN_OFFSET_MINUTES,
): string {
  const clock = tehranClock(dueAt, tzOffsetMinutes);
  const time = formatClock(clock.hour, clock.minute, lang);
  const tzLabel = lang === "fa" ? "وقت تهران" : "Tehran time";
  if (!recurrence) {
    return lang === "fa"
      ? `${formatLocalDate(dueAt, lang, nowMs, tzOffsetMinutes)} ساعت ${time} (${tzLabel})`
      : `${formatLocalDate(dueAt, lang, nowMs, tzOffsetMinutes)} at ${time} (${tzLabel})`;
  }
  switch (recurrence.kind) {
    case "daily":
      return lang === "fa"
        ? `هر روز ساعت ${formatClock(recurrence.hour, recurrence.minute, lang)} (${tzLabel})`
        : `daily at ${formatClock(recurrence.hour, recurrence.minute, lang)} (${tzLabel})`;
    case "weekly":
      return lang === "fa"
        ? `هر ${WEEKDAY_FA[recurrence.weekday]} ساعت ${formatClock(recurrence.hour, recurrence.minute, lang)} (${tzLabel})`
        : `every ${WEEKDAY_EN[recurrence.weekday]} at ${formatClock(recurrence.hour, recurrence.minute, lang)} (${tzLabel})`;
    case "monthly":
      return lang === "fa"
        ? `هر ماه روز ${toFaDigits(String(recurrence.day))} ساعت ${formatClock(recurrence.hour, recurrence.minute, lang)} (${tzLabel})`
        : `monthly on day ${recurrence.day} at ${formatClock(recurrence.hour, recurrence.minute, lang)} (${tzLabel})`;
    case "interval": {
      const mins = Math.max(1, Math.round(recurrence.everyMinutes));
      const human = mins >= 1440 && mins % 1440 === 0
        ? (lang === "fa" ? `${toFaDigits(String(mins / 1440))} روز` : `${mins / 1440} day(s)`)
        : mins >= 60 && mins % 60 === 0
          ? (lang === "fa" ? `${toFaDigits(String(mins / 60))} ساعت` : `${mins / 60} hour(s)`)
          : (lang === "fa" ? `${toFaDigits(String(mins))} دقیقه` : `${mins} minute(s)`);
      return lang === "fa"
        ? `هر ${human} یک‌بار — اولین اجرا ${formatLocalDate(dueAt, lang, nowMs, tzOffsetMinutes)} ساعت ${time} (${tzLabel})`
        : `every ${human} — first run ${formatLocalDate(dueAt, lang, nowMs, tzOffsetMinutes)} at ${time} (${tzLabel})`;
    }
  }
}

/**
 * Chooses between the deterministic parse and the model's own answer.
 *
 * `high`-confidence parses are authoritative: the arithmetic is verifiable and
 * the model's value is only as good as its reading of "ساعت ۵". `medium` and
 * `low` parses (a bare "فردا", a recurrence word in another clause) fill in a
 * gap when the model gave nothing usable, but never overwrite it.
 */
export function reconcileSchedule(input: {
  text: string;
  nowMs: number;
  /** The model's ISO wall-clock value, already parsed, or null. */
  modelDueAt: number | null;
  /** The model's recurrence, or null. */
  modelRecurrence: RecurrenceRule | null;
  tzOffsetMinutes?: number;
}): {
  dueAt: number;
  recurrence: RecurrenceRule | null;
  /** Where the stored instant came from — surfaced to the model, not invented. */
  timeSource: "deterministic" | "deterministic-corrected" | "model" | "default";
  /** Where the recurrence came from. */
  repeatSource: "deterministic" | "model" | "none";
  parse: ScheduleParse | null;
} {
  const tz = input.tzOffsetMinutes ?? TEHRAN_OFFSET_MINUTES;
  const parse = parseScheduleText(input.text, input.nowMs, tz);
  const modelDueAt = input.modelDueAt !== null && Number.isFinite(input.modelDueAt) ? input.modelDueAt : null;

  let dueAt: number;
  let timeSource: "deterministic" | "deterministic-corrected" | "model" | "default";
  if (parse && parse.confidence === "high") {
    dueAt = parse.dueAt;
    // 30 minutes of slack absorbs the difference between "in an hour" computed
    // at tool time and the same phrase computed a moment earlier.
    const drifted = modelDueAt !== null && Math.abs(modelDueAt - dueAt) > 30 * MINUTE_MS;
    timeSource = drifted ? "deterministic-corrected" : "deterministic";
  } else if (modelDueAt !== null) {
    dueAt = modelDueAt;
    timeSource = "model";
  } else if (parse) {
    dueAt = parse.dueAt;
    timeSource = "deterministic";
  } else {
    dueAt = input.nowMs + 5 * MINUTE_MS;
    timeSource = "default";
  }
  if (dueAt <= input.nowMs) dueAt = input.nowMs + MINUTE_MS;

  // Recurrence: the wording wins when it is explicit, because a one-shot job
  // created from "every day at 9am" fires exactly once and is never rescheduled.
  let recurrence = input.modelRecurrence;
  let repeatSource: "deterministic" | "model" | "none" = recurrence ? "model" : "none";
  if (parse?.recurrence) {
    recurrence = parse.recurrence;
    repeatSource = "deterministic";
  } else if (recurrence) {
    // The model asked for a repeat the text does not state. Keep it, but the
    // instant it repeats from must be a real occurrence of its own rule.
    const next = computeNextOccurrence(recurrence, input.nowMs);
    if (next !== null && next !== undefined) dueAt = next;
  }

  return { dueAt, recurrence, timeSource, repeatSource, parse };
}
