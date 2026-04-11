import { Router, type Response } from "express";
import { z } from "zod";
import {
  getPublishedPlacesByCityAdmin,
  searchPlacesForPublishing,
  updatePlaceDisplayOrder,
  removeFromPublished,
  addToPublished,
  bulkPublishWithOrder,
  upsertPlaceWithCity,
  upsertPlaceMeta,
  addPlacePhoto,
  approveCurationItem,
} from "../storage";
import { autocompleteEstablishments, getPlaceDetails } from "../google-places";
import { requireAuth, type AuthRequest } from "../auth";
import { requireAdminOrCollaborator } from "./helpers";

const router = Router();

router.get(
  "/api/admin/published/places",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const cityId = req.query.city_id as string;
    if (!cityId) {
      res.status(400).json({ error: "city_id é obrigatório" });
      return;
    }
    try {
      const places = await getPublishedPlacesByCityAdmin(cityId);
      res.json({ places });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.get(
  "/api/admin/published/search-places",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const cityId = req.query.city_id as string;
    const q = (req.query.q as string) ?? "";
    if (!cityId) {
      res.status(400).json({ error: "city_id é obrigatório" });
      return;
    }
    try {
      const places = await searchPlacesForPublishing(cityId, q);
      res.json({ places });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.post(
  "/api/admin/published",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const parsed = z.object({
      place_id: z.string().min(1),
      city_id: z.string().min(1),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      await addToPublished(parsed.data.place_id, parsed.data.city_id, req.user!.userId);
      res.status(201).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.patch(
  "/api/admin/published/:placeId/order",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const placeId = req.params.placeId as string;
    const parsed = z.object({ order: z.number().int().min(0) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      await updatePlaceDisplayOrder(placeId, parsed.data.order);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.delete(
  "/api/admin/published/:placeId",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const placeId = req.params.placeId as string;
    try {
      await removeFromPublished(placeId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.post(
  "/api/admin/curation/bulk-publish",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const parsed = z.object({
      city_id: z.string().min(1),
      places: z.array(z.object({
        place_id: z.string().min(1),
        display_order: z.number().int().min(1),
      })).min(1),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      await bulkPublishWithOrder(parsed.data.city_id, parsed.data.places, req.user!.userId);
      res.json({ ok: true, count: parsed.data.places.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.get(
  "/api/admin/google-places/autocomplete",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const input = req.query.input as string;
    const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
    const lng = req.query.lng ? parseFloat(req.query.lng as string) : undefined;
    if (!input || input.trim().length === 0) {
      res.json({ suggestions: [] });
      return;
    }
    try {
      const suggestions = await autocompleteEstablishments(input.trim(), lat, lng);
      res.json({ suggestions });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.get(
  "/api/admin/google-places/details/:placeId",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const placeId = req.params.placeId as string;
    if (!placeId) {
      res.status(400).json({ error: "placeId is required" });
      return;
    }
    try {
      const details = await getPlaceDetails(placeId);
      res.json({ place: details });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

const ingestAndPublishSchema = z.object({
  place_id: z.string().min(1),
  name: z.string().min(1),
  address: z.string().optional().default(""),
  category: z.string().optional().default(""),
  city: z.string().min(1),
  ciudad_id: z.string().min(1),
  lat: z.number().default(0),
  lng: z.number().default(0),
  photo_reference: z.string().optional(),
});

const ingestToFilaSchema = ingestAndPublishSchema.extend({
  target_status: z.enum(["pendente", "aprovado"]).default("pendente"),
});

router.post(
  "/api/admin/google-places/ingest-to-fila",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const parsed = ingestToFilaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { place_id, name, address, category, city, ciudad_id, lat, lng, photo_reference, target_status } = parsed.data;
    const userId = req.user!.userId;

    try {
      await upsertPlaceWithCity({ place_id, city, ciudad_id, lat, lng });
      await upsertPlaceMeta({ place_id, name, address, category, city });

      if (photo_reference) {
        const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${encodeURIComponent(photo_reference)}&key=${process.env.GOOGLE_PLACES_API_KEY || ""}`;
        await addPlacePhoto({ place_id, url: photoUrl, photo_reference, order: 0 });
      }

      if (target_status === "aprovado") {
        await approveCurationItem(place_id, userId);
      }

      res.status(201).json({ ok: true });
    } catch (err) {
      console.error("Ingest to fila error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.post(
  "/api/admin/google-places/ingest-and-publish",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const parsed = ingestAndPublishSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { place_id, name, address, category, city, ciudad_id, lat, lng, photo_reference } = parsed.data;
    const userId = req.user!.userId;

    try {
      await upsertPlaceWithCity({ place_id, city, ciudad_id, lat, lng });
      await upsertPlaceMeta({ place_id, name, address, category, city });

      if (photo_reference) {
        const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${encodeURIComponent(photo_reference)}&key=${process.env.GOOGLE_PLACES_API_KEY || ""}`;
        await addPlacePhoto({ place_id, url: photoUrl, photo_reference, order: 0 });
      }

      await addToPublished(place_id, ciudad_id, userId);

      res.status(201).json({ ok: true });
    } catch (err) {
      console.error("Ingest and publish error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

export default router;
