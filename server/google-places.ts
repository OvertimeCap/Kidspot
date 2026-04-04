import {
  filterOpenNow,
  applyKidFilters,
  calculateKidScore,
  sortResults,
  type EstablishmentType,
  type SortBy,
  type PlaceWithScore,
} from "./kid-score";
import { getAggregatedKidFlagsForPlaces, upsertPlace, getNonApprovedPlaceIds } from "./storage";
import { matchFoursquarePlace, calculateFoursquareBonus, calculateCrossSourceBonus, type FoursquareMatch } from "./foursquare";
import { analyzeReviewsWithAI, calculateAIReviewBonus } from "./ai-review-analysis";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!GOOGLE_PLACES_API_KEY) {
  console.warn("GOOGLE_PLACES_API_KEY is not set — Places API calls will fail");
}

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place";
const GEOCODING_BASE = "https://maps.googleapis.com/maps/api/geocode";
const FETCH_TIMEOUT_MS = 8_000;

async function fetchWithTimeout(
  url: string,
  label: string,
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`Google Places fetch timed out: ${label}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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

  let res: globalThis.Response;
  try {
    res = await fetchWithTimeout(`${PLACES_BASE}/textsearch/json?${params.toString()}`, "textSearchOne");
  } catch { return []; }
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

  let res: globalThis.Response;
  try {
    res = await fetchWithTimeout(`${PLACES_BASE}/nearbysearch/json?${params.toString()}`, "nearbySearchOne");
  } catch { return []; }
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

// ─── Review fetching ──────────────────────────────────────────────────────────

const REVIEW_FETCH_TIMEOUT_MS = 5_000;
const REVIEW_ENRICH_TOP_N = 30;

/**
 * fetchPlaceTextData
 *
 * Fetches `reviews` + `editorial_summary` from the Google Places Details API
 * for a single place. Returns all available text strings combined so that
 * `analyseReviews` has the richest possible signal.
 *
 * - reviews          : up to 5 user reviews in pt-BR (Google's limit)
 * - editorial_summary: short Google-authored description; often mentions
 *                      "family-friendly", "kids area", etc. — included as
 *                      an extra text source at no additional API cost.
 *
 * Returns an empty array on any error.
 */
export async function fetchPlaceReviews(placeId: string): Promise<string[]> {
  if (!GOOGLE_PLACES_API_KEY) return [];

  const qs = new URLSearchParams({
    place_id: placeId,
    fields: "reviews,editorial_summary",
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVIEW_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${PLACES_BASE}/details/json?${qs.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      result?: {
        reviews?: Array<{ text?: string }>;
        editorial_summary?: { overview?: string };
      };
      status: string;
    };

    if (data.status !== "OK" || !data.result) return [];

    const texts: string[] = [];

    // Add editorial summary first (higher signal-to-noise than user reviews)
    const overview = data.result.editorial_summary?.overview;
    if (overview && overview.trim().length > 0) texts.push(overview.trim());

    // Add user reviews
    for (const r of data.result.reviews ?? []) {
      const t = r.text?.trim() ?? "";
      if (t.length > 0) texts.push(t);
    }

    return texts;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
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

  let res: globalThis.Response;
  try {
    res = await fetchWithTimeout(
      `${PLACES_BASE}/nearbysearch/json?${qs.toString()}`,
      `fetchGooglePlaces type="${params.type}"`,
    );
  } catch { return []; }
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
  /** Single type (kept for backward compat). Ignored when establishmentTypes is provided. */
  establishmentType?: EstablishmentType;
  /** When provided, runs one Google fetch per type in parallel and merges results. */
  establishmentTypes?: EstablishmentType[];
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
  const { latitude, longitude, radius, establishmentType, establishmentTypes, openNow, query, sortBy = "kidScore" } =
    params;

  // 1. Determine which types to search
  const typesToSearch: EstablishmentType[] =
    establishmentTypes && establishmentTypes.length > 0
      ? establishmentTypes
      : establishmentType
        ? [establishmentType]
        : [];

  if (typesToSearch.length === 0) return [];

  // 2. Fetch from Google Places — run one request per type in parallel
  const fetchResults = await Promise.allSettled(
    typesToSearch.map((t) =>
      fetchGooglePlaces({ latitude, longitude, radius, type: t, query }),
    ),
  );

  const combined = fetchResults.flatMap((r) =>
    r.status === "fulfilled" ? r.value : [],
  );

  // 3. Deduplicate by place_id
  const seen = new Set<string>();
  let raw = combined.filter((p) => {
    if (seen.has(p.place_id)) return false;
    seen.add(p.place_id);
    return true;
  });

  // 4. Optional openNow filter
  if (openNow) {
    raw = filterOpenNow(raw);
  }

  // 4. Apply the three-layer kid-relevance filter + blocklist
  raw = applyKidFilters(raw);

  // 4b. Exclude places that exist in local DB with non-approved status
  const nonApprovedIds = await getNonApprovedPlaceIds(raw.map((p) => p.place_id));
  if (nonApprovedIds.size > 0) {
    raw = raw.filter((p) => !nonApprovedIds.has(p.place_id));
  }

  // 5. Persist surviving places to local DB (non-blocking, failures are silent)
  // New places discovered via app search are auto-approved (backward compat)
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

  // 7. First-pass score (without reviews) to identify top candidates
  const firstPass = raw.map((p) =>
    calculateKidScore(p, latitude, longitude, kidFlagsMap.get(p.place_id) ?? {}),
  );
  const sortedFirstPass = sortResults(firstPass, sortBy);

  // 8. Fetch Google reviews + enrichment for the top N results in parallel
  //    For non-kidScore sorts (distance/rating), skip Foursquare and AI enrichment
  //    since those bonuses don't affect the ranking anyway.
  const topCandidates = sortedFirstPass.slice(0, REVIEW_ENRICH_TOP_N);
  const restCandidates = sortedFirstPass.slice(REVIEW_ENRICH_TOP_N);

  const topRawPlaces = raw.filter((p) =>
    topCandidates.some((tc) => tc.place_id === p.place_id),
  );

  const useEnrichment = sortBy === "kidScore";

  const [reviewResults, foursquareResults] = await Promise.all([
    Promise.allSettled(
      topCandidates.map((p) => fetchPlaceReviews(p.place_id)),
    ),
    useEnrichment
      ? Promise.allSettled(
          topRawPlaces.map((p) =>
            matchFoursquarePlace(p.name, p.location.lat, p.location.lng, p.place_id),
          ),
        )
      : Promise.resolve(topRawPlaces.map(() => ({ status: "fulfilled" as const, value: null }))),
  ]);

  const reviewsMap = new Map<string, string[]>();
  topCandidates.forEach((p, i) => {
    const r = reviewResults[i];
    reviewsMap.set(p.place_id, r.status === "fulfilled" ? r.value : []);
  });

  const foursquareMatchMap = new Map<string, FoursquareMatch | null>();
  const foursquareMap = new Map<string, number>();
  topRawPlaces.forEach((p, i) => {
    const r = foursquareResults[i];
    const match = r.status === "fulfilled" ? r.value : null;
    foursquareMatchMap.set(p.place_id, match);
    foursquareMap.set(p.place_id, calculateFoursquareBonus(match));
  });

  // 8b. Run AI review analysis in parallel (only for kidScore sort)
  const aiMap = new Map<string, number>();
  if (useEnrichment) {
    const placesWithReviews = topRawPlaces.filter(
      (p) => (reviewsMap.get(p.place_id)?.length ?? 0) > 0,
    );
    const aiResults = await Promise.allSettled(
      placesWithReviews.map((p) =>
        analyzeReviewsWithAI(p.place_id, p.name, reviewsMap.get(p.place_id) ?? []),
      ),
    );

    placesWithReviews.forEach((p, i) => {
      const r = aiResults[i];
      const analysis = r.status === "fulfilled" ? r.value : null;
      aiMap.set(p.place_id, calculateAIReviewBonus(analysis));
    });
  }

  // 9. Re-score top candidates with review texts + enrichment data
  const enrichedTop = topRawPlaces.map((p) => {
    const fsqMatch = foursquareMatchMap.get(p.place_id) ?? null;
    return calculateKidScore(
      p,
      latitude,
      longitude,
      kidFlagsMap.get(p.place_id) ?? {},
      reviewsMap.get(p.place_id) ?? [],
      {
        foursquareBonus: foursquareMap.get(p.place_id) ?? 0,
        aiReviewBonus: aiMap.get(p.place_id) ?? 0,
        crossSourceBonus: calculateCrossSourceBonus(p.rating, p.user_ratings_total, fsqMatch),
      },
    );
  });

  // 10. Merge enriched top + rest, then sort and return
  const allScored = [...enrichedTop, ...restCandidates];
  return sortResults(allScored, sortBy);
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

  let res: globalThis.Response;
  try {
    res = await fetchWithTimeout(`${PLACES_BASE}/autocomplete/json?${qs.toString()}`, "autocompletePlaces");
  } catch { return []; }
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

export type EstablishmentSuggestion = {
  place_id: string;
  description: string;
  main_text: string;
  secondary_text: string;
};

/**
 * autocompleteEstablishments
 *
 * Calls the Google Places Autocomplete API restricted to establishments
 * (not cities). Used by the backoffice to search for places to add.
 */
export async function autocompleteEstablishments(
  input: string,
  lat?: number,
  lng?: number,
): Promise<EstablishmentSuggestion[]> {
  if (!GOOGLE_PLACES_API_KEY || input.trim().length === 0) return [];

  const qs = new URLSearchParams({
    input: input.trim(),
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR",
    components: "country:br",
    types: "establishment",
  });

  if (lat !== undefined && lng !== undefined) {
    qs.set("location", `${lat},${lng}`);
    qs.set("radius", "50000");
  }

  let res: globalThis.Response;
  try {
    res = await fetchWithTimeout(`${PLACES_BASE}/autocomplete/json?${qs.toString()}`, "autocompleteEstablishments");
  } catch { return []; }
  if (!res.ok) return [];

  const data = (await res.json()) as {
    predictions: Array<{
      place_id: string;
      description: string;
      structured_formatting: { main_text: string; secondary_text?: string };
    }>;
    status: string;
  };

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return [];

  return (data.predictions ?? []).slice(0, 8).map((p) => ({
    place_id: p.place_id,
    description: p.description,
    main_text: p.structured_formatting?.main_text ?? p.description,
    secondary_text: p.structured_formatting?.secondary_text ?? "",
  }));
}

export type GeocodeResult = {
  lat: number;
  lng: number;
  label: string;
};

export type CityGeocodeResult = {
  nome: string;
  estado: string;
  latitude: number;
  longitude: number;
};

/**
 * geocodeCityPlace
 *
 * Resolves a Google Places place_id to city name, state UF, and coordinates.
 * Uses address_components to extract the locality name and state short_name.
 */
export async function geocodeCityPlace(placeId: string): Promise<CityGeocodeResult> {
  if (!GOOGLE_PLACES_API_KEY) throw new Error("API key not configured");

  const qs = new URLSearchParams({
    place_id: placeId,
    fields: "address_components,geometry",
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR",
  });

  const res = await fetchWithTimeout(`${PLACES_BASE}/details/json?${qs.toString()}`, "geocodeCityPlace");
  if (!res.ok) throw new Error(`Geocode request failed: ${res.status}`);

  const data = (await res.json()) as {
    result: {
      address_components?: { long_name: string; short_name: string; types: string[] }[];
      geometry?: { location: { lat: number; lng: number } };
    };
    status: string;
  };

  if (data.status !== "OK") throw new Error(`Geocode status: ${data.status}`);

  const loc = data.result.geometry?.location;
  if (!loc) throw new Error("No geometry in geocode result");

  const components = data.result.address_components ?? [];
  const localityComp = components.find(c => c.types.includes("locality") || c.types.includes("administrative_area_level_2"));
  const stateComp = components.find(c => c.types.includes("administrative_area_level_1"));

  if (!localityComp) throw new Error("Could not extract city name from address components");
  if (!stateComp) throw new Error("Could not extract state from address components");

  return {
    nome: localityComp.long_name,
    estado: stateComp.short_name,
    latitude: loc.lat,
    longitude: loc.lng,
  };
}

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

  const res = await fetchWithTimeout(`${PLACES_BASE}/details/json?${qs.toString()}`, "geocodePlace");
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

// ─── Claimable place search ───────────────────────────────────────────────────

export type ClaimablePlace = {
  place_id: string;
  name: string;
  address: string;
  photo_reference?: string;
};

/**
 * textSearchClaimable
 *
 * Searches Google Places Text Search for a business by name + optional city.
 * Returns a simplified list suitable for the claim flow.
 */
export async function textSearchClaimable(
  query: string,
  city?: string,
): Promise<ClaimablePlace[]> {
  if (!GOOGLE_PLACES_API_KEY) return [];

  const searchQuery = city ? `${query} em ${city}` : query;
  const params = new URLSearchParams({
    query: searchQuery,
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR",
    type: "establishment",
  });

  let res: globalThis.Response;
  try {
    res = await fetchWithTimeout(`${PLACES_BASE}/textsearch/json?${params.toString()}`, "textSearchClaimable");
  } catch { return []; }
  if (!res.ok) return [];

  const data = (await res.json()) as {
    results: Array<{
      place_id: string;
      name: string;
      formatted_address?: string;
      vicinity?: string;
      photos?: { photo_reference: string }[];
    }>;
    status: string;
  };

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return [];

  return (data.results ?? []).slice(0, 10).map((r) => ({
    place_id: r.place_id,
    name: r.name,
    address: r.formatted_address ?? r.vicinity ?? "",
    photo_reference: r.photos?.[0]?.photo_reference,
  }));
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
  const res = await fetchWithTimeout(url, "getPlaceDetails");
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

export async function reverseGeocodeCity(lat: number, lng: number): Promise<{ label: string; estado: string | null } | null> {
  const qs = new URLSearchParams({
    latlng: `${lat},${lng}`,
    result_type: "locality",
    language: "pt-BR",
    key: GOOGLE_PLACES_API_KEY!,
  });
  try {
    const res = await fetchWithTimeout(`${GEOCODING_BASE}/json?${qs.toString()}`, "reverseGeocodeCity");
    const data = await res.json();
    const result = data.results?.[0];
    if (!result) return null;
    const label = result.formatted_address as string;
    const stateComponent = result.address_components?.find((c: any) =>
      c.types.includes("administrative_area_level_1")
    );
    const estado = stateComponent?.long_name ?? null;
    return { label, estado };
  } catch {
    return null;
  }
}
