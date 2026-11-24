export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function success<T extends object>(data: T) {
  // Keep the AGENTS.md data envelope and the requested top-level API fields.
  return Response.json({ ok: true, data, ...data }, { headers: { "Cache-Control": "no-store" } });
}

export function failure(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ ok: false, error: error.message, code: error.code }, {
      status: error.status, headers: { "Cache-Control": "no-store" },
    });
  }
  // Keep credentials, request bodies and raw database/provider errors out of logs.
  // Stable error categories and stack locations are enough to diagnose runtime failures.
  const details = error as { name?: unknown; code?: unknown; stack?: unknown; message?: unknown } | null;
  console.error("api_unexpected_failure", {
    name: typeof details?.name === "string" ? details.name : "UnknownError",
    code: typeof details?.code === "string" && /^[A-Z\d_]{1,40}$/.test(details.code) ? details.code : undefined,
    wasm: typeof details?.message === "string" && /wasm|WebAssembly/i.test(details.message),
    locations: typeof details?.stack === "string" ? details.stack.split("\n").filter((line) => /^\s+at /.test(line)).slice(0, 3) : [],
  });
  return Response.json({ ok: false, error: "服务暂时不可用，请稍后重试", code: "INTERNAL_ERROR" }, { status: 500 });
}

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new ApiError(403, "INVALID_ORIGIN", "不允许从其他网站调用此接口");
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new ApiError(415, "INVALID_CONTENT_TYPE", "请发送 application/json 请求");
  }
  if (!request.body) throw new ApiError(400, "INVALID_JSON", "缺少请求内容");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) {
        await reader.cancel();
        throw new ApiError(413, "REQUEST_TOO_LARGE", "请求内容过大");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Return a stable error, without echoing user input. */ }
  throw new ApiError(400, "INVALID_JSON", "请求 JSON 格式不正确");
}
