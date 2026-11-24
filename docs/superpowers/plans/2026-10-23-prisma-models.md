# Prisma Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the four requested Prisma models and generate, apply, and verify the initial SQLite migration.

**Architecture:** Use matching stable Prisma 7.9.0 CLI, client, and SQLite adapter versions. Keep database access in `src/libs/db.ts`, with generated code ignored and generated during builds. Keep the ledger as the source of credit changes; do not add a mutable balance or API endpoints. Version 7.10.1 failed SQLite Studio's file: protocol acceptance check, while the 7.9.0 source uses standard URL protocol parsing.

**Tech Stack:** Next.js 15, TypeScript, Prisma 7, SQLite, Node's built-in test runner.

**Requirements:** Root `AGENTS.md` and the four-table design in the user's current request. Work in the current directory, which has no Git repository.

### Task 1: Define database behavior checks

- [ ] Add `tests/database.test.mjs` using isolated in-memory SQLite databases and the actual migration SQL.
- [ ] Verify the missing-migration failure before writing schema or migration code.
- [ ] Cover table creation, valid and invalid scales and enums, unique owner/session tokens, foreign keys, nullable attribution, and ledger-derived credits.

### Task 2: Add Prisma configuration and models

**Files:** `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `prisma.config.ts`, `prisma/schema.prisma`, `.env`, `.env.example`, `.gitignore`, `eslint.config.mjs`, `src/libs/db.ts`.

- [ ] Pin matching stable Prisma 7 dependencies and the libSQL SQLite adapter; declare all imported dependencies. The better-sqlite3 prebuilt download timed out and no local C++ toolchain is installed, so use Prisma's official libSQL adapter for local files.
- [ ] Configure local SQLite at `file:./dev.db` in the repository root, load environment variables, and ignore database files and generated clients.
- [ ] Add the requested enums, fields, cuid IDs, timestamps, and relevant lookup indexes.
- [ ] Keep originalUrl required and resultUrl optional. Make stripePaymentIntentId optional until payment completion, and attribution/referrer/jobId optional for visits without a job or referrer. Use a unique required ownerToken supplied securely by future server logic.
- [ ] Relate CreditLedger to Order with restricted deletion; relate UsageEvent to VideoJob with SetNull deletion to preserve attribution.
- [ ] Add a local server-only Prisma singleton in `src/libs/db.ts`. Cloudflare D1 runtime adaptation remains future deployment work.

### Task 3: Generate and apply the initial migration

**Files:** `prisma/migrations/*_init/migration.sql`, `prisma/migrations/migration_lock.toml`.

- [ ] Generate the initial SQL with Prisma `migrate dev --name init --create-only`.
- [ ] Before applying it, add SQLite CHECK constraints for scales and enums, since Prisma schema syntax does not express SQLite CHECK constraints.
- [ ] Run the user's `npx prisma migrate dev --name init` and generate the Prisma client explicitly.
- [ ] Run database behavior checks and verify migration status, including a repeat `migrate dev` with no drift.

### Task 4: Documentation and acceptance

**Files:** `docs/database-schema.md`, `README.md`.

- [ ] Document each table, nullability decisions, ledger sum semantics, indexes, custom SQL constraints, and local commands.
- [ ] Run `npx prisma studio`, open the local UI, and confirm that all four application tables are visible.
- [ ] Run `pnpm lint && pnpm build` and report actual results with links to schema and migration.
