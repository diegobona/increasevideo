import "server-only";
import type { PrismaD1 } from "@prisma/adapter-d1";
import type { PrismaClient } from "@/generated/prisma/client";
import { ApiError } from "../api/http";

export type D1Connection = Extract<ConstructorParameters<typeof PrismaD1>[0], { prepare: unknown }>;
export type SqlStatement = { sql: string; values: (string | number | null)[] };
const connections = new WeakMap<PrismaClient, D1Connection>();

export function registerD1(client: PrismaClient, connection: D1Connection) {
  connections.set(client, connection);
  return client;
}
export const getD1 = (client: PrismaClient) => connections.get(client);
export const statement = (sql: string, ...values: SqlStatement["values"]): SqlStatement => ({ sql, values });

export async function batchD1(connection: D1Connection, statements: SqlStatement[]) {
  return connection.batch(statements.map(({ sql, values }) => connection.prepare(sql).bind(...values)));
}

/** Plan reads first, then atomically commit the whole mutation. All business-table
 * writes increment AtomicGuard via SQL triggers. A concurrent write invalidates
 * the plan; D1 rolls the entire batch back and we recompute from current data.
 * Never use Prisma's no-op D1 interactive transactions for billing. */
export async function atomicD1<T>(database: PrismaClient, plan: () => Promise<{ statements: SqlStatement[]; result: T }>): Promise<T> {
  const connection = getD1(database);
  if (!connection) throw new Error("Missing D1 binding");
  for (let attempt = 0; attempt < 6; attempt++) {
    const guard = await connection.prepare('SELECT version FROM AtomicGuard WHERE id = 1').first<{ version: number }>();
    if (!guard) throw new Error("D1 migrations have not been applied");
    const planned = await plan();
    try {
      await batchD1(connection, [statement('UPDATE AtomicGuard SET version = CASE WHEN version = ? THEN version ELSE -1 END WHERE id = 1', guard.version), ...planned.statements]);
      return planned.result;
    } catch (error) {
      if (!(error instanceof Error) || !/CHECK constraint failed:.*version/i.test(error.message)) throw error;
    }
  }
  throw new ApiError(409, "CONCURRENT_UPDATE", "Another request updated your account. Please retry.");
}
