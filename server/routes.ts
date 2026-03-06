import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { pool } from "./db";
import { searchPlacesByText, searchPlacesNearby, getPlaceDetails } from "./google-places";
import { upsertPlace, createReview, getReviewsForPlace, toggleFavorite, getFavoritesForUser } from "./storage";
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

  const searchBodySchema = z.object({
    city: z.enum(["Franca", "Ribeirão Preto"]).optional(),
    query: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    radiusMeters: z.number().optional(),
  });

  app.post("/api/places/search", async (req: Request, res: Response) => {
    const parsed = searchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { city, query, lat, lng, radiusMeters } = parsed.data;

    try {
      let places;
      if (lat !== undefined && lng !== undefined) {
        places = await searchPlacesNearby(lat, lng, radiusMeters ?? 5000, query);
      } else {
        places = await searchPlacesByText(city ?? "Franca", query);
      }

      const cityName = city ?? "Franca";
      for (const p of places) {
        await upsertPlace({
          place_id: p.place_id,
          city: cityName,
          lat: String(p.location.lat),
          lng: String(p.location.lng),
        }).catch(() => {});
      }

      res.json({ places });
    } catch (err) {
      console.error("Places search error:", err);
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
