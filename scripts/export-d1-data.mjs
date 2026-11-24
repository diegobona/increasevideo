import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";

// One-time initial migration of the existing business records. Auth sessions,
// OAuth state and IP counters stay local; users sign in again on the new origin.
const db = new DatabaseSync("dev.db", { readOnly: true });
const quote = (value) => value === null ? "NULL" : typeof value === "number" || typeof value === "bigint" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const statements = [];
const counts = {};
for (const table of ["Account", "Order", "VideoJob", "CreditLedger", "UsageEvent"]) {
  const rows = db.prepare(`SELECT * FROM "${table}"`).all();
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
  const dates = new Set(columns.filter((column) => /DATETIME/i.test(column.type)).map((column) => column.name));
  counts[table] = rows.length;
  for (const row of rows) {
    for (const key of dates) if (typeof row[key] === "number") row[key] = new Date(row[key]).toISOString();
    statements.push(`INSERT OR IGNORE INTO "${table}" (${Object.keys(row).map((name) => `"${name}"`).join(",")}) VALUES (${Object.values(row).map(quote).join(",")});`);
  }
}
mkdirSync(".wrangler/deployment", { recursive: true });
writeFileSync(".wrangler/deployment/initial-business-data.sql", statements.join("\n") + "\n");
writeFileSync(".wrangler/deployment/source-counts.json", JSON.stringify(counts, null, 2));
console.log(counts);
db.close();
