import "server-only";
import { timingSafeEqual } from "node:crypto";

export function ownsJob(storedToken: string, token?: string): boolean {
  return !!token && /^[a-f\d]{32}$/.test(token) && /^[a-f\d]{32}$/.test(storedToken)
    && timingSafeEqual(Buffer.from(token), Buffer.from(storedToken));
}

export function readOwnerToken(request: Request) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("ownerToken="))?.slice("ownerToken=".length);
}

export function setResultCookie(response: Response, requestUrl: string, id: string, token: string) {
  response.headers.append("Set-Cookie", `ownerToken=${token}; Path=/result/${id}; HttpOnly; SameSite=Lax; Max-Age=2592000${new URL(requestUrl).protocol === "https:" ? "; Secure" : ""}`);
  return response;
}
