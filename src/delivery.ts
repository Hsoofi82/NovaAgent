import type { OperationsDB } from "./operations";
import { classifyDeliveryFailure, type DeliveryFailure } from "./reliability";

interface ChatDelivery { reason: Exclude<DeliveryFailure,null>; retry_at: number }
const caches=new WeakMap<object,Map<number,{value:ChatDelivery|null;until:number}>>();
const schemas=new WeakMap<object,Promise<void>>();
function cache(db:OperationsDB){let value=caches.get(db);if(!value){value=new Map();caches.set(db,value);}return value;}
function remember(db:OperationsDB,id:number,value:ChatDelivery|null){const entries=cache(db);entries.delete(id);entries.set(id,{value,until:Date.now()+(value?Math.min(value.retry_at?Math.max(1000,value.retry_at-Date.now()):300_000,300_000):60_000)});if(entries.size>1000)entries.delete(entries.keys().next().value!);}
export function ensureDeliverySchema(db:OperationsDB):Promise<void>{
  let pending=schemas.get(db);if(!pending){pending=db.prepare(`CREATE TABLE IF NOT EXISTS chat_delivery(chat_id INTEGER PRIMARY KEY,reason TEXT NOT NULL,retry_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`).run().then(()=>{}).catch(error=>{schemas.delete(db);throw error;});schemas.set(db,pending);}return pending;
}
export async function chatCanReceive(db:OperationsDB,id:number):Promise<boolean>{
  const hit=cache(db).get(id);if(hit&&hit.until>Date.now())return !hit.value||(hit.value.retry_at>0&&hit.value.retry_at<=Date.now());
  await ensureDeliverySchema(db);
  const row=await db.prepare("SELECT reason,retry_at FROM chat_delivery WHERE chat_id=?").bind(id).first<ChatDelivery>();remember(db,id,row);
  return !row||(row.retry_at>0&&row.retry_at<=Date.now());
}
export async function deliveryStatus(db:OperationsDB,id:number){
  const canSend=await chatCanReceive(db,id),state=cache(db).get(id)?.value;
  return {canSend,reason:canSend?null:state?.reason??null,retryAt:state?.retry_at||null};
}
export async function noteGroupMessage(db:OperationsDB,id:number):Promise<void>{
  await chatCanReceive(db,id);
  // A newly authenticated group update proves the bot can see this chat again.
  // It does not prove sending permissions were restored, so retain that state.
  if(cache(db).get(id)?.value?.reason==="removed")await clearDeliveryFailure(db,id);
}
export async function noteDeliveryFailure(db:OperationsDB,id:number,message:string):Promise<boolean>{
  const reason=classifyDeliveryFailure(message);if(!reason)return false;
  const prior=cache(db).get(id)?.value;
  const retryAt=reason==="permissions"?Date.now()+15*60_000:0;
  if(prior?.reason===reason&&(!prior.retry_at||prior.retry_at>Date.now()))return true;
  remember(db,id,{reason,retry_at:retryAt});
  await ensureDeliverySchema(db);
  await db.prepare(`INSERT INTO chat_delivery(chat_id,reason,retry_at,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(chat_id) DO UPDATE SET reason=excluded.reason,retry_at=excluded.retry_at,updated_at=excluded.updated_at
    WHERE chat_delivery.reason IS NOT excluded.reason OR (chat_delivery.retry_at>0 AND chat_delivery.retry_at<=?)`)
    .bind(id,reason,retryAt,Date.now(),Date.now()).run();
  return true;
}
export async function clearDeliveryFailure(db:OperationsDB,id:number):Promise<void>{
  const hit=cache(db).get(id);
  if(hit&&hit.until>Date.now()&&!hit.value)return;
  await ensureDeliverySchema(db);
  // Only known blocked rows are written: inbound private traffic normally hits
  // the warm healthy cache and costs no write or read at all.
  const row=hit?.value??await db.prepare("SELECT reason,retry_at FROM chat_delivery WHERE chat_id=?").bind(id).first<ChatDelivery>();
  if(row)await db.prepare("DELETE FROM chat_delivery WHERE chat_id=?").bind(id).run();
  remember(db,id,null);
}
