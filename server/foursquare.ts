import { db } from "./db";
import { enrichmentCache } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const FOURSQUARE_API_KEY = process.env.FOURSQUARE_API_KEY;
const FSQ_BASE = "https://api.foursquare.com/v3/places";
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_DAYS = 7;

if (!FOURSQUARE_API_KEY) {
  console.warn("FOURSQUARE_API_KEY is not set — Foursquare enrichment will be skipped");
}

export type FoursquareMatch = {
  fsq_id: string;
  name: string;
  rating: number | undefined;
  popularity: number;
  categories: string[];
};

async function fetchWithTimeout(
  url: string,
  label: string,
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: FOURSQUARE_API_KEY!,
        Accept: "application/json",
      },
    });
    return res;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`Foursquare fetch timed out: ${label}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function normalise(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function nameSimilarity(a: string, b: string): number {
  const na = normalise(a);
  const nb = normalise(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.8;

  const wordsA = new Set(na.split(/\s+/));
  const wordsB = new Set(nb.split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.length / union.size;
}

async function getCachedEnrichment(placeId: string): Promise<{ hit: boolean; data: FoursquareMatch | null }> {
  try {
    const cached = await db.query.enrichmentCache.findFirst({
      where: and(
        eq(enrichmentCache.place_id, placeId),
        eq(enrichmentCache.source, "foursquare"),
      ),
    });

    if (cached && new Date(cached.expires_at) > new Date()) {
      const data = cached.data as FoursquareMatch;
      if (data.fsq_id === "") return { hit: true, data: null };
      return { hit: true, data };
    }
    return { hit: false, data: null };
  } catch {
    return { hit: false, data: null };
  }
}

async function setCachedEnrichment(placeId: string, data: FoursquareMatch): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);

  try {
    await db
      .insert(enrichmentCache)
      .values({
        place_id: placeId,
        source: "foursquare",
        data,
        expires_at: expiresAt,
      })
      .onConflictDoUpdate({
        target: [enrichmentCache.place_id, enrichmentCache.source],
        set: { data, expires_at: expiresAt },
      });
  } catch (err) {
    console.warn("Failed to cache Foursquare enrichment:", err);
  }
}

export async function searchFoursquareNearby(
  lat: number,
  lng: number,
  query: string,
  radius = 1000,
): Promise<FoursquareMatch[]> {
  if (!FOURSQUARE_API_KEY) return [];

  const params = new URLSearchParams({
    ll: `${lat},${lng}`,
    query,
    radius: String(radius),
    limit: "5",
    fields: "fsq_id,name,rating,popularity,categories",
  });

  let res: globalThis.Response;
  try {
    res = await fetchWithTimeout(`${FSQ_BASE}/search?${params.toString()}`, "searchFoursquareNearby");
  } catch {
    return [];
  }

  if (!res.ok) return [];

  const data = (await res.json()) as {
    results?: Array<{
      fsq_id: string;
      name: string;
      rating?: number;
      popularity?: number;
      categories?: Array<{ name: string }>;
    }>;
  };

  return (data.results ?? []).map((r) => ({
    fsq_id: r.fsq_id,
    name: r.name,
    rating: r.rating,
    popularity: r.popularity ?? 0,
    categories: (r.categories ?? []).map((c) => c.name),
  }));
}

export async function matchFoursquarePlace(
  placeName: string,
  lat: number,
  lng: number,
  placeId: string,
): Promise<FoursquareMatch | null> {
  const cached = await getCachedEnrichment(placeId);
  if (cached.hit) return cached.data;

  if (!FOURSQUARE_API_KEY) return null;

  const results = await searchFoursquareNearby(lat, lng, placeName, 500);
  if (results.length === 0) return null;

  let bestMatch: FoursquareMatch | null = null;
  let bestScore = 0;

  for (const r of results) {
    const sim = nameSimilarity(placeName, r.name);
    if (sim > bestScore && sim >= 0.4) {
      bestScore = sim;
      bestMatch = r;
    }
  }

  if (bestMatch) {
    await setCachedEnrichment(placeId, bestMatch);
  } else {
    await setCachedEnrichment(placeId, { fsq_id: "", name: "", rating: undefined, popularity: 0, categories: [] });
  }

  return bestMatch;
}

export function calculateFoursquareBonus(match: FoursquareMatch | null): number {
  if (!match) return 0;

  let bonus = 0;

  if (match.rating !== undefined) {
    if (match.rating >= 8.0) bonus += 10;
    else if (match.rating >= 7.0) bonus += 7;
    else if (match.rating >= 6.0) bonus += 4;
  }

  if (match.popularity >= 0.8) bonus += 5;
  else if (match.popularity >= 0.5) bonus += 3;

  return bonus;
}
