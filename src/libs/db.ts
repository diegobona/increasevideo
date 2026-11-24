import "server-only";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

const globalForDb = globalThis as unknown as {
  db: PrismaClient | undefined;
};

export const db =
  globalForDb.db ??
  new PrismaClient({
    adapter: new PrismaLibSql({
      url: process.env.DATABASE_URL ?? "file:./dev.db",
    }),
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}
