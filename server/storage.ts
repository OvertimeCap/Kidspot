import { db } from "./db";
import { eq, and, inArray, desc, ne } from "drizzle-orm";
import {
  placesKidspot,
  reviews,
  favorites,
  users,
  placeClaims,
  type InsertPlace,
  type InsertReview,
  type PlaceKidspot,
  type Review,
  type Favorite,
  type User,
  type UserRole,
  type PlaceClaim,
  type InsertClaim,
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

export async function createReview(
  review: InsertReview,
  userId: string,
): Promise<Review> {
  const [row] = await db
    .insert(reviews)
    .values({ ...review, user_id: userId })
    .returning();
  return row;
}

export async function getReviewsForPlace(placeId: string): Promise<Review[]> {
  return db.query.reviews.findMany({
    where: eq(reviews.place_id, placeId),
    orderBy: (r, { desc }) => [desc(r.created_at)],
  });
}

export async function toggleFavorite(
  userId: string,
  placeId: string,
): Promise<{ added: boolean }> {
  const existing = await db.query.favorites.findFirst({
    where: and(
      eq(favorites.user_id, userId),
      eq(favorites.place_id, placeId),
    ),
  });

  if (existing) {
    await db
      .delete(favorites)
      .where(
        and(
          eq(favorites.user_id, userId),
          eq(favorites.place_id, placeId),
        ),
      );
    return { added: false };
  }

  await db.insert(favorites).values({ user_id: userId, place_id: placeId });
  return { added: true };
}

export async function getFavoritesForUser(userId: string): Promise<Favorite[]> {
  return db.query.favorites.findMany({
    where: eq(favorites.user_id, userId),
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

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function findOrCreateGoogleUser(data: {
  email: string;
  name: string;
}): Promise<User> {
  const existing = await findUserByEmail(data.email);
  if (existing) return existing;

  const password_hash = await bcrypt.hash(
    Math.random().toString(36) + Date.now().toString(36),
    10,
  );
  const [user] = await db
    .insert(users)
    .values({ name: data.name, email: data.email.toLowerCase(), password_hash })
    .returning();
  return user;
}

export async function listUsers(limit = 100, offset = 0): Promise<User[]> {
  return db.query.users.findMany({
    orderBy: [desc(users.created_at)],
    limit,
    offset,
  });
}

export async function updateUserRole(id: string, role: UserRole): Promise<User | null> {
  const [updated] = await db
    .update(users)
    .set({ role })
    .where(eq(users.id, id))
    .returning();
  return updated ?? null;
}

/* ------------------------------------------------------------------ */
/* Place Claims                                                         */
/* ------------------------------------------------------------------ */

export async function createClaim(
  userId: string,
  data: InsertClaim,
): Promise<PlaceClaim> {
  const [row] = await db
    .insert(placeClaims)
    .values({
      user_id: userId,
      place_id: data.place_id,
      place_name: data.place_name,
      place_address: data.place_address,
      place_photo_reference: data.place_photo_reference ?? null,
      contact_phone: data.contact_phone,
    })
    .returning();
  return row;
}

export async function getClaimsForUser(userId: string): Promise<PlaceClaim[]> {
  return db.query.placeClaims.findMany({
    where: eq(placeClaims.user_id, userId),
    orderBy: [desc(placeClaims.created_at)],
  });
}

export async function listClaims(status?: string): Promise<(PlaceClaim & { user_name: string; user_email: string })[]> {
  const conditions = status
    ? and(eq(placeClaims.status, status as "pending" | "approved" | "denied"))
    : undefined;

  const rows = await db
    .select({
      id: placeClaims.id,
      user_id: placeClaims.user_id,
      place_id: placeClaims.place_id,
      place_name: placeClaims.place_name,
      place_address: placeClaims.place_address,
      place_photo_reference: placeClaims.place_photo_reference,
      contact_phone: placeClaims.contact_phone,
      status: placeClaims.status,
      admin_user_id: placeClaims.admin_user_id,
      created_at: placeClaims.created_at,
      reviewed_by: placeClaims.reviewed_by,
      reviewed_at: placeClaims.reviewed_at,
      user_name: users.name,
      user_email: users.email,
    })
    .from(placeClaims)
    .innerJoin(users, eq(placeClaims.user_id, users.id))
    .where(conditions)
    .orderBy(desc(placeClaims.created_at));

  return rows;
}

export async function approveClaim(
  claimId: string,
  reviewerId: string,
): Promise<{ claim: PlaceClaim; user: User }> {
  return db.transaction(async (tx) => {
    const claim = await tx.query.placeClaims.findFirst({
      where: eq(placeClaims.id, claimId),
    });
    if (!claim) throw new Error("Reivindicação não encontrada");
    if (claim.status !== "pending") throw new Error("Reivindicação já foi revisada");

    const existingApproved = await tx.query.placeClaims.findFirst({
      where: and(
        eq(placeClaims.place_id, claim.place_id),
        eq(placeClaims.status, "approved"),
      ),
    });
    if (existingApproved) {
      throw new Error("Este local já possui um administrador aprovado");
    }

    const [updatedClaim] = await tx
      .update(placeClaims)
      .set({
        status: "approved",
        admin_user_id: claim.user_id,
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
      })
      .where(and(eq(placeClaims.id, claimId), eq(placeClaims.status, "pending")))
      .returning();

    if (!updatedClaim) throw new Error("Reivindicação já foi revisada por outro administrador");

    const currentUser = await tx.query.users.findFirst({ where: eq(users.id, claim.user_id) });
    if (!currentUser) throw new Error("Usuário solicitante não encontrado");
    if (currentUser.linked_place_id) throw new Error("O usuário já possui um estabelecimento vinculado");

    await tx
      .update(placeClaims)
      .set({
        status: "denied",
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
      })
      .where(
        and(
          eq(placeClaims.place_id, claim.place_id),
          eq(placeClaims.status, "pending"),
          ne(placeClaims.id, claimId),
        ),
      );

    const [updatedUser] = await tx
      .update(users)
      .set({
        role: "estabelecimento",
        linked_place_id: claim.place_id,
        linked_place_name: claim.place_name,
        linked_place_address: claim.place_address,
      })
      .where(eq(users.id, claim.user_id))
      .returning();

    return { claim: updatedClaim, user: updatedUser };
  });
}

export async function denyClaim(
  claimId: string,
  reviewerId: string,
): Promise<PlaceClaim> {
  const claim = await db.query.placeClaims.findFirst({
    where: eq(placeClaims.id, claimId),
  });
  if (!claim) throw new Error("Reivindicação não encontrada");
  if (claim.status !== "pending") throw new Error("Reivindicação já foi revisada");

  const [updated] = await db
    .update(placeClaims)
    .set({
      status: "denied",
      reviewed_by: reviewerId,
      reviewed_at: new Date(),
    })
    .where(eq(placeClaims.id, claimId))
    .returning();

  return updated;
}

export async function getApprovedAdminForPlace(placeId: string): Promise<string | null> {
  const claim = await db.query.placeClaims.findFirst({
    where: and(
      eq(placeClaims.place_id, placeId),
      eq(placeClaims.status, "approved"),
    ),
  });
  return claim?.admin_user_id ?? null;
}

export async function getApprovedPlaceIds(): Promise<Set<string>> {
  const rows = await db.query.placeClaims.findMany({
    where: eq(placeClaims.status, "approved"),
    columns: { place_id: true },
  });
  return new Set(rows.map((r) => r.place_id));
}
