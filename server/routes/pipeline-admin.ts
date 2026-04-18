import { Router, type Response } from "express";
import { z } from "zod";
import { pipelineBlacklist, placesKidspot } from "@shared/schema";
import { db } from "../db";
import { getUserById } from "../storage";
import { requireAuth, type AuthRequest } from "../auth";
import { eq, desc, and, ilike, sql as sqlExpr } from "drizzle-orm";

const router = Router();

router.get("/api/admin/blacklist", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const cityId = req.query.city_id as string | undefined;
      const search = req.query.search as string | undefined;

      const conditions = [];
      if (cityId) conditions.push(eq(pipelineBlacklist.city_id, cityId));
      if (search) conditions.push(ilike(pipelineBlacklist.nome, `%${search}%`));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select()
        .from(pipelineBlacklist)
        .where(where)
        .orderBy(desc(pipelineBlacklist.excluido_em));

      res.json({ items: rows });
    } catch (err) {
      console.error("List blacklist error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

router.post("/api/admin/blacklist", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const schema = z.object({
      items: z.array(z.object({
        place_id: z.string(),
        city_id: z.string().optional(),
        city_name: z.string().optional(),
        nome: z.string(),
        tipo: z.string().optional(),
      })),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      let added = 0;
      for (const item of parsed.data.items) {
        const existing = await db.query.pipelineBlacklist.findFirst({
          where: eq(pipelineBlacklist.place_id, item.place_id),
        });
        if (!existing) {
          await db.insert(pipelineBlacklist).values({
            place_id: item.place_id,
            city_id: item.city_id ?? null,
            city_name: item.city_name ?? null,
            nome: item.nome,
            tipo: item.tipo ?? null,
            excluido_por: caller.id,
          });
          added++;
        }
      }
      res.json({ added });
    } catch (err) {
      console.error("Add to blacklist error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

router.delete("/api/admin/blacklist/:id", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      await db.delete(pipelineBlacklist).where(eq(pipelineBlacklist.id, req.params.id));
      res.json({ ok: true });
    } catch (err) {
      console.error("Remove from blacklist error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

router.get("/api/admin/places/pending", requireAuth,
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
        db.select().from(placesKidspot).where(eq(placesKidspot.status, "pendente")).orderBy(desc(placesKidspot.created_at)).limit(limit).offset(offset),
        db.select({ count: sqlExpr<number>`count(*)::int` }).from(placesKidspot).where(eq(placesKidspot.status, "pendente")),
      ]);
      res.json({ places: rows, total: countResult[0]?.count ?? 0 });
    } catch (err) {
      console.error("List pending places error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

const updatePlaceStatusSchema = z.object({
  status: z.enum(["aprovado", "rejeitado"]),
});

router.patch("/api/admin/places/:place_id/status", requireAuth,
  async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const parsed = updatePlaceStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const [updated] = await db.update(placesKidspot)
        .set({ status: parsed.data.status })
        .where(eq(placesKidspot.place_id, req.params.place_id as string))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Local não encontrado" });
        return;
      }
      res.json({ place: updated });
    } catch (err) {
      console.error("Update place status error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

export default router;
