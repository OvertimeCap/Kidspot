import { Router, type Response } from "express";
import { z } from "zod";
import { searchPlaces, getPlaceDetails, autocompletePlaces, geocodePlace, textSearchClaimable } from "../google-places";
import {
  getActiveSponsoredPlaceIds,
  getApprovedPlaceIds,
  incrementImpressions,
  incrementDetailAccess,
  listPlacePhotosForDisplay,
  getPlaceMetaForDetails,
} from "../storage";
import { requireAuth, type AuthRequest } from "../auth";
import { ESTABLISHMENT_TYPES } from "./helpers";

const router = Router();

const searchBodySchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    radius: z.number().positive().max(10_000).default(5_000),
    establishmentType: z.enum(ESTABLISHMENT_TYPES).optional(),
    establishmentTypes: z.array(z.enum(ESTABLISHMENT_TYPES)).optional(),
    openNow: z.boolean().optional(),
    query: z.string().optional(),
    sortBy: z.enum(["kidScore", "distance", "rating"]).default("kidScore"),
  })
  .refine(
    (d) =>
      d.establishmentType != null ||
      (d.establishmentTypes != null && d.establishmentTypes.length > 0),
    { message: "Provide establishmentType or establishmentTypes" },
  );

router.get("/api/places/photo", async (req: AuthRequest, res: Response) => {
  const reference = req.query.reference as string;
  const maxwidth = (req.query.maxwidth as string) || "400";

  if (!reference) {
    res.status(400).json({ error: "reference is required" });
    return;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "API key not configured" });
    return;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxwidth}&photo_reference=${encodeURIComponent(reference)}&key=${apiKey}`;
    const photoRes = await fetch(url);
    const buffer = await photoRes.arrayBuffer();
    const contentType = photoRes.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Photo proxy error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/api/places/search", async (req: AuthRequest, res: Response) => {
  const parsed = searchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const [places, sponsoredMap] = await Promise.all([
      searchPlaces(parsed.data),
      getActiveSponsoredPlaceIds(),
    ]);

    const augmented = places.map((p) => ({
      ...p,
      is_sponsored: sponsoredMap.has(p.place_id),
    }));

    if (sponsoredMap.size > 0) {
      augmented.sort((a, b) => {
        const aPrio = sponsoredMap.get(a.place_id) ?? -1;
        const bPrio = sponsoredMap.get(b.place_id) ?? -1;
        if (bPrio !== aPrio) return bPrio - aPrio;
        return 0;
      });
    }

    const placeIds = augmented.map((p) => p.place_id);
    incrementImpressions(placeIds).catch(() => {});

    res.json({ places: augmented });
  } catch (err) {
    console.error("Places search error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/places/autocomplete", async (req: AuthRequest, res: Response) => {
  const input = (req.query.input as string) ?? "";
  const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
  const lng = req.query.lng ? parseFloat(req.query.lng as string) : undefined;

  try {
    const suggestions = await autocompletePlaces(input, lat, lng);
    res.json({ suggestions });
  } catch (err) {
    console.error("Autocomplete error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/places/geocode", async (req: AuthRequest, res: Response) => {
  const placeId = req.query.place_id as string;
  if (!placeId) {
    res.status(400).json({ error: "place_id query parameter is required" });
    return;
  }

  try {
    const result = await geocodePlace(placeId);
    res.json(result);
  } catch (err) {
    console.error("Geocode error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/places/details", async (req: AuthRequest, res: Response) => {
  const placeId = req.query.place_id as string;
  if (!placeId) {
    res.status(400).json({ error: "place_id query parameter is required" });
    return;
  }

  try {
    const [details, sponsoredMap, meta] = await Promise.all([
      getPlaceDetails(placeId),
      getActiveSponsoredPlaceIds(),
      getPlaceMetaForDetails(placeId),
    ]);
    incrementDetailAccess(placeId).catch(() => {});
    res.json({ place: { ...details, is_sponsored: sponsoredMap.has(placeId), family_summary: meta?.family_summary ?? null } });
  } catch (err) {
    console.error("Places details error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/places/search-claimable", requireAuth, async (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string) ?? "";
  const city = (req.query.city as string) ?? "";

  if (!q || q.trim().length < 2) {
    res.status(400).json({ error: "Informe pelo menos 2 caracteres para buscar" });
    return;
  }

  try {
    const approvedIds = await getApprovedPlaceIds();
    const results = await textSearchClaimable(q.trim(), city.trim());
    const filtered = results.filter((p) => !approvedIds.has(p.place_id));
    res.json({ places: filtered });
  } catch (err) {
    console.error("Search claimable error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/places/:placeId/photos", async (req: AuthRequest, res: Response) => {
  const placeId = req.params.placeId as string;
  try {
    const photos = await listPlacePhotosForDisplay(placeId);
    res.json({ photos });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
