import "server-only";

export type Visitor = { id: string; isNew: boolean };

const visitorCookieName = "visitorId";
// Retained for attribution and anonymous request throttling. Billing uses the
// authenticated Google account ID; this cookie no longer grants trial access.
const cookieMaxAgeSec = 400 * 24 * 60 * 60;
const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

/** Anonymous request identity only; never use this as proof of account ownership. */
export function getVisitor(request: Request): Visitor {
  const cookie = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${visitorCookieName}=`));
  const value = cookie?.slice(visitorCookieName.length + 1);
  if (value && uuidPattern.test(value)) return { id: value.toLowerCase(), isNew: false };
  return { id: crypto.randomUUID(), isNew: true };
}

export function withVisitorCookie(response: Response, request: Request, visitor: Visitor, renew = false): Response {
  if (!visitor.isNew && !renew) return response;
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  response.headers.append("Set-Cookie", `${visitorCookieName}=${visitor.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookieMaxAgeSec}${secure}`);
  return response;
}
