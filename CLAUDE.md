# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KidSpot is a full-stack mobile application for discovering kid-friendly locations. It uses **Expo/React Native** (frontend) + **Express.js** (backend) + **PostgreSQL/Drizzle ORM** (database), all in TypeScript.

## Development Commands

```bash
# Start backend in development mode
npm run server:dev

# Start Expo frontend (requires Replit env vars for proxy URLs)
npm run expo:dev

# Push schema changes to the database
npm run db:push

# Lint
npm run lint
npm run lint:fix

# Production build & run
npm run expo:static:build   # builds Expo static bundle
npm run server:build        # bundles Express server with esbuild
npm run server:prod         # runs the production server
```

There is no test suite configured.

## Architecture

### Frontend (`app/`, `components/`, `lib/`)
- **Expo Router** file-based navigation. Tabs live in `app/(tabs)/`. Dynamic routes like `app/place/[place_id].tsx`.
- **TanStack React Query v5** for all server state (fetching, caching, mutations).
- **AuthProvider** (`lib/auth-context.tsx`) manages JWT tokens stored in AsyncStorage. Wrap all authenticated screens with this context.
- Path alias `@/*` maps to the project root; `@shared/*` maps to `shared/`.
- Admin screens are in `app/admin-*.tsx` and require the mobile `admin` role.

### Backend (`server/`)
- `server/index.ts` — Express setup, CORS config, middleware chain, mounts all routes, serves static files and the backoffice admin panel at `/admin`.
- `server/routes.ts` — All ~100+ API endpoints in one file (~2900 lines). Split logically by feature but not into separate files.
- `server/storage.ts` — Repository layer. All Drizzle ORM database queries go here; routes call storage functions, never query the DB directly.
- `server/auth.ts` — JWT middleware: `requireAuth`, `requireBackofficeAuth`, `requireRole(...)`, `optionalAuth`.

### Database (`shared/schema.ts`, `migrations/`)
- Single schema file defines all Drizzle tables. Run `npm run db:push` to apply changes.
- Key tables: `users` (mobile), `backoffice_users` (admin panel), `places_kidspot`, `cities`, `reviews`, `favorites`, `enrichment_cache`, `pipeline_runs`, `kid_flags`.

### Two Auth Systems
- **Mobile users** (`users` table): roles `admin`, `colaborador`, `parceiro`, `estabelecimento`, `usuario`. JWT with 7-day expiry.
- **Backoffice users** (`backoffice_users` table): roles `super_admin`, `admin`, `curador`, `analista`. Separate JWT with 2-hour expiry. Accessed via `/admin` web panel.

### AI & Pipeline (`server/pipeline.ts`, `server/ai-review-analysis.ts`)
- **AI Provider Hub**: multi-provider support (OpenAI, Anthropic, Perplexity, Gemini). Keys stored AES-256-GCM encrypted. Configured via backoffice admin panel; admins select provider/model per pipeline stage with fallback chains.
- **Pipeline**: automated city scanning — queries Google Places for kid-friendly locations, inserts them as `pendente`, logs metrics to `pipeline_runs`.
- `server/kid-score.ts` — KidScore algorithm: multi-layer scoring from place type, community flags (`espaco_kids`, `trocador`, `cadeirao`, etc.), ratings, and AI-analyzed review sentiment.

### Place Workflow
Places follow: `pendente` → `aprovado` / `rejeitado`. Only `aprovado` places appear in mobile search results.

### External APIs
- **Google Places**: primary place data (name, address, photos, reviews).
- **Foursquare**: enrichment (ratings, popularity) — results cached 7 days in `enrichment_cache`.
- **OpenAI** (via AI Provider Hub): NLP analysis of reviews for family-friendly signals — also cached 7 days.

## Key Conventions

- **Routing (two-level rule)**:
  - Isolated endpoints → add to `server/routes.ts` and the database logic to `server/storage.ts`.
  - New feature route groups (3+ related routes) → create `server/routes/[feature].ts`, export a router, mount it in `server/index.ts`.
  - New files must stay under **300 lines**. This rule applies to new or extracted files only; existing large files (e.g. `routes.ts`) are not subject to it.
- Use Zod (`zod` + `drizzle-zod`) for request validation at route boundaries.
- Frontend API calls use the helpers in `lib/api.ts`. Keep them there.
- Run `npm run lint` before declaring any task complete.
- The `replit.md` file contains architecture documentation; update it when making significant structural changes.
- Ask for confirmation before adding new external dependencies or making major structural changes.
- `AGENTS.md` takes precedence over this file when they conflict. Orchestration rules below are additive — they extend, not override, `AGENTS.md`.

## Security Checklist

Auto-review before closing any task that touches auth, routes, or schemas:

- **JWT**: every new protected route uses `requireAuth`, `requireBackofficeAuth`, or `requireRole()`; roles match the two-system model (mobile 7-day / backoffice 2-hour); no endpoint silently skips middleware.
- **Zod**: all route inputs (body, query, params) validated with explicit Zod schemas at the route boundary; no `as any` bypassing validation; insert operations use drizzle-zod insert schemas.
- **Secrets**: no keys, tokens, or passwords hardcoded; all secrets via `process.env`.
- **Lint**: `npm run lint` passes with zero new errors.

## Orchestration Rules

For **simple tasks** (single file, isolated change): use a single session.

For **complex tasks**, form an **Agent Team**. A task is complex if it:
1. Alters 3 or more files; or
2. Involves backend + frontend + tests; or
3. Touches auth, routes, database, permissions, or the admin panel; or
4. Requires automated browser navigation via MCP (Playwright is configured in `.mcp.json`); or
5. Requires structural refactoring or modularization.

### Agent Team — Roles

Create exactly these roles unless instructed otherwise:

| # | Role | Responsibility |
|---|---|---|
| 1 | **Team Lead / Arquiteto** | Approves plan; coordinates agents |
| 2 | **Desenvolvedor** | Implements code changes |
| 3 | **QA de Código** | Runs lint, reviews types, contracts, regressions |
| 4 | **Browser QA** | Validates flows in the browser via Playwright MCP |

### Team Lead Rules
- Do not approve vague plans.
- Only approve plans that specify: scope, target files, risks, and validation strategy.
- Provide enough context in tasks — teammates do not have the full conversation history.
- Write **"PLANO APROVADO"** explicitly before the Developer starts coding.
- Prefer teams of 3–4 agents; for tasks concentrated in one file, use sequential flow instead.

### Developer Rules
- Never expand `server/routes.ts` with new routes. Use `server/routes/[feature].ts` instead.
- Prefer modularization in `server/routes/`.
- Do not modify more files than necessary.
- Preserve Zod, JWT, storage layer, and existing conventions.
- New files must stay under 300 lines.

### QA de Código Rules
- Run `npm run lint` and other available local validations.
- Review imports, types, route contracts, and obvious regressions.
- Apply the Security Checklist above for any task touching auth, routes, or schemas.
- Do not declare success without objective validation.

### Browser QA Rules
- Playwright MCP (headless Chrome) is always available via `.mcp.json`.
- Read `TESTING_MAP.md` before executing flows. If it doesn't exist, create it at the project root documenting the flows you run.
- Report errors with: affected screen, reproduction steps, and relevant console/network logs.

### Handoff to Human
Only involve the human when:
- The plan is approved and ready to execute; or
- Implementation is validated and ready for human testing; or
- There is a real blocker requiring a product decision.
