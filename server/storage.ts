import { db } from "./db";
import { eq, and } from "drizzle-orm";
import {
  placesKidspot,
  reviews,
  favorites,
  type InsertPlace,
  type InsertReview,
  type PlaceKidspot,
  type Review,
  type Favorite,
} from "@shared/schema";

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
