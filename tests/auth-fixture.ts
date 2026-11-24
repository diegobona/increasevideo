import { createHash } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import { ensureFreeGrant } from "../src/libs/billing/credits";
import { hashToken } from "../src/libs/auth/session";

const token = (id: string) => createHash("sha256").update(`test-session:${id}`).digest("hex");
export const accountCookie = (id: string) => `ivq_session=${token(id)}`;

export async function seedAccount(database: PrismaClient, id: string, grant = true) {
  await database.account.upsert({ where: { id }, update: {}, create: { id, googleSubject: `test-google:${id}`, email: `${id}@example.com` } });
  await database.authSession.upsert({ where: { tokenHash: hashToken(token(id)) },
    create: { tokenHash: hashToken(token(id)), accountId: id, expiresAt: new Date(Date.now() + 86_400_000) },
    update: { expiresAt: new Date(Date.now() + 86_400_000) },
  });
  if (grant) await ensureFreeGrant(database, id);
}
