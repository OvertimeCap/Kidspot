# KidSpot API Reference

Base URL: `https://<your-domain>`

All endpoints are prefixed with `/api`.

---

## Health

### GET /api/health

Returns server status.

```bash
curl https://<your-domain>/api/health
# {"ok":true}
```

### GET /api/kidspot/ping-db

Checks database connectivity.

```bash
curl https://<your-domain>/api/kidspot/ping-db
# {"db":true}
```

---

## Places (Google Places Proxy)

### POST /api/places/search

Search for kid-friendly places in Franca or Ribeirão Preto.

**Body:**

| Field        | Type   | Required | Description                                       |
|--------------|--------|----------|---------------------------------------------------|
| city         | string | Yes      | `"Franca"` or `"Ribeirão Preto"`                 |
| query        | string | No       | Search keyword (e.g. `"parque"`, `"restaurante"`) |
| lat          | number | No       | Latitude for nearby search                        |
| lng          | number | No       | Longitude for nearby search                       |
| radiusMeters | number | No       | Radius in meters (default: 5000)                  |

If `lat` and `lng` are provided, nearby search is used. Otherwise, text search biased to the city.

**Text search example:**
```bash
curl -X POST https://<your-domain>/api/places/search \
  -H "Content-Type: application/json" \
  -d '{"city": "Franca", "query": "parque infantil"}'
```

**Nearby search example:**
```bash
curl -X POST https://<your-domain>/api/places/search \
  -H "Content-Type: application/json" \
  -d '{"city": "Ribeirão Preto", "lat": -21.1704, "lng": -47.8102, "radiusMeters": 3000}'
```

**Response:**
```json
{
  "places": [
    {
      "place_id": "ChIJ...",
      "name": "Parque Maurílio Biagi",
      "formatted_address": "Av. ..., Ribeirão Preto - SP",
      "location": { "lat": -21.17, "lng": -47.81 },
      "types": ["park", "point_of_interest"],
      "rating": 4.5,
      "user_ratings_total": 1234
    }
  ]
}
```

---

### GET /api/places/details

Get full details for a specific place.

**Query params:**

| Param    | Required | Description              |
|----------|----------|--------------------------|
| place_id | Yes      | Google Places place_id   |

```bash
curl "https://<your-domain>/api/places/details?place_id=ChIJ..."
```

**Response:**
```json
{
  "place": {
    "place_id": "ChIJ...",
    "name": "Parque Maurílio Biagi",
    "formatted_address": "Av. ..., Ribeirão Preto - SP",
    "location": { "lat": -21.17, "lng": -47.81 },
    "types": ["park"],
    "rating": 4.5,
    "user_ratings_total": 1234,
    "opening_hours": {
      "open_now": true,
      "weekday_text": ["Segunda-feira: 06:00 – 20:00", "..."]
    },
    "photos": [{ "photo_reference": "Aap_uEA..." }],
    "website": "https://example.com",
    "formatted_phone_number": "(16) 3977-8000"
  }
}
```

---

## Reviews (KidSpot Layer)

### POST /api/reviews

Submit a KidScore review for a place.

**Body:**

| Field      | Type   | Required | Description                               |
|------------|--------|----------|-------------------------------------------|
| place_id   | string | Yes      | Google Places place_id                    |
| rating     | number | Yes      | Integer 1–5                               |
| kid_flags  | object | Yes      | Boolean criteria (see below)              |
| note       | string | No       | Optional text comment                     |

**kid_flags fields:**
- `trocador` – Has baby changing station
- `cadeirao` – Has high chairs
- `banheiro_familia` – Has family bathroom
- `espaco_kids` – Has kids play area
- `seguro` – Felt safe for children

```bash
curl -X POST https://<your-domain>/api/reviews \
  -H "Content-Type: application/json" \
  -d '{
    "place_id": "ChIJ...",
    "rating": 5,
    "kid_flags": {
      "trocador": true,
      "cadeirao": true,
      "banheiro_familia": false,
      "espaco_kids": true,
      "seguro": true
    },
    "note": "Ótimo para crianças pequenas!"
  }'
```

**Response:** `201 Created`
```json
{
  "review": {
    "id": "uuid",
    "place_id": "ChIJ...",
    "rating": 5,
    "kid_flags": { ... },
    "note": "Ótimo para crianças pequenas!",
    "created_at": "2026-03-04T10:00:00.000Z"
  }
}
```

---

### GET /api/reviews

Get all reviews for a place.

**Query params:**

| Param    | Required | Description            |
|----------|----------|------------------------|
| place_id | Yes      | Google Places place_id |

```bash
curl "https://<your-domain>/api/reviews?place_id=ChIJ..."
```

**Response:**
```json
{
  "reviews": [
    {
      "id": "uuid",
      "place_id": "ChIJ...",
      "rating": 5,
      "kid_flags": { "trocador": true, "cadeirao": true, ... },
      "note": "Ótimo!",
      "created_at": "2026-03-04T10:00:00.000Z"
    }
  ]
}
```

---

## Favorites (KidSpot Layer)

### POST /api/favorites/toggle

Toggle a place as favorite for an anonymous user. If the favorite already exists, it is removed. If not, it is added.

**Body:**

| Field    | Type   | Required | Description                            |
|----------|--------|----------|----------------------------------------|
| user_key | string | Yes      | Anonymous user identifier (UUID or device ID) |
| place_id | string | Yes      | Google Places place_id                 |

> **Note:** The place must have been searched first (via `POST /api/places/search`) so it exists in the KidSpot database.

```bash
curl -X POST https://<your-domain>/api/favorites/toggle \
  -H "Content-Type: application/json" \
  -d '{"user_key": "device-abc-123", "place_id": "ChIJ..."}'
```

**Response:**
```json
{ "added": true }
```
or
```json
{ "added": false }
```

---

### GET /api/favorites

Get all favorites for an anonymous user.

**Query params:**

| Param    | Required | Description               |
|----------|----------|---------------------------|
| user_key | Yes      | Anonymous user identifier |

```bash
curl "https://<your-domain>/api/favorites?user_key=device-abc-123"
```

**Response:**
```json
{
  "favorites": [
    {
      "id": "uuid",
      "user_key": "device-abc-123",
      "place_id": "ChIJ...",
      "created_at": "2026-03-04T10:00:00.000Z"
    }
  ]
}
```
