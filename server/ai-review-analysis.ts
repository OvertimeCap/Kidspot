import OpenAI from "openai";
import { db } from "./db";
import { enrichmentCache, aiPrompts } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const CACHE_TTL_DAYS = 7;

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

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

async function fetchAndCacheAIAnalysis(
  placeId: string,
  placeName: string,
  reviewTexts: string[],
): Promise<AIFamilyAnalysis | null> {
  const openai = getOpenAI();
  if (!openai) return null;

  if (activeRequests >= MAX_CONCURRENT_AI) return null;

  const systemPrompt = await getActiveSystemPrompt();

  const combinedReviews = reviewTexts
    .slice(0, 5)
    .map((r, i) => `Review ${i + 1}: ${r}`)
    .join("\n\n");

  activeRequests++;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Estabelecimento: "${placeName}"\n\nReviews:\n${combinedReviews}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" },
    }, { signal: controller.signal });

    clearTimeout(timer);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      await setCachedAnalysis(placeId, NEGATIVE_SENTINEL);
      return null;
    }

    const parsed = JSON.parse(content) as AIFamilyAnalysis;

    if (
      typeof parsed.family_score !== "number" ||
      !Array.isArray(parsed.highlights) ||
      !["high", "medium", "low"].includes(parsed.confidence)
    ) {
      await setCachedAnalysis(placeId, NEGATIVE_SENTINEL);
      return null;
    }

    parsed.family_score = Math.max(0, Math.min(100, Math.round(parsed.family_score)));
    parsed.highlights = parsed.highlights.slice(0, 3);

    await setCachedAnalysis(placeId, parsed);
    return parsed;
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
