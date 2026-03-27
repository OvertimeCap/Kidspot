import type { Express, Response } from "express";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { pool } from "./db";
import { searchPlaces, getPlaceDetails, autocompletePlaces, geocodePlace } from "./google-places";
import {
  createReview,
  getReviewsForPlace,
  toggleFavorite,
  getFavoritesForUser,
  createUser,
  findUserByEmail,
  verifyPassword,
} from "./storage";
import { insertReviewSchema } from "@shared/schema";
import { requireAuth, signToken, type AuthRequest } from "./auth";

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/health", (_req: AuthRequest, res: Response) => {
    res.json({ ok: true });
  });

  app.get("/api/kidspot/ping-db", async (_req: AuthRequest, res: Response) => {
    try {
      await pool.query("SELECT 1");
      res.json({ db: true });
    } catch (err) {
      console.error("DB ping failed:", err);
      res.status(500).json({ db: false, error: "Database unreachable" });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Auth routes                                                          */
  /* ------------------------------------------------------------------ */

  const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
  });

  app.post("/api/auth/register", async (req: AuthRequest, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { name, email, password } = parsed.data;

    const existing = await findUserByEmail(email.toLowerCase());
    if (existing) {
      res.status(409).json({ error: "E-mail já cadastrado" });
      return;
    }

    try {
      const user = await createUser({ name, email: email.toLowerCase(), password });
      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      });
      res.status(201).json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  app.post("/api/auth/login", async (req: AuthRequest, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { email, password } = parsed.data;

    try {
      const user = await findUserByEmail(email.toLowerCase());
      if (!user) {
        res.status(401).json({ error: "E-mail ou senha incorretos" });
        return;
      }

      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: "E-mail ou senha incorretos" });
        return;
      }

      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      });
      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/auth/me", requireAuth, (req: AuthRequest, res: Response) => {
    res.json({ user: req.user });
  });

  /* ------------------------------------------------------------------ */
  /* Places photo proxy                                                   */
  /* ------------------------------------------------------------------ */

  app.get("/api/places/photo", async (req: AuthRequest, res: Response) => {
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

  /* ------------------------------------------------------------------ */
  /* Places search / details                                              */
  /* ------------------------------------------------------------------ */

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

  app.post("/api/places/search", async (req: AuthRequest, res: Response) => {
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

  app.get("/api/places/autocomplete", async (req: AuthRequest, res: Response) => {
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

  app.get("/api/places/geocode", async (req: AuthRequest, res: Response) => {
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

  app.get("/api/places/details", async (req: AuthRequest, res: Response) => {
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

  /* ------------------------------------------------------------------ */
  /* Reviews                                                              */
  /* ------------------------------------------------------------------ */

  app.post("/api/reviews", requireAuth, async (req: AuthRequest, res: Response) => {
    const parsed = insertReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const review = await createReview(parsed.data, req.user!.userId);
      res.status(201).json({ review });
    } catch (err) {
      console.error("Create review error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/reviews", async (req: AuthRequest, res: Response) => {
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

  /* ------------------------------------------------------------------ */
  /* Favorites (protected — require JWT)                                  */
  /* ------------------------------------------------------------------ */

  app.post("/api/favorites/toggle", requireAuth, async (req: AuthRequest, res: Response) => {
    const placeId = req.body?.place_id as string | undefined;
    if (!placeId) {
      res.status(400).json({ error: "place_id is required" });
      return;
    }

    const userKey = req.user!.userId;

    try {
      const result = await toggleFavorite(userKey, placeId);
      res.json(result);
    } catch (err) {
      console.error("Toggle favorite error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/favorites", requireAuth, async (req: AuthRequest, res: Response) => {
    const userKey = req.user!.userId;

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
