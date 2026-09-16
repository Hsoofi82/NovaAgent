/** Bounded lexical retrieval for durable user facts. No extra model or database calls. */
const STOP_WORDS = new Set("the a an and or is are was were to for of in on with my me you your please about this that what how i من تو شما این اون آن را رو با به از که یک برای لطفا چطور چیست".split(" "));
function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک")
    .replace(/[\u064b-\u065f\u0670]/g, "").replace(/\u200c/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(text: string): Set<string> {
  return new Set((normalize(text).match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length > 1 && !STOP_WORDS.has(word)));
}

export function selectMemoryEntries(entries: readonly string[] | undefined, query: string, limit: number, maxChars = 900): string[] {
  const terms = tokens(query.slice(0, 4000));
  const seen = new Set<string>();
  const ranked: Array<{ text: string; score: number; index: number; words: Set<string> }> = [];
  const source = (entries ?? []).slice(-300);
  for (let index = source.length - 1; index >= 0; index--) {
    if (typeof source[index] !== "string") continue;
    const text = source[index].trim().slice(0, 600);
    const key = normalize(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    const words = tokens(text);
    ranked.push({ text, score: 0, index, words });
  }
  // Rare matching terms carry more information than a common topic word.
  const frequencies = new Map<string, number>();
  for (const term of terms) frequencies.set(term, ranked.reduce((n, r) => n + Number(r.words.has(term)), 0));
  for (const entry of ranked) {
    for (const term of terms) if (entry.words.has(term)) {
      entry.score += Math.log(1 + (ranked.length + 1) / (frequencies.get(term)! + 0.5)) / (0.8 + entry.words.size / 40);
    }
    if (entry.score > 0) entry.score += importance(entry.text) * 0.15;
  }
  ranked.sort((a, b) => b.score - a.score || b.index - a.index);
  const out: string[] = [];
  let used = 0;
  for (const entry of ranked) {
    if (out.length >= limit) break;
    if (used + entry.text.length + (out.length ? 2 : 0) > maxChars) continue;
    out.push(entry.text);
    used += entry.text.length + (out.length > 1 ? 2 : 0);
  }
  return out;
}

function importance(text: string): number {
  if (/\b(always|never|prefer|allerg|deadline|project)\b|همیشه|هرگز|ترجیح|حساسیت|پروژه|مهلت/i.test(text)) return 2;
  return 1;
}

/** New facts must be able to displace old ones once a profile reaches its cap. */
export function mergeMemoryEntries(existing: readonly string[], incoming: unknown, cap: number): string[] {
  if (!Array.isArray(incoming)) return [...existing];
  const unique = new Map<string, { text: string; order: number }>();
  for (const raw of [...existing, ...incoming].slice(-300)) {
    if (typeof raw !== "string") continue;
    const text = raw.trim().replace(/\s+/g, " ").slice(0, 400);
    if (!text) continue;
    const key = normalize(text);
    // Identical extractions should not reorder the profile or trigger a write.
    if (!unique.has(key)) unique.set(key, { text, order: unique.size });
  }
  return [...unique.values()].sort((a, b) => importance(b.text) - importance(a.text) || b.order - a.order)
    .slice(0, Math.max(0, cap)).sort((a, b) => a.order - b.order).map(e => e.text);
}

export function hasDurableMemorySignal(text: string): boolean {
  return /\b(i am|i'm|my |i prefer|i use|remember|from now on|always|never|deadline)\b|من |اسمم|نامم|ترجیح|یادت|همیشه|از این به بعد|پروژه|مهلت|کارم|شغلم/i.test(text);
}
