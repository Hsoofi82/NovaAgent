import type { OperationsDB } from "./operations";
const changed=(r:unknown)=>Number((r as {meta?:{changes?:number}})?.meta?.changes??0)>0;
export async function reserveBroadcast(db:OperationsDB,id:string,token:string,from:number,to:number):Promise<boolean>{
  return changed(await db.prepare(`UPDATE kv_store SET value_text=json_set(value_text,'$.processedIndex',?,'$.status','running',
    '$.uncertain',COALESCE(json_extract(value_text,'$.uncertain'),0)+?) WHERE key='broadcast_job:current'
    AND json_extract(value_text,'$.id')=? AND json_extract(value_text,'$.processedIndex')=?
    AND json_extract(value_text,'$.status') IN ('pending','running')
    AND EXISTS(SELECT 1 FROM kv_store lock WHERE lock.key='broadcast_lock' AND lock.value_text=? AND lock.expires_at>?)`)
    .bind(to,to-from,id,from,token,Math.floor(Date.now()/1000)).run());
}
export async function settleBroadcast(db:OperationsDB,id:string,token:string,reservedEnd:number,next:number,sent:number,failed:number,deferUntil=0):Promise<boolean>{
  return changed(await db.prepare(`UPDATE kv_store SET value_text=json_set(value_text,
    '$.sent',COALESCE(json_extract(value_text,'$.sent'),0)+?,
    '$.failed',COALESCE(json_extract(value_text,'$.failed'),0)+?,
    '$.uncertain',MAX(0,COALESCE(json_extract(value_text,'$.uncertain'),0)-?-?-?),
    '$.processedIndex',?,'$.deferUntil',?,
    '$.status',CASE WHEN json_extract(value_text,'$.status')='error' THEN 'error' WHEN ?>=json_extract(value_text,'$.totalUsers') THEN 'done' ELSE 'pending' END)
    WHERE key='broadcast_job:current' AND json_extract(value_text,'$.id')=? AND json_extract(value_text,'$.processedIndex')=?
    AND EXISTS(SELECT 1 FROM kv_store lock WHERE lock.key='broadcast_lock' AND lock.value_text=?)`)
    .bind(sent,failed,sent,failed,reservedEnd-next,next,deferUntil,next,id,reservedEnd,token).run());
}
export async function cancelBroadcast(db:OperationsDB,id:string):Promise<boolean>{
  return changed(await db.prepare(`UPDATE kv_store SET value_text=json_set(value_text,'$.status','error')
    WHERE key='broadcast_job:current' AND json_extract(value_text,'$.id')=? AND json_extract(value_text,'$.status') IN ('pending','running')`).bind(id).run());
}
