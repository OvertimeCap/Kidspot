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

- When adding new API routes, add the endpoint to `server/routes.ts` and the database logic to `server/storage.ts`.
- Use Zod (`zod` + `drizzle-zod`) for request validation at route boundaries.
- Frontend API calls use the helpers in `lib/api.ts`. Keep them there.
- The `replit.md` file contains architecture documentation; update it when making significant structural changes.
- Ask for confirmation before adding new external dependencies or making major structural changes.
