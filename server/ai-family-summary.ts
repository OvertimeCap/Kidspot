import OpenAI from "openai";
import { db } from "./db";
import { aiProviders, pipelineRouting } from "@shared/schema";
import { eq } from "drizzle-orm";
import { decryptApiKey } from "./ai-crypto";

export const DEFAULT_FAMILY_SUMMARY_PROMPT =
  "Você é um especialista em turismo familiar. Com base nas informações do local abaixo, escreva um parágrafo curto explicando por que este local é indicado para famílias com crianças. Use linguagem acolhedora e direta. Não use asteriscos, emojis ou formatação especial.";

const AI_REQUEST_TIMEOUT_MS = 15_000;

type ProviderConfig = {
  provider: string;
  model: string;
  apiKey: string;
};

export type FamilySummaryInput = {
  placeName: string;
  category: string | null;
  reviewNotes: string[];
  aiEvidences: unknown;
  prompt: string;
};

async function getDescriptionGenerationRouting(): Promise<{ primary: ProviderConfig; fallbacks: ProviderConfig[] } | null> {
  try {
    const routing = await db.query.pipelineRouting.findFirst({
      where: eq(pipelineRouting.stage, "description_generation"),
    });

    const providerRows = await db.select().from(aiProviders);
    const providerMap = Object.fromEntries(providerRows.map((r) => [r.provider, r]));

    const primaryProvider = routing?.primary_provider ?? "openai";
    const primaryModel = routing?.model ?? "gpt-4o-mini";
    const primaryRow = providerMap[primaryProvider];

    let primaryConfig: ProviderConfig | null = null;
    if (primaryRow?.encrypted_key && primaryRow.is_active) {
      primaryConfig = { provider: primaryProvider, model: primaryModel, apiKey: decryptApiKey(primaryRow.encrypted_key) };
    } else if (primaryProvider === "openai" && process.env.OPENAI_API_KEY) {
      primaryConfig = { provider: "openai", model: primaryModel, apiKey: process.env.OPENAI_API_KEY };
    }

    if (!primaryConfig) {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) return { primary: { provider: "openai", model: "gpt-4o-mini", apiKey: openaiKey }, fallbacks: [] };
      return null;
    }

    const fallbackOrder = (routing?.fallback_order as string[]) ?? [];
    const fallbacks: ProviderConfig[] = [];
    for (const fbProvider of fallbackOrder) {
      if (fbProvider === primaryProvider) continue;
      const fbRow = providerMap[fbProvider];
      if (fbRow?.encrypted_key && fbRow.is_active) {
        fallbacks.push({ provider: fbProvider, model: "gpt-4o-mini", apiKey: decryptApiKey(fbRow.encrypted_key) });
      } else if (fbProvider === "openai" && process.env.OPENAI_API_KEY) {
        fallbacks.push({ provider: "openai", model: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY });
      }
    }

    return { primary: primaryConfig, fallbacks };
  } catch {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) return { primary: { provider: "openai", model: "gpt-4o-mini", apiKey: openaiKey }, fallbacks: [] };
    return null;
  }
}

function buildUserContent(input: FamilySummaryInput): string {
  const lines: string[] = [`Local: ${input.placeName}`];
  if (input.category) lines.push(`Categoria: ${input.category}`);
  if (Array.isArray(input.aiEvidences) && input.aiEvidences.length > 0) {
    lines.push(`Destaques identificados: ${(input.aiEvidences as string[]).join(", ")}`);
  }
  if (input.reviewNotes.length > 0) {
    const notes = input.reviewNotes.slice(0, 5).join(" | ");
    lines.push(`Comentários de visitantes: ${notes}`);
  }
  return lines.join("\n");
}

async function callOpenAIText(config: ProviderConfig, systemPrompt: string, userContent: string): Promise<string | null> {
  const client = new OpenAI({ apiKey: config.apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    const response = await client.chat.completions.create(
      {
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.7,
        max_tokens: 200,
      },
      { signal: controller.signal },
    );
    clearTimeout(timer);
    return response.choices[0]?.message?.content?.trim() ?? null;
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropicText(config: ProviderConfig, systemPrompt: string, userContent: string): Promise<string | null> {
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
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json() as { content?: Array<{ type: string; text: string }> };
    return data.content?.find((c) => c.type === "text")?.text?.trim() ?? null;
  } finally {
    clearTimeout(timer);
  }
}

async function callPerplexityText(config: ProviderConfig, systemPrompt: string, userContent: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Authorization": `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model || "llama-3.1-sonar-small-128k-online",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: 200,
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } finally {
    clearTimeout(timer);
  }
}

async function callGoogleText(config: ProviderConfig, systemPrompt: string, userContent: string): Promise<string | null> {
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
          generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
        }),
      },
    );
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } finally {
    clearTimeout(timer);
  }
}

async function callProviderText(config: ProviderConfig, systemPrompt: string, userContent: string): Promise<string | null> {
  switch (config.provider) {
    case "openai": return callOpenAIText(config, systemPrompt, userContent);
    case "anthropic": return callAnthropicText(config, systemPrompt, userContent);
    case "perplexity": return callPerplexityText(config, systemPrompt, userContent);
    case "google": return callGoogleText(config, systemPrompt, userContent);
    default: return null;
  }
}

/**
 * Generates a family-friendly summary for a place using the configured AI provider.
 * Does NOT save to the database — the caller is responsible for persisting.
 * Throws a user-friendly PT-BR error if generation fails.
 */
export async function generateFamilySummary(input: FamilySummaryInput): Promise<string> {
  const routing = await getDescriptionGenerationRouting();
  if (!routing) {
    throw new Error("Nenhum provedor de IA configurado. Configure uma chave de API nas configurações.");
  }

  const userContent = buildUserContent(input);
  const configs = [routing.primary, ...routing.fallbacks];

  for (const config of configs) {
    try {
      const result = await callProviderText(config, input.prompt, userContent);
      if (result && result.length > 10) {
        return result;
      }
    } catch (err) {
      console.warn(`[AI family summary] provider ${config.provider} failed for "${input.placeName}":`, err);
    }
  }

  throw new Error("Não foi possível gerar o resumo. Verifique as configurações do provedor de IA e tente novamente.");
}
