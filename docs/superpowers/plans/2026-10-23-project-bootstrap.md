# Project Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing package.json and the minimal project files needed to run real lint and production build checks.

**Architecture:** Use Next.js 15 App Router with TypeScript and Tailwind. Keep the initial page and layout as Server Components, rendering the H1 and text into the HTML. This task initializes the local project; Cloudflare deployment, video processing, storage, and billing are separate implementation work.

**Tech Stack:** Next.js 15, React, TypeScript, Tailwind CSS, ESLint, pnpm.

**Requirements:** Root AGENTS.md and the user's request to supply the missing package.json. The existing directory contains only AGENTS.md and is not a Git checkout, so work directly in the requested directory.

---

### Task 1: Add project configuration

**Files:** `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.gitignore`, `tsconfig.json`, `next-env.d.ts`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts`.

- [x] Query the package registry for compatible stable dependency versions, keeping Next.js and eslint-config-next on version 15.
- [x] Define real `dev`, `lint`, `build`, `start`, and `typecheck` scripts. Use ESLint directly with zero warnings allowed and `next build` for production.
- [x] Add strict TypeScript configuration and the `@/*` alias to `src/*`.
- [x] Configure Tailwind and Next.js ESLint rules. Do not disable build-time lint or type checks.
- [x] Ignore generated artifacts, dependencies, and local secrets.

### Task 2: Add the minimal App Router entry point

**Files:** `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `README.md`.

- [x] Add a root layout with English language and metadata for increasevideoquality.com.
- [x] Add a small placeholder home page with the H1 `Increase video quality` and truthful coming-soon text.
- [x] Keep both modules as Server Components and use dynamic server rendering rather than static export.
- [x] Include no API routes, upload handlers, prices, quotas, or unimplemented service integrations.
- [x] Document local setup and the fact that Cloudflare Pages SSR adaptation is not configured by this local bootstrap. Keep the deployment requirement in AGENTS.md unchanged.

### Task 3: Install and verify

- [x] Run `pnpm install` and retain the generated lockfile.
- [x] Run `pnpm lint && pnpm build`; both commands must succeed.
- [x] Start the production server and request `/` without a browser or JavaScript execution. Confirm HTTP 200, the H1, and the paragraph in the response HTML.
- [x] Stop the temporary server after verification and record the actual result.

Validation uses the real toolchain and an HTTP smoke check; configuration and the placeholder page do not need a separate unit-test framework.

Verified on 2026-10-23: `pnpm install --frozen-lockfile` exited successfully after configuring the reviewed `unrs-resolver@1.12.2` native preparation script. `pnpm lint && pnpm build` passed, and the build classified `/` as dynamically server-rendered. The production HTTP check returned 200 with the H1 and body paragraph in HTML, and its temporary server was stopped.
