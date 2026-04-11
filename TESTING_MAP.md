# TESTING_MAP.md — Kidspot API Smoke Tests

> Criado pelo Browser QA após refatoração de `server/routes.ts` em módulos.
> Execute com o servidor rodando em `http://localhost:5000` (`npm run server:dev`).

## Como Executar

```bash
# 1. Suba o servidor
npm run server:dev

# 2. Substitua os valores de variáveis abaixo conforme seu ambiente:
#    TOKEN_MOBILE  — JWT de um usuário mobile válido
#    TOKEN_ADMIN   — JWT de um usuário com role "admin" (mobile)
#    TOKEN_BO      — JWT de um backoffice user válido
```

---

## Tabela de Testes

| # | Descrição | Método | URL | Headers / Body | Status Esperado | Resultado |
|---|-----------|--------|-----|----------------|-----------------|-----------|
| 1 | Health check | GET | `/api/health` | — | `200 {"ok":true}` | ✅ |
| 2 | DB ping | GET | `/api/kidspot/ping-db` | — | `200 {"db":true}` | ✅ |
| 3 | Filtros ativos (público) | GET | `/api/filters/active` | — | `200 {"filters":[...]}` | ✅ |
| 4 | Lista de cidades (público) | GET | `/api/cities/list` | — | `200 {"cities":[...]}` | ✅ |
| 5 | Rota protegida sem token | GET | `/api/auth/me` | — | `401` | — |
| 6 | Login mobile válido | POST | `/api/auth/login` | `{"email":"...","password":"..."}` | `200` + `token` | — |
| 7 | Me autenticado | GET | `/api/auth/me` | `Authorization: Bearer TOKEN_MOBILE` | `200` + `user` | — |
| 8 | Registro de novo usuário | POST | `/api/auth/register` | `{"name":"Test","email":"...","password":"123456"}` | `201` + `token` | — |
| 9 | Google auth (token inválido) | POST | `/api/auth/google` | `{"accessToken":"invalid"}` | `401` | — |
| 10 | Busca de places | POST | `/api/places/search` | `{"latitude":-20.0,"longitude":-48.0,"establishmentTypes":["park"]}` | `200 {"places":[...]}` | — |
| 11 | Autocomplete places | GET | `/api/places/autocomplete?input=parque` | — | `200 {"suggestions":[...]}` | — |
| 12 | Geocode (sem param) | GET | `/api/places/geocode` | — | `400` | — |
| 13 | Reviews de um place | GET | `/api/reviews?place_id=PLACE_ID` | — | `200 {"reviews":[...]}` | — |
| 14 | Stories nearby | GET | `/api/stories/nearby?lat=-20&lng=-48` | — | `200 {"stories":[...]}` | — |
| 15 | Check cidade por coordenadas | GET | `/api/cities/check?lat=-20.37&lng=-48.0` | — | `200` | — |
| 16 | Backoffice login válido | POST | `/api/backoffice/auth/login` | `{"email":"...","password":"..."}` | `200` + `token` | — |
| 17 | Backoffice me | GET | `/api/backoffice/auth/me` | `Authorization: Bearer TOKEN_BO` | `200` + `user` | — |
| 18 | Admin cities (autenticado) | GET | `/api/admin/cities` | `Authorization: Bearer TOKEN_ADMIN` | `200 {"cities":[...]}` | — |
| 19 | Admin filters (autenticado) | GET | `/api/admin/filters` | `Authorization: Bearer TOKEN_ADMIN` | `200` | — |
| 20 | Admin AI prompts | GET | `/api/admin/ai-prompts` | `Authorization: Bearer TOKEN_ADMIN` | `200` | — |
| 21 | Admin kidscore rules | GET | `/api/admin/kidscore-rules` | `Authorization: Bearer TOKEN_ADMIN` | `200` | — |
| 22 | Curation queue | GET | `/api/admin/curation/queue` | `Authorization: Bearer TOKEN_ADMIN` | `200` | — |
| 23 | Curation pending count | GET | `/api/admin/curation/pending-count` | `Authorization: Bearer TOKEN_ADMIN` | `200` | — |
| 24 | Pipeline runs | GET | `/api/admin/pipeline/runs` | `Authorization: Bearer TOKEN_ADMIN` | `200` | — |
| 25 | Blacklist | GET | `/api/admin/blacklist` | `Authorization: Bearer TOKEN_ADMIN` | `200` | — |
| 26 | Sponsorship plans | GET | `/api/admin/sponsorship/plans` | `Authorization: Bearer TOKEN_ADMIN` | `200` | — |
| 27 | Feedback unread count | GET | `/api/admin/feedback/unread-count` | `Authorization: Bearer TOKEN_ADMIN` | `200` | — |
| 28 | AI providers config | GET | `/api/admin/ai-providers` | `Authorization: Bearer TOKEN_ADMIN` | `200` | — |
| 29 | Pipeline routing | GET | `/api/admin/pipeline-routing` | `Authorization: Bearer TOKEN_ADMIN` | `200` | — |
| 30 | Favoritos (sem token) | GET | `/api/favorites` | — | `401` | — |

---

## Critério de Sucesso

- **Testes 1–4**: verificados automaticamente pelo Browser QA (servidor live).
- **Testes 5–30**: executar com tokens reais do ambiente de desenvolvimento.
- Nenhum endpoint deve retornar `500` em condições normais.
- Rotas protegidas sem token devem sempre retornar `401`.

## Notas de Arquitetura

- **Refatoração realizada em:** 2026-04-10
- **Arquivo original:** `server/routes.ts` (3994 linhas) → substituído por thin orchestrator (49 linhas)
- **Módulos criados:** 21 arquivos em `server/routes/` (todos ≤ 300 linhas)
- `server/index.ts` não foi alterado
- `server/storage.ts`, `server/auth.ts`, `shared/schema.ts` não foram alterados
