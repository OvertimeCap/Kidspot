# AGENTS.md

## Purpose
Continue development of the KidSpot project without disrupting the existing architecture, conventions, or integrations already established in this repository.

## First rules
Before making any code change:
1. Read this file completely.
2. Read `CLAUDE.md` if it exists.
3. Inspect the current codebase structure and confirm whether the implementation still matches this document.
4. Summarize your understanding before any major task.
5. If you detect inconsistencies between docs and code, trust the codebase first and report the mismatch explicitly.

Do not start with broad refactors.
Do not replace architecture patterns unless explicitly approved.
Prefer small, safe, incremental changes.

## Project overview
KidSpot is a full-stack mobile application for discovering kid-friendly places.

Current documented stack:
- Frontend: Expo + React Native + TypeScript
- Navigation: Expo Router
- Server state: TanStack React Query
- Backend: Express.js + TypeScript
- Database: PostgreSQL with Drizzle ORM
- Primary database host: Neon
- File storage: Firebase Storage
- Repository hosting: GitHub

Important: some docs may be partially outdated. The current codebase is the source of truth. If code and docs differ, preserve the live implementation pattern already present in the repository and report the discrepancy.

## Working style
Follow these preferences:
- Give clear and direct answers.
- Work iteratively with small updates.
- Ask for confirmation before major structural changes.
- Ask for confirmation before adding new dependencies.
- Explain architectural or non-obvious decisions briefly and clearly.

## Non-negotiable safety rules
- Do not rename folders, move many files, or reorganize architecture without approval.
- Do not swap libraries or services without approval.
- Do not modify environment variable names lightly.
- Do not introduce parallel patterns when one already exists.
- Do not create duplicate service layers, auth flows, API clients, or storage abstractions.
- Do not edit unrelated files in the same task.
- Before editing, state which files you intend to change and why.
- After editing, summarize exactly what changed.

## Expected architecture
### Frontend
Expected folders and patterns:
- `app/` for Expo Router screens
- `components/` for reusable UI
- `lib/` for shared frontend utilities and API helpers
- Admin mobile screens in files like `app/admin-*.tsx`
- Path aliases may include `@/*` and `@shared/*`

Frontend rules:
- Use Expo Router conventions already present in the project.
- Use React Query for server state, fetching, caching, and mutations.
- Keep API access centralized through existing helpers in `lib/api.ts` or the current equivalent.
- Preserve existing auth flow with `AuthProvider` and AsyncStorage if still used in code.
- Do not create new API access patterns if one already exists.

### Backend
Expected folders and patterns:
- `server/index.ts` for Express setup
- `server/routes.ts` for route definitions
- `server/storage.ts` as the repository/data-access layer
- `server/auth.ts` for auth middleware
- Additional domain files such as pipeline, AI analysis, and KidScore logic

Backend rules:
- Route handlers should not query the database directly if `server/storage.ts` is the established repository layer.
- New database access should follow the existing storage/repository pattern already used in the codebase.
- New endpoints should be added consistently with the current route organization.
- Use validation at the route boundary, preferably following the current Zod pattern where already present.

### Database
Documented database expectations:
- PostgreSQL with Drizzle ORM
- Neon as primary database host
- Prefer `NEON_DATABASE_URL` when present
- Fall back to `DATABASE_URL` if that is how the current code is implemented

Database rules:
- Treat schema changes carefully.
- Before changing schema, inspect `shared/schema.ts` and current migration/db push workflow.
- Preserve naming conventions already used by the existing tables and columns.
- If a schema change is required, explain impact first.

Documented key tables include:
- `users`
- `backoffice_users`
- `places_kidspot`
- `cities`
- `reviews`
- `favorites`
- `enrichment_cache`
- `pipeline_runs`
- `kid_flags`

### Storage
Project note:
- Firebase Storage is considered part of the current project setup.

Storage rules:
- Before implementing upload or file changes, inspect the current Firebase integration in code.
- Reuse the existing Firebase Storage setup, helpers, bucket configuration, and naming conventions.
- Do not create a second storage approach unless explicitly requested.

### Auth
Documented auth model:
- Mobile auth for app users
- Separate backoffice auth for admin panel users

Auth rules:
- Preserve separation between mobile auth and backoffice auth.
- Do not merge tokens, roles, middleware, or session logic unless explicitly approved.
- Respect existing role names found in code.

### Admin and operations
Documented features include:
- Mobile admin screens
- Web admin panel at `/admin`
- AI provider hub
- Pipeline execution and city management
- KidScore and review analysis logic

Rules:
- Preserve role-based access control.
- Be careful with admin features because they often affect operations data and permissions.
- Do not simplify or bypass permission checks.

## External integrations
Documented integrations include:
- Google Places
- Foursquare
- OpenAI via AI provider hub
- Anthropic/Claude
- Perplexity
- Gemini
- Neon PostgreSQL
- Firebase Storage
- GitHub as repository host
- Optional SMTP/Nodemailer

Rules:
- Reuse existing integration points.
- Do not hardcode secrets.
- Do not change provider selection logic if a configurable AI provider hub already exists.

## Development commands
Use the commands defined in the repository if they still exist. Documented commands are:

```bash
npm run server:dev
npm run expo:dev
npm run db:push
npm run lint
npm run lint:fix
npm run expo:static:build
npm run server:build
npm run server:prod
```

If these commands fail or no longer exist, inspect `package.json` and use the real commands from the codebase.

## Change policy
For every non-trivial task, follow this sequence:
1. Inspect relevant files.
2. Summarize current behavior.
3. List planned file edits.
4. Wait for approval if the change is structural, risky, or affects integrations.
5. Implement the smallest viable change.
6. Run lint/build checks when applicable.
7. Report what changed, any risks, and any follow-up needed.

## What counts as a major change
Ask for approval before:
- Adding a new dependency
- Changing database schema
- Replacing a service or provider
- Refactoring large files into many files
- Changing auth flow
- Changing navigation structure
- Changing storage provider logic
- Altering environment variable strategy
- Changing API contracts used by app and backend

## Output style
When responding during development:
- Be concise
- Be explicit
- Mention affected files
- Mention assumptions
- Flag uncertainty clearly
- Prefer “I found X in code, but docs say Y” over guessing

## Priority order
When deciding what to trust:
1. Current codebase
2. This `AGENTS.md`
3. `CLAUDE.md`
4. Other repository documentation

## Recommended first action for any new session
Start by inspecting:
- `package.json`
- `app/`
- `components/`
- `lib/`
- `server/`
- `shared/schema.ts`
- Any Firebase config files
- Any DB connection config files
- Any env example files

Then provide:
- stack summary
- architecture summary
- likely outdated documentation notes
- list of safe next steps

## Instruction for migration from Claude Code
This repository was previously developed with Claude Code guidance. Maintain continuity with existing conventions rather than introducing a “new preferred style” from another coding agent.

Your job is to continue the same project cleanly, not reinterpret it from scratch.