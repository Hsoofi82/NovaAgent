import type { AgentRun } from "./agentRuntime";
import { storageGovernor } from "./storageHealth";

// Small structural interface keeps storage testable without a Worker environment.
export interface OperationsDB {
  prepare(sql: string): {
    bind(...values: unknown[]): ReturnType<OperationsDB["prepare"]>;
    run(): Promise<unknown>;
    all<T = unknown>(): Promise<{ results?: T[] }>;
    first<T = unknown>(): Promise<T | null>;
  };
}
const schemas = new WeakMap<OperationsDB, Promise<void>>();
const pendingRuns = new WeakMap<AgentRun, { chatId: number; userId: number; source: string; durable: boolean }>();
const summaryCache = new WeakMap<OperationsDB, { until: number; value: unknown }>();
export function ensureOperationsSchema(db: OperationsDB): Promise<void> {
  const previous = schemas.get(db);
  if (previous) return previous;
  const pending = (async () => {
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY, chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
        source TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER,
        deadline INTEGER NOT NULL, status TEXT NOT NULL, rounds INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0, model_calls INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0, events TEXT NOT NULL DEFAULT '[]')`,
      `CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at DESC, id DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status, started_at DESC, id DESC)`,
      `CREATE TABLE IF NOT EXISTS admin_audit (
        id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL, action TEXT NOT NULL,
        status_code INTEGER NOT NULL, ts INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_admin_audit_ts ON admin_audit(ts DESC, id DESC)`,
    ]) await db.prepare(sql).run();
  })().catch(error => { schemas.delete(db); throw error; });
  schemas.set(db, pending);
  return pending;
}

export async function startRun(db: OperationsDB, run: AgentRun, chatId: number, userId: number, source: string): Promise<void> {
  const meta = { chatId, userId, source, durable: source === "scheduled" };
  pendingRuns.set(run, meta);
  // Interactive runs cost one final INSERT, not INSERT + UPDATE of every index.
  // Scheduled jobs retain durable in-flight tracking for crash diagnosis.
  if (!meta.durable || !storageGovernor(db).optional()) return;
  await ensureOperationsSchema(db);
  try {
    await db.prepare(`INSERT INTO agent_runs(id, chat_id, user_id, source, started_at, deadline, status)
      VALUES(?, ?, ?, ?, ?, ?, 'running')`).bind(run.id, chatId, userId, source, run.startedAt, run.deadline).run();
  } catch (e) { meta.durable = false; throw e; }
}
export async function finishRun(db: OperationsDB, run: AgentRun): Promise<void> {
  const meta = pendingRuns.get(run);
  pendingRuns.delete(run);
  if (!meta || !storageGovernor(db).optional()) return;
  // Ordinary successful chat already contributes to in-memory runtime metrics.
  // Persist tool executions and exceptions, not another indexed row per greeting.
  if(!meta.durable&&run.status==="completed"&&run.toolCalls===0)return;
  await ensureOperationsSchema(db);
  if (!meta.durable) {
    await db.prepare(`INSERT INTO agent_runs(id, chat_id, user_id, source, started_at, deadline, finished_at,
      status, rounds, tool_calls, model_calls, failures, events) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(run.id, meta.chatId, meta.userId, meta.source, run.startedAt, run.deadline, Date.now(), run.status,
        run.rounds, run.toolCalls, run.modelCalls, run.failures, JSON.stringify(run.events)).run();
    return;
  }
  await db.prepare(`UPDATE agent_runs SET finished_at = ?, status = ?, rounds = ?, tool_calls = ?,
    model_calls = ?, failures = ?, events = ? WHERE id = ?`).bind(Date.now(), run.status, run.rounds,
    run.toolCalls, run.modelCalls, run.failures, JSON.stringify(run.events), run.id).run();
}

export async function recordAdminAudit(db: OperationsDB, actorId: number, action: string, status: number): Promise<void> {
  await ensureOperationsSchema(db);
  // Only the route is stored; request bodies may contain private prompts or credentials.
  await db.prepare(`INSERT INTO admin_audit(id, actor_id, action, status_code, ts) VALUES(?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), actorId, action.slice(0, 160), status, Date.now()).run();
}

export async function operationsAPI(db: OperationsDB, path: string, url: URL): Promise<unknown | null> {
  if (!["runs", "runs/summary", "audit"].includes(path) && !/^runs\/[\w-]{36}$/.test(path)) return null;
  await ensureOperationsSchema(db);
  const now = Date.now();
  if (path === "runs/summary") {
    const cached = summaryCache.get(db);
    if (cached && cached.until > now) return cached.value;
    const data = await db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'running' AND deadline >= ? THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status = 'running' AND deadline < ? THEN 1 ELSE 0 END) AS interrupted,
      COALESCE(AVG(CASE WHEN finished_at IS NOT NULL THEN finished_at - started_at END), 0) AS avg_ms,
      COALESCE(SUM(tool_calls), 0) AS tool_calls, COALESCE(SUM(model_calls), 0) AS model_calls
      FROM agent_runs WHERE started_at >= ?`).bind(now, now, now - 86_400_000).first();
    const series = await db.prepare(`SELECT CAST(started_at / 3600000 AS INTEGER) * 3600000 AS hour,
      COUNT(*) AS total, SUM(CASE WHEN status IN ('failed', 'partial') THEN 1 ELSE 0 END) AS errors
      FROM agent_runs WHERE started_at >= ? GROUP BY hour ORDER BY hour`).bind(now - 86_400_000).all();
    const value = { ok: true, scope: "tool_and_exception_runs_24h", inProgressTracking: "scheduled_only", generatedAt: now,
      storage: storageGovernor(db).snapshot(), summary: data, series: series.results ?? [] };
    summaryCache.set(db, { until: now + 15_000, value });
    return value;
  }
  if (path.startsWith("runs/")) {
    const run = await db.prepare(`SELECT * FROM agent_runs WHERE id = ?`).bind(path.slice(5)).first<{ events: string }>();
    return { ok: true, run: run ? { ...run, events: JSON.parse(run.events) } : null };
  }
  const limit = Math.min(50, Math.max(1, Math.trunc(Number(url.searchParams.get("limit")) || 25)));
  const cursor = url.searchParams.get("cursor") || "";
  let before = Number.MAX_SAFE_INTEGER, id = "\uffff";
  if (cursor) {
    const match = /^(\d{1,16}):([\w-]{36})$/.exec(cursor);
    if (!match) return { ok: false, error: "invalid_cursor" };
    before = Number(match[1]); id = match[2];
  }
  const audit = path === "audit";
  const table = path === "runs" ? "agent_runs" : "admin_audit";
  const ts = audit ? "ts" : "started_at";
  const status = url.searchParams.get("status") || "";
  const validStatus = ["running", "completed", "partial", "failed", "cancelled", "interrupted"].includes(status);
  const filter = !audit && validStatus ? status === "interrupted" ? " AND status = 'running' AND deadline < ?"
    : status === "running" ? " AND status = 'running' AND deadline >= ?" : " AND status = ?" : "";
  const values: unknown[] = [before, before, id];
  if (filter) values.push(["interrupted", "running"].includes(status) ? now : status);
  values.push(limit + 1);
  const columns = audit ? "*" : "id, chat_id, user_id, source, started_at, finished_at, deadline, status, rounds, tool_calls, model_calls, failures";
  const result = await db.prepare(`SELECT ${columns} FROM ${table} WHERE (${ts} < ? OR (${ts} = ? AND id < ?))${filter}
    ORDER BY ${ts} DESC, id DESC LIMIT ?`).bind(...values).all<Record<string, unknown>>();
  const rows = result.results ?? [];
  const items: Record<string, unknown>[] = rows.slice(0, limit).map(row => ({ ...row,
    ...(!audit && row.status === "running" && Number(row.deadline) < now ? { status: "interrupted" } : {}),
  }));
  const last = items[items.length - 1];
  return { ok: true, items, cursor: rows.length > limit && last ? `${last[ts]}:${last.id}` : null };
}

export async function cleanupOperations(db: OperationsDB): Promise<void> {
  if (!storageGovernor(db).optional()) return;
  await ensureOperationsSchema(db);
  for (const [table, ts, days] of [["agent_runs", "started_at", 14], ["admin_audit", "ts", 90]] as const) {
    await db.prepare(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${ts} < ? LIMIT 200)`)
      .bind(Date.now() - days * 86_400_000).run();
  }
}
