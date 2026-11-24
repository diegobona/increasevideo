import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "../src/generated/prisma/client";
import { registerD1, type D1Connection } from "../src/libs/db/d1";

/** Uses the real Prisma D1 adapter against SQLite with D1 batch commit/rollback
 * semantics. It never connects to a Cloudflare account or the local dev.db. */
export function createD1Fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../cloudflare/migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  class Prepared {
    constructor(readonly sql: string, readonly values: SQLInputValue[] = []) {}
    bind(...values: SQLInputValue[]) { return new Prepared(this.sql, values); }
    result() {
      const query = sqlite.prepare(this.sql);
      if (query.columns().length) return { results: query.all(...this.values), success: true, meta: { changes: 0 } };
      return { results: [], success: true, meta: { changes: Number(query.run(...this.values).changes) } };
    }
    async raw(options?: { columnNames?: boolean }) {
      const query = sqlite.prepare(this.sql);
      const columns = query.columns().map((column) => column.name);
      query.setReturnArrays(true);
      const rows = query.all(...this.values);
      return options?.columnNames ? [columns, ...rows] : rows;
    }
    async run() { return this.result(); }
    async all() { return this.result(); }
    async first(column?: string) {
      const row = sqlite.prepare(this.sql).get(...this.values);
      return column ? row?.[column] ?? null : row ?? null;
    }
  }
  const connection = {
    prepare: (sql: string) => new Prepared(sql),
    async batch(statements: Prepared[]) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((query) => query.result());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Connection;
  const database = registerD1(new PrismaClient({ adapter: new PrismaD1(connection) }), connection);
  return { database, connection, sqlite, close: () => sqlite.close() };
}
