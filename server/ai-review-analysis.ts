import OpenAI from "openai";
import { db } from "./db";
import { enrichmentCache, aiPrompts, aiProviders, pipelineRouting } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { decryptApiKey } from "./ai-crypto";

const CACHE_TTL_DAYS = 7;

export type AIFamilyAnalysis = {
  family_score: number;
  highlights: string[];
  confidence: "high" | "medium" | "low";
};

const FALLBACK_SYSTEM_PROMPT = `Você é um assistente especializado em avaliar se um estabelecimento é adequado para famílias com crianças pequenas (0-10 anos).

Analise os textos de reviews fornecidos e identifique sinais de que o lugar é family-friendly.

Procure por menções a:
- Infraestrutura infantil: brinquedoteca, playground, área kids, espaço kids, piscina infantil
- Equipamentos: trocador/fraldário, cadeirão/cadeirinha, banheiro família
- Cardápio infantil, porções kids, menu crianças
- Segurança: ambiente seguro, cercado, monitorado
- Acessibilidade para carrinhos de bebê
- Espaço amplo para crianças brincarem
- Atendimento receptivo a famílias
- Filas rápidas ou atendimento prioritário para famílias
- Atividades ou eventos para crianças

Responda APENAS com um JSON válido neste formato:
{
  "family_score": <número de 0 a 100>,
  "highlights": [<lista de até 3 destaques curtos em português, ex: "Brinquedoteca monitorada", "Cardápio kids">],
  "confidence": "<high|medium|low>"
}

- family_score: 0 = nenhuma evidência familiar, 100 = excelente para famílias
- Se não houver nenhuma menção a crianças/família, retorne score 0 e lista vazia
- confidence: high = múltiplas menções claras, medium = algumas menções, low = indícios vagos`;

let cachedPrompt: string | null = null;
let promptCacheTime = 0;
const PROMPT_CACHE_TTL_MS = 60_000;

async function getActiveSystemPrompt(): Promise<string> {
  const now = Date.now();
  if (cachedPrompt && now - promptCacheTime < PROMPT_CACHE_TTL_MS) {
    return cachedPrompt;
  }

  try {
    const active = await db.query.aiPrompts.findFirst({
      where: eq(aiPrompts.is_active, true),
      orderBy: (t, { desc }) => [desc(t.updated_at)],
    });
    if (active?.prompt) {
      cachedPrompt = active.prompt;
      promptCacheTime = now;
      return cachedPrompt;
    }
  } catch (err) {
    console.warn("[AI] failed to load prompt from DB, using fallback:", err);
  }

  return FALLBACK_SYSTEM_PROMPT;
}

export function invalidatePromptCache(): void {
  cachedPrompt = null;
  promptCacheTime = 0;
}

type ProviderConfig = {
  provider: string;
  model: string;
  apiKey: string;
};

let routingCacheTime = 0;
let routingCache: { primary: ProviderConfig; fallbacks: ProviderConfig[] } | null = null;
const ROUTING_CACHE_TTL_MS = 30_000;

async function getReviewAnalysisRouting(): Promise<{ primary: ProviderConfig; fallbacks: ProviderConfig[] } | null> {
  const now = Date.now();
  if (routingCache && now - routingCacheTime < ROUTING_CACHE_TTL_MS) {
    return routingCache;
  }

  try {
    const routing = await db.query.pipelineRouting.findFirst({
      where: eq(pipelineRouting.stage, "review_analysis"),
    });

    if (!routing?.primary_provider) {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) return null;
      const config = { primary: { provider: "openai", model: "gpt-4o-mini", apiKey: openaiKey }, fallbacks: [] };
      routingCache = config;
      routingCacheTime = now;
      return config;
    }

    const providerRows = await db.select().from(aiProviders);
    const providerMap = Object.fromEntries(providerRows.map((r) => [r.provider, r]));

    const primaryRow = providerMap[routing.primary_provider];
    let primaryConfig: ProviderConfig | null = null;

    if (primaryRow?.encrypted_key && primaryRow.is_active) {
      primaryConfig = {
        provider: routing.primary_provider,
        model: routing.model || "gpt-4o-mini",
        apiKey: decryptApiKey(primaryRow.encrypted_key),
      };
    } else if (routing.primary_provider === "openai" && process.env.OPENAI_API_KEY) {
      primaryConfig = { provider: "openai", model: routing.model || "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY };
    }

    if (!primaryConfig) return null;

    const fallbackOrder = (routing.fallback_order as string[]) || [];
    const fallbacks: ProviderConfig[] = [];
    for (const fbProvider of fallbackOrder) {
      if (fbProvider === routing.primary_provider) continue;
      const fbRow = providerMap[fbProvider];
      if (fbRow?.encrypted_key && fbRow.is_active) {
        fallbacks.push({ provider: fbProvider, model: "gpt-4o-mini", apiKey: decryptApiKey(fbRow.encrypted_key) });
      } else if (fbProvider === "openai" && process.env.OPENAI_API_KEY) {
        fallbacks.push({ provider: "openai", model: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY });
      }
    }

    const result = { primary: primaryConfig, fallbacks };
    routingCache = result;
    routingCacheTime = now;
    return result;
  } catch (err) {
    console.warn("[AI] failed to load routing config, falling back to env:", err);
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) return null;
    return { primary: { provider: "openai", model: "gpt-4o-mini", apiKey: openaiKey }, fallbacks: [] };
  }
}

export function invalidateRoutingCache(): void {
  routingCache = null;
  routingCacheTime = 0;
}

const NEGATIVE_SENTINEL: AIFamilyAnalysis = { family_score: -1, highlights: [], confidence: "low" };

async function getCachedAnalysis(placeId: string): Promise<{ hit: boolean; data: AIFamilyAnalysis | null }> {
  try {
    const cached = await db.query.enrichmentCache.findFirst({
      where: and(
        eq(enrichmentCache.place_id, placeId),
        eq(enrichmentCache.source, "openai_review"),
      ),
    });

    if (cached && new Date(cached.expires_at) > new Date()) {
      const data = cached.data as AIFamilyAnalysis;
      if (data.family_score === -1) return { hit: true, data: null };
      return { hit: true, data };
    }
    return { hit: false, data: null };
  } catch {
    return { hit: false, data: null };
  }
}

async function setCachedAnalysis(placeId: string, data: AIFamilyAnalysis): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);

  try {
    await db
      .insert(enrichmentCache)
      .values({
        place_id: placeId,
        source: "openai_review",
        data,
        expires_at: expiresAt,
      })
      .onConflictDoUpdate({
        target: [enrichmentCache.place_id, enrichmentCache.source],
        set: { data, expires_at: expiresAt },
      });
  } catch (err) {
    console.warn("Failed to cache AI review analysis:", err);
  }
}

let activeRequests = 0;
const MAX_CONCURRENT_AI = 5;
const AI_REQUEST_TIMEOUT_MS = 10_000;

async function callOpenAI(config: ProviderConfig, systemPrompt: string, userContent: string): Promise<AIFamilyAnalysis | null> {
  const client = new OpenAI({ apiKey: config.apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" },
    }, { signal: controller.signal });

    clearTimeout(timer);
    const content = response.choices[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content) as AIFamilyAnalysis;
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(config: ProviderConfig, systemPrompt: string, userContent: string): Promise<AIFamilyAnalysis | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model || "claude-haiku-4-5",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json() as { content?: Array<{ type: string; text: string }> };
    const text = data.content?.find((c) => c.type === "text")?.text;
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as AIFamilyAnalysis;
  } finally {
    clearTimeout(timer);
  }
}

async function callPerplexity(config: ProviderConfig, systemPrompt: string, userContent: string): Promise<AIFamilyAnalysis | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model || "llama-3.1-sonar-small-128k-online",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: 300,
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as AIFamilyAnalysis;
  } finally {
    clearTimeout(timer);
  }
}

async function callGoogle(config: ProviderConfig, systemPrompt: string, userContent: string): Promise<AIFamilyAnalysis | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model || "gemini-1.5-flash"}:generateContent?key=${config.apiKey}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userContent }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.1 },
        }),
      },
    );
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as AIFamilyAnalysis;
  } finally {
    clearTimeout(timer);
  }
}

async function callProvider(config: ProviderConfig, systemPrompt: string, userContent: string): Promise<AIFamilyAnalysis | null> {
  switch (config.provider) {
    case "openai": return callOpenAI(config, systemPrompt, userContent);
    case "anthropic": return callAnthropic(config, systemPrompt, userContent);
    case "perplexity": return callPerplexity(config, systemPrompt, userContent);
    case "google": return callGoogle(config, systemPrompt, userContent);
    default: return null;
  }
}

function validateAnalysis(parsed: AIFamilyAnalysis): boolean {
  return (
    typeof parsed.family_score === "number" &&
    Array.isArray(parsed.highlights) &&
    ["high", "medium", "low"].includes(parsed.confidence)
  );
}

async function fetchAndCacheAIAnalysis(
  placeId: string,
  placeName: string,
  reviewTexts: string[],
): Promise<AIFamilyAnalysis | null> {
  if (activeRequests >= MAX_CONCURRENT_AI) return null;

  const routing = await getReviewAnalysisRouting();
  if (!routing) return null;

  const systemPrompt = await getActiveSystemPrompt();
  const combinedReviews = reviewTexts
    .slice(0, 5)
    .map((r, i) => `Review ${i + 1}: ${r}`)
    .join("\n\n");
  const userContent = `Estabelecimento: "${placeName}"\n\nReviews:\n${combinedReviews}`;

  activeRequests++;
  try {
    const configs = [routing.primary, ...routing.fallbacks];
    for (const config of configs) {
      try {
        const result = await callProvider(config, systemPrompt, userContent);
        if (result && validateAnalysis(result)) {
          result.family_score = Math.max(0, Math.min(100, Math.round(result.family_score)));
          result.highlights = result.highlights.slice(0, 3);
          await setCachedAnalysis(placeId, result);
          return result;
        }
      } catch (err) {
        console.warn(`[AI] provider ${config.provider} failed for ${placeName}, trying fallback:`, err);
      }
    }

    await setCachedAnalysis(placeId, NEGATIVE_SENTINEL);
    return null;
  } catch (err) {
    console.warn("AI review analysis failed for", placeName, ":", err);
    await setCachedAnalysis(placeId, NEGATIVE_SENTINEL);
    return null;
  } finally {
    activeRequests--;
  }
}

export async function analyzeReviewsWithAI(
  placeId: string,
  placeName: string,
  reviewTexts: string[],
): Promise<AIFamilyAnalysis | null> {
  if (reviewTexts.length === 0) return null;

  const cached = await getCachedAnalysis(placeId);
  if (cached.hit) return cached.data;

  fetchAndCacheAIAnalysis(placeId, placeName, reviewTexts).catch((err) =>
    console.error(`[AI] background analysis failed for ${placeId}:`, err),
  );

  return null;
}

export function calculateAIReviewBonus(analysis: AIFamilyAnalysis | null): number {
  if (!analysis) return 0;

  let bonus = 0;

  if (analysis.confidence === "high") {
    bonus = Math.round(analysis.family_score * 0.25);
  } else if (analysis.confidence === "medium") {
    bonus = Math.round(analysis.family_score * 0.15);
  } else {
    bonus = Math.round(analysis.family_score * 0.08);
  }

  return Math.min(bonus, 25);
}
