import { db } from "./db";
import { eq, and, inArray } from "drizzle-orm";
import {
  placesKidspot,
  reviews,
  favorites,
  users,
  type InsertPlace,
  type InsertReview,
  type PlaceKidspot,
  type Review,
  type Favorite,
  type User,
} from "@shared/schema";
import type { KidFlags } from "./kid-score";
import bcrypt from "bcryptjs";

export async function upsertPlace(place: InsertPlace): Promise<PlaceKidspot> {
  const [row] = await db
    .insert(placesKidspot)
    .values(place)
    .onConflictDoNothing()
    .returning();

  if (row) return row;

  const existing = await db.query.placesKidspot.findFirst({
    where: eq(placesKidspot.place_id, place.place_id),
  });
  return existing!;
}

export async function createReview(review: InsertReview): Promise<Review> {
  const [row] = await db.insert(reviews).values(review).returning();
  return row;
}

export async function getReviewsForPlace(placeId: string): Promise<Review[]> {
  return db.query.reviews.findMany({
    where: eq(reviews.place_id, placeId),
    orderBy: (r, { desc }) => [desc(r.created_at)],
  });
}

export async function toggleFavorite(
  userKey: string,
  placeId: string,
): Promise<{ added: boolean }> {
  const existing = await db.query.favorites.findFirst({
    where: and(
      eq(favorites.user_key, userKey),
      eq(favorites.place_id, placeId),
    ),
  });

  if (existing) {
    await db
      .delete(favorites)
      .where(
        and(
          eq(favorites.user_key, userKey),
          eq(favorites.place_id, placeId),
        ),
      );
    return { added: false };
  }

  await db.insert(favorites).values({ user_key: userKey, place_id: placeId });
  return { added: true };
}

export async function getFavoritesForUser(userKey: string): Promise<Favorite[]> {
  return db.query.favorites.findMany({
    where: eq(favorites.user_key, userKey),
    orderBy: (f, { desc }) => [desc(f.created_at)],
  });
}

/**
 * getAggregatedKidFlagsForPlaces
 *
 * Batch-queries reviews for a list of place IDs and returns a map of
 * place_id → KidFlags where a flag is true if ANY review reported it.
 * Only the three signals used by KidScore are returned.
 */
export async function getAggregatedKidFlagsForPlaces(
  placeIds: string[],
): Promise<Map<string, KidFlags>> {
  const result = new Map<string, KidFlags>();
  if (placeIds.length === 0) return result;

  const rows = await db.query.reviews.findMany({
    where: inArray(reviews.place_id, placeIds),
    columns: { place_id: true, kid_flags: true },
  });

  for (const row of rows) {
    const flags = row.kid_flags as {
      espaco_kids?: boolean;
      trocador?: boolean;
      cadeirao?: boolean;
    };
    const existing = result.get(row.place_id) ?? {};
    result.set(row.place_id, {
      espaco_kids: existing.espaco_kids || flags.espaco_kids,
      trocador: existing.trocador || flags.trocador,
      cadeirao: existing.cadeirao || flags.cadeirao,
    });
  }

  return result;
}

export async function createUser(data: {
  name: string;
  email: string;
  password: string;
}): Promise<User> {
  const password_hash = await bcrypt.hash(data.password, 10);
  const [user] = await db
    .insert(users)
    .values({ name: data.name, email: data.email, password_hash })
    .returning();
  return user;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });
  return user ?? null;
}

export async function getUserById(id: string): Promise<User | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
  });
  return user ?? null;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
