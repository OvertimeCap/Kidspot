import { getApiUrl, apiRequest } from "@/lib/query-client";

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
  is_sponsored?: boolean;
};

export type KidFlags = {
  trocador: boolean;
  cadeirao: boolean;
  banheiro_familia: boolean;
  espaco_kids: boolean;
  seguro: boolean;
};

export type Review = {
  id: string;
  place_id: string;
  user_id: string;
  rating: number;
  kid_flags: KidFlags;
  note?: string | null;
  created_at: string;
};

export type FavoriteRow = {
  id: string;
  user_id: string;
  place_id: string;
  created_at: string;
};

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

export type SortBy = "kidScore" | "distance" | "rating";

export type KidScoreBreakdown = {
  type_bonus: number;
  espaco_kids_bonus: number;
  trocador_bonus: number;
  cadeirao_bonus: number;
  rating_bonus: number;
  proximity_bonus: number;
  review_bonus: number;
};

export type SearchParams = {
  latitude: number;
  longitude: number;
  radius?: number;
  /** Single type — kept for backward compat. Prefer establishmentTypes for home search. */
  establishmentType?: EstablishmentType;
  /** Run one Google fetch per type in parallel and merge results. */
  establishmentTypes?: EstablishmentType[];
  openNow?: boolean;
  query?: string;
  sortBy?: SortBy;
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
  is_sponsored?: boolean;
};

export function getPhotoUrl(photoReference: string, maxwidth = 400): string {
  const base = getApiUrl();
  const url = new URL("/api/places/photo", base);
  url.searchParams.set("reference", photoReference);
  url.searchParams.set("maxwidth", String(maxwidth));
  return url.toString();
}

export async function searchPlaces(params: SearchParams): Promise<PlaceWithScore[]> {
  const res = await apiRequest("POST", "/api/places/search", params);
  const data = await res.json();
  return data.places ?? [];
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const res = await apiRequest("GET", `/api/places/details?place_id=${encodeURIComponent(placeId)}`);
  const data = await res.json();
  return data.place;
}

export async function getReviews(placeId: string): Promise<Review[]> {
  const res = await apiRequest("GET", `/api/reviews?place_id=${encodeURIComponent(placeId)}`);
  const data = await res.json();
  return data.reviews ?? [];
}

export async function createReview(review: {
  place_id: string;
  rating: number;
  kid_flags: KidFlags;
  note?: string;
}): Promise<Review> {
  const res = await apiRequest("POST", "/api/reviews", review);
  const data = await res.json();
  return data.review;
}

export async function toggleFavorite(placeId: string): Promise<{ added: boolean }> {
  const res = await apiRequest("POST", "/api/favorites/toggle", {
    place_id: placeId,
  });
  return res.json();
}

export async function getFavorites(): Promise<FavoriteRow[]> {
  const res = await apiRequest("GET", "/api/favorites");
  const data = await res.json();
  return data.favorites ?? [];
}

const SKIP_TYPES = new Set([
  "point_of_interest", "establishment", "food", "finance", "health",
  "place_of_worship", "political", "locality", "sublocality", "route",
  "street_address", "premise", "subpremise", "administrative_area_level_1",
  "administrative_area_level_2", "country",
]);

const TYPE_LABELS: Record<string, string> = {
  restaurant: "Restaurante",
  park: "Parque",
  cafe: "Café",
  shopping_mall: "Shopping",
  school: "Escola",
  museum: "Museu",
  store: "Loja",
  gym: "Academia",
  library: "Biblioteca",
  movie_theater: "Cinema",
  amusement_park: "Parque de Diversões",
  aquarium: "Aquário",
  zoo: "Zoológico",
  bakery: "Padaria",
  bar: "Bar",
  bowling_alley: "Boliche",
  church: "Igreja",
  clothing_store: "Loja de Roupas",
  drugstore: "Farmácia",
  pharmacy: "Farmácia",
  hospital: "Hospital",
  hotel: "Hotel",
  lodging: "Hospedagem",
  pet_store: "Pet Shop",
  playground: "Playground",
  primary_school: "Escola",
  secondary_school: "Escola",
  spa: "Spa",
  stadium: "Estádio",
  supermarket: "Supermercado",
  tourist_attraction: "Atração Turística",
  university: "Universidade",
};

export function getBestType(types: string[]): string {
  for (const t of types) {
    if (!SKIP_TYPES.has(t) && TYPE_LABELS[t]) return TYPE_LABELS[t];
  }
  for (const t of types) {
    if (!SKIP_TYPES.has(t)) return t.replace(/_/g, " ");
  }
  return "Local";
}

export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/* ------------------------------------------------------------------ */
/* Partner Stories                                                       */
/* ------------------------------------------------------------------ */

export type StoryItem = {
  id: string;
  user_id: string;
  place_id: string;
  place_name: string;
  expires_at: string;
  created_at: string;
  first_photo_id: string | null;
  user_role: string;
};

export type StoryPhotoRef = {
  id: string;
  order: number;
};

export function getStoryPhotoUrl(photoId: string): string {
  const base = getApiUrl();
  const url = new URL(`/api/stories/photo/${encodeURIComponent(photoId)}`, base);
  return url.toString();
}

export async function fetchStories(placeIds: string[]): Promise<StoryItem[]> {
  if (placeIds.length === 0) return [];
  const res = await apiRequest(
    "GET",
    `/api/stories?place_ids=${encodeURIComponent(placeIds.join(","))}`,
  );
  const data = await res.json();
  return data.stories ?? [];
}

export async function fetchStoriesNearby(lat: number, lng: number, radiusKm = 8): Promise<StoryItem[]> {
  const res = await apiRequest(
    "GET",
    `/api/stories/nearby?lat=${lat}&lng=${lng}&radius=${radiusKm}`,
  );
  const data = await res.json();
  return data.stories ?? [];
}

export async function fetchStoryPhotos(storyId: string): Promise<StoryPhotoRef[]> {
  const res = await apiRequest("GET", `/api/stories/${encodeURIComponent(storyId)}/photos`);
  const data = await res.json();
  return data.photos ?? [];
}

export async function createStory(photos: string[]): Promise<void> {
  await apiRequest("POST", "/api/stories", { photos });
}

/* ------------------------------------------------------------------ */
/* City-based curated places (Feature #23)                             */
/* ------------------------------------------------------------------ */

export type CityCheckResult = {
  enabled: boolean;
  city_id: string | null;
  city_name: string | null;
  distance_km?: number;
};

export type CuratedPlace = {
  place_id: string;
  name: string | null;
  address: string | null;
  category: string | null;
  kid_score: number | null;
  display_order: number | null;
  cover_photo_url: string | null;
  is_sponsored: boolean;
  family_highlight: string | null;
  lat: string;
  lng: string;
};

export async function checkCity(lat: number, lng: number): Promise<CityCheckResult> {
  const res = await apiRequest("GET", `/api/cities/check?lat=${lat}&lng=${lng}`);
  return res.json();
}

export async function getCuratedPlaces(cityId: string): Promise<CuratedPlace[]> {
  const res = await apiRequest("GET", `/api/cities/${encodeURIComponent(cityId)}/places`);
  const data = await res.json();
  return data.places ?? [];
}

export async function requestCityActivation(lat: number, lng: number, cityName: string | null): Promise<void> {
  const content = cityName
    ? `Solicitação de habilitação de cidade: ${cityName} (lat: ${lat.toFixed(5)}, lng: ${lng.toFixed(5)})`
    : `Solicitação de habilitação de cidade (lat: ${lat.toFixed(5)}, lng: ${lng.toFixed(5)})`;
  await apiRequest("POST", "/api/feedback", { type: "sugestao", content });
}
