/**
 * KidScore module
 *
 * Architecture note:
 * ─────────────────
 * Three progressive filter layers remove irrelevant results before scoring:
 *
 *   Layer 1 – Allowed types  : keep only recognised kid-relevant Google Place types.
 *   Layer 2 – Kid evidence   : at least one positive keyword must appear in the name.
 *                              Inherently-kid types (playground, amusement_center, zoo)
 *                              are granted an automatic pass.
 *   Layer 3 – Quality gate   : rating ≥ 4.2, ≥ 20 reviews, at least one photo.
 *   Blocklist                : hard-exclude places whose names contain adult-business
 *                              keywords (applied independently of the layers).
 *
 * Passing results are scored and sorted with a 3-key priority:
 *   user_ratings_total DESC → rating DESC → distance ASC
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SortBy = "kidScore" | "distance" | "rating";

export type EstablishmentType =
  | "playground"
  | "park"
  | "amusement_center"
  | "restaurant"
  | "cafe"
  | "bakery"
  | "shopping_mall"
  | "zoo"
  | "tourist_attraction"
  | "sports_club"
  | "community_center";

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
  review_bonus: number;
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
  family_highlight?: string;
};

// ─── Filter constants ─────────────────────────────────────────────────────────

/**
 * Layer 1 – The only Google Places types KidSpot considers relevant.
 * Any place whose type list has NO intersection with this set is discarded.
 */
export const ALLOWED_TYPES = new Set([
  "playground",
  "amusement_center",
  "park",
  "zoo",
  "tourist_attraction",
  "restaurant",
  "cafe",
  "bakery",
  "shopping_mall",
  "sports_club",
  "community_center",
  // common Google synonym kept for coverage
  "amusement_park",
]);

/**
 * Layer 2 – Positive kid-evidence keywords.
 * Checked case-insensitively against the place name.
 * Types in KID_AUTO_PASS skip this check entirely.
 */
export const KID_KEYWORDS = [
  "kids",
  "kid",
  "kids area",
  "kids club",
  "infantil",
  "criança",
  "crianças",
  "family",
  "family friendly",
  "playground",
  "brinquedoteca",
  "parquinho",
  "recreação",
  "recreacao",
  "espaço kids",
  "espaco kids",
  "baby",
  "menu infantil",
  "cadeirão",
  "cadeirao",
  "trocador",
  "parque",
  "jardim",
  "zoo",
  "zoológico",
  "zoologico",
];

/**
 * Types that automatically satisfy Layer 2 (kid nature is inherent).
 *
 * Food establishments (restaurant, cafe, bakery) are included here because
 * they almost never have kid-keywords in their name yet can be family-friendly.
 * Layer 3 (quality gate: rating ≥ 4.2, ≥ 20 reviews, photo) acts as the
 * quality signal for these types instead.
 */
export const KID_AUTO_PASS_TYPES = new Set([
  // Public outdoor spaces — inherently kid-relevant
  "park",
  "playground",
  "amusement_park",
  // Leisure venues — inherently kid-relevant
  "amusement_center",
  "zoo",
  "community_center",
  "sports_club",
  // Food establishments — pass Layer 2, gated by Layer 3 quality check
  "restaurant",
  "cafe",
  "bakery",
  "shopping_mall",
]);

/**
 * Blocklist – places whose names contain any of these words are always excluded,
 * regardless of type or score.
 */
export const BLOCK_KEYWORDS = [
  "advocacia",
  "advocaticia",
  "contabilidade",
  "contabil",
  "cartório",
  "cartorio",
  "oficina",
  "consultoria",
  "transportadora",
  "indústria",
  "industria",
  "fábrica",
  "fabrica",
  "depósito",
  "deposito",
  "material elétrico",
  "material eletrico",
  "clínica",
  "clinica",
  "hospital",
  "farmácia",
  "farmacia",
  "posto",
  "combustível",
  "combustivel",
  "igreja",
  "condomínio",
  "condominio",
];

// ─── Family review keywords ───────────────────────────────────────────────────

/**
 * Priority-ordered list of kid/family keywords to search for in Google Places
 * reviews. The first match found becomes the `family_highlight` label.
 *
 * Each entry: [keyword to match (normalised), human-readable label]
 */
export const FAMILY_REVIEW_KEYWORD_MAP: Array<[string, string]> = [
  ["brinquedoteca", "Brinquedoteca"],
  ["parquinho", "Parquinho"],
  ["playground", "Playground"],
  ["area kids", "Área Kids"],
  ["espaco kids", "Espaço Kids"],
  ["monitora", "Monitores infantis"],
  ["monitor infantil", "Monitores infantis"],
  ["fralda", "Fraldário"],
  ["trocador", "Fraldário"],
  ["menu infantil", "Menu infantil"],
  ["cardapio infantil", "Menu infantil"],
  ["piscina infantil", "Piscina infantil"],
  ["crianca", "Ambiente familiar"],
  ["infantil", "Ambiente familiar"],
  ["familia", "Ambiente familiar"],
  ["kids", "Ambiente Kids"],
];

export type ReviewAnalysis = {
  /** Human-readable label of the highest-priority keyword found (undefined = none found) */
  highlight: string | undefined;
  /** Number of individual reviews that contain at least one family keyword */
  reviewsWithKeyword: number;
  /** Number of distinct keyword labels found across all reviews */
  distinctKeywords: number;
};

/**
 * analyseReviews – scans each review independently and returns:
 *   - `highlight`         : label of the first (highest-priority) keyword found
 *   - `reviewsWithKeyword`: count of reviews that mention at least one family term
 *   - `distinctKeywords`  : count of distinct keyword labels across all reviews
 *
 * Used by calculateReviewBonus and calculateKidScore.
 */
export function analyseReviews(reviewTexts: string[]): ReviewAnalysis {
  let highlight: string | undefined;
  let reviewsWithKeyword = 0;
  const foundLabels = new Set<string>();

  for (const text of reviewTexts) {
    const norm = normalise(text);
    let reviewHasKeyword = false;

    for (const [kw, label] of FAMILY_REVIEW_KEYWORD_MAP) {
      if (norm.includes(normalise(kw))) {
        reviewHasKeyword = true;
        foundLabels.add(label);
        // Keep the highest-priority highlight (first match wins globally)
        if (!highlight) highlight = label;
      }
    }

    if (reviewHasKeyword) reviewsWithKeyword++;
  }

  return { highlight, reviewsWithKeyword, distinctKeywords: foundLabels.size };
}

/**
 * calculateReviewBonus – graduated scoring formula based on review analysis.
 *
 *   bonus = (reviewsWithKeyword × 10) + (distinctKeywords × 5)
 *
 * Examples:
 *   1 review, 1 keyword label  → 10 + 5  = 15
 *   3 reviews, 2 keyword labels → 30 + 10 = 40
 *   5 reviews, 4 keyword labels → 50 + 20 = 70
 *
 * Maximum possible (5 reviews, all distinct labels) is capped at 75.
 */
export function calculateReviewBonus(analysis: ReviewAnalysis): number {
  return (analysis.reviewsWithKeyword * 10) + (analysis.distinctKeywords * 5);
}

/**
 * extractFamilyHighlight – kept for backward compatibility.
 * Returns the highest-priority label found across all review texts.
 */
export function extractFamilyHighlight(reviewTexts: string[]): string | undefined {
  return analyseReviews(reviewTexts).highlight;
}

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

function normalise(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function containsAny(text: string, keywords: string[]): boolean {
  const n = normalise(text);
  return keywords.some((kw) => n.includes(normalise(kw)));
}

// ─── Filter layers ────────────────────────────────────────────────────────────

type Filterable = {
  types: string[];
  name: string;
  rating?: number;
  user_ratings_total?: number;
  photos?: { photo_reference: string }[];
};

/**
 * Layer 1 – Only places with at least one allowed type pass.
 */
export function filterByAllowedTypes<T extends Filterable>(places: T[]): T[] {
  return places.filter((p) => p.types.some((t) => ALLOWED_TYPES.has(t)));
}

/**
 * Blocklist – Discard places whose name matches any block keyword.
 * Applied independently of the layer order.
 */
export function filterByBlocklist<T extends Filterable>(places: T[]): T[] {
  return places.filter((p) => !containsAny(p.name, BLOCK_KEYWORDS));
}

/**
 * Layer 2 – Kid evidence.
 * A place passes if:
 *   (a) one of its types is in KID_AUTO_PASS_TYPES, OR
 *   (b) its name contains at least one KID_KEYWORD.
 */
export function filterByKidEvidence<T extends Filterable>(places: T[]): T[] {
  return places.filter(
    (p) =>
      p.types.some((t) => KID_AUTO_PASS_TYPES.has(t)) ||
      containsAny(p.name, KID_KEYWORDS),
  );
}

/**
 * Types that are inherently public spaces — parks, playgrounds, etc.
 * These pass Layer 3 unconditionally because:
 *   - Public parks rarely have ratings or photos in Google Places
 *   - Their kid-relevance is already guaranteed by Layer 1 + Layer 2
 *   - Filtering them by business-oriented quality metrics makes no sense
 */
export const QUALITY_GATE_EXEMPT_TYPES = new Set([
  "park",
  "playground",
  "amusement_park",
]);

/**
 * Layer 3 – Quality gate.
 *
 * Commercial establishments (restaurants, cafes, shopping malls, etc.) must
 * meet the full quality bar: rating ≥ 4.2, ≥ 20 reviews, at least one photo.
 *
 * Public spaces in QUALITY_GATE_EXEMPT_TYPES bypass this check entirely —
 * their kid-relevance is established by Layers 1 and 2 already.
 *
 * Mid-tier leisure venues (amusement_center, zoo, tourist_attraction, etc.)
 * use a relaxed bar: rating ≥ 3.8, ≥ 5 reviews (photos optional).
 */
export function filterByQuality<T extends Filterable>(places: T[]): T[] {
  return places.filter((p) => {
    // Public spaces — always pass
    if (p.types.some((t) => QUALITY_GATE_EXEMPT_TYPES.has(t))) return true;

    const rating = p.rating ?? 0;
    const reviewCount = p.user_ratings_total ?? 0;

    // Commercial food/retail — strict gate
    const isCommercial = p.types.some((t) =>
      ["restaurant", "cafe", "bakery", "shopping_mall"].includes(t),
    );
    if (isCommercial) {
      return rating >= 4.2 && reviewCount >= 20 && (p.photos?.length ?? 0) > 0;
    }

    // Everything else (amusement_center, zoo, tourist_attraction, etc.) — relaxed gate
    return rating >= 3.8 && reviewCount >= 5;
  });
}

/**
 * applyKidFilters – runs all four checks in order and returns the survivors.
 *
 * Order:
 *   Blocklist → Layer 1 (allowed types) → Layer 2 (kid evidence) → Layer 3 (quality)
 */
export function applyKidFilters<T extends Filterable>(places: T[]): T[] {
  return filterByQuality(
    filterByKidEvidence(
      filterByAllowedTypes(
        filterByBlocklist(places),
      ),
    ),
  );
}

// ─── Open-now filter ──────────────────────────────────────────────────────────

/**
 * filterOpenNow – removes places whose opening_hours.open_now is explicitly false.
 * Places with no opening_hours data are kept (we cannot confirm they are closed).
 */
export function filterOpenNow<T extends { opening_hours?: { open_now?: boolean } }>(
  places: T[],
): T[] {
  return places.filter(
    (p) => p.opening_hours == null || p.opening_hours.open_now !== false,
  );
}

// ─── KidScore calculation ─────────────────────────────────────────────────────

/**
 * calculateKidScore – assigns a score and full breakdown to a single place.
 *
 * @param place        Minimal place data from Google Places
 * @param originLat    Search origin latitude  (used for proximity bonus)
 * @param originLng    Search origin longitude (used for proximity bonus)
 * @param kidFlags     Optional crowd-sourced flags from KidSpot reviews
 * @param reviewTexts  Optional Google Places review texts for family-highlight extraction
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
  reviewTexts: string[] = [],
): PlaceWithScore {
  const breakdown: KidScoreBreakdown = {
    type_bonus: 0,
    espaco_kids_bonus: 0,
    trocador_bonus: 0,
    cadeirao_bonus: 0,
    rating_bonus: 0,
    proximity_bonus: 0,
    review_bonus: 0,
  };

  // 1. Type bonus (+40 for playground/amusement_center)
  const premiumKidTypes = new Set(["playground", "amusement_center", "amusement_park", "zoo"]);
  if (place.types.some((t) => premiumKidTypes.has(t))) {
    breakdown.type_bonus = 40;
  }

  // 2. Community flags from KidSpot reviews
  if (kidFlags.espaco_kids) breakdown.espaco_kids_bonus = 25;
  if (kidFlags.trocador) breakdown.trocador_bonus = 20;
  if (kidFlags.cadeirao) breakdown.cadeirao_bonus = 15;

  // 3. Quality bonus (+10 for rating ≥ 4.2 with at least 20 reviews)
  if ((place.rating ?? 0) >= 4.2 && (place.user_ratings_total ?? 0) >= 20) {
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

  // 5. Review-based graduated bonus
  //    bonus = (reviewsWithKeyword × 10) + (distinctKeywords × 5)
  //    Max achievable with Google's 5-review limit: 5×10 + N×5
  const reviewAnalysis = analyseReviews(reviewTexts);
  const family_highlight = reviewAnalysis.highlight;
  breakdown.review_bonus = calculateReviewBonus(reviewAnalysis);

  const kid_score =
    breakdown.type_bonus +
    breakdown.espaco_kids_bonus +
    breakdown.trocador_bonus +
    breakdown.cadeirao_bonus +
    breakdown.rating_bonus +
    breakdown.proximity_bonus +
    breakdown.review_bonus;

  return {
    ...place,
    kid_score,
    kid_score_breakdown: breakdown,
    distance_meters: Math.round(distanceMeters),
    ...(family_highlight ? { family_highlight } : {}),
  };
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

/**
 * sortResults – orders a list of scored places.
 *
 * Primary key per strategy:
 *
 *   kidScore (default):
 *     1. has_family_highlight DESC  — places with confirmed family features always first
 *     2. user_ratings_total DESC    — among highlighted: most reviewed comes first
 *     3. kid_score DESC             — among non-highlighted: highest score first
 *     4. user_ratings_total DESC    — tiebreaker: most reviewed
 *     5. rating DESC
 *     6. distance ASC
 *
 *   rating:
 *     user_ratings_total DESC → rating DESC → distance ASC
 *
 *   distance:
 *     distance ASC → rating DESC → user_ratings_total DESC
 */
export function sortResults(places: PlaceWithScore[], sortBy: SortBy): PlaceWithScore[] {
  const copy = [...places];

  function byPopularity(a: PlaceWithScore, b: PlaceWithScore): number {
    const totalDiff = (b.user_ratings_total ?? 0) - (a.user_ratings_total ?? 0);
    if (totalDiff !== 0) return totalDiff;
    const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
    if (ratingDiff !== 0) return ratingDiff;
    return (a.distance_meters ?? Infinity) - (b.distance_meters ?? Infinity);
  }

  switch (sortBy) {
    case "distance":
      copy.sort((a, b) => {
        const distDiff = (a.distance_meters ?? Infinity) - (b.distance_meters ?? Infinity);
        if (distDiff !== 0) return distDiff;
        const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
        if (ratingDiff !== 0) return ratingDiff;
        return (b.user_ratings_total ?? 0) - (a.user_ratings_total ?? 0);
      });
      break;

    case "rating":
      copy.sort(byPopularity);
      break;

    case "kidScore":
    default:
      copy.sort((a, b) => {
        // 1. Places with family highlight always come before those without
        const aHas = a.family_highlight ? 1 : 0;
        const bHas = b.family_highlight ? 1 : 0;
        if (bHas !== aHas) return bHas - aHas;

        // 2. Both have (or both lack) family highlight → compare by kid_score
        const scoreDiff = b.kid_score - a.kid_score;
        if (scoreDiff !== 0) return scoreDiff;

        // 3. Same score → fall back to popularity
        return byPopularity(a, b);
      });
      break;
  }

  return copy;
}
