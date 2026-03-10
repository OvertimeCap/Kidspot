import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { pool } from "./db";
import { searchPlaces, getPlaceDetails, autocompletePlaces, geocodePlace } from "./google-places";
import { createReview, getReviewsForPlace, toggleFavorite, getFavoritesForUser } from "./storage";
import { insertReviewSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.get("/api/kidspot/ping-db", async (_req: Request, res: Response) => {
    try {
      await pool.query("SELECT 1");
      res.json({ db: true });
    } catch (err) {
      console.error("DB ping failed:", err);
      res.status(500).json({ db: false, error: "Database unreachable" });
    }
  });

  app.get("/api/places/photo", async (req: Request, res: Response) => {
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

  /**
   * POST /api/places/search
   *
   * Discovers kid-friendly places near a coordinate using the Google Places
   * Nearby Search API, scores each result with a KidScore, and returns them
   * sorted by the caller's preferred strategy.
   *
   * Request body:
   * {
   *   "latitude": -23.5505,        // required – search origin latitude
   *   "longitude": -46.6333,       // required – search origin longitude
   *   "radius": 5000,              // metres, max 10 000
   *   "establishmentType": "playground", // playground | park | amusement_center |
   *                                       // restaurant | cafe | shopping_mall
   *   "openNow": true,             // optional – filter to currently open places
   *   "query": "espaço kids",      // optional – keyword refinement
   *   "sortBy": "kidScore"         // optional – kidScore | distance | rating
   * }
   *
   * Response:
   * {
   *   "places": [
   *     {
   *       "place_id": "ChIJ...",
   *       "name": "Parque Ibirapuera",
   *       "address": "Av. Pedro Álvares Cabral, São Paulo",
   *       "location": { "lat": -23.5872, "lng": -46.6576 },
   *       "rating": 4.7,
   *       "user_ratings_total": 82340,
   *       "types": ["park", "point_of_interest"],
   *       "opening_hours": { "open_now": true },
   *       "photos": [{ "photo_reference": "ATtYBwJ..." }],
   *       "kid_score": 60,
   *       "kid_score_breakdown": {
   *         "type_bonus": 0,
   *         "espaco_kids_bonus": 25,
   *         "trocador_bonus": 20,
   *         "cadeirao_bonus": 0,
   *         "rating_bonus": 10,
   *         "proximity_bonus": 5
   *       },
   *       "distance_meters": 3821
   *     }
   *   ]
   * }
   */
  const ESTABLISHMENT_TYPES = [
    "playground",
    "park",
    "amusement_center",
    "restaurant",
    "cafe",
    "bakery",
    "shopping_mall",
    "zoo",
    "tourist_attraction",
    "sports_club",
    "community_center",
  ] as const;

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

  app.post("/api/places/search", async (req: Request, res: Response) => {
    const parsed = searchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const places = await searchPlaces(parsed.data);
      res.json({ places });
    } catch (err) {
      console.error("Places search error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/places/autocomplete", async (req: Request, res: Response) => {
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

  app.get("/api/places/geocode", async (req: Request, res: Response) => {
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

  app.get("/api/places/details", async (req: Request, res: Response) => {
    const placeId = req.query.place_id as string;
    if (!placeId) {
      res.status(400).json({ error: "place_id query parameter is required" });
      return;
    }

    try {
      const details = await getPlaceDetails(placeId);
      res.json({ place: details });
    } catch (err) {
      console.error("Places details error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/reviews", async (req: Request, res: Response) => {
    const parsed = insertReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const review = await createReview(parsed.data);
      res.status(201).json({ review });
    } catch (err) {
      console.error("Create review error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/reviews", async (req: Request, res: Response) => {
    const placeId = req.query.place_id as string;
    if (!placeId) {
      res.status(400).json({ error: "place_id query parameter is required" });
      return;
    }

    try {
      const reviewList = await getReviewsForPlace(placeId);
      res.json({ reviews: reviewList });
    } catch (err) {
      console.error("Get reviews error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const toggleFavoriteSchema = z.object({
    user_key: z.string().min(1),
    place_id: z.string().min(1),
  });

  app.post("/api/favorites/toggle", async (req: Request, res: Response) => {
    const parsed = toggleFavoriteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { user_key, place_id } = parsed.data;

    try {
      const result = await toggleFavorite(user_key, place_id);
      res.json(result);
    } catch (err) {
      console.error("Toggle favorite error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/favorites", async (req: Request, res: Response) => {
    const userKey = req.query.user_key as string;
    if (!userKey) {
      res.status(400).json({ error: "user_key query parameter is required" });
      return;
    }

    try {
      const favList = await getFavoritesForUser(userKey);
      res.json({ favorites: favList });
    } catch (err) {
      console.error("Get favorites error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
