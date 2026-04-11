import { Router, type Response } from "express";
import { z } from "zod";
import { aiProviders, pipelineRouting } from "@shared/schema";
import { db } from "../db";
import { getUserById } from "../storage";
import { encryptApiKey, decryptApiKey, maskApiKey } from "../ai-crypto";
import { requireAuth, type AuthRequest } from "../auth";
import { eq } from "drizzle-orm";

const router = Router();

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic / Claude",
  perplexity: "Perplexity",
  google: "Google Gemini",
};

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-3-5-sonnet-20241022"],
  perplexity: ["llama-3.1-sonar-large-128k-online", "llama-3.1-sonar-small-128k-online"],
  google: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-exp"],
};

const PROVIDER_NAMES = ["openai", "anthropic", "perplexity", "google"] as const;
type ProviderName = typeof PROVIDER_NAMES[number];

const PIPELINE_STAGES = ["place_discovery", "review_analysis", "description_generation", "score_calculation"] as const;
type PipelineStage = typeof PIPELINE_STAGES[number];

router.get("/api/admin/ai-providers", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  try {
    const rows = await db.select().from(aiProviders);
    const rowsByProvider = Object.fromEntries(rows.map((r) => [r.provider, r]));
    const providers = PROVIDER_NAMES.map((p) => {
      const row = rowsByProvider[p];
      return {
        provider: p,
        label: PROVIDER_LABELS[p],
        configured: !!(row?.encrypted_key),
        is_active: row?.is_active ?? false,
        tested_at: row?.tested_at ?? null,
        masked_key: row?.encrypted_key ? maskApiKey(decryptApiKey(row.encrypted_key)) : null,
        available_models: PROVIDER_MODELS[p] ?? [],
      };
    });
    res.json({ providers });
  } catch (err) {
    console.error("List AI providers error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

const upsertProviderKeySchema = z.object({
  api_key: z.string().min(1, "Chave de API é obrigatória"),
});

router.put("/api/admin/ai-providers/:provider", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || caller.role !== "admin") {
    res.status(403).json({ error: "Apenas administradores podem configurar provedores de IA" });
    return;
  }
  const provider = req.params.provider as ProviderName;
  if (!PROVIDER_NAMES.includes(provider)) {
    res.status(400).json({ error: "Provedor inválido" });
    return;
  }
  const parsed = upsertProviderKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const encrypted = encryptApiKey(parsed.data.api_key);
    await db
      .insert(aiProviders)
      .values({ provider, encrypted_key: encrypted, is_active: true })
      .onConflictDoUpdate({
        target: [aiProviders.provider],
        set: { encrypted_key: encrypted, is_active: true, updated_at: new Date() },
      });
    res.json({ ok: true, masked_key: maskApiKey(parsed.data.api_key) });
  } catch (err) {
    console.error("Save AI provider key error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/api/admin/ai-providers/:provider/test", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  const provider = req.params.provider as ProviderName;
  if (!PROVIDER_NAMES.includes(provider)) {
    res.status(400).json({ error: "Provedor inválido" });
    return;
  }
  try {
    const row = await db.query.aiProviders.findFirst({
      where: eq(aiProviders.provider, provider),
    });
    if (!row?.encrypted_key) {
      res.status(400).json({ error: "Provedor não configurado. Cadastre uma chave de API primeiro." });
      return;
    }
    const apiKey = decryptApiKey(row.encrypted_key);
    let testPassed = false;
    let errorMsg = "";

    if (provider === "openai") {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ apiKey });
      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Say ok" }],
        max_tokens: 5,
      });
      testPassed = !!(resp.choices[0]?.message?.content);
    } else if (provider === "anthropic") {
      const httpRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 5,
          messages: [{ role: "user", content: "Say ok" }],
        }),
      });
      testPassed = httpRes.ok;
      if (!testPassed) {
        const d = await httpRes.json() as { error?: { message?: string } };
        errorMsg = d.error?.message || `HTTP ${httpRes.status}`;
      }
    } else if (provider === "perplexity") {
      const httpRes = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-sonar-small-128k-online",
          messages: [{ role: "user", content: "Say ok" }],
          max_tokens: 5,
        }),
      });
      testPassed = httpRes.ok;
      if (!testPassed) {
        const d = await httpRes.json() as { error?: { message?: string } };
        errorMsg = d.error?.message || `HTTP ${httpRes.status}`;
      }
    } else if (provider === "google") {
      const httpRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Say ok" }] }] }),
        },
      );
      testPassed = httpRes.ok;
      if (!testPassed) {
        const d = await httpRes.json() as { error?: { message?: string } };
        errorMsg = d.error?.message || `HTTP ${httpRes.status}`;
      }
    }

    if (testPassed) {
      await db
        .update(aiProviders)
        .set({ tested_at: new Date(), updated_at: new Date() })
        .where(eq(aiProviders.provider, provider));
      res.json({ ok: true, message: "Conexão testada com sucesso!" });
    } else {
      res.status(400).json({ ok: false, error: errorMsg || "Falha na conexão com o provedor" });
    }
  } catch (err) {
    console.error("Test AI provider error:", err);
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

router.get("/api/admin/pipeline-routing", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  try {
    const rows = await db.select().from(pipelineRouting);
    res.json({ routing: rows });
  } catch (err) {
    console.error("List pipeline routing error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

const updateRoutingSchema = z.object({
  primary_provider: z.enum(["openai", "anthropic", "perplexity", "google"]).nullable().optional(),
  model: z.string().min(1).nullable().optional(),
  fallback_order: z.array(z.enum(["openai", "anthropic", "perplexity", "google"])).optional(),
});

router.patch("/api/admin/pipeline-routing/:stage", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || caller.role !== "admin") {
    res.status(403).json({ error: "Apenas administradores podem alterar o roteamento do pipeline" });
    return;
  }
  const stage = req.params.stage as PipelineStage;
  if (!PIPELINE_STAGES.includes(stage)) {
    res.status(400).json({ error: "Etapa inválida" });
    return;
  }
  const parsed = updateRoutingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const setClause: Partial<{
      primary_provider: string | null;
      model: string | null;
      fallback_order: string[];
      updated_at: Date;
    }> = { updated_at: new Date() };
    if (parsed.data.primary_provider !== undefined) setClause.primary_provider = parsed.data.primary_provider ?? null;
    if (parsed.data.model !== undefined) setClause.model = parsed.data.model ?? null;
    if (parsed.data.fallback_order !== undefined) setClause.fallback_order = parsed.data.fallback_order;

    const [updated] = await db
      .update(pipelineRouting)
      .set(setClause as never)
      .where(eq(pipelineRouting.stage, stage))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Etapa não encontrada" });
      return;
    }
    res.json({ routing: updated });
  } catch (err) {
    console.error("Update pipeline routing error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
