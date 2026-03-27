import { sql } from "drizzle-orm";
import {
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

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "colaborador",
  "parceiro",
  "usuario",
]);

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("usuario"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export const placesKidspot = pgTable("places_kidspot", {
  place_id: text("place_id").primaryKey(),
  city: text("city").notNull(),
  lat: numeric("lat").notNull(),
  lng: numeric("lng").notNull(),
  tags: jsonb("tags"),
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

export type PlaceKidspot = typeof placesKidspot.$inferSelect;
export type InsertPlace = z.infer<typeof insertPlaceSchema>;

export type Review = typeof reviews.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;

export type EnrichmentCache = typeof enrichmentCache.$inferSelect;
export type InsertEnrichmentCache = typeof enrichmentCache.$inferInsert;

export type Favorite = typeof favorites.$inferSelect;
export type InsertFavorite = z.infer<typeof insertFavoriteSchema>;

export type User = typeof users.$inferSelect;
export type UserRole = "admin" | "colaborador" | "parceiro" | "usuario";
