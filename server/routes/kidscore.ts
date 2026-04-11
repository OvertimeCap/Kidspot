import { Router, type Response } from "express";
import { z } from "zod";
import { kidscoreRules, customCriteria } from "@shared/schema";
import { db } from "../db";
import { getUserById } from "../storage";
import { requireAuth, type AuthRequest } from "../auth";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/api/admin/kidscore-rules", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  try {
    const rows = await db.select().from(kidscoreRules).orderBy(kidscoreRules.label);
    res.json({ rules: rows });
  } catch (err) {
    console.error("List kidscore rules error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

const updateRuleSchema = z.object({
  weight: z.number().int().min(0).max(1000).optional(),
  is_active: z.boolean().optional(),
  label: z.string().min(1).optional(),
});

router.patch("/api/admin/kidscore-rules/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || caller.role !== "admin") {
    res.status(403).json({ error: "Apenas administradores podem editar regras de ranqueamento" });
    return;
  }
  const parsed = updateRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const [updated] = await db
      .update(kidscoreRules)
      .set({ ...parsed.data, updated_at: new Date() })
      .where(eq(kidscoreRules.id, req.params.id as string))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Regra não encontrada" });
      return;
    }
    res.json({ rule: updated });
  } catch (err) {
    console.error("Update kidscore rule error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

const bulkUpdateRulesSchema = z.object({
  rules: z.array(z.object({
    id: z.string(),
    weight: z.number().int().min(0).max(1000),
    is_active: z.boolean(),
  })),
});

router.put("/api/admin/kidscore-rules", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || caller.role !== "admin") {
    res.status(403).json({ error: "Apenas administradores podem editar regras de ranqueamento" });
    return;
  }
  const parsed = bulkUpdateRulesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const updated = [];
    for (const rule of parsed.data.rules) {
      const [row] = await db
        .update(kidscoreRules)
        .set({ weight: rule.weight, is_active: rule.is_active, updated_at: new Date() })
        .where(eq(kidscoreRules.id, rule.id))
        .returning();
      if (row) updated.push(row);
    }
    res.json({ rules: updated });
  } catch (err) {
    console.error("Bulk update kidscore rules error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/admin/custom-criteria", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  try {
    const rows = await db.select().from(customCriteria).orderBy(customCriteria.created_at);
    res.json({ criteria: rows });
  } catch (err) {
    console.error("List custom criteria error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

const createCriterionSchema = z.object({
  key: z.string().min(1).regex(/^[a-z_]+$/, "Chave deve conter apenas letras minúsculas e underscores"),
  label: z.string().min(1),
  field_type: z.enum(["boolean", "number", "text"]).default("boolean"),
  show_in_filter: z.boolean().default(true),
});

router.post("/api/admin/custom-criteria", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || caller.role !== "admin") {
    res.status(403).json({ error: "Apenas administradores podem criar critérios" });
    return;
  }
  const parsed = createCriterionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const [created] = await db
      .insert(customCriteria)
      .values({ ...parsed.data, is_active: true })
      .returning();
    res.status(201).json({ criterion: created });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("unique")) {
      res.status(409).json({ error: "Já existe um critério com essa chave" });
      return;
    }
    console.error("Create custom criterion error:", err);
    res.status(500).json({ error: msg });
  }
});

router.delete("/api/admin/custom-criteria/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || caller.role !== "admin") {
    res.status(403).json({ error: "Apenas administradores podem excluir critérios" });
    return;
  }
  try {
    const [deleted] = await db
      .delete(customCriteria)
      .where(eq(customCriteria.id, req.params.id as string))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Critério não encontrado" });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error("Delete custom criterion error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch("/api/admin/custom-criteria/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || caller.role !== "admin") {
    res.status(403).json({ error: "Apenas administradores podem editar critérios" });
    return;
  }
  const patchSchema = z.object({
    is_active: z.boolean().optional(),
    show_in_filter: z.boolean().optional(),
    label: z.string().min(1).optional(),
  });
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const [updated] = await db
      .update(customCriteria)
      .set(parsed.data)
      .where(eq(customCriteria.id, req.params.id as string))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Critério não encontrado" });
      return;
    }
    res.json({ criterion: updated });
  } catch (err) {
    console.error("Patch custom criterion error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
