import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";

// Only schema is exported here. Credentials, local sessions and videos are never
// part of the build output or migration artifact.
const db = new DatabaseSync(":memory:");
const root = new URL("../prisma/migrations/", import.meta.url);
for (const entry of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  db.exec(readFileSync(new URL(`${entry.name}/migration.sql`, root), "utf8"));
}
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name").all().map((row) => `${row.sql};`).join("\n\n");
const guard = `CREATE TABLE AtomicGuard (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL CHECK (version >= 0));\nINSERT INTO AtomicGuard (id, version) VALUES (1, 0);\n`;
const triggers = ["Account", "VideoJob", "Order", "CreditLedger"].flatMap((table) => ["INSERT", "UPDATE", "DELETE"].map((event) => `CREATE TRIGGER "revision_${table}_${event}" AFTER ${event} ON "${table}" BEGIN UPDATE AtomicGuard SET version = version + 1 WHERE id = 1; END;`)).join("\n");
mkdirSync(new URL("../cloudflare/migrations/", import.meta.url), { recursive: true });
writeFileSync(new URL("../cloudflare/migrations/0001_initial.sql", import.meta.url), `${schema}\n\n${guard}\n${triggers}\n`);
db.close();
console.log("D1 initial schema generated (8 application tables + transaction guard).");
