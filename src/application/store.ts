import type { OperationsDB } from "../operations";
import { storageGovernor } from "../storageHealth";
import { BUILD_LEASE_MS, MAX_PROJECTS_PER_USER, MAX_STORED_PROJECTS_PER_USER, sha256, type AppSpec, type AppTarget, type BuildArtifact, type BuildStatus } from "./protocol.ts";

export interface FactoryDB extends OperationsDB { batch?(statements: ReturnType<OperationsDB["prepare"]>[]): Promise<unknown[]> }
export interface ProjectRow { id: string; owner_id: number; scope: string; title: string; head: string; draft: string; archived_at: number | null; created_at: number; updated_at: number }
export interface BuildRow {
  id: string; project_id: string; owner_id: number; chat_id: number; target: AppTarget; status: BuildStatus;
  base_revision: string; revision: string; instruction: string; context: string; request_key: string;
  lease_token: string; lease_until: number; repairs: number; claims: number; generation_count: number;
  generation_lock_until: number;
  diagnostics: string; artifacts: string; created_at: number; updated_at: number;
}
const schemas = new WeakMap<object, Promise<void>>();
const recoveryTimes = new WeakMap<object, number>();
export function changed(result: unknown): boolean { return Number((result as { meta?: { changes?: number } })?.meta?.changes ?? 0) > 0; }
export class FactoryStore {
  readonly db: FactoryDB; readonly bucket: R2Bucket;
  constructor(db: FactoryDB, bucket: R2Bucket) { this.db = db; this.bucket = bucket; }
  async ready(): Promise<void> {
    let pending = schemas.get(this.db);
    if (!pending) {
      pending = (async () => {
        for (const sql of [
          `CREATE TABLE IF NOT EXISTS app_projects(id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, scope TEXT NOT NULL,
            title TEXT NOT NULL, head TEXT NOT NULL DEFAULT '', draft TEXT NOT NULL, archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
          `CREATE INDEX IF NOT EXISTS idx_app_projects_owner ON app_projects(owner_id, updated_at DESC)`,
          `CREATE TABLE IF NOT EXISTS app_context(owner_id INTEGER NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL, PRIMARY KEY(owner_id,scope))`,
          `CREATE TABLE IF NOT EXISTS app_build_workers(worker_id TEXT NOT NULL,target TEXT NOT NULL,last_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(worker_id,target))`,
          `CREATE TABLE IF NOT EXISTS app_builds(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, owner_id INTEGER NOT NULL, chat_id INTEGER NOT NULL,
            target TEXT NOT NULL, status TEXT NOT NULL, base_revision TEXT NOT NULL, revision TEXT NOT NULL,
            instruction TEXT NOT NULL, context TEXT NOT NULL DEFAULT '', request_key TEXT NOT NULL,
            lease_token TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0, repairs INTEGER NOT NULL DEFAULT 0,
            claims INTEGER NOT NULL DEFAULT 0, generation_count INTEGER NOT NULL DEFAULT 0, generation_lock_until INTEGER NOT NULL DEFAULT 0,
            diagnostics TEXT NOT NULL DEFAULT '', artifacts TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            UNIQUE(project_id,request_key))`,
          `CREATE INDEX IF NOT EXISTS idx_app_builds_queue ON app_builds(status, target, created_at)`,
          `CREATE INDEX IF NOT EXISTS idx_app_builds_project ON app_builds(project_id, created_at DESC)`,
          `CREATE INDEX IF NOT EXISTS idx_app_builds_owner ON app_builds(owner_id, created_at DESC)`,
          `CREATE INDEX IF NOT EXISTS idx_app_builds_created ON app_builds(created_at)`,
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_app_one_active ON app_builds(project_id) WHERE status IN ('queued','generating','building','repairing')`,
          `CREATE TABLE IF NOT EXISTS app_artifacts(build_id TEXT NOT NULL, name TEXT NOT NULL, object_key TEXT NOT NULL,
            bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, kind TEXT NOT NULL, signing TEXT NOT NULL, lease_token TEXT NOT NULL, revision TEXT NOT NULL,
            PRIMARY KEY(build_id,name))`,
        ]) await this.db.prepare(sql).run();
        const columns=await this.db.prepare("PRAGMA table_info(app_projects)").all<{name:string}>();
        if(!columns.results?.some(column=>column.name==="archived_at"))await this.db.prepare("ALTER TABLE app_projects ADD COLUMN archived_at INTEGER").run()
          .catch(error=>{if(!/duplicate column/i.test(String(error)))throw error;});
        await this.db.prepare("CREATE INDEX IF NOT EXISTS idx_app_projects_archived ON app_projects(archived_at) WHERE archived_at IS NOT NULL").run();
      })().catch(e => { schemas.delete(this.db); throw e; });
      schemas.set(this.db, pending);
    }
    await pending;
  }
  async putSnapshot(projectId: string, spec: AppSpec): Promise<string> {
    storageGovernor(this.db).assertAvailable();
    const json = JSON.stringify(spec), hash = await sha256(json);
    await this.bucket.put(`factory/projects/${projectId}/${hash}.json`, json, { httpMetadata: { contentType: "application/json" } });
    return hash;
  }
  async workerSeen(workerId: string, targets: AppTarget[]): Promise<void> {
    await this.ready();const now=Date.now();
    for(const target of targets)await this.db.prepare(`INSERT INTO app_build_workers(worker_id,target,last_seen,expires_at) VALUES(?,?,?,?)
      ON CONFLICT(worker_id,target) DO UPDATE SET last_seen=excluded.last_seen,expires_at=excluded.expires_at WHERE app_build_workers.last_seen < ?`)
      .bind(workerId,target,now,now+180_000,now-60_000).run();
  }
  async onlineTargets(): Promise<AppTarget[]> {
    await this.ready();
    const rows=await this.db.prepare("SELECT DISTINCT target FROM app_build_workers WHERE expires_at>? AND target IN ('android-apk','android-aab','windows')").bind(Date.now()).all<{target:AppTarget}>();
    return (rows.results??[]).map(row=>row.target);
  }
  async recoverStalled(): Promise<void> {
    const now=Date.now();if(now-(recoveryTimes.get(this.db)??0)<30_000)return;
    await this.ready();
    await this.db.prepare(`UPDATE app_builds SET status='failed',lease_token='',lease_until=0,updated_at=?,diagnostics='The external build did not finish within its time limit.'
      WHERE id IN (SELECT id FROM app_builds WHERE status IN ('queued','generating','building','repairing') AND
        (target NOT IN ('android-apk','android-aab','windows') OR (status='queued' AND created_at<?) OR created_at<? OR (status!='queued' AND lease_until<? AND claims>=3)) LIMIT 20)`)
      .bind(now,now-15*60_000,now-60*60_000,now).run();
    recoveryTimes.set(this.db,now);
  }
  async snapshot(projectId: string, revision: string): Promise<AppSpec> {
    if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("INVALID_REVISION");
    const object = await this.bucket.get(`factory/projects/${projectId}/${revision}.json`);
    if (!object) throw new Error("PROJECT_SNAPSHOT_MISSING");
    return object.json<AppSpec>();
  }
  async project(id: string, ownerId: number, includeArchived=false): Promise<ProjectRow | null> {
    await this.ready();
    return this.db.prepare(`SELECT * FROM app_projects WHERE id = ? AND owner_id = ? ${includeArchived?"":"AND archived_at IS NULL"}`).bind(id, ownerId).first<ProjectRow>();
  }
  async activeProject(ownerId: number, scope: string): Promise<ProjectRow | null> {
    await this.ready();
    return this.db.prepare(`SELECT p.* FROM app_projects p JOIN app_context c ON p.id = c.project_id
      WHERE c.owner_id = ? AND c.scope = ? AND p.owner_id = ? AND p.archived_at IS NULL`).bind(ownerId, scope, ownerId).first<ProjectRow>();
  }
  async selectProject(project: ProjectRow, scope: string): Promise<void> {
    await this.db.prepare(`INSERT INTO app_context(owner_id,scope,project_id) VALUES(?,?,?)
      ON CONFLICT(owner_id,scope) DO UPDATE SET project_id=excluded.project_id
      WHERE app_context.project_id IS NOT excluded.project_id`).bind(project.owner_id, scope, project.id).run();
  }
  async createProject(ownerId: number, scope: string, title: string, spec: AppSpec, id: string): Promise<ProjectRow> {
    await this.ready();
    const count=await this.db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS active FROM app_projects WHERE owner_id=?").bind(ownerId).first<{total:number;active:number}>();
    if(Number(count?.active??0)>=MAX_PROJECTS_PER_USER||Number(count?.total??0)>=MAX_STORED_PROJECTS_PER_USER)throw new Error("PROJECT_LIMIT_REACHED");
    const now = Date.now(), revision = await this.putSnapshot(id, spec);
    const result = await this.db.prepare(`INSERT INTO app_projects(id,owner_id,scope,title,draft,created_at,updated_at)
      SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM app_projects WHERE owner_id = ? AND archived_at IS NULL) < ?
      AND (SELECT COUNT(*) FROM app_projects WHERE owner_id=?) < ?`)
      .bind(id, ownerId, scope, title, revision, now, now, ownerId, MAX_PROJECTS_PER_USER,ownerId,MAX_STORED_PROJECTS_PER_USER).run();
    if (!changed(result)) {
      if(!await this.project(id,ownerId))await this.bucket.delete(`factory/projects/${id}/${revision}.json`);
      throw new Error("PROJECT_LIMIT_REACHED");
    }
    const project = (await this.project(id, ownerId))!;
    await this.selectProject(project, scope);
    return project;
  }
  async enqueue(project: ProjectRow, target: AppTarget, instruction: string, context: string, chatId: number, requestKey: string): Promise<BuildRow> {
    const prior = await this.db.prepare("SELECT * FROM app_builds WHERE project_id = ? AND request_key = ?").bind(project.id, requestKey).first<BuildRow>();
    if (prior) {
      if(prior.target!==target||prior.instruction!==instruction.slice(0,6000))throw new Error("IDEMPOTENCY_CONFLICT");
      return prior;
    }
    const running = await this.db.prepare("SELECT id FROM app_builds WHERE project_id = ? AND status IN ('queued','generating','building','repairing')").bind(project.id).first();
    if (running) throw new Error("PROJECT_BUILD_IN_PROGRESS");
    const id = crypto.randomUUID(), now = Date.now();
    try {
      const result = await this.db.prepare(`INSERT INTO app_builds(id,project_id,owner_id,chat_id,target,status,base_revision,revision,instruction,context,request_key,created_at,updated_at)
        SELECT ?,?,?,?,?,'queued',?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM app_builds WHERE owner_id=? AND created_at>=?) < 6
        AND EXISTS(SELECT 1 FROM app_projects WHERE id=? AND head=? AND draft=? AND archived_at IS NULL)`)
        .bind(id, project.id, project.owner_id, chatId, target,
          project.head, project.draft, instruction.slice(0,6000), context.slice(0,14000), requestKey, now, now,project.owner_id,Math.floor(now/86400000)*86400000,project.id,project.head,project.draft).run();
      if (!changed(result)) throw new Error("DAILY_APP_BUILD_LIMIT");
    } catch (e) {
      const duplicate = await this.db.prepare("SELECT * FROM app_builds WHERE project_id = ? AND request_key = ?").bind(project.id, requestKey).first<BuildRow>();
      if (duplicate) {
        if(duplicate.target!==target||duplicate.instruction!==instruction.slice(0,6000))throw new Error("IDEMPOTENCY_CONFLICT");
        return duplicate;
      }
      throw e;
    }
    return (await this.build(id))!;
  }
  async build(id: string): Promise<BuildRow | null> { return this.db.prepare("SELECT * FROM app_builds WHERE id = ?").bind(id).first<BuildRow>(); }
  async archive(projectId:string,ownerId:number,restore=false):Promise<boolean>{
    await this.ready();const now=Date.now();
    const result=restore?await this.db.prepare(`UPDATE app_projects SET archived_at=NULL,updated_at=? WHERE id=? AND owner_id=? AND archived_at>0
      AND (SELECT COUNT(*) FROM app_projects WHERE owner_id=? AND archived_at IS NULL) < ?`)
      .bind(now,projectId,ownerId,ownerId,MAX_PROJECTS_PER_USER).run():await this.db.prepare(`UPDATE app_projects SET archived_at=?,updated_at=? WHERE id=? AND owner_id=? AND archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM app_builds WHERE project_id=? AND status IN ('queued','generating','building','repairing'))`)
      .bind(now,now,projectId,ownerId,projectId).run();
    if(changed(result)&&!restore)await this.db.prepare("DELETE FROM app_context WHERE owner_id=? AND project_id=?").bind(ownerId,projectId).run();
    return changed(result);
  }
  async claim(targets: AppTarget[]): Promise<BuildRow | null> {
    await this.ready();
    if (!targets.length) return null;
    const now = Date.now();
    // Abandoned jobs have a finite retry budget. No immortal poison queue entries.
    await this.db.prepare(`UPDATE app_builds SET status='failed',diagnostics='Runner lease expired repeatedly',updated_at=?
      WHERE id IN (SELECT id FROM app_builds WHERE status IN ('generating','building','repairing') AND lease_until < ? AND claims >= 3 LIMIT 10)`).bind(now,now).run();
    const row = await this.db.prepare(`SELECT * FROM app_builds WHERE target IN (${targets.map(()=>"?").join(",")})
      AND created_at>=? AND ((status='queued' AND created_at>=?) OR (status IN ('generating','building','repairing') AND lease_until < ? AND claims < 3)) ORDER BY created_at LIMIT 1`)
      .bind(...targets,now-60*60_000,now-15*60_000,now).first<BuildRow>();
    if (!row) return null;
    const token = crypto.randomUUID();
    const result = await this.db.prepare(`UPDATE app_builds SET lease_token=?,lease_until=?,claims=claims+1,
      status=CASE WHEN status='queued' THEN 'generating' ELSE status END,updated_at=?
      WHERE id=? AND (status='queued' OR (status IN ('generating','building','repairing') AND lease_until < ?))`)
      .bind(token,now+BUILD_LEASE_MS,now,row.id,now).run();
    return changed(result) ? this.build(row.id) : null;
  }
  async leased(id: string, token: string): Promise<BuildRow> {
    const row = await this.build(id);
    if (!row || row.lease_token !== token || row.lease_until <= Date.now() || row.created_at<Date.now()-60*60_000 || !["generating","building","repairing"].includes(row.status)) throw new Error("BUILD_LEASE_LOST");
    return row;
  }
  async heartbeat(id: string, token: string): Promise<boolean> {
    const now = Date.now();
    return changed(await this.db.prepare(`UPDATE app_builds SET lease_until=?,updated_at=? WHERE id=? AND lease_token=?
      AND lease_until>? AND status IN ('generating','building','repairing')`).bind(now+BUILD_LEASE_MS,now,id,token,now).run());
  }
  async saveDraft(job: BuildRow, spec: AppSpec): Promise<BuildRow> {
    const revision = await this.putSnapshot(job.project_id,spec), now = Date.now();
    const result = await this.db.prepare(`UPDATE app_builds SET revision=?,status='building',generation_lock_until=0,updated_at=?
      WHERE id=? AND lease_token=? AND lease_until>? AND generation_count=? AND status IN ('generating','repairing')`)
      .bind(revision,now,job.id,job.lease_token,now,job.generation_count).run();
    if (!changed(result)) throw new Error("BUILD_LEASE_LOST");
    await this.db.prepare(`UPDATE app_projects SET draft=?,updated_at=? WHERE id=?
      AND EXISTS(SELECT 1 FROM app_builds WHERE id=? AND lease_token=? AND status='building')`)
      .bind(revision,now,job.project_id,job.id,job.lease_token).run();
    return (await this.build(job.id))!;
  }
  async lockDependencies(job: BuildRow, lockfile: string): Promise<BuildRow> {
    const spec=await this.snapshot(job.project_id,job.revision);
    if(spec.dependencyLock===lockfile)return job;
    if(spec.dependencyLock)throw new Error("DEPENDENCY_LOCK_CHANGED");
    const revision=await this.putSnapshot(job.project_id,{...spec,dependencyLock:lockfile}),now=Date.now();
    const result=await this.db.prepare(`UPDATE app_builds SET revision=?,updated_at=? WHERE id=? AND lease_token=? AND lease_until>? AND revision=? AND status='building'`)
      .bind(revision,now,job.id,job.lease_token,now,job.revision).run();
    if(!changed(result))throw new Error("BUILD_LEASE_OR_REVISION_CONFLICT");
    await this.db.prepare(`UPDATE app_projects SET draft=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM app_builds WHERE id=? AND lease_token=? AND revision=?)`)
      .bind(revision,now,job.project_id,job.id,job.lease_token,revision).run();
    return (await this.build(job.id))!;
  }
  async finish(job: BuildRow, artifacts: BuildArtifact[]): Promise<void> {
    if (!this.db.batch) throw new Error("ATOMIC_D1_BATCH_REQUIRED");
    const now = Date.now();
    const results = await this.db.batch([
      this.db.prepare(`UPDATE app_builds SET status='succeeded',artifacts=?,lease_until=0,updated_at=?
        WHERE id=? AND lease_token=? AND lease_until>? AND status='building'
        AND EXISTS(SELECT 1 FROM app_projects WHERE id=? AND head=?)`)
        .bind(JSON.stringify(artifacts),now,job.id,job.lease_token,now,job.project_id,job.base_revision),
      this.db.prepare(`UPDATE app_projects SET head=?,draft=?,updated_at=? WHERE id=? AND head=?
        AND EXISTS(SELECT 1 FROM app_builds WHERE id=? AND lease_token=? AND status='succeeded')`)
        .bind(job.revision,job.revision,now,job.project_id,job.base_revision,job.id,job.lease_token),
    ]);
    if (!changed(results[0])) throw new Error("BUILD_LEASE_OR_REVISION_CONFLICT");
  }
  async cleanup(): Promise<void> {
    await this.ready();const now=Date.now();
    await this.recoverStalled();
    await this.db.prepare("DELETE FROM app_build_workers WHERE rowid IN (SELECT rowid FROM app_build_workers WHERE expires_at<? LIMIT 100)").bind(now-86400000).run();
    await this.db.prepare(`UPDATE app_builds SET status='failed',diagnostics='No runner accepted this job within 24 hours',updated_at=?
      WHERE id IN (SELECT id FROM app_builds WHERE status='queued' AND created_at<? LIMIT 10)`).bind(now,now-86400000).run();
    const rows=await this.db.prepare(`SELECT * FROM app_builds b WHERE created_at<? AND
      (status IN ('failed','cancelled') OR (status='succeeded' AND (EXISTS(SELECT 1 FROM app_builds newer WHERE newer.project_id=b.project_id AND newer.target=b.target AND newer.status='succeeded' AND newer.created_at>b.created_at)
        OR EXISTS(SELECT 1 FROM app_projects p WHERE p.id=b.project_id AND p.archived_at>0 AND p.archived_at<?))))
      ORDER BY created_at LIMIT 3`).bind(now-30*86400000,now-30*86400000).all<BuildRow>();
    for(const job of rows.results??[]){
      const objects=await this.bucket.list({prefix:`factory/artifacts/${job.id}/`,limit:100});
      if(objects.objects.length)await this.bucket.delete(objects.objects.map(object=>object.key));
      if(objects.truncated)continue;
      await this.db.prepare("DELETE FROM app_artifacts WHERE build_id=?").bind(job.id).run();
      await this.db.prepare("DELETE FROM app_builds WHERE id=? AND status IN ('succeeded','failed','cancelled')").bind(job.id).run();
      for(const revision of [...new Set([job.revision,job.base_revision])].filter(Boolean)){
        const referenced=await this.db.prepare(`SELECT 1 AS present FROM app_projects WHERE id=? AND (head=? OR draft=?)
          UNION ALL SELECT 1 AS present FROM app_builds WHERE project_id=? AND (revision=? OR base_revision=?) LIMIT 1`)
          .bind(job.project_id,revision,revision,job.project_id,revision,revision).first();
        if(!referenced)await this.bucket.delete(`factory/projects/${job.project_id}/${revision}.json`);
      }
    }
    // Archive deletion is tombstoned before touching R2 so a concurrent restore
    // cannot resurrect a project whose source is already being removed.
    const old=await this.db.prepare(`SELECT id FROM app_projects p WHERE (archived_at=-1 OR (archived_at>0 AND archived_at<?))
      AND NOT EXISTS(SELECT 1 FROM app_builds b WHERE b.project_id=p.id) LIMIT 1`).bind(now-30*86400000).first<{id:string}>();
    if(old){
      const claimed=await this.db.prepare(`UPDATE app_projects SET archived_at=-1 WHERE id=? AND (archived_at=-1 OR (archived_at>0 AND archived_at<?))
        AND NOT EXISTS(SELECT 1 FROM app_builds WHERE project_id=?)`).bind(old.id,now-30*86400000,old.id).run();
      if(changed(claimed)){
        const page=await this.bucket.list({prefix:`factory/projects/${old.id}/`,limit:100});
        if(page.objects.length)await this.bucket.delete(page.objects.map(object=>object.key));
        if(!page.truncated)await this.db.prepare("DELETE FROM app_projects WHERE id=? AND archived_at=-1").bind(old.id).run();
      }
    }
  }
}
