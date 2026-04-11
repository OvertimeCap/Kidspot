import { Router, type Response } from "express";
import { z } from "zod";
import { pipelineRuns, placesKidspot } from "@shared/schema";
import { db } from "../db";
import { getUserById, upsertPlaceMeta, addPlacePhoto } from "../storage";
import {
  runPipelineForCity,
  runPipelineForAllCities,
  previewPipelineForCity,
  aiSearchForCity,
  applyCriteriaToPlaces,
} from "../pipeline";
import { requireAuth, type AuthRequest } from "../auth";
import { eq, desc, sql as sqlExpr } from "drizzle-orm";

const router = Router();

const pipelineRunSchema = z.object({
  city_id: z.string().optional(),
});

router.post("/api/admin/pipeline/run", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const parsed = pipelineRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { city_id } = parsed.data;

    try {
      if (city_id) {
        const result = await runPipelineForCity(city_id);
        res.json({ results: [result] });
      } else {
        const results = await runPipelineForAllCities();
        res.json({ results });
      }
    } catch (err) {
      console.error("Pipeline run error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

router.get("/api/admin/pipeline/runs", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 200);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    try {
      const [rows, countResult] = await Promise.all([
        db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.started_at)).limit(limit).offset(offset),
        db.select({ count: sqlExpr<number>`count(*)::int` }).from(pipelineRuns),
      ]);
      res.json({ runs: rows, total: countResult[0]?.count ?? 0 });
    } catch (err) {
      console.error("List pipeline runs error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

router.post("/api/admin/pipeline/preview", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const schema = z.object({
      city_id: z.string(),
      limit: z.number().int().min(1).max(200).optional().default(50),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await previewPipelineForCity(parsed.data.city_id, parsed.data.limit);
      res.json(result);
    } catch (err) {
      console.error("Pipeline preview error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

router.post("/api/admin/pipeline/triage", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const schema = z.object({
      city_id: z.string(),
      city_name: z.string(),
      places: z.array(z.object({
        place_id: z.string(),
        name: z.string(),
        formatted_address: z.string().optional().default(""),
        types: z.array(z.string()).optional().default([]),
        lat: z.number(),
        lng: z.number(),
        photo_reference: z.string().optional(),
      })),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      let inserted = 0;
      for (const place of parsed.data.places) {
        const existing = await db.query.placesKidspot.findFirst({
          where: eq(placesKidspot.place_id, place.place_id),
        });
        if (!existing) {
          await db.insert(placesKidspot).values({
            place_id: place.place_id,
            city: parsed.data.city_name,
            ciudad_id: parsed.data.city_id,
            lat: String(place.lat),
            lng: String(place.lng),
            status: "pendente",
          });
          await upsertPlaceMeta({ place_id: place.place_id, city: parsed.data.city_name, name: place.name, address: place.formatted_address });
          if (place.photo_reference) {
            const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${encodeURIComponent(place.photo_reference)}&key=${process.env.GOOGLE_PLACES_API_KEY || ""}`;
            await addPlacePhoto({ place_id: place.place_id, url: photoUrl, photo_reference: place.photo_reference, order: 0 });
          }
          inserted++;
        }
      }
      res.json({ inserted });
    } catch (err) {
      console.error("Pipeline triage error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

router.post("/api/admin/pipeline/ai-search", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const schema = z.object({
      city_id: z.string(),
      limit: z.number().int().min(1).max(200).optional().default(50),
      provider: z.string().optional(),
      model: z.string().optional(),
      prompt: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await aiSearchForCity(parsed.data.city_id, parsed.data.limit, {
        provider: parsed.data.provider,
        model: parsed.data.model,
        prompt: parsed.data.prompt,
      });
      res.json({ city_name: result.city_name, places: result.places, total: result.places.length });
    } catch (err) {
      console.error("Pipeline ai-search error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

router.post("/api/admin/pipeline/apply-criteria", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const placeSchema = z.object({
      place_id: z.string(),
      name: z.string(),
      formatted_address: z.string().optional().default(""),
      types: z.array(z.string()).optional().default([]),
      rating: z.number().optional(),
      user_ratings_total: z.number().optional(),
      location: z.object({ lat: z.number(), lng: z.number() }),
    });
    const schema = z.object({
      city_id: z.string(),
      city_name: z.string(),
      places: z.array(placeSchema),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await applyCriteriaToPlaces(parsed.data.city_id, parsed.data.places);
      const passed = result.places.filter((p) => p.passed_criteria).length;
      const rejected = result.places.length - passed;
      res.json({ places: result.places, passed, rejected, active_criteria: result.active_criteria });
    } catch (err) {
      console.error("Pipeline apply-criteria error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

export default router;
