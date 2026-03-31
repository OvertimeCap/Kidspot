import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const backofficeRoleEnum = pgEnum("backoffice_role", [
  "super_admin",
  "admin",
  "curador",
  "analista",
]);

export const placeStatusEnum = pgEnum("place_status", [
  "pendente",
  "aprovado",
  "rejeitado",
]);

export const scanFrequencyEnum = pgEnum("scan_frequency", [
  "diaria",
  "semanal",
  "quinzenal",
  "mensal",
]);

export const backofficeUserStatusEnum = pgEnum("backoffice_user_status", [
  "ativo",
  "pendente",
  "inativo",
]);

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "colaborador",
  "parceiro",
  "estabelecimento",
  "usuario",
]);

export const claimStatusEnum = pgEnum("claim_status", [
  "pending",
  "approved",
  "denied",
]);

export const feedbackTypeEnum = pgEnum("feedback_type", [
  "sugestao",
  "denuncia",
  "fechado",
]);

export const feedbackStatusEnum = pgEnum("feedback_status", [
  "pendente",
  "resolvido",
  "rejeitado",
]);

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("usuario"),
  linked_place_id: text("linked_place_id"),
  linked_place_name: text("linked_place_name"),
  linked_place_address: text("linked_place_address"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const cities = pgTable("cities", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  estado: text("estado").notNull(),
  latitude: numeric("latitude").notNull(),
  longitude: numeric("longitude").notNull(),
  raio_km: integer("raio_km").notNull().default(10),
  frequencia: scanFrequencyEnum("frequencia").notNull().default("semanal"),
  parametros_prompt: jsonb("parametros_prompt"),
  ativa: boolean("ativa").notNull().default(true),
  ultima_varredura: timestamp("ultima_varredura"),
  criado_em: timestamp("criado_em").defaultNow().notNull(),
});

export const pipelineRuns = pgTable("pipeline_runs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  city_id: varchar("city_id").references(() => cities.id),
  city_name: text("city_name").notNull(),
  status: text("status").notNull().default("running"),
  places_found: integer("places_found").notNull().default(0),
  new_pending: integer("new_pending").notNull().default(0),
  failures: integer("failures").notNull().default(0),
  estimated_cost_usd: numeric("estimated_cost_usd").notNull().default("0"),
  error_message: text("error_message"),
  started_at: timestamp("started_at").defaultNow().notNull(),
  finished_at: timestamp("finished_at"),
});

export const placesKidspot = pgTable("places_kidspot", {
  place_id: text("place_id").primaryKey(),
  city: text("city").notNull(),
  ciudad_id: varchar("ciudad_id").references(() => cities.id),
  lat: numeric("lat").notNull(),
  lng: numeric("lng").notNull(),
  tags: jsonb("tags"),
  status: placeStatusEnum("status").notNull().default("aprovado"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const reviews = pgTable("reviews", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  place_id: text("place_id")
    .notNull()
    .references(() => placesKidspot.place_id),
  user_id: varchar("user_id")
    .references(() => users.id)
    .notNull(),
  rating: integer("rating").notNull(),
  kid_flags: jsonb("kid_flags").notNull(),
  note: text("note"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const favorites = pgTable(
  "favorites",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: varchar("user_id")
      .notNull()
      .references(() => users.id),
    place_id: text("place_id")
      .notNull()
      .references(() => placesKidspot.place_id),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("favorites_user_id_place_id_unique").on(table.user_id, table.place_id)],
);

export const enrichmentCache = pgTable("enrichment_cache", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  place_id: text("place_id").notNull(),
  source: text("source").notNull(),
  data: jsonb("data").notNull(),
  expires_at: timestamp("expires_at").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
}, (table) => [unique("enrichment_cache_place_source_unique").on(table.place_id, table.source)]);

export const placeClaims = pgTable("place_claims", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  user_id: varchar("user_id")
    .notNull()
    .references(() => users.id),
  place_id: text("place_id").notNull(),
  place_name: text("place_name").notNull(),
  place_address: text("place_address").notNull(),
  place_photo_reference: text("place_photo_reference"),
  contact_phone: text("contact_phone").notNull(),
  status: claimStatusEnum("status").notNull().default("pending"),
  admin_user_id: varchar("admin_user_id").references(() => users.id),
  created_at: timestamp("created_at").defaultNow().notNull(),
  reviewed_by: varchar("reviewed_by").references(() => users.id),
  reviewed_at: timestamp("reviewed_at"),
});

export const partnerStories = pgTable("partner_stories", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  user_id: varchar("user_id")
    .notNull()
    .references(() => users.id),
  place_id: text("place_id").notNull(),
  place_name: text("place_name").notNull(),
  place_lat: numeric("place_lat"),
  place_lng: numeric("place_lng"),
  expires_at: timestamp("expires_at").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const storyPhotos = pgTable("story_photos", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  story_id: varchar("story_id")
    .notNull()
    .references(() => partnerStories.id),
  photo_data: text("photo_data").notNull(),
  order: integer("order").notNull().default(0),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const appFilters = pgTable("app_filters", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  icon: text("icon").notNull().default("filter"),
  active: boolean("active").notNull().default(true),
  seasonal: boolean("seasonal").notNull().default(false),
  starts_at: timestamp("starts_at"),
  ends_at: timestamp("ends_at"),
  criteria: jsonb("criteria"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const aiPrompts = pgTable("ai_prompts", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull().default("default"),
  prompt: text("prompt").notNull(),
  is_active: boolean("is_active").notNull().default(true),
  created_by: varchar("created_by").references(() => users.id),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const communityFeedback = pgTable("community_feedback", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  type: feedbackTypeEnum("type").notNull(),
  content: text("content").notNull(),
  place_id: text("place_id"),
  place_name: text("place_name"),
  user_id: varchar("user_id").references(() => users.id),
  status: feedbackStatusEnum("status").notNull().default("pendente"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  resolved_at: timestamp("resolved_at"),
  resolved_by: varchar("resolved_by").references(() => users.id),
});

export const kidscoreRules = pgTable("kidscore_rules", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  weight: integer("weight").notNull().default(0),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const customCriteria = pgTable("custom_criteria", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  field_type: text("field_type").notNull().default("boolean"),
  show_in_filter: boolean("show_in_filter").notNull().default(true),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at").defaultNow().notNull(),
});


export const curationStatusEnum = pgEnum("curation_status", [
  "pendente",
  "aprovado",
  "rejeitado",
]);

export const placePhotos = pgTable("place_photos", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  place_id: text("place_id")
    .notNull()
    .references(() => placesKidspot.place_id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  photo_reference: text("photo_reference"),
  is_cover: boolean("is_cover").notNull().default(false),
  order: integer("order").notNull().default(0),
  deleted: boolean("deleted").notNull().default(false),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const placeKidspotMeta = pgTable("place_kidspot_meta", {
  place_id: text("place_id")
    .primaryKey()
    .references(() => placesKidspot.place_id, { onDelete: "cascade" }),
  name: text("name"),
  address: text("address"),
  category: text("category"),
  kid_score: integer("kid_score"),
  ai_evidences: jsonb("ai_evidences"),
  curation_status: curationStatusEnum("curation_status").notNull().default("pendente"),
  description: text("description"),
  custom_criteria: jsonb("custom_criteria"),
  curated_by: varchar("curated_by"),
  curated_at: timestamp("curated_at"),
  ingested_at: timestamp("ingested_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});


export const insertPlaceSchema = createInsertSchema(placesKidspot).omit({
  created_at: true,
});

export const insertReviewSchema = createInsertSchema(reviews)
  .omit({ id: true, created_at: true, user_id: true })
  .extend({
    rating: z.number().int().min(1).max(5),
    kid_flags: z.object({
      trocador: z.boolean(),
      cadeirao: z.boolean(),
      banheiro_familia: z.boolean(),
      espaco_kids: z.boolean(),
      seguro: z.boolean(),
    }),
  });

export const insertFavoriteSchema = createInsertSchema(favorites).omit({
  id: true,
  created_at: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  created_at: true,
  password_hash: true,
}).extend({
  password: z.string().min(6),
});

export const insertClaimSchema = z.object({
  place_id: z.string().min(1),
  place_name: z.string().min(1),
  place_address: z.string().min(1),
  place_photo_reference: z.string().optional(),
  contact_phone: z.string().min(8),
});

export type PlaceKidspot = typeof placesKidspot.$inferSelect;
export type InsertPlace = z.infer<typeof insertPlaceSchema>;

export type Review = typeof reviews.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;

export type EnrichmentCache = typeof enrichmentCache.$inferSelect;
export type InsertEnrichmentCache = typeof enrichmentCache.$inferInsert;

export type Favorite = typeof favorites.$inferSelect;
export type InsertFavorite = z.infer<typeof insertFavoriteSchema>;

export type User = typeof users.$inferSelect;
export type UserRole = "admin" | "colaborador" | "parceiro" | "estabelecimento" | "usuario";

export type PlaceClaim = typeof placeClaims.$inferSelect;
export type InsertClaim = z.infer<typeof insertClaimSchema>;

export type PartnerStory = typeof partnerStories.$inferSelect;
export type StoryPhoto = typeof storyPhotos.$inferSelect;

export const backofficeUsers = pgTable("backoffice_users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash"),
  role: backofficeRoleEnum("role").notNull(),
  status: backofficeUserStatusEnum("status").notNull().default("pendente"),
  invite_token: text("invite_token"),
  invite_token_expires_at: timestamp("invite_token_expires_at"),
  created_by: varchar("created_by"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  last_active_at: timestamp("last_active_at"),
});

export const auditLog = pgTable("audit_log", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  user_id: varchar("user_id").notNull(),
  user_email: text("user_email").notNull(),
  user_role: text("user_role").notNull(),
  action: text("action").notNull(),
  module: text("module").notNull(),
  target_id: text("target_id"),
  payload_before: jsonb("payload_before"),
  payload_after: jsonb("payload_after"),
  ip: text("ip"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export type BackofficeUser = typeof backofficeUsers.$inferSelect;
export type BackofficeRole = "super_admin" | "admin" | "curador" | "analista";
export type BackofficeUserStatus = "ativo" | "pendente" | "inativo";
export type AuditLogEntry = typeof auditLog.$inferSelect;

export type AppFilter = typeof appFilters.$inferSelect;
export type InsertAppFilter = typeof appFilters.$inferInsert;

export type CommunityFeedback = typeof communityFeedback.$inferSelect;

export const insertFeedbackSchema = z.object({
  type: z.enum(["sugestao", "denuncia", "fechado"]),
  content: z.string().min(1).max(2000),
  place_id: z.string().optional(),
  place_name: z.string().optional(),
});

export const insertFilterSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().min(1).max(50),
  active: z.boolean().optional(),
  seasonal: z.boolean().optional(),
  starts_at: z.string().datetime().optional().nullable(),
  ends_at: z.string().datetime().optional().nullable(),
  criteria: z.record(z.unknown()).optional().nullable(),
});

export type AiPrompt = typeof aiPrompts.$inferSelect;
export type KidscoreRule = typeof kidscoreRules.$inferSelect;
export type CustomCriterion = typeof customCriteria.$inferSelect;

export type City = typeof cities.$inferSelect;
export type ScanFrequency = "diaria" | "semanal" | "quinzenal" | "mensal";

export type PlacePhoto = typeof placePhotos.$inferSelect;
export type InsertPlacePhoto = typeof placePhotos.$inferInsert;

export type PlaceKidspotMeta = typeof placeKidspotMeta.$inferSelect;
export type InsertPlaceKidspotMeta = typeof placeKidspotMeta.$inferInsert;
export type CurationStatus = "pendente" | "aprovado" | "rejeitado";

export const insertCitySchema = createInsertSchema(cities)
  .omit({ id: true, criado_em: true, ultima_varredura: true })
  .extend({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    raio_km: z.number().int().min(1).max(500),
    frequencia: z.enum(["diaria", "semanal", "quinzenal", "mensal"]),
    parametros_prompt: z.record(z.unknown()).optional().nullable(),
    ativa: z.boolean().optional(),
  });

export type InsertCity = z.infer<typeof insertCitySchema>;
export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type InsertPipelineRun = typeof pipelineRuns.$inferInsert;
export type PlaceStatus = "pendente" | "aprovado" | "rejeitado";

export const aiProviderEnum = pgEnum("ai_provider", [
  "openai",
  "anthropic",
  "perplexity",
  "google",
]);

export const aiProviders = pgTable("ai_providers", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  provider: aiProviderEnum("provider").notNull().unique(),
  encrypted_key: text("encrypted_key"),
  is_active: boolean("is_active").notNull().default(false),
  tested_at: timestamp("tested_at"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const pipelineStageEnum = pgEnum("pipeline_stage", [
  "place_discovery",
  "review_analysis",
  "description_generation",
  "score_calculation",
]);

export const pipelineRouting = pgTable("pipeline_routing", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  stage: pipelineStageEnum("stage").notNull().unique(),
  primary_provider: aiProviderEnum("primary_provider"),
  model: text("model"),
  fallback_order: jsonb("fallback_order").$type<string[]>().default([]),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export type AiProvider = typeof aiProviders.$inferSelect;
export type PipelineRouting = typeof pipelineRouting.$inferSelect;
