const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!GOOGLE_PLACES_API_KEY) {
  console.warn("GOOGLE_PLACES_API_KEY is not set — Places API calls will fail");
}

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place";

const CITY_BIASES: Record<string, { lat: number; lng: number }> = {
  Franca: { lat: -20.5386, lng: -47.4009 },
  "Ribeirão Preto": { lat: -21.1704, lng: -47.8102 },
};

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

export async function searchPlacesByText(
  city: string,
  query?: string,
): Promise<MinimalPlace[]> {
  const bias = CITY_BIASES[city];
  const searchQuery = query
    ? `${query} em ${city} SP Brasil`
    : `lugares para crianças em ${city} SP Brasil`;

  const params = new URLSearchParams({
    query: searchQuery,
    key: GOOGLE_PLACES_API_KEY!,
    language: "pt-BR",
  });

  if (bias) {
    params.set("location", `${bias.lat},${bias.lng}`);
    params.set("radius", "10000");
  }

  const url = `${PLACES_BASE}/textsearch/json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Places Text Search failed: ${res.status}`);

  const data = (await res.json()) as {
    results: Record<string, unknown>[];
    status: string;
  };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places status: ${data.status}`);
  }

  return (data.results ?? []).map(pickMinimal);
}

export async function searchPlacesNearby(
  lat: number,
  lng: number,
  radiusMeters = 5000,
  keyword?: string,
): Promise<MinimalPlace[]> {
  const params = new URLSearchParams({
    location: `${lat},${lng}`,
    radius: String(radiusMeters),
    key: GOOGLE_PLACES_API_KEY!,
    language: "pt-BR",
    type: "establishment",
  });

  if (keyword) params.set("keyword", keyword);

  const url = `${PLACES_BASE}/nearbysearch/json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Places Nearby Search failed: ${res.status}`);

  const data = (await res.json()) as {
    results: Record<string, unknown>[];
    status: string;
  };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places status: ${data.status}`);
  }

  return (data.results ?? []).map(pickMinimal);
}

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
