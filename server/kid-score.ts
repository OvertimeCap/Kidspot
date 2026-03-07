/**
 * KidScore module
 *
 * Architecture note:
 * ─────────────────
 * Google Places has no kid-friendly signal, so we layer our own scoring on top.
 * Each place receives a KidScore (0-100) computed from four signal groups:
 *
 *   1. Place type  — playground / amusement_center are inherently kid-oriented (+40)
 *   2. Community flags — kid_flags crowd-sourced via KidSpot reviews stored in our DB
 *                        (espaco_kids +25, trocador +20, cadeirao +15)
 *   3. Quality     — Google rating ≥ 4.0 (+10)
 *   4. Proximity   — within 1 km of the search origin (+10)
 *
 * The score is advisory; clients may sort by kidScore, distance, or rating.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SortBy = "kidScore" | "distance" | "rating";

export type EstablishmentType =
  | "playground"
  | "park"
  | "amusement_center"
  | "restaurant"
  | "cafe"
  | "shopping_mall";

export type KidFlags = {
  espaco_kids?: boolean;
  trocador?: boolean;
  cadeirao?: boolean;
};

export type KidScoreBreakdown = {
  type_bonus: number;
  espaco_kids_bonus: number;
  trocador_bonus: number;
  cadeirao_bonus: number;
  rating_bonus: number;
  proximity_bonus: number;
};

export type PlaceWithScore = {
  place_id: string;
  name: string;
  address: string;
  location: { lat: number; lng: number };
  rating?: number;
  user_ratings_total?: number;
  types: string[];
  opening_hours?: { open_now?: boolean; weekday_text?: string[] };
  photos?: { photo_reference: string }[];
  kid_score: number;
  kid_score_breakdown: KidScoreBreakdown;
  distance_meters?: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Haversine formula – returns distance between two WGS-84 coordinates in metres.
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * filterOpenNow – removes places whose opening_hours.open_now is not true.
 * Places with no opening_hours data are kept (we cannot confirm they are closed).
 */
export function filterOpenNow<T extends { opening_hours?: { open_now?: boolean } }>(
  places: T[],
): T[] {
  return places.filter(
    (p) => p.opening_hours == null || p.opening_hours.open_now !== false,
  );
}

/**
 * calculateKidScore – assigns a score and full breakdown to a single place.
 *
 * @param place        Minimal place data from Google Places
 * @param originLat    Search origin latitude  (used for proximity bonus)
 * @param originLng    Search origin longitude (used for proximity bonus)
 * @param kidFlags     Optional crowd-sourced flags from KidSpot reviews
 */
export function calculateKidScore(
  place: {
    place_id: string;
    name: string;
    address: string;
    location: { lat: number; lng: number };
    rating?: number;
    user_ratings_total?: number;
    types: string[];
    opening_hours?: { open_now?: boolean; weekday_text?: string[] };
    photos?: { photo_reference: string }[];
  },
  originLat: number,
  originLng: number,
  kidFlags: KidFlags = {},
): PlaceWithScore {
  const breakdown: KidScoreBreakdown = {
    type_bonus: 0,
    espaco_kids_bonus: 0,
    trocador_bonus: 0,
    cadeirao_bonus: 0,
    rating_bonus: 0,
    proximity_bonus: 0,
  };

  // 1. Type bonus (+40 for playground/amusement_center)
  const kidTypes = new Set(["playground", "amusement_center"]);
  if (place.types.some((t) => kidTypes.has(t))) {
    breakdown.type_bonus = 40;
  }

  // 2. Community flags from KidSpot reviews
  if (kidFlags.espaco_kids) breakdown.espaco_kids_bonus = 25;
  if (kidFlags.trocador) breakdown.trocador_bonus = 20;
  if (kidFlags.cadeirao) breakdown.cadeirao_bonus = 15;

  // 3. Quality bonus (+10 for rating ≥ 4.0 with at least 5 reviews)
  if ((place.rating ?? 0) >= 4.0 && (place.user_ratings_total ?? 0) >= 5) {
    breakdown.rating_bonus = 10;
  }

  // 4. Proximity bonus (+10 if within 1 km of search origin)
  const distanceMeters = haversineMeters(
    originLat,
    originLng,
    place.location.lat,
    place.location.lng,
  );
  if (distanceMeters <= 1_000) {
    breakdown.proximity_bonus = 10;
  }

  const kid_score =
    breakdown.type_bonus +
    breakdown.espaco_kids_bonus +
    breakdown.trocador_bonus +
    breakdown.cadeirao_bonus +
    breakdown.rating_bonus +
    breakdown.proximity_bonus;

  return {
    ...place,
    kid_score,
    kid_score_breakdown: breakdown,
    distance_meters: Math.round(distanceMeters),
  };
}

/**
 * sortResults – orders a list of scored places by the chosen strategy.
 *
 *   kidScore  – highest score first (default)
 *   distance  – nearest first
 *   rating    – highest Google rating first
 */
export function sortResults(places: PlaceWithScore[], sortBy: SortBy): PlaceWithScore[] {
  const copy = [...places];
  switch (sortBy) {
    case "distance":
      copy.sort((a, b) => (a.distance_meters ?? Infinity) - (b.distance_meters ?? Infinity));
      break;
    case "rating":
      copy.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      break;
    case "kidScore":
    default:
      copy.sort((a, b) => b.kid_score - a.kid_score);
      break;
  }
  return copy;
}
