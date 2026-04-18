# AGENTS.md - Regras Prioritárias (Otimizado)

**Propósito**: Desenvolva KidSpot preservando arquitetura existente. Priorize: 1) Código atual, 2) Este arquivo, 3) CLAUDE.md.[file:1]

## Primeiras Ações (Nova Sessão)
- Inspecione: package.json, app/, server/, sharedschema.ts, .mcp.json.
- Forneça: resumo stack/arq., discrepâncias docs, próximos passos seguros.[file:1]

## Antes de Alterar Código
1. Leia AGENTS.md + CLAUDE.md.
2. Liste arquivos alvo + justificativa.
3. Aguarde aprovação para: schema, auth, rotas, deps novas, refatorações grandes.[file:1][file:2]

## Estilo de Trabalho
- Mudanças pequenas/incrementais.
- Explique decisões arquiteturais brevemente.
- Use Agent Team para tarefas complexas (CLAUDE.md).[file:1][file:2]
- Após edição: resuma mudanças, riscos, follow-ups.[file:1]

## Regras de Segurança (Não Negociáveis)
- Sem renomear/mover arquivos em bulk.
- Sem trocar libs/serviços sem aprovação.
- Sem duplicar padrões (auth, storage, API).
- Arquivos novos: <300 linhas.[file:1][file:2]

## Convenções a Preservar
**Frontend**: Expo Router, React Query (lib/api.ts), AuthProvider (AsyncStorage).[file:1]
**Backend**: serverindex.ts (setup), serverroutes*.ts (rotas), serverstorage.ts (repo), serverauth.ts (JWT), Zod validação.[file:1][file:2]
**DB**: Drizzle/Neon (NEONDATABASEURL), sharedschema.ts.[file:1]
**Auth**: Mobile (7d) vs Backoffice (2h).[file:1]
**Externals**: Reutilize Google/Foursquare/AI Hub/Firebase.[file:1]

## Workflow Mudanças Não-Triviais
1. Inspecione arquivos.
2. Liste edições.
3. Aprove (se req.).
4. Implemente mínimo viável.
5. Lint + Security Checklist (CLAUDE.md).
6. Relate mudanças/riscos.[file:1][file:2]