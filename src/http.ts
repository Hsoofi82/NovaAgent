export class RequestBodyError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** Enforce the actual streamed byte count, including requests without Content-Length. */
export async function readJsonObject(request: Request, maxBytes = 65_536): Promise<Record<string, unknown>> {
  if (!request.body) throw new RequestBodyError("invalid_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyError("body_too_large", 413);
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new RequestBodyError("invalid_json"); }
}
