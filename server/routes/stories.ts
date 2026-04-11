import { Router, type Response } from "express";
import { z } from "zod";
import {
  getStoriesNearby,
  getActiveStoriesForPlaces,
  createPartnerStory,
  getStoryById,
  getStoryPhotos,
  getStoryPhotoById,
  getUserById,
} from "../storage";
import { getPlaceDetails } from "../google-places";
import { requireAuth, type AuthRequest } from "../auth";

const router = Router();

const ALLOWED_IMAGE_PREFIXES = [
  "data:image/jpeg;base64,",
  "data:image/jpg;base64,",
  "data:image/png;base64,",
  "data:image/webp;base64,",
  "data:image/gif;base64,",
  "data:image/heic;base64,",
  "data:image/heif;base64,",
];

const isValidImageDataUri = (s: string) =>
  ALLOWED_IMAGE_PREFIXES.some((prefix) => s.startsWith(prefix));

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const createStorySchema = z.object({
  photos: z
    .array(
      z.string().refine(isValidImageDataUri, {
        message: "Cada foto deve ser uma imagem válida (jpeg, png, webp)",
      }),
    )
    .min(1)
    .max(10)
    .refine(
      (photos) => photos.every((p) => Buffer.byteLength(p, "utf8") <= MAX_PHOTO_BYTES),
      { message: "Cada foto deve ter no máximo 5 MB" },
    ),
});

router.get("/api/stories/nearby", async (req: AuthRequest, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const rawRadius = parseFloat((req.query.radius as string) || "8");

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ error: "lat e lng são obrigatórios e devem ser válidos" });
    return;
  }

  const radius = isFinite(rawRadius) && rawRadius > 0 ? Math.min(rawRadius, 50) : 8;

  try {
    const stories = await getStoriesNearby(lat, lng, radius);
    res.json({ stories });
  } catch (err) {
    console.error("Get stories nearby error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/stories/photo/:photoId", async (req: AuthRequest, res: Response) => {
  const photoId = req.params.photoId as string;

  try {
    const photo = await getStoryPhotoById(photoId);
    if (!photo) {
      res.status(404).json({ error: "Foto não encontrada" });
      return;
    }

    const parentStory = await getStoryById(photo.story_id);
    if (!parentStory || parentStory.expires_at < new Date()) {
      res.status(404).json({ error: "Story expirado" });
      return;
    }

    const base64Data = photo.photo_data;
    const matches = base64Data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);

    if (matches) {
      const contentType = matches[1];
      const buffer = Buffer.from(matches[2], "base64");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(buffer);
    } else {
      const buffer = Buffer.from(base64Data, "base64");
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(buffer);
    }
  } catch (err) {
    console.error("Get story photo error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/stories", async (req: AuthRequest, res: Response) => {
  const placeIdsParam = req.query.place_ids as string | undefined;
  if (!placeIdsParam) {
    res.status(400).json({ error: "place_ids query parameter is required" });
    return;
  }

  const placeIds = placeIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (placeIds.length === 0) {
    res.json({ stories: [] });
    return;
  }

  try {
    const stories = await getActiveStoriesForPlaces(placeIds);
    res.json({ stories });
  } catch (err) {
    console.error("Get stories error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/api/stories", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;

  const dbUser = await getUserById(userId);
  if (!dbUser) {
    res.status(401).json({ error: "Usuário não encontrado" });
    return;
  }

  if (dbUser.role !== "parceiro" && dbUser.role !== "estabelecimento") {
    res.status(403).json({ error: "Apenas parceiros e estabelecimentos podem publicar stories" });
    return;
  }

  if (!dbUser.linked_place_id || !dbUser.linked_place_name) {
    res.status(403).json({ error: "Você precisa ter um local vinculado para publicar stories" });
    return;
  }

  const parsed = createStorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    let placeLat: number;
    let placeLng: number;
    try {
      const details = await getPlaceDetails(dbUser.linked_place_id);
      if (details?.location?.lat == null || details?.location?.lng == null) {
        res.status(422).json({ error: "Não foi possível obter as coordenadas do seu local. Tente novamente." });
        return;
      }
      placeLat = details.location.lat;
      placeLng = details.location.lng;
    } catch {
      res.status(422).json({ error: "Não foi possível obter as coordenadas do seu local. Verifique sua conexão e tente novamente." });
      return;
    }

    const story = await createPartnerStory(
      userId,
      dbUser.linked_place_id,
      dbUser.linked_place_name,
      parsed.data.photos,
      placeLat,
      placeLng,
    );
    res.status(201).json({ story });
  } catch (err) {
    console.error("Create story error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/stories/:id/photos", async (req: AuthRequest, res: Response) => {
  const storyId = req.params.id as string;

  try {
    const story = await getStoryById(storyId);
    if (!story) {
      res.status(404).json({ error: "Story não encontrado" });
      return;
    }

    if (story.expires_at < new Date()) {
      res.status(404).json({ error: "Story expirado" });
      return;
    }

    const photos = await getStoryPhotos(storyId);
    res.json({ photos: photos.map((p) => ({ id: p.id, order: p.order })) });
  } catch (err) {
    console.error("Get story photos error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
