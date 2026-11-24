// Creates an isolated fixture through the real job handlers with a mock provider.
// This is a local SSR test, not a claim that fal enhanced a video.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma/client";
import { createJobHandlers } from "../src/libs/video/jobs";
import { createGoogleSession } from "../src/libs/auth/google";

async function main() {
  const path = resolve(process.argv[2] || "");
  if (!process.argv[2] || existsSync(path) || path === resolve("dev.db")) throw new Error("Pass a new, isolated test database path.");
  const database = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${path.replace(/\\/g, "/")}` }) });
  try {
    const root = new URL("../prisma/migrations/", import.meta.url);
    for (const entry of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      for (const statement of readFileSync(new URL(`${entry.name}/migration.sql`, root), "utf8").split(";").filter((sql) => sql.trim())) await database.$executeRawUnsafe(statement);
    }
    const session = await createGoogleSession(database, { sub: "isolated-mock-google-subject", email: "fixture@example.com" });
    const accountCookie = `ivq_session=${session.token}`;
    const handlers = createJobHandlers({
      database,
      provider: { submitUpScale: async () => ({ jobId: "mock-result-fixture" }), getJobStatus: async () => ({ status: "SUCCEEDED", resultUrl: "https://media.example.com/result.mp4" }) },
      readMetadata: async (url) => ({ durationSec: 4, width: url.endsWith("result.mp4") ? 768 : 384, height: url.endsWith("result.mp4") ? 432 : 216 }),
    });
    const response = await handlers.POST(new Request("http://localhost:3002/api/jobs", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: accountCookie },
      body: JSON.stringify({ url: "https://media.example.com/input.mp4", scale: 2, denoise: true, visitorId: "isolated-result-fixture" }),
    }));
    if (!response.ok) throw new Error(await response.text());
    const { jobId } = await response.json();
    const ownerCookie = response.headers.getSetCookie()[0].split(";")[0];
    const done = await handlers.GET(new Request(`http://localhost:3002/api/jobs/${jobId}`, { headers: { Cookie: ownerCookie } }), { params: Promise.resolve({ id: jobId }) });
    if ((await done.json()).status !== "SUCCEEDED") throw new Error("Fixture pipeline did not complete.");
    // Local illustration clips make the player testable without fal/R2 credentials.
    await database.videoJob.update({ where: { id: jobId }, data: { originalUrl: "/demos/flowers-before.mp4", resultUrl: "/demos/flowers-after.mp4" } });
    writeFileSync(`${path}.fixture.json`, JSON.stringify({ jobId, ownerCookie, accountCookie, databaseUrl: `file:${path.replace(/\\/g, "/")}` }));
    console.log(JSON.stringify({ jobId, fixtureFile: `${path}.fixture.json`, kind: "mock-provider SSR fixture" }));
  } finally { await database.$disconnect(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
