import { readJsonObject, RequestBodyError } from "../http";
import { timingSafeEqualStr } from "../core";
import { exportDocument, type ExportFormat } from "../exportEngine";
import { nativeUnavailableMessage } from "../reliability";
import { FactoryStore, changed, type BuildRow, type ProjectRow } from "./store.ts";
import { appGenerationPrompt, createAppTemplate } from "./templates.ts";
import { appTarget, applyAppPatch, cleanBuildLog, FLUTTER_VERSION, MAX_ARTIFACT_BYTES, MAX_BUILD_REPAIRS, sha256, validateBackend,
  type AppTarget, type BuildArtifact, type AppSpec } from "./protocol.ts";

export interface FactoryDeps {
  store: FactoryStore; runnerToken: string; downloadSecret: string; origin: string;
  generate(prompt: string): Promise<string>;
  notify?(chatId: number, text: string): Promise<unknown>;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type":"application/json", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" } });
export class AppFactory {
  readonly deps: FactoryDeps;
  constructor(deps: FactoryDeps) { this.deps = deps; }
  async availability() {
    const targets=this.deps.runnerToken?await this.deps.store.onlineTargets():[];
    return { available:targets.length>0,status:targets.length?"available":"offline",targets,message:targets.length?"External build worker connected.":nativeUnavailableMessage() };
  }
  async submit(input: { ownerId: number; chatId: number; scope: string; title?: string; idea: string; target: AppTarget;
    action: "create" | "edit" | "build"; projectId?: string; requestKey: string; context?: string }): Promise<Record<string, unknown>> {
    const store = this.deps.store;
    await store.ready();
    await store.recoverStalled();
    const availability=await this.availability();
    if(!availability.targets.includes(input.target))return {success:false,unavailable:true,status:"unavailable",message:nativeUnavailableMessage(),artifacts:[]};
    let project: ProjectRow | null;
    if (input.action === "create") {
      if (input.idea.trim().length < 8) throw new Error("DESCRIBE_THE_APPLICATION");
      // Deterministic creation id closes duplicate webhook/model-call races.
      const hash = await sha256(`${input.ownerId}:${input.scope}:${input.requestKey}`);
      const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
      project = await store.project(id,input.ownerId);
      if (!project) {
        const title = (input.title || input.idea).slice(0,100);
        const spec = createAppTemplate(id,title,/[\u0600-\u06ff]/.test(input.idea) ? "fa" : "en");
        try { project = await store.createProject(input.ownerId,input.scope,title,spec,id); }
        catch(e) { project = await store.project(id,input.ownerId); if (!project) throw e; }
      }
    } else project = input.projectId ? await store.project(input.projectId,input.ownerId) : await store.activeProject(input.ownerId,input.scope);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    await store.selectProject(project,input.scope);
    if (input.action === "build" && project.head && project.head===project.draft) {
      const cached = await store.db.prepare(`SELECT * FROM app_builds WHERE project_id=? AND revision=? AND target=? AND status='succeeded' ORDER BY created_at DESC LIMIT 1`)
        .bind(project.id,project.head,input.target).first<BuildRow>();
      if (cached) return this.publicBuild(cached);
    }
    let instruction=input.idea;
    if(input.action==="build"){
      const draft=await store.snapshot(project.id,project.draft);
      const starter=draft.files.some(file=>file.path==="test/generated_test.dart"&&file.content.includes("Feature tests must be generated"));
      if(starter){
        const previous=await store.db.prepare("SELECT instruction FROM app_builds WHERE project_id=? AND instruction!='__EXPORT__' ORDER BY created_at DESC LIMIT 1").bind(project.id).first<{instruction:string}>();
        instruction=previous?.instruction||input.idea;
      }else instruction="__EXPORT__";
    }
    const job = await store.enqueue(project,input.target,instruction,
      input.context ?? "",input.chatId,input.requestKey);
    return { ...await this.publicBuild(job), message: "Native project queued. A build runner will generate, analyze, test, compile and repair it. Only validated artifacts will be delivered." };
  }
  private async signature(buildId: string, name: string, expires: number): Promise<string> {
    const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(this.deps.downloadSecret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const bytes = await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${buildId}\n${name}\n${expires}`));
    return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
  }
  async publicBuild(job: BuildRow): Promise<Record<string, unknown>> {
    const expires = Math.floor(Date.now()/1000)+3600;
    const artifacts = job.status === "succeeded" ? JSON.parse(job.artifacts) as BuildArtifact[] : [];
    return { success: true, projectId: job.project_id, buildId: job.id, target: job.target, status: job.status,
      revision: job.revision, repairs: job.repairs, createdAt: job.created_at,
      artifacts: await Promise.all(artifacts.map(async a => ({ name:a.name,bytes:a.bytes,sha256:a.sha256,kind:a.kind,signing:a.signing,
        url:`${this.deps.origin}/api/apps/download/${job.id}/${a.name}?expires=${expires}&signature=${await this.signature(job.id,a.name,expires)}` }))) };
  }
  async download(request: Request): Promise<Response> {
    const url = new URL(request.url), match = /^\/api\/apps\/download\/([\w-]{36})\/([a-z0-9_.-]{1,80})$/.exec(url.pathname);
    if (!match || request.method !== "GET") return json({ok:false,error:"not_found"},404);
    const expires = Number(url.searchParams.get("expires"));
    if (!Number.isSafeInteger(expires) || expires < Date.now()/1000 || expires > Date.now()/1000+3700) return json({ok:false,error:"expired"},403);
    if (!timingSafeEqualStr(await this.signature(match[1],match[2],expires),url.searchParams.get("signature")??"")) return json({ok:false,error:"forbidden"},403);
    await this.deps.store.ready();
    const job = await this.deps.store.build(match[1]);
    if (!job || job.status !== "succeeded") return json({ok:false,error:"not_found"},404);
    const artifact = (JSON.parse(job.artifacts) as BuildArtifact[]).find(a=>a.name===match[2]);
    if (!artifact) return json({ok:false,error:"not_found"},404);
    const object = await this.deps.store.bucket.get(artifact.key);
    if (!object) return json({ok:false,error:"artifact_unavailable"},410);
    return new Response(object.body,{headers:{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename="${artifact.name}"`,
      "Content-Length":String(object.size),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
  }
  async userAPI(request: Request, ownerId: number, admin = false): Promise<Response> {
    const url = new URL(request.url), store = this.deps.store;
    await store.ready();
    if(request.method==="GET"&&url.pathname==="/api/apps/status")return json({ok:true,...await this.availability()});
    await store.recoverStalled();
    if (request.method === "GET" && url.pathname === "/api/apps/projects") {
      const rows = await store.db.prepare(`SELECT id,title,head,draft,archived_at,created_at,updated_at FROM app_projects WHERE ${admin ? "1=1" : "owner_id=?"}
        AND ${url.searchParams.get("archived")==="1"?"archived_at>0":"archived_at IS NULL"} ORDER BY updated_at DESC LIMIT 50`)
        .bind(...(admin?[]:[ownerId])).all();
      return json({ok:true,projects:rows.results??[],flutter:FLUTTER_VERSION});
    }
    if (request.method === "GET" && url.pathname === "/api/apps/builds") {
      const rows = await store.db.prepare(`SELECT * FROM app_builds ${admin ? "" : "WHERE owner_id=?"} ORDER BY created_at DESC LIMIT 30`)
        .bind(...(admin?[]:[ownerId])).all<BuildRow>();
      return json({ok:true,builds:await Promise.all((rows.results??[]).map(row=>this.publicBuild(row))),availability:await this.availability()});
    }
    const match = /^\/api\/apps\/builds\/([\w-]{36})(\/cancel)?$/.exec(url.pathname);
    const reportMatch = /^\/api\/apps\/projects\/([\w-]{36})\/architecture$/.exec(url.pathname);
    const configMatch = /^\/api\/apps\/projects\/([\w-]{36})\/config$/.exec(url.pathname);
    const lifecycle=/^\/api\/apps\/projects\/([\w-]{36})\/(archive|restore)$/.exec(url.pathname);
    if(request.method==="POST"&&lifecycle){
      const project=await store.project(lifecycle[1],ownerId,true);
      if(!project)return json({ok:false,error:"not_found"},404);
      const restoring=lifecycle[2]==="restore",ok=await store.archive(project.id,ownerId,restoring);
      if(ok&&restoring)await store.selectProject({...project,archived_at:null},String(ownerId));
      return json({ok,...(!ok?{error:restoring?"project_not_restorable_or_limit_reached":"cancel_active_build_before_archiving"}:{retentionDays:30})},ok?200:409);
    }
    if(request.method==="POST"&&configMatch){
      const project=await store.project(configMatch[1],ownerId);if(!project)return json({ok:false,error:"not_found"},404);
      const config=validateBackend(await readJsonObject(request,8192));
      const spec=await store.snapshot(project.id,project.draft);
      const revision=await store.putSnapshot(project.id,{...spec,backend:config});
      const result=await store.db.prepare(`UPDATE app_projects SET draft=?,updated_at=? WHERE id=? AND draft=? AND archived_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM app_builds WHERE project_id=? AND status IN ('queued','generating','building','repairing'))`)
        .bind(revision,Date.now(),project.id,project.draft,project.id).run();
      return json({ok:changed(result),revision},changed(result)?200:409);
    }
    if (request.method === "GET" && reportMatch) {
      const project = await store.project(reportMatch[1],ownerId);
      if (!project) return json({ok:false,error:"not_found"},404);
      const spec = await store.snapshot(project.id,project.head||project.draft);
      const format = url.searchParams.get("format")??"pdf";
      if (!["pdf","docx","html","md"].includes(format)) return json({ok:false,error:"invalid_format"},400);
      const document = exportDocument(`# ${spec.title}\n\n${spec.architecture}\n\n## Acceptance criteria\n${spec.acceptance.map(item=>"- "+item).join("\n")}\n\n## Source files\n${spec.files.map(file=>"- "+file.path).join("\n")}`,
        {format:format as ExportFormat,title:spec.title,lang:spec.language});
      return new Response(document.bytes as BodyInit,{headers:{"Content-Type":document.mime,"Content-Disposition":`attachment; filename="architecture.${document.ext}"`,"Cache-Control":"no-store"}});
    }
    if (match) {
      const row = await store.build(match[1]);
      if (!row || (!admin && row.owner_id!==ownerId)) return json({ok:false,error:"not_found"},404);
      if (request.method === "GET" && !match[2]) return json({ok:true,...await this.publicBuild(row),diagnostics:row.diagnostics});
      if (request.method === "POST" && match[2]) {
        const result = await store.db.prepare(`UPDATE app_builds SET status='cancelled',lease_token='',lease_until=0,updated_at=? WHERE id=? AND status IN ('queued','generating','building','repairing')`).bind(Date.now(),row.id).run();
        return json({ok:changed(result)},changed(result)?200:409);
      }
    }
    if (request.method === "POST" && url.pathname === "/api/apps/projects") {
      const body = await readJsonObject(request,16_000);
      const action = String(body.action??"create");
      if (!["create","edit","build"].includes(action)) return json({ok:false,error:"invalid_action"},400);
      const key = request.headers.get("Idempotency-Key");
      if (!key || !/^[a-zA-Z0-9_-]{8,80}$/.test(key)) return json({ok:false,error:"idempotency_key_required"},400);
      const result=await this.submit({ownerId,chatId:ownerId,scope:String(ownerId),idea:String(body.idea??""),title:String(body.title??""),
        target:appTarget(body.target),action:action as "create"|"edit"|"build",projectId:typeof body.projectId==="string"?body.projectId:undefined,requestKey:key});
      return result.success===false?json({ok:false,available:false,error:result.message},503):json({ok:true,...result},202);
    }
    return json({ok:false,error:"not_found"},404);
  }
  async runnerAPI(request: Request): Promise<Response> {
    if (!this.deps.runnerToken || !timingSafeEqualStr(request.headers.get("Authorization")??"",`Bearer ${this.deps.runnerToken}`)) return json({ok:false,error:"forbidden"},403);
    const store = this.deps.store; await store.ready();
    const path = new URL(request.url).pathname.replace("/api/app-runner/","");
    if(path==="offline"&&request.method==="POST"){
      const body=await readJsonObject(request,4096);
      if(typeof body.workerId!=="string"||!/^[\w-]{36}$/.test(body.workerId))return json({ok:false,error:"invalid_worker"},400);
      await store.db.prepare("DELETE FROM app_build_workers WHERE worker_id=?").bind(body.workerId).run();return json({ok:true});
    }
    if (path === "claim" && request.method === "POST") {
      const body = await readJsonObject(request,4096);
      if (!Array.isArray(body.targets) || body.targets.length>3 || typeof body.workerId!=="string" || !/^[\w-]{36}$/.test(body.workerId)) return json({ok:false,error:"invalid_targets"},400);
      const targets=[...new Set(body.targets.map(appTarget))];
      await store.workerSeen(body.workerId,targets);await store.recoverStalled();
      const job = await store.claim(targets);
      return json({ok:true,job:job?{id:job.id,projectId:job.project_id,target:job.target,leaseToken:job.lease_token,revision:job.revision,status:job.status}:null});
    }
    const match = /^([\w-]{36})\/(heartbeat|generate|lock|result|artifact\/([a-z0-9_.-]{1,80}))$/.exec(path);
    if (!match) return json({ok:false,error:"not_found"},404);
    const token = request.headers.get("X-Build-Lease")??"";
    if(match[2]==="result"&&request.method==="POST"){
      const existing=await store.build(match[1]);
      if(existing?.status==="succeeded"&&existing.lease_token===token)return json({ok:true,...await this.publicBuild(existing)});
    }
    const job = await store.leased(match[1],token);
    if (match[2] === "heartbeat" && request.method === "POST") {
      const body=await readJsonObject(request,4096);
      if(typeof body.workerId==="string"&&/^[\w-]{36}$/.test(body.workerId))await store.workerSeen(body.workerId,[job.target]);
      await store.recoverStalled();return json({ok:await store.heartbeat(job.id,token)});
    }
    if (match[2] === "generate" && request.method === "POST") return this.generate(job);
    if (match[2] === "lock" && request.method === "POST") {
      const body=await readJsonObject(request,110_000);
      if(job.status!=="building"||typeof body.lockfile!=="string"||body.lockfile.length>100_000||!/^packages:/m.test(body.lockfile))return json({ok:false,error:"invalid_dependency_lock"},400);
      const updated=await store.lockDependencies(job,body.lockfile);
      return json({ok:true,revision:updated.revision});
    }
    if (match[3] && request.method === "PUT") return this.upload(job,match[3],request);
    if (match[2] === "result" && request.method === "POST") return this.result(job,await readJsonObject(request,24_000));
    return json({ok:false,error:"method_not_allowed"},405);
  }
  private async generate(job: BuildRow): Promise<Response> {
    const store = this.deps.store;
    const buildNumber=Math.floor(job.created_at/1000)-1577836800+1;
    if (job.status === "building") return json({ok:true,spec:await store.snapshot(job.project_id,job.revision),revision:job.revision,target:job.target,flutter:FLUTTER_VERSION,buildNumber});
    if (job.generation_count >= 5) {
      await store.db.prepare("UPDATE app_builds SET status='failed',lease_until=0,diagnostics='Generation budget exhausted' WHERE id=? AND lease_token=?").bind(job.id,job.lease_token).run();
      return json({ok:false,error:"generation_budget_exhausted"},422);
    }
    const now = Date.now();
    const acquired = await store.db.prepare(`UPDATE app_builds SET generation_lock_until=?,generation_count=generation_count+1
      WHERE id=? AND lease_token=? AND lease_until>? AND generation_lock_until<=? AND status IN ('generating','repairing')`)
      .bind(now+90_000,job.id,job.lease_token,now,now).run();
    if (!changed(acquired)) return json({ok:false,error:"generation_in_progress"},409);
    job = (await store.build(job.id))!;
    try {
      const base = await store.snapshot(job.project_id,job.revision);
      let spec: AppSpec = base;
      if (job.instruction !== "__EXPORT__" || job.status === "repairing") {
        const raw = await this.deps.generate(appGenerationPrompt(base,job.instruction,job.target,job.diagnostics,job.context));
        if (raw.length>350_000) throw new Error("MODEL_PATCH_TOO_LARGE");
        const patch = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/, ""));
        spec = applyAppPatch(base,patch);
      }
      const updated = await store.saveDraft(job,spec);
      return json({ok:true,spec,revision:updated.revision,target:updated.target,flutter:FLUTTER_VERSION,buildNumber});
    } catch(e) {
      await store.db.prepare(`UPDATE app_builds SET generation_lock_until=0,diagnostics=? WHERE id=? AND lease_token=? AND generation_count=?`)
        .bind(cleanBuildLog(e),job.id,job.lease_token,job.generation_count).run();
      return json({ok:false,error:"generation_failed",retryable:true},422);
    }
  }
  private async upload(job: BuildRow,name: string,request: Request): Promise<Response> {
    if (job.status!=="building") return json({ok:false,error:"not_building"},409);
    const bytes=Number(request.headers.get("Content-Length")),digest=request.headers.get("X-Artifact-SHA256")??"";
    const kind=request.headers.get("X-Artifact-Kind"),signing=request.headers.get("X-Artifact-Signing")??"unsigned";
    if (!request.body || !Number.isSafeInteger(bytes)||bytes<16||bytes>MAX_ARTIFACT_BYTES||!/^[a-f0-9]{64}$/.test(digest)
      ||!(["source","binary"].includes(kind??""))||!["development","release","unsigned","not-applicable"].includes(signing)) return json({ok:false,error:"invalid_artifact"},400);
    const expected = kind==="source" ? "source.zip" : job.target==="android-apk"?"app.apk":job.target==="android-aab"?"app.aab":`${job.target}.zip`;
    if (name!==expected || (job.target==="android-aab"&&kind==="binary"&&signing!=="release")) return json({ok:false,error:"artifact_contract_mismatch"},400);
    let received=0; const prefix:number[]=[];
    let body=request.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){
      received+=chunk.byteLength;if(received>bytes)throw new Error("ARTIFACT_SIZE_MISMATCH");
      for(let i=0;i<chunk.length&&prefix.length<4;i++)prefix.push(chunk[i]);controller.enqueue(chunk);
    },flush(){if(received!==bytes||prefix[0]!==0x50||prefix[1]!==0x4b||prefix[2]!==3||prefix[3]!==4)throw new Error("ARTIFACT_FORMAT_MISMATCH");}}));
    // R2 requires known-length streams; a regular TransformStream loses the
    // incoming body's length metadata. Workers' fixed-length stream restores it.
    if(typeof FixedLengthStream!=="undefined")body=body.pipeThrough(new FixedLengthStream(bytes));
    const key=`factory/artifacts/${job.id}/${job.lease_token}/${digest}/${name}`;
    // R2 verifies the checksum server-side; never buffer a native binary in Worker memory.
    await this.deps.store.bucket.put(key,body,{sha256:digest,httpMetadata:{contentType:"application/octet-stream"}});
    await this.deps.store.leased(job.id,job.lease_token);
    const saved=await this.deps.store.db.prepare(`INSERT INTO app_artifacts(build_id,name,object_key,bytes,sha256,kind,signing,lease_token,revision)
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM app_builds WHERE id=? AND lease_token=? AND lease_until>? AND status='building' AND revision=?)
      ON CONFLICT(build_id,name) DO UPDATE SET object_key=excluded.object_key,bytes=excluded.bytes,sha256=excluded.sha256,kind=excluded.kind,signing=excluded.signing,lease_token=excluded.lease_token,revision=excluded.revision`)
      .bind(job.id,name,key,bytes,digest,kind,signing,job.lease_token,job.revision,job.id,job.lease_token,Date.now(),job.revision).run();
    if (!changed(saved)) throw new Error("BUILD_LEASE_LOST");
    return json({ok:true,name,bytes,sha256:digest});
  }
  private async result(job: BuildRow,body: Record<string,unknown>): Promise<Response> {
    const store=this.deps.store;
    if (body.ok !== true) {
      const repairable=body.repairable===true && job.status==="building" && job.repairs<MAX_BUILD_REPAIRS;
      const updated=await store.db.prepare(`UPDATE app_builds SET status=?,diagnostics=?,repairs=repairs+?,generation_lock_until=0,updated_at=?
        WHERE id=? AND lease_token=? AND lease_until>? AND status IN ('generating','building','repairing')`)
        .bind(repairable?"repairing":"failed",cleanBuildLog(body.log),repairable?1:0,Date.now(),job.id,job.lease_token,Date.now()).run();
      if (!changed(updated)) throw new Error("BUILD_LEASE_LOST");
      if (!repairable) await this.deps.notify?.(job.chat_id,`Application build ${job.id.slice(0,8)} could not be completed. The project is saved; ask Nova to revise it. No unverified binary was delivered.`).catch(()=>{});
      return json({ok:true,repair:repairable});
    }
    const checks=body.checks as Record<string,unknown>|undefined;
    if (body.revision!==job.revision||body.flutter!==FLUTTER_VERSION||checks?.analysis!==true||checks?.tests!==true||checks?.build!==true) return json({ok:false,error:"validation_required"},422);
    if(!(await store.snapshot(job.project_id,job.revision)).dependencyLock)return json({ok:false,error:"dependency_lock_required"},422);
    const rows=await store.db.prepare(`SELECT name,object_key AS key,bytes,sha256,kind,signing FROM app_artifacts WHERE build_id=? AND lease_token=? AND revision=?`).bind(job.id,job.lease_token,job.revision).all<BuildArtifact>();
    const artifacts=rows.results??[];
    if (!artifacts.some(a=>a.kind==="source") || !artifacts.some(a=>a.kind==="binary")) return json({ok:false,error:"artifacts_missing"},422);
    await store.finish(job,artifacts);
    const completed=(await store.build(job.id))!;
    const view=await this.publicBuild(completed);
    const links=(view.artifacts as Array<{name:string;url:string;signing:string}>).map(a=>`${a.name} (${a.signing}): ${a.url}`).join("\n");
    await this.deps.notify?.(job.chat_id,`Application build complete: ${job.target}\nProject: ${job.project_id}\n${links}\nDownload links expire in one hour; ask for build status to refresh them.`).catch(()=>{});
    return json({ok:true,...view});
  }
}

export function factoryError(error: unknown): Response {
  const message=error instanceof Error?error.message:"factory_unavailable";
  const status=error instanceof RequestBodyError?error.status:/NOT_CONFIGURED|BACKPRESSURE|STORAGE/.test(message)?503:/LEASE|CONFLICT|IN_PROGRESS/.test(message)?409:/NOT_FOUND/.test(message)?404:400;
  const friendly=/NOT_CONFIGURED|UNAVAILABLE/.test(message)?nativeUnavailableMessage():status===404?"This project or build could not be found.":status===409?"The project changed or a build is already in progress. Refresh its status before trying again.":status===503?"Build storage is temporarily unavailable. Please try again later.":"The application request could not be completed. Check the selected project and try again.";
  return json({ok:false,error:friendly},status);
}
