import { db } from "./db";
import { cities, pipelineRuns, placesKidspot, pipelineBlacklist, customCriteria } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { searchPlacesByText, type MinimalPlace } from "./google-places";
import { applyKidFilters } from "./kid-score";
import { upsertPlaceMeta, addPlacePhoto } from "./storage";

export type PipelineRunResult = {
  run_id: string;
  city_name: string;
  places_found: number;
  new_pending: number;
  failures: number;
  estimated_cost_usd: number;
  status: "completed" | "failed";
  error_message?: string;
};

const COST_PER_TEXT_SEARCH = 0.032;
const TEXT_SEARCH_REQUESTS_PER_CITY = 4;

async function ingestCity(cityId: string, cityName: string, lat: number, lng: number): Promise<{
  placesFound: number;
  newPending: number;
  failures: number;
  estimatedCost: number;
}> {
  let placesFound = 0;
  let newPending = 0;
  let failures = 0;

  try {
    const rawPlaces = await searchPlacesByText(cityName);

    const filtered = applyKidFilters(
      rawPlaces.map((p) => ({
        ...p,
        types: p.types ?? [],
        name: p.name ?? "",
      }))
    );

    const blacklisted = await db
      .select({ place_id: pipelineBlacklist.place_id })
      .from(pipelineBlacklist);
    const blacklistSet = new Set(blacklisted.map((b) => b.place_id));
    const notBlacklisted = filtered.filter((p) => !blacklistSet.has(p.place_id));

    placesFound = notBlacklisted.length;

    for (const place of notBlacklisted) {
      try {
        const existing = await db.query.placesKidspot.findFirst({
          where: eq(placesKidspot.place_id, place.place_id),
        });

        if (!existing) {
          await db.insert(placesKidspot).values({
            place_id: place.place_id,
            city: cityName,
            ciudad_id: cityId,
            lat: String(place.location?.lat ?? 0),
            lng: String(place.location?.lng ?? 0),
            status: "pendente",
          });
          await upsertPlaceMeta({
            place_id: place.place_id,
            city: cityName,
            name: place.name,
            address: place.formatted_address,
          });
          if (place.photos?.[0]?.photo_reference) {
            const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${encodeURIComponent(place.photos[0].photo_reference)}&key=${process.env.GOOGLE_PLACES_API_KEY || ""}`;
            await addPlacePhoto({ place_id: place.place_id, url: photoUrl, photo_reference: place.photos[0].photo_reference, order: 0 });
          }
          newPending++;
        }
      } catch {
        failures++;
      }
    }
  } catch {
    failures++;
  }

  const estimatedCost = TEXT_SEARCH_REQUESTS_PER_CITY * COST_PER_TEXT_SEARCH;

  return { placesFound, newPending, failures, estimatedCost };
}

export async function runPipelineForCity(cityId: string): Promise<PipelineRunResult> {
  const city = await db.query.cities.findFirst({
    where: and(eq(cities.id, cityId), eq(cities.ativa, true)),
  });

  if (!city) {
    throw new Error("Cidade não encontrada ou não está ativa");
  }

  const [run] = await db.insert(pipelineRuns).values({
    city_id: city.id,
    city_name: city.nome,
    status: "running",
    places_found: 0,
    new_pending: 0,
    failures: 0,
    estimated_cost_usd: "0",
  }).returning();

  try {
    const result = await ingestCity(city.id, city.nome, Number(city.latitude), Number(city.longitude));

    const [updated] = await db.update(pipelineRuns)
      .set({
        status: "completed",
        places_found: result.placesFound,
        new_pending: result.newPending,
        failures: result.failures,
        estimated_cost_usd: String(result.estimatedCost.toFixed(4)),
        finished_at: new Date(),
      })
      .where(eq(pipelineRuns.id, run.id))
      .returning();

    await db
      .update(cities)
      .set({ ultima_varredura: new Date() })
      .where(eq(cities.id, cityId));

    return {
      run_id: updated.id,
      city_name: city.nome,
      places_found: result.placesFound,
      new_pending: result.newPending,
      failures: result.failures,
      estimated_cost_usd: result.estimatedCost,
      status: "completed",
    };
  } catch (err) {
    const errorMessage = (err as Error).message;

    await db.update(pipelineRuns)
      .set({
        status: "failed",
        error_message: errorMessage,
        finished_at: new Date(),
      })
      .where(eq(pipelineRuns.id, run.id));

    return {
      run_id: run.id,
      city_name: city.nome,
      places_found: 0,
      new_pending: 0,
      failures: 1,
      estimated_cost_usd: 0,
      status: "failed",
      error_message: errorMessage,
    };
  }
}

export type PreviewPlace = {
  place_id: string;
  name: string;
  formatted_address: string;
  types: string[];
  rating?: number;
  user_ratings_total?: number;
  location: { lat: number; lng: number };
  already_exists: boolean;
};

export async function previewPipelineForCity(
  cityId: string,
  limit = 50,
): Promise<{ city_name: string; places: PreviewPlace[] }> {
  const city = await db.query.cities.findFirst({
    where: and(eq(cities.id, cityId), eq(cities.ativa, true)),
  });
  if (!city) throw new Error("Cidade não encontrada ou não está ativa");

  const rawPlaces = await searchPlacesByText(city.nome);
  const filtered = applyKidFilters(
    rawPlaces.map((p) => ({ ...p, types: p.types ?? [], name: p.name ?? "" }))
  );

  const blacklisted = await db
    .select({ place_id: pipelineBlacklist.place_id })
    .from(pipelineBlacklist);
  const blacklistSet = new Set(blacklisted.map((b) => b.place_id));

  const withoutBlacklisted = filtered.filter((p) => !blacklistSet.has(p.place_id));
  const limited = withoutBlacklisted.slice(0, limit);

  const placeIds = limited.map((p) => p.place_id);
  const existingRows = placeIds.length > 0
    ? await db
        .select({ place_id: placesKidspot.place_id })
        .from(placesKidspot)
        .where(inArray(placesKidspot.place_id, placeIds))
    : [];
  const existingSet = new Set(existingRows.map((r) => r.place_id));

  await db
    .update(cities)
    .set({ ultima_varredura: new Date() })
    .where(eq(cities.id, cityId));

  return {
    city_name: city.nome,
    places: limited.map((p) => ({
      place_id: p.place_id,
      name: p.name,
      formatted_address: p.formatted_address,
      types: p.types,
      rating: p.rating,
      user_ratings_total: p.user_ratings_total,
      location: p.location,
      already_exists: existingSet.has(p.place_id),
    })),
  };
}

export type CriteriaPlace = PreviewPlace & {
  passed_criteria: boolean;
  rejection_reason?: string;
};

/**
 * Step 1 of the 3-step pipeline: call Google Places and return raw results
 * without applying kid filters. Lets admins see everything before filtering.
 */
export async function aiSearchForCity(
  cityId: string,
  limit = 50,
  options: { provider?: string; model?: string; prompt?: string } = {},
): Promise<{ city_name: string; places: MinimalPlace[] }> {
  const city = await db.query.cities.findFirst({
    where: and(eq(cities.id, cityId), eq(cities.ativa, true)),
  });
  if (!city) throw new Error("Cidade não encontrada ou não está ativa");

  const cityLat = city.latitude ? Number(city.latitude) : undefined;
  const cityLng = city.longitude ? Number(city.longitude) : undefined;
  const rawPlaces = await searchPlacesByText(
    city.nome,
    options.prompt || undefined,
    cityLat,
    cityLng,
  );
  const limited = rawPlaces.slice(0, limit);

  await db.update(cities).set({ ultima_varredura: new Date() }).where(eq(cities.id, cityId));

  return {
    city_name: city.nome,
    places: limited.map((p) => ({
      place_id: p.place_id,
      name: p.name ?? "",
      formatted_address: p.formatted_address,
      types: p.types ?? [],
      rating: p.rating,
      user_ratings_total: p.user_ratings_total,
      location: p.location,
      photos: p.photos,
    })),
  };
}

/**
 * Step 2 of the 3-step pipeline: apply blacklist and active custom criteria
 * to the raw places returned by aiSearchForCity.
 */
export async function applyCriteriaToPlaces(
  cityId: string,
  rawPlaces: MinimalPlace[],
): Promise<{ places: CriteriaPlace[]; active_criteria: { key: string; label: string }[] }> {
  const [blacklisted, activeCriteriaRows] = await Promise.all([
    db.select({ place_id: pipelineBlacklist.place_id }).from(pipelineBlacklist),
    db.select({ key: customCriteria.key, label: customCriteria.label })
      .from(customCriteria)
      .where(eq(customCriteria.is_active, true)),
  ]);
  const blacklistSet = new Set(blacklisted.map((b) => b.place_id));

  const placeIds = rawPlaces.map((p) => p.place_id);
  const existingRows = placeIds.length > 0
    ? await db
        .select({ place_id: placesKidspot.place_id })
        .from(placesKidspot)
        .where(inArray(placesKidspot.place_id, placeIds))
    : [];
  const existingSet = new Set(existingRows.map((r) => r.place_id));

  return {
    places: rawPlaces.map((p) => {
      const isBlacklisted = blacklistSet.has(p.place_id);
      const passed = !isBlacklisted;
      const rejection_reason = isBlacklisted ? "Na blacklist" : undefined;

      return {
        place_id: p.place_id,
        name: p.name,
        formatted_address: p.formatted_address,
        types: p.types,
        rating: p.rating,
        user_ratings_total: p.user_ratings_total,
        location: p.location,
        already_exists: existingSet.has(p.place_id),
        passed_criteria: passed,
        rejection_reason,
      };
    }),
    active_criteria: activeCriteriaRows,
  };
}

export async function runPipelineForAllCities(): Promise<PipelineRunResult[]> {
  const activeCities = await db.query.cities.findMany({
    where: eq(cities.ativa, true),
  });

  if (activeCities.length === 0) {
    throw new Error("Nenhuma cidade ativa cadastrada");
  }

  const results = await Promise.allSettled(
    activeCities.map((c) => runPipelineForCity(c.id))
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      run_id: "",
      city_name: activeCities[i]?.nome ?? "Desconhecida",
      places_found: 0,
      new_pending: 0,
      failures: 1,
      estimated_cost_usd: 0,
      status: "failed" as const,
      error_message: (r.reason as Error).message,
    };
  });
}
