/** D1 quota protection shared by every SQL writer in an isolate. No storage writes of its own. */
export class StorageBackpressureError extends Error {
  constructor() { super("STORAGE_WRITE_BACKPRESSURE"); }
}
export class WriteGovernor {
  blockedUntil = 0;
  reason: "daily_quota" | "transient" | null = null;
  rejected = 0;
  writes = 0;
  rowsWritten = 0;
  optionalSkipped = 0;
  private failures = 0;
  private now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  get available(): boolean { return this.now() >= this.blockedUntil; }
  assertAvailable(): void {
    if (!this.available) { this.rejected++; throw new StorageBackpressureError(); }
  }
  optional(): boolean {
    if (this.available) return true;
    this.optionalSkipped++;
    return false;
  }
  success(result: unknown): void {
    this.writes++;
    this.rowsWritten += Number((result as { meta?: { rows_written?: number; changes?: number } })?.meta?.rows_written
      ?? (result as { meta?: { changes?: number } })?.meta?.changes ?? 0);
    if (this.available) { this.failures = 0; this.reason = null; }
  }
  failure(error: unknown): void {
    const text = String(error).toLowerCase();
    if (/daily.*(row.*write|write.*limit)|exceeded.*free tier|daily.*quota/.test(text)) {
      this.reason = "daily_quota";
      this.blockedUntil = Math.floor(this.now() / 86_400_000 + 1) * 86_400_000 + 60_000;
    } else if (/d1.*(busy|overload)|sqlite_busy|too many requests|temporar|timeout/.test(text)) {
      this.reason = "transient";
      this.blockedUntil = this.now() + Math.min(60_000, 1000 * 2 ** Math.min(++this.failures, 6));
    }
  }
  snapshot() {
    return { scope: "isolate", available: this.available, reason: this.available ? null : this.reason,
      retryAt: this.available ? null : this.blockedUntil, writes: this.writes, rowsWritten: this.rowsWritten,
      rejected: this.rejected, optionalSkipped: this.optionalSkipped };
  }
}

const governors = new WeakMap<object, WriteGovernor>();
const wrappers = new WeakMap<object, object>();
export function storageGovernor(db: object): WriteGovernor {
  let governor = governors.get(db);
  if (!governor) { governor = new WriteGovernor(); governors.set(db, governor); }
  return governor;
}

/** Proxy preserves the native binding interface, including transactional batch(). */
export function governDatabase<T extends object>(db: T): T {
  const previous = wrappers.get(db);
  if (previous) return previous as T;
  const governor = storageGovernor(db);
  const nativeStatements = new WeakMap<object, object>();
  const write = async (work: () => Promise<unknown>) => {
    governor.assertAvailable();
    try {
      const result = await work();
      for (const item of Array.isArray(result) ? result : [result]) governor.success(item);
      return result;
    } catch (e) { governor.failure(e); throw e; }
  };
  const statement = (native: any): any => {
    const proxy = new Proxy(native, { get(target, prop) {
      if (prop === "bind") return (...args: unknown[]) => statement(target.bind(...args));
      if (prop === "run") return () => write(() => target.run());
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    nativeStatements.set(proxy, native);
    return proxy;
  };
  const proxy = new Proxy(db, { get(target: any, prop) {
    if (prop === "prepare") return (sql: string) => statement(target.prepare(sql));
    if (prop === "batch" && target.batch) return (items: object[]) => write(() => target.batch(items.map(s => nativeStatements.get(s) ?? s)));
    if (prop === "exec" && target.exec) return (sql: string) => write(() => target.exec(sql));
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  governors.set(proxy, governor);
  wrappers.set(db, proxy); wrappers.set(proxy, proxy);
  return proxy;
}

/** Small keyed cooldown for repeated warnings/notices; bounded independently of traffic. */
export class NoticeGate {
  private entries = new Map<string, number>();
  allow(key: string, intervalMs = 30_000, now = Date.now()): boolean {
    if ((this.entries.get(key) ?? 0) > now) return false;
    this.entries.delete(key); this.entries.set(key, now + intervalMs);
    if (this.entries.size > 512) this.entries.delete(this.entries.keys().next().value!);
    return true;
  }
}

/** Error details stay in logs; normal chat sees a stable, actionable category. */
export function friendlyFailure(error: unknown, lang: string): string {
  const text = String(error).toLowerCase();
  const category = /storage|d1|sqlite|write.*limit/.test(text) ? "storage"
    : /quota|429|rate.?limit|busy|capacity/.test(text) ? "busy"
    : /timeout|network|connection|fetch/.test(text) ? "network" : "failed";
  const fa: Record<string, string> = { storage: "ذخیره‌سازی موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.", busy: "سرویس فعلاً شلوغ است؛ کمی بعد دوباره تلاش کن.", network: "ارتباط با سرویس کامل نشد؛ دوباره تلاش کن.", failed: "این بخش از کار کامل نشد؛ می‌توانی دوباره تلاش کنی." };
  const en: Record<string, string> = { storage: "Storage is temporarily unavailable. Please try again later.", busy: "The service is busy. Please try again shortly.", network: "The service could not be reached. Please try again.", failed: "This part of the work did not finish. Please try again." };
  return (lang === "fa" ? fa : en)[category];
}
