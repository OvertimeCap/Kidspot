import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
    user_key: text("user_key").notNull(),
    place_id: text("place_id")
      .notNull()
      .references(() => placesKidspot.place_id),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [unique("favorites_user_key_place_id_unique").on(table.user_key, table.place_id)],
);

export const insertPlaceSchema = createInsertSchema(placesKidspot).omit({
  created_at: true,
});

export const insertReviewSchema = createInsertSchema(reviews)
  .omit({ id: true, created_at: true })
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

export type PlaceKidspot = typeof placesKidspot.$inferSelect;
export type InsertPlace = z.infer<typeof insertPlaceSchema>;

export type Review = typeof reviews.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;

export type Favorite = typeof favorites.$inferSelect;
export type InsertFavorite = z.infer<typeof insertFavoriteSchema>;
