# KidSpot

A mobile app (Expo + Express) that helps families find kid-friendly places nearby.

## Stack

- **Frontend**: Expo (React Native) with Expo Router, `@tanstack/react-query`, TypeScript
- **Backend**: Express + TypeScript (`tsx` dev server on port 5000)
- **Database**: PostgreSQL via Drizzle ORM
- **External APIs**: Google Places, Foursquare Places, OpenAI (review analysis)

## Key directories

```
app/            Expo Router screens
components/     Shared React Native components
lib/            Client-side API helpers and query client
server/         Express backend
  google-places.ts       Google Places fetching + searchPlaces orchestrator
  kid-score.ts           KidScore scoring, filtering, sorting
  foursquare.ts          Foursquare Places API integration + caching
  ai-review-analysis.ts  OpenAI-powered review analysis for family signals
  routes.ts              API route definitions
  storage.ts             Drizzle DB access layer
shared/
  schema.ts          Drizzle schema + Zod types (users, places, reviews, favorites, enrichment_cache)
lib/
  auth-context.tsx   AuthProvider + useAuth() hook (JWT persistence, login/register/logout)
```

## Authentication

JWT-based authentication with 4 user roles:
- **admin** — Sócios e desenvolvedores
- **colaborador** — Equipe de gestão
- **parceiro** — Estabelecimentos com parceria contratual
- **usuario** — Usuários finais (role padrão para novos cadastros)

Auth state is stored in AsyncStorage (JWT token + user object). The `AuthProvider` in `app/_layout.tsx` manages the state. The token is injected in all API requests via `setAuthToken()` in `lib/query-client.ts`.

New users register with role `usuario`. Roles `admin`, `colaborador`, and `parceiro` are assigned manually in the database by an admin.

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/health | — | Health check |
| GET | /api/kidspot/ping-db | — | DB connectivity check |
| POST | /api/auth/register | — | Register (email, password, name) |
| POST | /api/auth/login | — | Login → JWT token |
| GET | /api/auth/me | Required | Get current user info |
| POST | /api/places/search | — | Main search endpoint (see below) |
| GET | /api/places/details | — | Place details by place_id |
| GET | /api/places/photo | — | Google photo proxy |
| GET | /api/reviews | — | Reviews for a place |
| POST | /api/reviews | Required | Submit a review |
| GET | /api/favorites | Required | User's favorites |
| POST | /api/favorites/toggle | Required | Add/remove favorite |

## POST /api/places/search

### Architecture note

```
Google Places Nearby Search
        │
        ▼
  fetchGooglePlaces()          ← single type, coordinate+radius query, ≤10 km
        │
        ▼
  filterOpenNow()  (optional)  ← removes places with open_now === false
        │
        ▼
  applyKidFilters()            ← three progressive layers + blocklist:
    ├─ Blocklist               – hard-exclude adult/commercial keyword matches
    ├─ Layer 1: allowed types  – only playground/park/zoo/restaurant/cafe/etc.
    ├─ Layer 2: kid evidence   – keyword in name OR inherently-kid type
    └─ Layer 3: quality gate   – rating ≥ 4.2, ≥ 20 ratings, ≥ 1 photo
        │
        ▼
  upsertPlace() batch          ← persists surviving place_ids to local DB
        │
        ▼
  getAggregatedKidFlagsForPlaces() ← batch-reads crowd-sourced kid_flags from reviews
        │
        ▼
  calculateKidScore() (1st pass) ← type +40, espaco_kids +25, trocador +20,
                                   cadeirao +15, rating +10, proximity +10
        │
        ▼
  ┌─── Enrichment (top 30 candidates, in parallel) ───┐
  │  fetchPlaceReviews()      ← Google review texts    │
  │  matchFoursquarePlace()   ← Foursquare rating/pop  │
  │  analyzeReviewsWithAI()   ← OpenAI family analysis │
  └────────────────────────────────────────────────────┘
        │
        ▼
  calculateKidScore() (2nd pass) ← adds foursquare_bonus (up to +15),
                                     cross_source_bonus (+5 or +10),
                                     and AI analysis merged into review_bonus
        │
        ▼
  sortResults()                ← kidScore | distance | rating
                                   tiebreaker: user_ratings_total → rating → distance
        │
        ▼
  { places: PlaceWithScore[] }
```

### Enrichment cache

Results from Foursquare and OpenAI are cached per place_id in the `enrichment_cache` table for 7 days. This avoids redundant API calls and keeps response times fast for repeat searches.

### Kid filter constants (server/kid-score.ts)

**Allowed types (Layer 1):** playground, amusement_center, park, zoo, tourist_attraction, restaurant, cafe, shopping_mall, sports_club, community_center

**Kid keywords (Layer 2):** kids, kid, infantil, crianças, family, playground, brinquedoteca, parquinho, recreação, espaço kids, baby, menu infantil, cadeirão, trocador, parque, zoo, zoológico…

**Auto-pass types (skip Layer 2):** playground, amusement_center, zoo, community_center, sports_club

**Blocklist:** advocacia, contabilidade, cartório, oficina, consultoria, transportadora, indústria, fábrica, depósito, clínica, hospital, farmácia, posto, combustível, igreja, condomínio

### KidScore breakdown

| Bonus | Source | Max points |
|-------|--------|-----------|
| type_bonus | Premium kid types (playground, zoo, etc.) | +40 |
| espaco_kids_bonus | Community review flag | +25 |
| trocador_bonus | Community review flag | +20 |
| cadeirao_bonus | Community review flag | +15 |
| rating_bonus | Google rating ≥ 4.2 with ≥ 20 reviews | +10 |
| proximity_bonus | Within 1 km of search origin | +10 |
| review_bonus | Tier 1/Tier 2 keyword analysis of Google reviews | variable |
| foursquare_bonus | Foursquare rating, tips, photos, popularity | up to +15 |
| cross_source_bonus | Google + Foursquare mutual quality confirmation | +5 or +10 |

### Request body

```json
{
  "latitude": -23.5505,
  "longitude": -46.6333,
  "radius": 5000,
  "establishmentType": "park",
  "openNow": true,
  "query": "espaço kids",
  "sortBy": "kidScore"
}
```

Supported `establishmentType` values: `playground`, `park`, `amusement_center`, `restaurant`, `cafe`, `shopping_mall`.

Supported `sortBy` values: `kidScore` (default), `distance`, `rating`.

### Response shape

```json
{
  "places": [
    {
      "place_id": "ChIJ...",
      "name": "Parque Ibirapuera",
      "address": "Av. Pedro Álvares Cabral, São Paulo",
      "location": { "lat": -23.5872, "lng": -46.6576 },
      "rating": 4.7,
      "user_ratings_total": 82340,
      "types": ["park", "point_of_interest"],
      "opening_hours": { "open_now": true },
      "photos": [{ "photo_reference": "ATtYBwJ..." }],
      "kid_score": 60,
      "kid_score_breakdown": {
        "type_bonus": 0,
        "espaco_kids_bonus": 25,
        "trocador_bonus": 20,
        "cadeirao_bonus": 0,
        "rating_bonus": 10,
        "proximity_bonus": 5,
        "review_bonus": 37,
        "foursquare_bonus": 7,
        "cross_source_bonus": 10
      },
      "distance_meters": 3821
    }
  ]
}
```

## Backoffice RBAC System

The backoffice has its own separate authentication system with 4 roles:

- **super_admin** — Unrestricted access to all 12 modules including AI Provider Hub and User Management
- **admin** — Access to all modules except AI Provider Hub and User Management
- **curador** — Operational access to Curation Queue, Gallery, Community Inbox, and "Run search" in Pipeline; read-only elsewhere
- **analista** — Read-only access in Prompts, Filters, KidScore, Curation, Pipeline, Cities, Community, Partnerships

### Backoffice Auth Flow

1. A super admin account is seeded in the DB on first deploy (credentials managed via environment or DB tooling — do not commit credentials to source code).
2. Super admin invites collaborators via `POST /api/backoffice/users/invite`
3. Invited user receives an activation link with a one-time token (72h TTL)
4. User activates account via `POST /api/backoffice/auth/activate` with token + new password
5. User logs in via `POST /api/backoffice/auth/login` and receives a 2h JWT

### Backoffice API Routes

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | /api/backoffice/auth/login | — | Login with email/password |
| GET | /api/backoffice/auth/me | backoffice | Get current user |
| POST | /api/backoffice/auth/activate | — | Activate account with invite token |
| GET | /api/backoffice/users | super_admin | List all backoffice collaborators |
| POST | /api/backoffice/users/invite | super_admin | Invite a new collaborator |
| PATCH | /api/backoffice/users/:id/role | super_admin | Change a collaborator's role |
| PATCH | /api/backoffice/users/:id/status | super_admin | Activate/deactivate a collaborator |
| GET | /api/backoffice/audit-log | super_admin | Paginated audit log with filters |
| GET | /api/backoffice/permissions | backoffice | Permission matrix for current role |

### Backoffice Database Tables

- `backoffice_users` — Collaborators with role, status, invite token
- `audit_log` — All actions with user, action, module, before/after payload, IP, timestamp

### Session Expiry

- Backoffice JWT TTL: 2 hours
- Mobile app session: 2h inactivity timeout tracked via AsyncStorage `last_active`
- On expiry, session is cleared and user is redirected to login

### Frontend Access

- Mobile app: Admin/Colaborador role → Profile tab → "Controle de Acesso (RBAC)" button → `app/backoffice-rbac.tsx`
- Login with backoffice credentials (separate from app user account)
- Super Admins see: Collaborators list + Audit Log tabs
- Non-super-admins see: Permission matrix for their role

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| GOOGLE_PLACES_API_KEY | Yes | Google Places API key |
| DATABASE_URL | Yes | PostgreSQL connection string |
| JWT_SECRET | Yes (prod) | Secret key for signing JWT tokens (defaults to dev fallback) |
| FOURSQUARE_API_KEY | No | Foursquare Places API key (enrichment) |
| OPENAI_API_KEY | No | OpenAI API key (AI review analysis) |
| SMTP_HOST | No | SMTP server host for invite emails (if unset, link is returned in API response) |
| SMTP_PORT | No | SMTP port (default: 587) |
| SMTP_SECURE | No | Set to "true" for TLS on port 465 |
| SMTP_USER | No | SMTP auth username |
| SMTP_PASS | No | SMTP auth password |
| SMTP_FROM | No | From address for invite emails (default: noreply@kidspot.app) |
