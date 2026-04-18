# CLAUDE.md - KidSpot Dev Guide (Otimizado)

**Projeto**: App mobile Expo/React Native + Express/TS + PostgreSQL/Drizzle para locais kid-friendly.

## Comandos Dev
npm run server:dev # Backend
npm run expo:dev # Frontend (Replit env para proxy)
npm run db:push # Schema
npm run lint # Lint/fix
npm run expo:static # Build mobile
npm run server:prod # Build/prod server

text

## Arquitetura Essencial
**Frontend**: Expo Router (app/tabs/), TanStack Query, AuthProvider (JWT AsyncStorage), admin/ screens.
**Backend**: server/index.ts (setup), server/routes*.ts (100+ endpoints <300ln), server/storage.ts (Drizzle repo), server/auth.ts (JWT mobile 7d/backoffice 2h).
**DB**: shared/schema.ts (users, placeskidspot, cities, pipelineruns).
**AI Pipeline**: Multi-provider (OpenAI/Anthropic/etc., keys AES), KidScore (flags + review sentiment).
**Externals**: Google Places, Foursquare cache 7d, Neon DB.

## Convenções Chave
- Rotas: Zod/drizzle-zod validação; storage layer (no DB direto em routes).
- Auth: requireAuth/Role; mobile vs backoffice separados.
- Novas features: server/routes[feature].ts (<300ln), monte em index.ts.
- Lint zero erros; npm run lint pré-fim tarefa.

## Security Checklist (Auto-review)
- JWT em toda rota protegida.
- Zod em body/query/params.
- process.env para secrets.
- No hardcode.

## Orquestração
**Tarefas Simples**: Sessão única.
**Complexas** (>3 files, auth/DB/routes/admin): Agent Team.
**Roles**:
1. **Team Lead**: Plano aprovado → "PLANO APROVADO".
2. **Dev**: Implementa modular (no expand routes.ts).
3. **QA Código**: Lint, types, regressions.
4. **Browser QA**: Playwright (.mcp.json), leia TESTING_MAP.md.

**Human só em**: Plano pronto, impl validada, blocker real.

**Precedência**: AGENTS.md > este arquivo.