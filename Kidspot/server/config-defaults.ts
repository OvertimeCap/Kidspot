import { db, pool } from "./db";
import { aiPrompts, kidscoreRules, customCriteria, aiProviders, pipelineRouting } from "@shared/schema";
import { count } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_AI_PROMPT = `Você é um assistente especializado em avaliar se um estabelecimento é adequado para famílias com crianças pequenas (0-10 anos).

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

const DEFAULT_KIDSCORE_RULES = [
  { key: "type_bonus_premium", label: "Bônus por tipo premium (playground, zoo, etc)", weight: 40 },
  { key: "espaco_kids", label: "Espaço Kids", weight: 25 },
  { key: "trocador", label: "Fraldário / Trocador", weight: 20 },
  { key: "cadeirao", label: "Cadeirão", weight: 15 },
  { key: "rating_bonus", label: "Bônus de qualidade (nota ≥ 4.2, ≥ 20 avaliações)", weight: 10 },
  { key: "proximity_bonus", label: "Bônus de proximidade (≤ 1 km)", weight: 10 },
  { key: "tier1_review_per_review", label: "Ponto por review Tier 1 (infra infantil específica)", weight: 15 },
  { key: "tier1_review_per_label", label: "Ponto por label Tier 1 distinto", weight: 10 },
  { key: "tier2_review_per_review", label: "Ponto por review Tier 2 (sinal familiar genérico)", weight: 3 },
  { key: "tier2_review_per_label", label: "Ponto por label Tier 2 distinto", weight: 2 },
];

const DEFAULT_CUSTOM_CRITERIA = [
  { key: "espaco_kids", label: "Espaço Kids", field_type: "boolean", show_in_filter: true },
  { key: "trocador", label: "Fraldário / Trocador", field_type: "boolean", show_in_filter: true },
  { key: "cadeirao", label: "Cadeirão", field_type: "boolean", show_in_filter: true },
  { key: "banheiro_familia", label: "Banheiro Família", field_type: "boolean", show_in_filter: true },
  { key: "seguro", label: "Ambiente Seguro", field_type: "boolean", show_in_filter: true },
];

async function runMigrations(): Promise<void> {
  const migrationsDir = path.resolve(process.cwd(), "server", "migrations");
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    try {
      await pool.query(sql);
      console.log(`[migrations] applied: ${file}`);
    } catch (err) {
      console.warn(`[migrations] ${file} failed (may already be applied):`, (err as Error).message);
    }
  }
}

const DEFAULT_PIPELINE_STAGES = [
  { stage: "place_discovery" as const, primary_provider: "openai" as const, model: "gpt-4o-mini", fallback_order: [] },
  { stage: "review_analysis" as const, primary_provider: "openai" as const, model: "gpt-4o-mini", fallback_order: [] },
  { stage: "description_generation" as const, primary_provider: "openai" as const, model: "gpt-4o-mini", fallback_order: [] },
  { stage: "score_calculation" as const, primary_provider: "openai" as const, model: "gpt-4o-mini", fallback_order: [] },
];

export async function seedConfigDefaults(): Promise<void> {
  try {
    await runMigrations();
  } catch (err) {
    console.warn("[migrations] failed:", err);
  }

  try {
    const [promptCount] = await db.select({ count: count() }).from(aiPrompts);
    if ((promptCount?.count ?? 0) === 0) {
      await db.insert(aiPrompts).values({
        name: "default",
        prompt: DEFAULT_AI_PROMPT,
        is_active: true,
      });
      console.log("[seed] ai_prompts: inserted default prompt");
    }

    const [ruleCount] = await db.select({ count: count() }).from(kidscoreRules);
    if ((ruleCount?.count ?? 0) === 0) {
      await db.insert(kidscoreRules).values(
        DEFAULT_KIDSCORE_RULES.map((r) => ({ ...r, is_active: true })),
      );
      console.log("[seed] kidscore_rules: inserted", DEFAULT_KIDSCORE_RULES.length, "rules");
    }

    const [criteriaCount] = await db.select({ count: count() }).from(customCriteria);
    if ((criteriaCount?.count ?? 0) === 0) {
      await db.insert(customCriteria).values(
        DEFAULT_CUSTOM_CRITERIA.map((c) => ({ ...c, is_active: true })),
      );
      console.log("[seed] custom_criteria: inserted", DEFAULT_CUSTOM_CRITERIA.length, "criteria");
    }

    const [routingCount] = await db.select({ count: count() }).from(pipelineRouting);
    if ((routingCount?.count ?? 0) === 0) {
      await db.insert(pipelineRouting).values(DEFAULT_PIPELINE_STAGES);
      console.log("[seed] pipeline_routing: inserted", DEFAULT_PIPELINE_STAGES.length, "stages");
    }
  } catch (err) {
    console.warn("[seed] config defaults failed:", err);
  }
}
