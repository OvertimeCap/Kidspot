import {
  filterOpenNow,
  applyKidFilters,
  calculateKidScore,
  sortResults,
  type EstablishmentType,
  type SortBy,
  type PlaceWithScore,
} from "./kid-score";
import { getAggregatedKidFlagsForPlaces, upsertPlace } from "./storage";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!GOOGLE_PLACES_API_KEY) {
  console.warn("GOOGLE_PLACES_API_KEY is not set — Places API calls will fail");
}

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place";

const CITY_BIASES: Record<string, { lat: number; lng: number }> = {
  Franca: { lat: -20.5386, lng: -47.4009 },
  "Ribeirão Preto": { lat: -21.1704, lng: -47.8102 },
};

// Kid-friendly text search queries run in parallel when no user query is given
const KID_TEXT_QUERIES = [
  "parque playground infantil",
  "brinquedoteca área kids",
  "restaurante infantil crianças",
  "espaço kids monitores",
];

// Nearby search strategies: each runs as a separate request in parallel
const KID_NEARBY_STRATEGIES: Array<{ type?: string; keyword?: string }> = [
  { type: "park" },
  { type: "amusement_park" },
  { keyword: "brinquedoteca" },
  { keyword: "infantil criança kids" },
];

export type MinimalPlace = {
  place_id: string;
  name: string;
  formatted_address: string;
  location: { lat: number; lng: number };
  types: string[];
  rating?: number;
  user_ratings_total?: number;
  photos?: { photo_reference: string }[];
};

export type PlaceDetails = MinimalPlace & {
  opening_hours?: { open_now?: boolean; weekday_text?: string[] };
  website?: string;
  formatted_phone_number?: string;
};

function pickMinimal(place: Record<string, unknown>): MinimalPlace {
  const geometry = place.geometry as
    | { location: { lat: number; lng: number } }
    | undefined;
  const photos = place.photos as { photo_reference: string }[] | undefined;
  return {
    place_id: place.place_id as string,
    name: place.name as string,
    formatted_address: (place.formatted_address || place.vicinity || "") as string,
    location: geometry?.location ?? { lat: 0, lng: 0 },
    types: (place.types as string[]) ?? [],
    rating: place.rating as number | undefined,
    user_ratings_total: place.user_ratings_total as number | undefined,
    photos: photos?.slice(0, 1).map((p) => ({ photo_reference: p.photo_reference })),
  };
}

function deduplicateAndSort(places: MinimalPlace[]): MinimalPlace[] {
  const seen = new Set<string>();
  const unique: MinimalPlace[] = [];
  for (const p of places) {
    if (!seen.has(p.place_id)) {
      seen.add(p.place_id);
      unique.push(p);
    }
  }
  // Sort by number of ratings descending; no-rating entries go to the end
  unique.sort((a, b) => (b.user_ratings_total ?? 0) - (a.user_ratings_total ?? 0));
  return unique;
}

async function textSearchOne(
  query: string,
  lat?: number,
  lng?: number,
  radius = 10000,
): Promise<MinimalPlace[]> {
  const params = new URLSearchParams({
    query,
    key: GOOGLE_PLACES_API_KEY!,
    language: "pt-BR",
  });

  if (lat !== undefined && lng !== undefined) {
    params.set("location", `${lat},${lng}`);
    params.set("radius", String(radius));
  }

  const res = await fetch(`${PLACES_BASE}/textsearch/json?${params.toString()}`);
  if (!res.ok) return [];

  const data = (await res.json()) as {
    results: Record<string, unknown>[];
    status: string;
  };

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return [];
  return (data.results ?? []).map(pickMinimal);
}

async function nearbySearchOne(
  lat: number,
  lng: number,
  radius: number,
  strategy: { type?: string; keyword?: string },
): Promise<MinimalPlace[]> {
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    radius: String(radius),
    key: GOOGLE_PLACES_API_KEY!,
    language: "pt-BR",
  });

  if (strategy.type) params.set("type", strategy.type);
  else params.set("type", "establishment");

  if (strategy.keyword) params.set("keyword", strategy.keyword);

  const res = await fetch(`${PLACES_BASE}/nearbysearch/json?${params.toString()}`);
  if (!res.ok) return [];

  const data = (await res.json()) as {
    results: Record<string, unknown>[];
    status: string;
  };

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return [];
  return (data.results ?? []).map(pickMinimal);
}

export async function searchPlacesByText(
  city: string,
  query?: string,
): Promise<MinimalPlace[]> {
  const bias = CITY_BIASES[city];
  const lat = bias?.lat;
  const lng = bias?.lng;

  let queries: string[];

  if (query) {
    // User typed something specific — search for it with a kid-friendly suffix
    queries = [`${query} infantil criança em ${city} SP Brasil`];
  } else {
    // No query — run all kid-focused categories in parallel
    queries = KID_TEXT_QUERIES.map((q) => `${q} em ${city} SP Brasil`);
  }

  const results = await Promise.allSettled(
    queries.map((q) => textSearchOne(q, lat, lng, 10000)),
  );

  const all: MinimalPlace[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  return deduplicateAndSort(all);
}

export async function searchPlacesNearby(
  lat: number,
  lng: number,
  radiusMeters = 5000,
  keyword?: string,
): Promise<MinimalPlace[]> {
  let strategies: Array<{ type?: string; keyword?: string }>;

  if (keyword) {
    // User specified a keyword — search with kid-friendly context added
    strategies = [
      { keyword: `${keyword} infantil criança` },
      { keyword, type: "park" },
    ];
  } else {
    // No keyword — run all kid-focused strategies in parallel
    strategies = KID_NEARBY_STRATEGIES;
  }

  const results = await Promise.allSettled(
    strategies.map((s) => nearbySearchOne(lat, lng, radiusMeters, s)),
  );

  const all: MinimalPlace[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  return deduplicateAndSort(all);
}

// ─── New structured search API ────────────────────────────────────────────────

export type FetchGooglePlacesParams = {
  latitude: number;
  longitude: number;
  radius: number;
  type: EstablishmentType;
  query?: string;
};

type RawGooglePlace = {
  place_id: string;
  name: string;
  formatted_address?: string;
  vicinity?: string;
  geometry?: { location: { lat: number; lng: number } };
  types?: string[];
  rating?: number;
  user_ratings_total?: number;
  opening_hours?: { open_now?: boolean };
  photos?: { photo_reference: string }[];
};

/**
 * fetchGooglePlaces
 *
 * Single-strategy fetch from the Google Places Nearby Search API.
 * Radius is clamped to 10 000 m (Google's limit for nearbysearch with rankby=prominence).
 */
export async function fetchGooglePlaces(
  params: FetchGooglePlacesParams,
): Promise<
  Array<{
    place_id: string;
    name: string;
    address: string;
    location: { lat: number; lng: number };
    types: string[];
    rating?: number;
    user_ratings_total?: number;
    opening_hours?: { open_now?: boolean };
    photos?: { photo_reference: string }[];
  }>
> {
  if (!GOOGLE_PLACES_API_KEY) return [];

  const clampedRadius = Math.min(params.radius, 10_000);

  const qs = new URLSearchParams({
    location: `${params.latitude},${params.longitude}`,
    radius: String(clampedRadius),
    type: params.type,
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR",
  });

  if (params.query) qs.set("keyword", params.query);

  const res = await fetch(`${PLACES_BASE}/nearbysearch/json?${qs.toString()}`);
  if (!res.ok) return [];

  const data = (await res.json()) as {
    results: RawGooglePlace[];
    status: string;
  };

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return [];

  return (data.results ?? []).map((r) => ({
    place_id: r.place_id,
    name: r.name,
    address: r.formatted_address ?? r.vicinity ?? "",
    location: r.geometry?.location ?? { lat: 0, lng: 0 },
    types: r.types ?? [],
    rating: r.rating,
    user_ratings_total: r.user_ratings_total,
    opening_hours: r.opening_hours,
    photos: r.photos?.slice(0, 1).map((p) => ({ photo_reference: p.photo_reference })),
  }));
}

export type SearchPlacesParams = {
  latitude: number;
  longitude: number;
  radius: number;
  establishmentType: EstablishmentType;
  openNow?: boolean;
  query?: string;
  sortBy?: SortBy;
};

/**
 * searchPlaces
 *
 * Full orchestrated search pipeline:
 *   fetchGooglePlaces → filterOpenNow? → DB kid-flags enrichment
 *   → calculateKidScore → sortResults
 *
 * Also upserts discovered places into the local DB for future enrichment.
 */
export async function searchPlaces(
  params: SearchPlacesParams,
): Promise<PlaceWithScore[]> {
  const { latitude, longitude, radius, establishmentType, openNow, query, sortBy = "kidScore" } =
    params;

  // 1. Fetch from Google Places
  let raw = await fetchGooglePlaces({
    latitude,
    longitude,
    radius,
    type: establishmentType,
    query,
  });

  // 2. Deduplicate
  const seen = new Set<string>();
  raw = raw.filter((p) => {
    if (seen.has(p.place_id)) return false;
    seen.add(p.place_id);
    return true;
  });

  // 3. Optional openNow filter
  if (openNow) {
    raw = filterOpenNow(raw);
  }

  // 4. Apply the three-layer kid-relevance filter + blocklist
  raw = applyKidFilters(raw);

  // 5. Persist surviving places to local DB (non-blocking, failures are silent)
  await Promise.allSettled(
    raw.map((p) =>
      upsertPlace({
        place_id: p.place_id,
        city: "unknown",
        lat: String(p.location.lat),
        lng: String(p.location.lng),
      }),
    ),
  );

  // 6. Batch-fetch community kid-flags from our reviews DB
  const kidFlagsMap = await getAggregatedKidFlagsForPlaces(raw.map((p) => p.place_id));

  // 7. Score each place
  const scored = raw.map((p) =>
    calculateKidScore(p, latitude, longitude, kidFlagsMap.get(p.place_id) ?? {}),
  );

  // 8. Sort and return
  return sortResults(scored, sortBy);
}

// ─── Autocomplete & Geocode ───────────────────────────────────────────────────

export type AutocompleteSuggestion = {
  place_id: string;
  description: string;
};

/**
 * autocompletePlaces
 *
 * Calls the Google Places Autocomplete API to return city/region suggestions
 * for a partial text input. Results are biased toward the user's current
 * location (200 km radius) when lat/lng are provided, and restricted to Brazil.
 */
export async function autocompletePlaces(
  input: string,
  lat?: number,
  lng?: number,
): Promise<AutocompleteSuggestion[]> {
  if (!GOOGLE_PLACES_API_KEY || input.trim().length === 0) return [];

  const qs = new URLSearchParams({
    input: input.trim(),
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR",
    components: "country:br",
    types: "(cities)",
  });

  if (lat !== undefined && lng !== undefined) {
    qs.set("location", `${lat},${lng}`);
    qs.set("radius", "200000");
  }

  const res = await fetch(`${PLACES_BASE}/autocomplete/json?${qs.toString()}`);
  if (!res.ok) return [];

  const data = (await res.json()) as {
    predictions: { place_id: string; description: string }[];
    status: string;
  };

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return [];

  return (data.predictions ?? []).slice(0, 5).map((p) => ({
    place_id: p.place_id,
    description: p.description,
  }));
}

export type GeocodeResult = {
  lat: number;
  lng: number;
  label: string;
};

/**
 * geocodePlace
 *
 * Resolves a Google Places place_id to a lat/lng coordinate and a
 * human-readable label using the Places Details API.
 */
export async function geocodePlace(placeId: string): Promise<GeocodeResult> {
  if (!GOOGLE_PLACES_API_KEY) throw new Error("API key not configured");

  const qs = new URLSearchParams({
    place_id: placeId,
    fields: "geometry,formatted_address",
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR",
  });

  const res = await fetch(`${PLACES_BASE}/details/json?${qs.toString()}`);
  if (!res.ok) throw new Error(`Geocode request failed: ${res.status}`);

  const data = (await res.json()) as {
    result: {
      geometry?: { location: { lat: number; lng: number } };
      formatted_address?: string;
    };
    status: string;
  };

  if (data.status !== "OK") throw new Error(`Geocode status: ${data.status}`);

  const loc = data.result.geometry?.location;
  if (!loc) throw new Error("No geometry in geocode result");

  return {
    lat: loc.lat,
    lng: loc.lng,
    label: data.result.formatted_address ?? placeId,
  };
}

// ─── Legacy API (kept for backward compatibility) ─────────────────────────────

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const fields = [
    "place_id", "name", "formatted_address", "geometry", "types",
    "rating", "user_ratings_total", "opening_hours", "photos",
    "website", "formatted_phone_number",
  ].join(",");

  const params = new URLSearchParams({
    place_id: placeId,
    fields,
    key: GOOGLE_PLACES_API_KEY!,
    language: "pt-BR",
  });

  const url = `${PLACES_BASE}/details/json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Places Details failed: ${res.status}`);

  const data = (await res.json()) as {
    result: Record<string, unknown>;
    status: string;
  };
  if (data.status !== "OK") throw new Error(`Google Places status: ${data.status}`);

  const r = data.result;
  const geometry = r.geometry as { location: { lat: number; lng: number } } | undefined;
  const openingHours = r.opening_hours as
    | { open_now?: boolean; weekday_text?: string[] }
    | undefined;
  const photos = r.photos as { photo_reference: string }[] | undefined;

  return {
    place_id: r.place_id as string,
    name: r.name as string,
    formatted_address: (r.formatted_address ?? "") as string,
    location: geometry?.location ?? { lat: 0, lng: 0 },
    types: (r.types as string[]) ?? [],
    rating: r.rating as number | undefined,
    user_ratings_total: r.user_ratings_total as number | undefined,
    opening_hours: openingHours
      ? { open_now: openingHours.open_now, weekday_text: openingHours.weekday_text }
      : undefined,
    photos: photos?.slice(0, 5).map((p) => ({ photo_reference: p.photo_reference })),
    website: r.website as string | undefined,
    formatted_phone_number: r.formatted_phone_number as string | undefined,
  };
}
