import "server-only";
import { env } from "cloudflare:workers";
import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "@/generated/prisma-workerd/client";
import type { PrismaClient as AppPrismaClient } from "@/generated/prisma/client";
import { registerD1, type D1Connection } from "./d1";

const connection = (env as unknown as { DB: D1Connection }).DB;
// Both clients are generated from the same schema. Their generic namespaces are
// distinct TypeScript types; only the engine-loading runtime differs here.
const client = new PrismaClient({ adapter: new PrismaD1(connection) });
export const db = registerD1(client as unknown as AppPrismaClient, connection);
