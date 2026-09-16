/**
 * Hosted-deployment lifecycle.
 *
 * WHAT THIS FIXES
 * ───────────────
 * Generated apps were "deployed" by writing `app:<name>` plus an `app_meta:`
 * blob into the D1-backed KV. The metadata carried an `expiresAt`, but **nothing
 * ever read it**: the `/app/<name>` route served the document for as long as the
 * key existed, and no sweep ever removed it. A "temporary" hosting promise was
 * therefore enforced by a field nobody consumed, which is exactly the failure
 * mode the product brief called out ("the deployment must actually disappear
 * after expiration").
 *
 * This module owns the lifecycle as data:
 *
 *   · `ttlForPlan` — normal users 3 days, Pro 7 days. One place, so the HTTP
 *     layer, the tool layer and the dashboard cannot disagree.
 *   · `deploymentFacts` — the single derivation of status / remaining lifetime
 *     that both the API and the UI render, so a badge can never claim "live"
 *     for something the server would refuse to serve.
 *   · `isServable` — the enforcement predicate used on every request.
 *   · `selectExpired` — the bounded cleanup set the cron sweep drains. It works
 *     from persisted state only (a D1 row), so cleanup is correct even when the
 *     isolate that created the deployment is long gone.
 *   · `canManage` / `extendDeployment` — ownership and plan gating for the
 *     delete/extend actions.
 *
 * Deliberately pure: no `env`, no I/O, no module state.
 */

export type DeployPlan = "free" | "pro";
export type DeploymentStatus = "draft" | "live" | "expired" | "deleted";

/** Normal users: 3 days. */
export const FREE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** Pro users: 7 days. */
export const PRO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A Pro user may extend; each extension adds this much, bounded. */
export const PRO_EXTENSION_MS = 24 * 60 * 60 * 1000;
export const MAX_EXTENSIONS = 2;
/** Expired rows are kept for the owner's history, then purged. */
export const EXPIRED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Hard cap per sweep, so a cron tick can never run a full scan. */
export const CLEANUP_BATCH = 25;

export interface DeploymentRecord {
  /** Public slug — also the `/app/<id>` path and the KV key. */
  id: string;
  ownerId: number;
  ownerName: string;
  title: string;
  kind: "webapp" | "game" | "document";
  /** Persisted lifecycle state. `draft` = source delivered, not hosted yet. */
  status: DeploymentStatus;
  /** The plan the TTL was granted under; kept so the UI can explain the limit. */
  plan: DeployPlan;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  /** Null only for a draft that has never been activated. */
  expiresAt: number | null;
  extensions: number;
  viewCount: number;
  lastViewedAt: number | null;
  lastError?: string | null;
}

export interface DeploymentFacts {
  status: DeploymentStatus;
  /** True only while the server would actually serve the URL. */
  servable: boolean;
  expiresAt: number | null;
  remainingMs: number;
  /** Whole hours left, floored — what the UI shows. */
  remainingHours: number;
  /** True when < 12h remain, so the UI can warn before it disappears. */
  expiringSoon: boolean;
  canExtend: boolean;
  extensionsLeft: number;
}

export function ttlForPlan(plan: DeployPlan): number {
  return plan === "pro" ? PRO_TTL_MS : FREE_TTL_MS;
}

export function planFor(isPro: boolean): DeployPlan {
  return isPro ? "pro" : "free";
}

/** Only the owner may act on a deployment. */
export function canManage(record: Pick<DeploymentRecord, "ownerId"> | null | undefined, userId: number): boolean {
  return Boolean(record && Number(record.ownerId) === Number(userId));
}

export function canExtend(record: Pick<DeploymentRecord, "plan" | "status" | "extensions">): boolean {
  return record.plan === "pro"
    && record.status === "live"
    && record.extensions < MAX_EXTENSIONS;
}

/**
 * The ONE predicate the HTTP layer must call before serving a slug.
 *
 * `expiresAt === null` on a live row is treated as expired, not as "forever":
 * an unbounded deployment could only come from legacy data, and honouring it
 * would contradict the product's temporary-hosting contract.
 */
export function isServable(record: Pick<DeploymentRecord, "status" | "expiresAt"> | null | undefined, now: number): boolean {
  if (!record) return false;
  if (record.status !== "live") return false;
  if (record.expiresAt === null || !Number.isFinite(record.expiresAt)) return false;
  return record.expiresAt > now;
}

/** The single derivation the API and every dashboard render from. */
export function deploymentFacts(record: DeploymentRecord, now: number): DeploymentFacts {
  const servable = isServable(record, now);
  const expiresAt = record.expiresAt ?? null;
  const remainingMs = servable && expiresAt !== null ? Math.max(0, expiresAt - now) : 0;
  const expired = record.status === "live" && !servable;
  return {
    status: expired ? "expired" : record.status,
    servable,
    expiresAt,
    remainingMs,
    remainingHours: Math.floor(remainingMs / 3_600_000),
    expiringSoon: servable && remainingMs < 12 * 3_600_000,
    canExtend: canExtend(record),
    extensionsLeft: Math.max(0, MAX_EXTENSIONS - record.extensions),
  };
}

export interface ExtendResult {
  ok: boolean;
  reason?: "plan" | "not-live" | "exhausted";
  expiresAt?: number;
}

/** Plan-gated extension. Pro only, at most {@link MAX_EXTENSIONS} times. */
export function extendDeployment(record: DeploymentRecord, now: number): ExtendResult {
  if (record.status !== "live") return { ok: false, reason: "not-live" };
  if (record.plan !== "pro") return { ok: false, reason: "plan" };
  if (record.extensions >= MAX_EXTENSIONS) return { ok: false, reason: "exhausted" };
  const from = Math.max(record.expiresAt ?? now, now);
  const expiresAt = from + PRO_EXTENSION_MS;
  record.expiresAt = expiresAt;
  record.extensions += 1;
  record.updatedAt = now;
  return { ok: true, expiresAt };
}

/** Activating a draft grants the plan TTL from *now*, never from creation. */
export function activationExpiry(plan: DeployPlan, now: number): number {
  return now + ttlForPlan(plan);
}

/** Rows that expired but were never swept. Bounded, newest-expiry first. */
export function selectExpired(records: readonly DeploymentRecord[], now: number, limit = CLEANUP_BATCH): DeploymentRecord[] {
  return records
    .filter(record => record.status === "live" && (record.expiresAt === null || record.expiresAt <= now))
    .sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0))
    .slice(0, Math.max(0, limit));
}

/** Old expired/deleted rows safe to forget entirely. */
export function selectPurgeable(records: readonly DeploymentRecord[], now: number, limit = CLEANUP_BATCH): string[] {
  return records
    .filter(record => (record.status === "expired" || record.status === "deleted")
      && record.updatedAt <= now - EXPIRED_RETENTION_MS)
    .slice(0, Math.max(0, limit))
    .map(record => record.id);
}

/**
 * One-time migration of a legacy `app_meta:` blob into a deployment record.
 *
 * Legacy rows were written with `expiresAt = null` for VIP owners (unbounded).
 * Honouring `null` forever would keep the promise broken, so an unbounded legacy
 * row is granted one final Pro-length window from now; a row that already has a
 * timestamp keeps it, which is the honest reading of what was stored.
 */
export function migrateLegacyMeta(
  meta: { name: string; createdAt: number; createdBy: number; createdByName?: string; size?: number; viewCount?: number; expiresAt?: number | null; description?: string },
  now: number,
): DeploymentRecord {
  const createdAt = Number.isFinite(meta.createdAt) && meta.createdAt > 0 ? meta.createdAt : now;
  const stored = typeof meta.expiresAt === "number" && Number.isFinite(meta.expiresAt) ? meta.expiresAt : null;
  const expiresAt = stored ?? Math.max(now + PRO_TTL_MS, createdAt + ttlForPlan("pro"));
  return {
    id: String(meta.name),
    ownerId: Number(meta.createdBy) || 0,
    ownerName: String(meta.createdByName ?? ""),
    title: String(meta.description ?? meta.name ?? "app"),
    kind: "webapp",
    // A legacy row that is already past its expiry is created already-expired:
    // it must not be served, and the sweep below will remove it.
    status: "live",
    plan: stored === null ? "pro" : "free",
    sizeBytes: Number(meta.size) || 0,
    createdAt,
    updatedAt: now,
    expiresAt,
    extensions: 0,
    viewCount: Number(meta.viewCount) || 0,
    lastViewedAt: null,
    lastError: null,
  };
}

export function safeSlug(value: unknown, fallback = "app"): string {
  const slug = String(value ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return slug || `${fallback}_${Date.now().toString(36)}`;
}

/** "2d 4h" / "۲ روز و ۴ ساعت" — the remaining lifetime, for receipts and the UI. */
export function formatRemaining(remainingMs: number, lang: string): string {
  const fa = lang === "fa";
  if (remainingMs <= 0) return fa ? "منقضی شده" : "expired";
  const days = Math.floor(remainingMs / 86_400_000);
  const hours = Math.floor((remainingMs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  if (fa) {
    if (days > 0) return `${days} روز و ${hours} ساعت`;
    if (hours > 0) return `${hours} ساعت و ${minutes} دقیقه`;
    return `${Math.max(1, minutes)} دقیقه`;
  }
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

export function formatPlanLimit(plan: DeployPlan, lang: string): string {
  const days = plan === "pro" ? 7 : 3;
  return lang === "fa" ? `${days} روز` : `${days} days`;
}
