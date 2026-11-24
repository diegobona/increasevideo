import "server-only";

export function createRateLimiter(limit: number, windowMs = 60_000) {
  const windows = new Map<string, number[]>();
  return (key: string, now = Date.now()): number => {
    for (const [address, times] of windows) {
      if (times[times.length - 1] <= now - windowMs) windows.delete(address);
    }
    const times = (windows.get(key) ?? []).filter((time) => time > now - windowMs);
    if (times.length >= limit) return Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000));
    // Never evict an active bucket to make room for another IP.
    if (!windows.has(key) && windows.size >= 20_000) return Math.ceil(windowMs / 1000);
    times.push(now);
    windows.set(key, times);
    return 0;
  };
}

export function requestIp(request: Request): string {
  // Cloudflare overwrites this header at its edge. A directly exposed origin must not trust it.
  if (process.env.TRUST_CLOUDFLARE_PROXY === "true") {
    const ip = request.headers.get("cf-connecting-ip");
    if (ip && ip.length <= 64 && /^[\da-f:.]+$/i.test(ip)) return ip.toLowerCase();
  }
  // Next Route Handlers don't expose a socket peer. Share a conservative bucket otherwise.
  return "unidentified-peer";
}

export function rateLimited(request: Request, limiter: ReturnType<typeof createRateLimiter>): Response | undefined {
  const retryAfter = limiter(requestIp(request));
  if (retryAfter) return Response.json({ ok: false, code: "RATE_LIMITED", error: "请求过于频繁，请稍后重试" }, {
    status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  });
}
