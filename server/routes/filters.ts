import { Router, type Response } from "express";
import { z } from "zod";
import { insertFilterSchema, aiPrompts } from "@shared/schema";
import { db } from "../db";
import {
  getUserById,
  archiveExpiredFilters,
  getActiveFilters,
  listFilters,
  createFilter,
  updateFilter,
  toggleFilter,
  getAiPromptByName,
  upsertAiPromptByName,
} from "../storage";
import { requireAuth, type AuthRequest } from "../auth";
import { invalidatePromptCache } from "../ai-review-analysis";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/api/filters/active", async (_req: AuthRequest, res: Response) => {
  try {
    await archiveExpiredFilters();
    const filters = await getActiveFilters();
    res.json({ filters });
  } catch (err) {
    console.error("Get active filters error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/admin/filters", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  try {
    await archiveExpiredFilters();
    const filters = await listFilters();
    res.json({ filters });
  } catch (err) {
    console.error("List filters error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/api/admin/filters", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  const parsed = insertFilterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const filter = await createFilter(parsed.data);
    res.status(201).json({ filter });
  } catch (err) {
    console.error("Create filter error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/admin/ai-prompts", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  try {
    const rows = await db.select().from(aiPrompts).orderBy(desc(aiPrompts.updated_at));
    res.json({ prompts: rows });
  } catch (err) {
    console.error("List prompts error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/admin/ai-prompts/active", requireAuth, async (req: AuthRequest, res: Response) => {
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
    res.json({ prompt: active ?? null });
  } catch (err) {
    console.error("Get active prompt error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

const upsertPromptSchema = z.object({
  prompt: z.string().min(10, "Prompt muito curto"),
});

router.put("/api/admin/ai-prompts/active", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || caller.role !== "admin") {
    res.status(403).json({ error: "Apenas administradores podem editar prompts" });
    return;
  }
  const parsed = upsertPromptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const existing = await db.query.aiPrompts.findFirst({
      where: eq(aiPrompts.is_active, true),
      orderBy: (t, { desc }) => [desc(t.updated_at)],
    });
    if (existing) {
      const [updated] = await db
        .update(aiPrompts)
        .set({ prompt: parsed.data.prompt, updated_at: new Date(), created_by: caller.id })
        .where(eq(aiPrompts.id, existing.id))
        .returning();
      invalidatePromptCache();
      res.json({ prompt: updated });
    } else {
      const [created] = await db
        .insert(aiPrompts)
        .values({ name: "default", prompt: parsed.data.prompt, is_active: true, created_by: caller.id })
        .returning();
      invalidatePromptCache();
      res.status(201).json({ prompt: created });
    }
  } catch (err) {
    console.error("Upsert prompt error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

const testPromptSchema = z.object({
  prompt: z.string().min(10),
  placeName: z.string().min(1),
  reviews: z.array(z.string()).min(1).max(5),
});

router.post("/api/admin/ai-prompts/test", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  const parsed = testPromptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(422).json({ error: "OPENAI_API_KEY não configurada no servidor" });
    return;
  }

  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey });

    const combinedReviews = parsed.data.reviews
      .map((r, i) => `Review ${i + 1}: ${r}`)
      .join("\n\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: parsed.data.prompt },
        {
          role: "user",
          content: `Estabelecimento: "${parsed.data.placeName}"\n\nReviews:\n${combinedReviews}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: "IA não retornou resposta" });
      return;
    }
    const result = JSON.parse(content);
    res.json({ result });
  } catch (err) {
    console.error("Test prompt error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch("/api/admin/filters/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  const filterId = req.params.id as string;
  const parsed = insertFilterSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const filter = await updateFilter(filterId, parsed.data);
    if (!filter) {
      res.status(404).json({ error: "Filtro não encontrado" });
      return;
    }
    res.json({ filter });
  } catch (err) {
    console.error("Update filter error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch("/api/admin/filters/:id/toggle", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  const filterId = req.params.id as string;
  try {
    const filter = await toggleFilter(filterId);
    if (!filter) {
      res.status(404).json({ error: "Filtro não encontrado" });
      return;
    }
    res.json({ filter });
  } catch (err) {
    console.error("Toggle filter error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/admin/ai-prompts/family-summary", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  try {
    const prompt = await getAiPromptByName("family_summary");
    res.json({ prompt });
  } catch (err) {
    console.error("Get family summary prompt error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.put("/api/admin/ai-prompts/family-summary", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  const parsed = z.object({ prompt: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const prompt = await upsertAiPromptByName("family_summary", parsed.data.prompt);
    res.json({ prompt });
  } catch (err) {
    console.error("Update family summary prompt error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
