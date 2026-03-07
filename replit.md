# KidSpot

A mobile app (Expo + Express) that helps families find kid-friendly places nearby.

## Stack

- **Frontend**: Expo (React Native) with Expo Router, `@tanstack/react-query`, TypeScript
- **Backend**: Express + TypeScript (`tsx` dev server on port 5000)
- **Database**: PostgreSQL via Drizzle ORM
- **External API**: Google Places (Nearby Search, Place Details, Photo proxy)

## Key directories

```
app/            Expo Router screens
components/     Shared React Native components
lib/            Client-side API helpers and query client
server/         Express backend
  google-places.ts   Google Places fetching + searchPlaces orchestrator
  kid-score.ts       KidScore scoring, filtering, sorting
  routes.ts          API route definitions
  storage.ts         Drizzle DB access layer
shared/
  schema.ts          Drizzle schema + Zod types (places, reviews, favorites)
```

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check |
| GET | /api/kidspot/ping-db | DB connectivity check |
| POST | /api/places/search | Main search endpoint (see below) |
| GET | /api/places/details | Place details by place_id |
| GET | /api/places/photo | Google photo proxy |
| GET | /api/reviews | Reviews for a place |
| POST | /api/reviews | Submit a review |
| GET | /api/favorites | User's favorites |
| POST | /api/favorites/toggle | Add/remove favorite |

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
  upsertPlace() batch          ← persists new place_ids to local DB
        │
        ▼
  getAggregatedKidFlagsForPlaces() ← batch-reads crowd-sourced kid_flags from reviews
        │
        ▼
  calculateKidScore()          ← type +40, espaco_kids +25, trocador +20,
                                   cadeirao +15, rating +10, proximity +10
        │
        ▼
  sortResults()                ← kidScore | distance | rating
        │
        ▼
  { places: PlaceWithScore[] }
```

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
        "proximity_bonus": 5
      },
      "distance_meters": 3821
    }
  ]
}
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| GOOGLE_PLACES_API_KEY | Yes | Google Places API key |
| DATABASE_URL | Yes | PostgreSQL connection string |
