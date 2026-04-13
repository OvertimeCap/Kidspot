# AGENTS.md

## Purpose
Continue development of KidSpot without disrupting existing architecture, conventions, or integrations.

## Priority order
1. Current codebase
2. This file (`AGENTS.md`)
3. `CLAUDE.md`
4. Other repository documentation

If docs and code diverge, follow the code and report the discrepancy explicitly.

## First actions — every new session
Inspect before anything else:
- `package.json`, `app/`, `components/`, `lib/`, `server/`, `shared/schema.ts`
- Firebase config files, DB connection config, env example files
- `graphify-out/GRAPH_REPORT.md` (or `graphify-out/wiki/index.md` if it exists)

Then provide: stack summary, architecture summary, outdated doc notes, safe next steps.

## Before any code change
1. Read this file and `CLAUDE.md` completely.
2. Inspect the relevant codebase area.
3. Summarize your understanding.
4. State which files you intend to change and why.
5. Wait for approval if the change is structural, risky, or affects integrations.

## Working style
- Small, safe, incremental changes only.
- Explain architectural or non-obvious decisions briefly.
- For complex tasks, form an Agent Team per Orchestration Rules in `CLAUDE.md`.
- After editing, summarize what changed, risks, and any follow-up needed.

## Non-negotiable safety rules
- Do not rename folders, move files in bulk, or reorganize architecture without approval.
- Do not swap libraries or services without approval.
- Do not modify environment variable names without approval.
- Do not introduce parallel patterns when one already exists.
- Do not create duplicate service layers, auth flows, API clients, or storage abstractions.
- Do not edit files unrelated to the current task.

## What requires approval
- New dependency
- Schema change
- Service or provider replacement
- Large-file refactoring
- Auth flow change
- Navigation structure change
- Storage provider logic change
- Environment variable strategy change
- API contract change (app ↔ backend)

## Current conventions to preserve

### Frontend
- `app/` → Expo Router screens; `components/` → reusable UI; `lib/` → utilities and API helpers
- React Query for all server state; API access via `lib/api.ts` only
- `AuthProvider` + AsyncStorage for auth; do not create new auth patterns
- Admin mobile screens: `app/admin-*.tsx`

### Backend
- `server/index.ts` → Express setup; `server/routes.ts` → route definitions
- `server/storage.ts` → repository layer; route handlers never query the DB directly
- `server/auth.ts` → auth middleware
- **Two-level routing rule** (see `CLAUDE.md` for full detail):
  - Isolated endpoint → `server/routes.ts` + `server/storage.ts`
  - 3+ related routes → `server/routes/[feature].ts`, mounted in `server/index.ts`
- All route inputs validated with Zod at route boundary
- New files: max 300 lines

### Database
- PostgreSQL + Drizzle ORM; Neon as host
- Prefer `NEON_DATABASE_URL`; fall back to `DATABASE_URL` if already used in code
- Inspect `shared/schema.ts` before any schema change; explain impact first
- Preserve naming conventions already used by existing tables and columns

### Auth
- Two separate systems: mobile (`users` table) and backoffice (`backoffice_users`)
- Do not merge tokens, roles, middleware, or session logic without approval

### Storage
- Firebase Storage is active; reuse existing helpers, bucket config, and naming conventions
- Do not create a second storage approach without explicit approval

### External integrations
- Reuse existing integration points (Google Places, Foursquare, AI provider hub, Neon, Firebase, SMTP)
- Do not hardcode secrets; do not bypass the configurable AI provider selection

## Change workflow (non-trivial tasks)
1. Inspect relevant files
2. Summarize current behavior
3. List planned edits
4. Get approval if required
5. Implement smallest viable change
6. Run `npm run lint`; apply Security Checklist from `CLAUDE.md` for auth/routes/schema tasks
7. Report: what changed, risks, follow-ups

## Browser QA
- Playwright MCP is configured in `.mcp.json` (always available)
- Read `TESTING_MAP.md` before any flow; create it if missing
- Report errors with: screen, reproduction steps, console/network logs
- Do not declare a feature validated without running flows

## Graphify
- Read `graphify-out/GRAPH_REPORT.md` before answering architecture questions
- After modifying code, run:
  ```bash
  python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
  ```

## Output style
- Be concise and explicit
- Mention affected files and assumptions
- Flag uncertainty as: "I found X in code, but docs say Y"
- Do not guess; do not silently skip a discrepancy

## Continuity note
This project was developed with Claude Code. Preserve existing conventions — do not introduce a new house style without approval.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current
