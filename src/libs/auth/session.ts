import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../api/http";

export const sessionCookie = "ivq_session";
export const sessionMaxAge = 30 * 24 * 60 * 60;
export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("hex");

export function readCookie(request: Request, name: string) {
  return (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function setAuthCookie(response: Response, name: string, value: string, maxAge: number, secure: boolean) {
  response.headers.append("Set-Cookie", `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
}

export async function getAccount(database: PrismaClient, request: Request) {
  const token = readCookie(request, sessionCookie);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await database.authSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { account: true } });
  return session && session.expiresAt > new Date() ? session.account : null;
}

export async function requireAccount(database: PrismaClient, request: Request) {
  const account = await getAccount(database, request);
  if (!account) throw new ApiError(401, "AUTH_REQUIRED", "请先使用 Google 登录，再上传和处理视频");
  return account;
}
