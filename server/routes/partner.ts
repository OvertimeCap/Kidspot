import { Router, type Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import {
  getUserById,
  listPlacePhotos,
  addPlacePhoto,
  countPlacePhotos,
  getPhotoById,
  setCoverPhoto,
  setKidsAreaPhoto,
  deletePlacePhoto,
} from "../storage";
import { uploadPartnerPhoto, deletePartnerPhotoFromStorage } from "../firebase";
import { requireAuth, type AuthRequest } from "../auth";
import { requirePartnerWithPlace } from "./helpers";

const router = Router();

router.get(
  "/api/partner/places/:placeId/photos",
  requireAuth,
  requirePartnerWithPlace,
  async (req: AuthRequest, res: Response) => {
    const dbUser = (req as AuthRequest & { dbUser: Awaited<ReturnType<typeof getUserById>> }).dbUser!;
    const placeId = req.params.placeId as string;
    if (dbUser.linked_place_id !== placeId) {
      res.status(403).json({ error: "Você só pode gerenciar fotos do seu local vinculado" });
      return;
    }
    try {
      const photos = await listPlacePhotos(placeId);
      res.json({ photos });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

const partnerUploadPhotoSchema = z.object({
  photo_data: z
    .string()
    .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/, "Formato de imagem inválido"),
});

router.post(
  "/api/partner/places/:placeId/photos",
  requireAuth,
  requirePartnerWithPlace,
  async (req: AuthRequest, res: Response) => {
    const dbUser = (req as AuthRequest & { dbUser: Awaited<ReturnType<typeof getUserById>> }).dbUser!;
    const placeId = req.params.placeId as string;
    if (dbUser.linked_place_id !== placeId) {
      res.status(403).json({ error: "Você só pode gerenciar fotos do seu local vinculado" });
      return;
    }
    const parsed = partnerUploadPhotoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const count = await countPlacePhotos(placeId);
      if (count >= 8) {
        res.status(409).json({ error: "Limite de 8 fotos por local atingido" });
        return;
      }
      const base64Data = parsed.data.photo_data.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const photoId = crypto.randomUUID();
      const publicUrl = await uploadPartnerPhoto(buffer, dbUser.id, placeId, photoId);
      const photo = await addPlacePhoto({ place_id: placeId, url: publicUrl, order: count });
      res.status(201).json({ photo });
    } catch (err) {
      console.error("Partner upload photo error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.patch(
  "/api/partner/photos/:photoId/cover",
  requireAuth,
  requirePartnerWithPlace,
  async (req: AuthRequest, res: Response) => {
    const dbUser = (req as AuthRequest & { dbUser: Awaited<ReturnType<typeof getUserById>> }).dbUser!;
    const photoId = req.params.photoId as string;
    try {
      const photo = await getPhotoById(photoId);
      if (!photo || photo.deleted) { res.status(404).json({ error: "Foto não encontrada" }); return; }
      if (photo.place_id !== dbUser.linked_place_id) { res.status(403).json({ error: "Acesso negado" }); return; }
      await setCoverPhoto(photo.place_id, photoId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

const kidsAreaSchema = z.object({ is_kids_area: z.boolean() });

router.patch(
  "/api/partner/photos/:photoId/kids-area",
  requireAuth,
  requirePartnerWithPlace,
  async (req: AuthRequest, res: Response) => {
    const dbUser = (req as AuthRequest & { dbUser: Awaited<ReturnType<typeof getUserById>> }).dbUser!;
    const photoId = req.params.photoId as string;
    const parsed = kidsAreaSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    try {
      const photo = await getPhotoById(photoId);
      if (!photo || photo.deleted) { res.status(404).json({ error: "Foto não encontrada" }); return; }
      if (photo.place_id !== dbUser.linked_place_id) { res.status(403).json({ error: "Acesso negado" }); return; }
      await setKidsAreaPhoto(photo.place_id, photoId, parsed.data.is_kids_area);
      res.json({ ok: true });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("Limite de 2")) {
        res.status(409).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  },
);

router.delete(
  "/api/partner/photos/:photoId",
  requireAuth,
  requirePartnerWithPlace,
  async (req: AuthRequest, res: Response) => {
    const dbUser = (req as AuthRequest & { dbUser: Awaited<ReturnType<typeof getUserById>> }).dbUser!;
    const photoId = req.params.photoId as string;
    try {
      const photo = await getPhotoById(photoId);
      if (!photo || photo.deleted) { res.status(404).json({ error: "Foto não encontrada" }); return; }
      if (photo.place_id !== dbUser.linked_place_id) { res.status(403).json({ error: "Acesso negado" }); return; }
      await deletePlacePhoto(photoId);
      if (!photo.photo_reference) {
        deletePartnerPhotoFromStorage(dbUser.id, photo.place_id, photoId).catch(() => {});
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

export default router;
