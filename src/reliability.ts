/** Deadlines cover the complete operation, not just the arrival of HTTP headers. */
export async function withinDeadline<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const stop = () => { controller.abort(); rejectAbort(new Error("CANCELLED_BY_USER")); };
  if (parent?.aborted) stop(); else parent?.addEventListener("abort", stop, { once: true });
  timer = setTimeout(() => { controller.abort(); rejectAbort(new Error("OPERATION_DEADLINE_EXCEEDED")); }, Math.max(1, timeoutMs));
  try {
    if (controller.signal.aborted) return await aborted;
    return await Promise.race([Promise.resolve().then(() => {
      if(controller.signal.aborted)throw new Error("CANCELLED_BY_USER");
      return work(controller.signal);
    }), aborted]);
  } finally { clearTimeout(timer); parent?.removeEventListener("abort", stop); }
}

/** A response whose deadline remains armed through json/text/stream consumption. */
export async function fetchDeadlineResponse(url: string, options: RequestInit, ms: number): Promise<Response> {
  const ac=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let stream:ReadableStreamDefaultController<Uint8Array>|undefined,finished=false;
  let rejectDeadline:(error:Error)=>void=()=>{};
  const deadline=new Promise<never>((_,reject)=>{rejectDeadline=reject;});
  const cleanup=()=>{finished=true;clearTimeout(timer);options.signal?.removeEventListener("abort",cancel);};
  const fail=(error:Error)=>{if(finished)return;cleanup();ac.abort();rejectDeadline(error);try{stream?.error(error);}catch{}void reader?.cancel().catch(()=>{});};
  const cancel=()=>fail(new Error("CANCELLED_BY_USER"));
  const timer=setTimeout(()=>fail(new Error("OPERATION_DEADLINE_EXCEEDED")),Math.max(1,ms));
  options.signal?.addEventListener("abort",cancel,{once:true});
  try{
    if(options.signal?.aborted){cancel();return await deadline;}
    const fetching=fetch(url,{...options,signal:ac.signal});
    void fetching.then(response=>{if(finished)void response.body?.cancel().catch(()=>{});},()=>{});
    const response=await Promise.race([fetching,deadline]);
    if(!response.body){cleanup();return response;}
    reader=response.body.getReader();
    const body=new ReadableStream<Uint8Array>({start(controller){stream=controller;},async pull(controller){
      try{const chunk=await reader!.read();if(finished)return;if(chunk.done){cleanup();reader!.releaseLock();controller.close();}else controller.enqueue(chunk.value);}
      catch(error){if(!finished){cleanup();controller.error(error);}}
    },cancel(){cleanup();ac.abort();void reader?.cancel().catch(()=>{});}});
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(error){cleanup();ac.abort();throw error;}
}

/**
 * `bot_target` marks an id that belongs to a bot account: Telegram refuses
 * bot→bot messages outright (USER_BOT_TO_BOT_DISABLED), and unlike a blocked
 * user the target can never become receivable, so the row is written without
 * a retry horizon. Keeping it in the union (not ad-hoc string checks) is what
 * lets `tg()` treat the 400 as routine instead of pinging the owner.
 */
export type DeliveryFailure = "blocked" | "removed" | "permissions" | "bot_target" | null;
export function classifyDeliveryFailure(message: string): DeliveryFailure {
  const text = message.toLowerCase();
  if (/user_bot_to_bot_disabled/.test(text)) return "bot_target";
  if (/not enough rights to send|have no rights to send|chat_write_forbidden|not allowed to send|bot is not allowed to send|need administrator rights/.test(text)) return "permissions";
  if (/bot was blocked|user is deactivated|user_deactivated|blocked by the user/.test(text)) return "blocked";
  if (/chat not found|bot was kicked|bot is not a member|peer_id_invalid|group chat was deleted/.test(text)) return "removed";
  return null;
}

export function nativeUnavailableMessage(lang = "en"): string {
  return lang === "fa"
    ? "ساخت خروجی بومیِ درخواستی فعلاً در دسترس نیست. می‌توانم نسخهٔ وب بسازم یا در آماده‌سازی پروژه کمک کنم؛ فایل APK یا EXE آماده‌ای وجود ندارد."
    : lang === "ar" ? "إنشاء ملفات Android وWindows غير متاح حالياً. يمكنني إنشاء تطبيق ويب أو المساعدة في تجهيز المشروع؛ لا يوجد ملف APK أو EXE جاهز."
    : "The requested Android or Windows build is currently unavailable. I can create a web app or help prepare the project instead; no APK or EXE has been built.";
}

/** Old groups without a stored choice are enabled; explicit disables survive. */
export function normalizeGroupConfig(raw: unknown): { enabled: boolean; allowHeavy: boolean } {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return { enabled: value.enabled !== false, allowHeavy: value.allowHeavy === true };
}
