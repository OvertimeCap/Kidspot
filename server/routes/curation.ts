import { Router, type Response } from "express";
import { z } from "zod";
import { placeKidspotMeta, placePhotos } from "@shared/schema";
import { db } from "../db";
import {
  listCurationQueue,
  countPendingCuration,
  upsertPlaceMeta,
  approveCurationItem,
  rejectCurationItem,
  resetCurationItem,
  listPlacePhotos,
  addPlacePhoto,
  setCoverPhoto,
  deletePlacePhoto,
  getActiveSponsoredPlaceIds,
  updatePlaceType,
  getAiPromptByName,
  upsertAiPromptByName,
  updatePlaceFamilySummary,
  getReviewsForPlace,
} from "../storage";
import { getPlaceDetails } from "../google-places";
import { generateFamilySummary, DEFAULT_FAMILY_SUMMARY_PROMPT } from "../ai-family-summary";
import { requireAuth, type AuthRequest } from "../auth";
import { requireAdminOrCollaborator } from "./helpers";
import { eq, and, isNull, or } from "drizzle-orm";

const router = Router();

router.post(
  "/api/admin/curation/backfill-meta",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    try {
      const missing = await db
        .select({ place_id: placeKidspotMeta.place_id })
        .from(placeKidspotMeta)
        .where(or(isNull(placeKidspotMeta.name), eq(placeKidspotMeta.name, "")));

      let updated = 0;
      let failed = 0;
      for (const row of missing) {
        try {
          const details = await getPlaceDetails(row.place_id);
          await upsertPlaceMeta({ place_id: row.place_id, name: details.name, address: details.formatted_address });
          const existingPhoto = await db.query.placePhotos.findFirst({
            where: and(eq(placePhotos.place_id, row.place_id), eq(placePhotos.deleted, false)),
          });
          if (!existingPhoto && details.photos?.[0]?.photo_reference) {
            const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${encodeURIComponent(details.photos[0].photo_reference)}&key=${process.env.GOOGLE_PLACES_API_KEY || ""}`;
            await addPlacePhoto({ place_id: row.place_id, url: photoUrl, photo_reference: details.photos[0].photo_reference, order: 0 });
          }
          updated++;
        } catch {
          failed++;
        }
      }
      res.json({ total: missing.length, updated, failed });
    } catch (err) {
      console.error("Backfill meta error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.get(
  "/api/admin/curation/pending-count",
  requireAuth,
  requireAdminOrCollaborator,
  async (_req: AuthRequest, res: Response) => {
    try {
      const count = await countPendingCuration();
      res.json({ count });
    } catch (err) {
      console.error("Pending count error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

const ingestPlaceSchema = z.object({
  place_id: z.string().min(1),
  name: z.string().optional(),
  address: z.string().optional(),
  category: z.string().optional(),
  city: z.string().optional(),
  kid_score: z.number().int().min(0).max(100).optional(),
  ai_evidences: z.array(z.string()).optional(),
  description: z.string().optional(),
  photos: z.array(z.object({
    url: z.string().url(),
    photo_reference: z.string().optional(),
    order: z.number().int().optional(),
  })).optional(),
});

router.post(
  "/api/admin/curation/ingest",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const parsed = ingestPlaceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const { place_id, photos, ...meta } = parsed.data;
      await upsertPlaceMeta({ place_id, ...meta });

      if (photos && photos.length > 0) {
        for (const p of photos) {
          await addPlacePhoto({ place_id, ...p });
        }
      }

      res.status(201).json({ ok: true });
    } catch (err) {
      console.error("Ingest place error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.get(
  "/api/admin/curation/queue",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const status = (req.query.status as string) || "pendente";
    const city = req.query.city as string | undefined;
    const category = req.query.category as string | undefined;
    const minKidScore = req.query.min_kid_score ? parseInt(req.query.min_kid_score as string, 10) : undefined;
    const maxKidScore = req.query.max_kid_score ? parseInt(req.query.max_kid_score as string, 10) : undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || "20", 10), 100);
    const offset = parseInt((req.query.offset as string) || "0", 10);

    const placeType = req.query.place_type as string | undefined;
    const validStatuses = ["pendente", "aprovado", "rejeitado"];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: "status inválido" });
      return;
    }

    try {
      const result = await listCurationQueue({
        status: status as "pendente" | "aprovado" | "rejeitado",
        city,
        category,
        minKidScore,
        maxKidScore,
        placeType: (placeType === "comer" || placeType === "parques") ? placeType : undefined,
        limit,
        offset,
      });
      const sponsoredMap = await getActiveSponsoredPlaceIds();
      const augmented = result.items.map(item => ({
        ...item,
        is_sponsored: sponsoredMap.has(item.place_id),
      }));
      res.json({ items: augmented, total: result.total });
    } catch (err) {
      console.error("Curation queue error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

const placeTypeSchema = z.object({
  place_type: z.enum(["comer", "parques"]),
});

router.post(
  "/api/admin/curation/:placeId/place-type",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const placeId = req.params.placeId as string;
    const parsed = placeTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      await updatePlaceType(placeId, parsed.data.place_type);
      res.json({ ok: true });
    } catch (err) {
      console.error("Update place type error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

const curationApproveSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  family_summary: z.string().optional(),
  custom_criteria: z.record(z.unknown()).optional(),
  place_type: z.enum(["comer", "parques"]).optional(),
});

router.post(
  "/api/admin/curation/:placeId/approve",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const placeId = req.params.placeId as string;
    const parsed = curationApproveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      await approveCurationItem(placeId, req.user!.userId, parsed.data);
      res.json({ ok: true });
    } catch (err) {
      console.error("Approve curation error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.post(
  "/api/admin/curation/:placeId/reject",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const placeId = req.params.placeId as string;

    try {
      await rejectCurationItem(placeId, req.user!.userId);
      res.json({ ok: true });
    } catch (err) {
      console.error("Reject curation error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.post(
  "/api/admin/curation/:placeId/reset",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const placeId = req.params.placeId as string;
    try {
      await resetCurationItem(placeId);
      res.json({ ok: true });
    } catch (err) {
      console.error("Reset curation error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.get(
  "/api/admin/curation/:placeId/photos",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const placeId = req.params.placeId as string;
    try {
      const photos = await listPlacePhotos(placeId);
      res.json({ photos });
    } catch (err) {
      console.error("List photos error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.patch("/api/admin/photos/:photoId/cover", requireAuth, requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const photoId = req.params.photoId as string;
    const placeId = req.body.place_id as string;
    if (!placeId) { res.status(400).json({ error: "place_id is required" }); return; }
    try {
      await setCoverPhoto(placeId, photoId);
      res.json({ ok: true });
    } catch (err) {
      console.error("Set cover error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.delete("/api/admin/photos/:photoId", requireAuth, requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const photoId = req.params.photoId as string;
    try {
      await deletePlacePhoto(photoId);
      res.json({ ok: true });
    } catch (err) {
      console.error("Delete photo error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

const generateSummarySchema = z.object({
  prompt: z.string().optional(),
});

router.post(
  "/api/admin/curation/:placeId/generate-family-summary",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const placeId = req.params.placeId as string;
    const parsed = generateSummarySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const [meta, reviews] = await Promise.all([
        db.query.placeKidspotMeta.findFirst({
          where: eq(placeKidspotMeta.place_id, placeId),
          columns: { name: true, category: true, ai_evidences: true },
        }),
        getReviewsForPlace(placeId),
      ]);

      if (!meta) {
        res.status(404).json({ error: "Local não encontrado na fila de curadoria." });
        return;
      }

      let prompt = parsed.data.prompt;
      if (prompt) {
        await upsertAiPromptByName("family_summary", prompt);
      } else {
        const stored = await getAiPromptByName("family_summary");
        prompt = stored?.prompt ?? DEFAULT_FAMILY_SUMMARY_PROMPT;
      }

      const reviewNotes = reviews
        .map((r) => r.note)
        .filter((n): n is string => !!n && n.trim().length > 0);

      const summary = await generateFamilySummary({
        placeName: meta.name ?? placeId,
        category: meta.category ?? null,
        reviewNotes,
        aiEvidences: meta.ai_evidences,
        prompt,
      });

      res.json({ summary });
    } catch (err) {
      console.error("Generate family summary error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

const saveSummarySchema = z.object({
  family_summary: z.string().min(1),
});

router.patch(
  "/api/admin/curation/:placeId/family-summary",
  requireAuth,
  requireAdminOrCollaborator,
  async (req: AuthRequest, res: Response) => {
    const placeId = req.params.placeId as string;
    const parsed = saveSummarySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      await updatePlaceFamilySummary(placeId, parsed.data.family_summary);
      res.json({ ok: true });
    } catch (err) {
      console.error("Save family summary error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

export default router;
