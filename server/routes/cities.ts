import { Router, type Response } from "express";
import { insertCitySchema, aiPrompts } from "@shared/schema";
import { db } from "../db";
import {
  getUserById,
  listCities,
  listActiveCities,
  createCity,
  updateCity,
  toggleCityActive,
  deleteCity,
  checkCityByCoords,
  recordCityDemand,
  getPublishedPlacesByCity,
} from "../storage";
import { geocodeCityPlace, reverseGeocodeCity } from "../google-places";
import { requireAuth, type AuthRequest } from "../auth";
import { eq } from "drizzle-orm";

const router = Router();

const updateCitySchema = insertCitySchema.partial();

router.get("/api/admin/cities/geocode", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  const placeId = req.query.place_id as string;
  if (!placeId) {
    res.status(400).json({ error: "place_id é obrigatório" });
    return;
  }
  try {
    const result = await geocodeCityPlace(placeId);
    res.json(result);
  } catch (err) {
    console.error("City geocode error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/admin/cities/active-prompt", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  try {
    const active = await db.query.aiPrompts.findFirst({
      where: eq(aiPrompts.is_active, true),
      orderBy: (t, { desc }) => [desc(t.updated_at)],
    });
    res.json({ prompt: active?.prompt ?? null });
  } catch (err) {
    console.error("Active prompt fetch error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/admin/cities", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  const search = req.query.search as string | undefined;
  try {
    const cityList = await listCities(search);
    res.json({ cities: cityList });
  } catch (err) {
    console.error("List cities error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/api/admin/cities", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const parsed = insertCitySchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const msg = [...flat.formErrors, ...Object.values(flat.fieldErrors).flat()].join(', ') || 'Dados inválidos';
      res.status(400).json({ error: msg });
      return;
    }
    try {
      const city = await createCity(parsed.data);
      res.status(201).json({ city });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("unique")) {
        res.status(409).json({ error: "Cidade já cadastrada" });
        return;
      }
      console.error("Create city error:", err);
      res.status(500).json({ error: msg });
    }
  }
);

router.patch("/api/admin/cities/:id/toggle", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const cityId = req.params.id as string;
    try {
      const city = await toggleCityActive(cityId);
      if (!city) {
        res.status(404).json({ error: "Cidade não encontrada" });
        return;
      }
      res.json({ city });
    } catch (err) {
      console.error("Toggle city error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

router.patch("/api/admin/cities/:id", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const parsed = updateCitySchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const msg = [...flat.formErrors, ...Object.values(flat.fieldErrors).flat()].join(', ') || 'Dados inválidos';
      res.status(400).json({ error: msg });
      return;
    }
    const cityId = req.params.id as string;
    try {
      const city = await updateCity(cityId, parsed.data);
      if (!city) {
        res.status(404).json({ error: "Cidade não encontrada" });
        return;
      }
      res.json({ city });
    } catch (err) {
      console.error("Update city error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

router.delete("/api/admin/cities/:id", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const cityId = req.params.id as string;
    try {
      const deleted = await deleteCity(cityId);
      if (!deleted) {
        res.status(404).json({ error: "Cidade não encontrada" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("Delete city error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

router.get("/api/cities/check", async (req: AuthRequest, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const label = ((req.query.label as string) || "").trim() || null;
  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "lat e lng são obrigatórios" });
    return;
  }
  try {
    const result = await checkCityByCoords(lat, lng);
    if (!result || !result.enabled) {
      (async () => {
        try {
          if (label) {
            await recordCityDemand(label, lat, lng);
          } else {
            const geo = await reverseGeocodeCity(lat, lng);
            if (geo) await recordCityDemand(geo.label, lat, lng, geo.estado);
          }
        } catch (e) {
          console.error("recordCityDemand error:", e);
        }
      })();
    }
    if (!result) {
      res.json({ enabled: false, city_id: null, city_name: null });
      return;
    }
    res.json({
      enabled: result.enabled,
      city_id: result.city.id,
      city_name: result.city.nome,
      distance_km: Math.round(result.distance_km * 10) / 10,
    });
  } catch (err) {
    console.error("City check error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/cities/list", async (req: AuthRequest, res: Response) => {
  const search = req.query.search as string | undefined;
  try {
    const cities = await listActiveCities(search);
    res.json({ cities });
  } catch (err) {
    console.error("List active cities error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/cities/:cityId/places", async (req: AuthRequest, res: Response) => {
  const cityId = req.params.cityId as string;
  const placeType = req.query.place_type as string | undefined;
  try {
    const places = await getPublishedPlacesByCity(
      cityId,
      (placeType === "comer" || placeType === "parques") ? placeType : undefined,
    );
    res.json({ places });
  } catch (err) {
    console.error("Curated places error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
