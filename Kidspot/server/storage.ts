import { db } from "./db";
import { eq, and, inArray, desc, ne, gt, lt, sql, gte, lte, like, or, ilike, asc } from "drizzle-orm";
import {
  placesKidspot,
  reviews,
  favorites,
  users,
  placeClaims,
  partnerStories,
  storyPhotos,
  backofficeUsers,
  auditLog,
  appFilters,
  communityFeedback,
  cities,
  placePhotos,
  placeKidspotMeta,
  sponsorshipPlans,
  sponsorshipContracts,
  type InsertPlace,
  type InsertReview,
  type PlaceKidspot,
  type Review,
  type Favorite,
  type User,
  type UserRole,
  type PlaceClaim,
  type InsertClaim,
  type PartnerStory,
  type StoryPhoto,
  type BackofficeUser,
  type BackofficeRole,
  type BackofficeUserStatus,
  type AuditLogEntry,
  type AppFilter,
  type InsertAppFilter,
  type CommunityFeedback,
  type City,
  type InsertCity,
  type PlacePhoto,
  type CurationStatus,
  type SponsorshipPlan,
  type SponsorshipContract,
  type SponsorshipContractStatus,
} from "@shared/schema";
import type { KidFlags } from "./kid-score";
import bcrypt from "bcryptjs";

export async function getNonApprovedPlaceIds(placeIds: string[]): Promise<Set<string>> {
  if (placeIds.length === 0) return new Set();
  const rows = await db
    .select({ place_id: placesKidspot.place_id })
    .from(placesKidspot)
    .where(
      and(
        inArray(placesKidspot.place_id, placeIds),
        sql`${placesKidspot.status} != 'aprovado'`,
      ),
    );
  return new Set(rows.map((r) => r.place_id));
}

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

/* ------------------------------------------------------------------ */
/* Partner Stories                                                       */
/* ------------------------------------------------------------------ */

export type StoryWithFirstPhoto = PartnerStory & {
  first_photo_id: string | null;
  user_role: string;
};

export async function createPartnerStory(
  userId: string,
  placeId: string,
  placeName: string,
  photoDataList: string[],
  placeLat?: number,
  placeLng?: number,
): Promise<PartnerStory> {
  if (photoDataList.length === 0) throw new Error("Pelo menos uma foto é obrigatória");
  if (photoDataList.length > 10) throw new Error("Máximo de 10 fotos por story");

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    const [story] = await tx
      .insert(partnerStories)
      .values({
        user_id: userId,
        place_id: placeId,
        place_name: placeName,
        place_lat: placeLat != null ? String(placeLat) : null,
        place_lng: placeLng != null ? String(placeLng) : null,
        expires_at: expiresAt,
      })
      .returning();

    await tx.insert(storyPhotos).values(
      photoDataList.map((photo_data, index) => ({
        story_id: story.id,
        photo_data,
        order: index,
      })),
    );

    return story;
  });
}

export async function getStoriesNearby(
  lat: number,
  lng: number,
  radiusKm = 8,
): Promise<StoryWithFirstPhoto[]> {
  const now = new Date();

  const rows = await db
    .select({
      id: partnerStories.id,
      user_id: partnerStories.user_id,
      place_id: partnerStories.place_id,
      place_name: partnerStories.place_name,
      place_lat: partnerStories.place_lat,
      place_lng: partnerStories.place_lng,
      expires_at: partnerStories.expires_at,
      created_at: partnerStories.created_at,
      user_role: users.role,
    })
    .from(partnerStories)
    .innerJoin(users, eq(partnerStories.user_id, users.id))
    .where(
      and(
        gt(partnerStories.expires_at, now),
        sql`${partnerStories.place_lat} IS NOT NULL`,
        sql`${partnerStories.place_lng} IS NOT NULL`,
        sql`6371 * acos(LEAST(1.0, cos(radians(${lat})) * cos(radians(${partnerStories.place_lat}::float8)) * cos(radians(${partnerStories.place_lng}::float8) - radians(${lng})) + sin(radians(${lat})) * sin(radians(${partnerStories.place_lat}::float8)))) <= ${radiusKm}`,
      ),
    )
    .orderBy(desc(partnerStories.created_at));

  if (rows.length === 0) return [];

  const storyIds = rows.map((r) => r.id);
  const firstPhotos = await db
    .select({
      story_id: storyPhotos.story_id,
      id: storyPhotos.id,
      order: storyPhotos.order,
    })
    .from(storyPhotos)
    .where(inArray(storyPhotos.story_id, storyIds));

  const firstPhotoMap = new Map<string, { id: string; order: number }>();
  for (const photo of firstPhotos) {
    const existing = firstPhotoMap.get(photo.story_id);
    if (existing === undefined || photo.order < existing.order) {
      firstPhotoMap.set(photo.story_id, { id: photo.id, order: photo.order });
    }
  }

  const result: StoryWithFirstPhoto[] = rows.map((r) => ({
    ...r,
    user_role: r.user_role,
    first_photo_id: firstPhotoMap.get(r.id)?.id ?? null,
  }));

  result.sort((a, b) => {
    const roleOrder = (role: string) => (role === "parceiro" ? 0 : 1);
    const diff = roleOrder(a.user_role) - roleOrder(b.user_role);
    if (diff !== 0) return diff;
    return b.created_at.getTime() - a.created_at.getTime();
  });

  return result;
}

export async function getActiveStoriesForPlaces(
  placeIds: string[],
): Promise<StoryWithFirstPhoto[]> {
  if (placeIds.length === 0) return [];

  const now = new Date();

  const rows = await db
    .select({
      id: partnerStories.id,
      user_id: partnerStories.user_id,
      place_id: partnerStories.place_id,
      place_name: partnerStories.place_name,
      place_lat: partnerStories.place_lat,
      place_lng: partnerStories.place_lng,
      expires_at: partnerStories.expires_at,
      created_at: partnerStories.created_at,
      user_role: users.role,
    })
    .from(partnerStories)
    .innerJoin(users, eq(partnerStories.user_id, users.id))
    .where(
      and(
        inArray(partnerStories.place_id, placeIds),
        gt(partnerStories.expires_at, now),
      ),
    )
    .orderBy(desc(partnerStories.created_at));

  if (rows.length === 0) return [];

  const storyIds = rows.map((r) => r.id);
  const firstPhotos = await db
    .select({
      story_id: storyPhotos.story_id,
      id: storyPhotos.id,
      order: storyPhotos.order,
    })
    .from(storyPhotos)
    .where(inArray(storyPhotos.story_id, storyIds));

  const firstPhotoMap = new Map<string, { id: string; order: number }>();
  for (const photo of firstPhotos) {
    const existing = firstPhotoMap.get(photo.story_id);
    if (existing === undefined || photo.order < existing.order) {
      firstPhotoMap.set(photo.story_id, { id: photo.id, order: photo.order });
    }
  }

  const result: StoryWithFirstPhoto[] = rows.map((r) => ({
    ...r,
    first_photo_id: firstPhotoMap.get(r.id)?.id ?? null,
    user_role: r.user_role,
  }));

  result.sort((a, b) => {
    const roleOrder = (role: string) => (role === "parceiro" ? 0 : 1);
    const diff = roleOrder(a.user_role) - roleOrder(b.user_role);
    if (diff !== 0) return diff;
    return b.created_at.getTime() - a.created_at.getTime();
  });

  return result;
}

export async function getStoryPhotos(storyId: string): Promise<StoryPhoto[]> {
  return db
    .select()
    .from(storyPhotos)
    .where(eq(storyPhotos.story_id, storyId))
    .orderBy(storyPhotos.order);
}

export async function getStoryPhotoById(photoId: string): Promise<StoryPhoto | null> {
  const [photo] = await db
    .select()
    .from(storyPhotos)
    .where(eq(storyPhotos.id, photoId))
    .limit(1);
  return photo ?? null;
}

export async function getStoryById(storyId: string): Promise<PartnerStory | null> {
  const [story] = await db
    .select()
    .from(partnerStories)
    .where(eq(partnerStories.id, storyId))
    .limit(1);
  return story ?? null;
}

/* ------------------------------------------------------------------ */
/* Backoffice Users                                                     */
/* ------------------------------------------------------------------ */

export async function createBackofficeUser(data: {
  name: string;
  email: string;
  role: BackofficeRole;
  createdBy: string;
  inviteToken: string;
  inviteTokenExpiresAt: Date;
}): Promise<BackofficeUser> {
  const [user] = await db
    .insert(backofficeUsers)
    .values({
      name: data.name,
      email: data.email.toLowerCase(),
      role: data.role,
      status: "pendente",
      invite_token: data.inviteToken,
      invite_token_expires_at: data.inviteTokenExpiresAt,
      created_by: data.createdBy,
    })
    .returning();
  return user;
}

export async function findBackofficeUserByEmail(email: string): Promise<BackofficeUser | null> {
  const user = await db.query.backofficeUsers.findFirst({
    where: eq(backofficeUsers.email, email.toLowerCase()),
  });
  return user ?? null;
}

export async function findBackofficeUserById(id: string): Promise<BackofficeUser | null> {
  const user = await db.query.backofficeUsers.findFirst({
    where: eq(backofficeUsers.id, id),
  });
  return user ?? null;
}

export async function findBackofficeUserByInviteToken(token: string): Promise<BackofficeUser | null> {
  const user = await db.query.backofficeUsers.findFirst({
    where: eq(backofficeUsers.invite_token, token),
  });
  return user ?? null;
}

export async function activateBackofficeUser(
  id: string,
  passwordHash: string,
): Promise<BackofficeUser> {
  const [user] = await db
    .update(backofficeUsers)
    .set({
      password_hash: passwordHash,
      status: "ativo",
      invite_token: null,
      invite_token_expires_at: null,
    })
    .where(eq(backofficeUsers.id, id))
    .returning();
  return user;
}

export async function listBackofficeUsers(): Promise<BackofficeUser[]> {
  return db.query.backofficeUsers.findMany({
    orderBy: [desc(backofficeUsers.created_at)],
  });
}

export async function updateBackofficeUserRole(
  id: string,
  role: BackofficeRole,
): Promise<BackofficeUser | null> {
  const [updated] = await db
    .update(backofficeUsers)
    .set({ role })
    .where(eq(backofficeUsers.id, id))
    .returning();
  return updated ?? null;
}

export async function updateBackofficeUserStatus(
  id: string,
  status: BackofficeUserStatus,
): Promise<BackofficeUser | null> {
  const [updated] = await db
    .update(backofficeUsers)
    .set({ status })
    .where(eq(backofficeUsers.id, id))
    .returning();
  return updated ?? null;
}

export async function listFilters(): Promise<AppFilter[]> {
  return db.query.appFilters.findMany({
    orderBy: (t, { desc }) => [desc(t.updated_at)],
  });
}

export async function getActiveFilters(): Promise<AppFilter[]> {
  return db.query.appFilters.findMany({
    where: eq(appFilters.active, true),
    orderBy: (t, { asc }) => [asc(t.name)],
  });
}

export async function createFilter(data: Omit<InsertAppFilter, "starts_at" | "ends_at"> & { starts_at?: string | Date | null; ends_at?: string | Date | null }): Promise<AppFilter> {
  const payload: InsertAppFilter = {
    ...data,
    starts_at: data.starts_at ? new Date(data.starts_at) : null,
    ends_at: data.ends_at ? new Date(data.ends_at) : null,
  };
  const [filter] = await db.insert(appFilters).values(payload).returning();
  return filter;
}

export async function updateFilter(id: string, data: Partial<Omit<InsertAppFilter, "starts_at" | "ends_at"> & { starts_at?: string | Date | null; ends_at?: string | Date | null }>): Promise<AppFilter | null> {
  const { starts_at, ends_at, ...rest } = data;
  const payload: Partial<InsertAppFilter> = {
    ...rest,
    ...(starts_at !== undefined ? { starts_at: starts_at ? new Date(starts_at) : null } : {}),
    ...(ends_at !== undefined ? { ends_at: ends_at ? new Date(ends_at) : null } : {}),
    updated_at: new Date(),
  };
  const [updated] = await db
    .update(appFilters)
    .set(payload)
    .where(eq(appFilters.id, id))
    .returning();
  return updated ?? null;
}

export async function toggleFilter(id: string): Promise<AppFilter | null> {
  const filter = await db.query.appFilters.findFirst({
    where: eq(appFilters.id, id),
  });
  if (!filter) return null;
  const [updated] = await db
    .update(appFilters)
    .set({ active: !filter.active, updated_at: new Date() })
    .where(eq(appFilters.id, id))
    .returning();
  return updated ?? null;
}

export async function updateBackofficeUserLastActive(id: string): Promise<void> {
  await db
    .update(backofficeUsers)
    .set({ last_active_at: new Date() })
    .where(eq(backofficeUsers.id, id));
}

export async function verifyBackofficePassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/* ------------------------------------------------------------------ */
/* Audit Log                                                            */
/* ------------------------------------------------------------------ */

export async function createAuditLog(data: {
  userId: string;
  userEmail: string;
  userRole: string;
  action: string;
  module: string;
  targetId?: string | null;
  payloadBefore?: Record<string, unknown> | null;
  payloadAfter?: Record<string, unknown> | null;
  ip?: string | null;
}): Promise<void> {
  await db.insert(auditLog).values({
    user_id: data.userId,
    user_email: data.userEmail,
    user_role: data.userRole,
    action: data.action,
    module: data.module,
    target_id: data.targetId ?? null,
    payload_before: data.payloadBefore ?? null,
    payload_after: data.payloadAfter ?? null,
    ip: data.ip ?? null,
  });
}

export async function listAuditLogs(opts: {
  limit?: number;
  offset?: number;
  userId?: string;
  userEmail?: string;
  module?: string;
  dateFrom?: Date;
  dateTo?: Date;
}): Promise<{ entries: AuditLogEntry[]; total: number }> {
  const { limit = 50, offset = 0, userId, userEmail, module: mod, dateFrom, dateTo } = opts;

  const conditions = [];
  if (userId) conditions.push(eq(auditLog.user_id, userId));
  if (userEmail) conditions.push(like(auditLog.user_email, `%${userEmail}%`));
  if (mod) conditions.push(eq(auditLog.module, mod));
  if (dateFrom) conditions.push(gte(auditLog.created_at, dateFrom));
  if (dateTo) conditions.push(lte(auditLog.created_at, dateTo));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [entries, countResult] = await Promise.all([
    db.query.auditLog.findMany({
      where,
      orderBy: [desc(auditLog.created_at)],
      limit,
      offset,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(where),
  ]);

  return { entries, total: countResult[0]?.count ?? 0 };
}

export async function archiveExpiredFilters(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(appFilters)
    .set({ active: false, updated_at: new Date() })
    .where(
      and(
        eq(appFilters.seasonal, true),
        eq(appFilters.active, true),
        lt(appFilters.ends_at, now),
      ),
    )
    .returning();
  return result.length;
}

/* ------------------------------------------------------------------ */
/* Community Feedback                                                    */
/* ------------------------------------------------------------------ */

export async function createFeedback(data: {
  type: "sugestao" | "denuncia" | "fechado";
  content: string;
  place_id?: string;
  place_name?: string;
  user_id?: string;
}): Promise<CommunityFeedback> {
  const [row] = await db
    .insert(communityFeedback)
    .values({
      type: data.type,
      content: data.content,
      place_id: data.place_id ?? null,
      place_name: data.place_name ?? null,
      user_id: data.user_id ?? null,
    })
    .returning();
  return row;
}

export async function listFeedback(opts?: {
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<(CommunityFeedback & { user_name: string | null; user_email: string | null })[]> {
  const conditions: ReturnType<typeof eq>[] = [];
  if (opts?.type) conditions.push(eq(communityFeedback.type, opts.type as "sugestao" | "denuncia" | "fechado"));
  if (opts?.status) conditions.push(eq(communityFeedback.status, opts.status as "pendente" | "resolvido" | "rejeitado"));

  const rows = await db
    .select({
      id: communityFeedback.id,
      type: communityFeedback.type,
      content: communityFeedback.content,
      place_id: communityFeedback.place_id,
      place_name: communityFeedback.place_name,
      user_id: communityFeedback.user_id,
      status: communityFeedback.status,
      created_at: communityFeedback.created_at,
      resolved_at: communityFeedback.resolved_at,
      resolved_by: communityFeedback.resolved_by,
      user_name: users.name,
      user_email: users.email,
    })
    .from(communityFeedback)
    .leftJoin(users, eq(communityFeedback.user_id, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(communityFeedback.created_at))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);

  return rows;
}

export async function countUnreadFeedback(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(communityFeedback)
    .where(eq(communityFeedback.status, "pendente"));
  return Number(row?.count ?? 0);
}

export async function resolveFeedback(
  id: string,
  resolvedById: string,
): Promise<CommunityFeedback | null> {
  const [updated] = await db
    .update(communityFeedback)
    .set({ status: "resolvido", resolved_at: new Date(), resolved_by: resolvedById })
    .where(eq(communityFeedback.id, id))
    .returning();
  return updated ?? null;
}

export async function rejectFeedback(
  id: string,
  resolvedById: string,
): Promise<CommunityFeedback | null> {
  const [updated] = await db
    .update(communityFeedback)
    .set({ status: "rejeitado", resolved_at: new Date(), resolved_by: resolvedById })
    .where(eq(communityFeedback.id, id))
    .returning();
  return updated ?? null;
}

export async function addFeedbackToQueue(
  id: string,
  resolvedById: string,
): Promise<{ feedback: CommunityFeedback; place_id: string } | null> {
  const feedback = await db.query.communityFeedback.findFirst({
    where: eq(communityFeedback.id, id),
  });
  if (!feedback) return null;

  const [updated] = await db
    .update(communityFeedback)
    .set({ status: "resolvido", resolved_at: new Date(), resolved_by: resolvedById })
    .where(eq(communityFeedback.id, id))
    .returning();

  const placeId = feedback.place_id ?? `feedback_${id}`;

  if (feedback.place_id) {
    await db
      .insert(placesKidspot)
      .values({
        place_id: feedback.place_id,
        city: "Pendente",
        lat: "0",
        lng: "0",
        tags: { status: "pendente", source: "feedback", feedback_id: id },
      })
      .onConflictDoNothing();
  }

  return { feedback: updated, place_id: placeId };
}

/* ------------------------------------------------------------------ */
/* Cities                                                               */
/* ------------------------------------------------------------------ */

export async function listCities(search?: string): Promise<City[]> {
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    return db
      .select()
      .from(cities)
      .where(ilike(cities.nome, term))
      .orderBy(desc(cities.criado_em));
  }
  return db.select().from(cities).orderBy(desc(cities.criado_em));
}

export async function getCityById(id: string): Promise<City | null> {
  const [city] = await db.select().from(cities).where(eq(cities.id, id)).limit(1);
  return city ?? null;
}

export async function createCity(data: InsertCity): Promise<City> {
  const [city] = await db
    .insert(cities)
    .values({
      nome: data.nome,
      estado: data.estado,
      latitude: String(data.latitude),
      longitude: String(data.longitude),
      raio_km: data.raio_km,
      frequencia: data.frequencia,
      parametros_prompt: data.parametros_prompt ?? null,
      ativa: data.ativa ?? true,
    })
    .returning();
  return city;
}

export async function updateCity(id: string, data: Partial<InsertCity>): Promise<City | null> {
  const updates: Record<string, unknown> = {};
  if (data.nome !== undefined) updates.nome = data.nome;
  if (data.estado !== undefined) updates.estado = data.estado;
  if (data.latitude !== undefined) updates.latitude = String(data.latitude);
  if (data.longitude !== undefined) updates.longitude = String(data.longitude);
  if (data.raio_km !== undefined) updates.raio_km = data.raio_km;
  if (data.frequencia !== undefined) updates.frequencia = data.frequencia;
  if (data.parametros_prompt !== undefined) updates.parametros_prompt = data.parametros_prompt;
  if (data.ativa !== undefined) updates.ativa = data.ativa;

  if (Object.keys(updates).length === 0) return getCityById(id);

  const [city] = await db
    .update(cities)
    .set(updates)
    .where(eq(cities.id, id))
    .returning();
  return city ?? null;
}

export async function toggleCityActive(id: string): Promise<City | null> {
  const city = await getCityById(id);
  if (!city) return null;
  const [updated] = await db
    .update(cities)
    .set({ ativa: !city.ativa })
    .where(eq(cities.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteCity(id: string): Promise<boolean> {
  const result = await db.delete(cities).where(eq(cities.id, id)).returning();
  return result.length > 0;
}

/* ------------------------------------------------------------------ */
/* Place Curation Queue                                                  */
/* ------------------------------------------------------------------ */

export type CurationItem = {
  place_id: string;
  name: string | null;
  address: string | null;
  category: string | null;
  kid_score: number | null;
  ai_evidences: unknown;
  curation_status: CurationStatus;
  description: string | null;
  custom_criteria: unknown;
  ingested_at: Date;
  updated_at: Date;
  curated_at: Date | null;
  city: string;
  photos: PlacePhoto[];
};

export async function listCurationQueue(opts: {
  status?: CurationStatus;
  city?: string;
  category?: string;
  minKidScore?: number;
  maxKidScore?: number;
  limit?: number;
  offset?: number;
}): Promise<{ items: CurationItem[]; total: number }> {
  const { status = "pendente", city, category, minKidScore, maxKidScore, limit = 20, offset = 0 } = opts;

  const conditions = [eq(placeKidspotMeta.curation_status, status)];
  if (city) conditions.push(ilike(placesKidspot.city, `%${city}%`));
  if (category) conditions.push(ilike(placeKidspotMeta.category, `%${category}%`));
  if (minKidScore != null) conditions.push(gte(placeKidspotMeta.kid_score, minKidScore));
  if (maxKidScore != null) conditions.push(lte(placeKidspotMeta.kid_score, maxKidScore));

  const where = and(...conditions);

  const [rows, countResult] = await Promise.all([
    db
      .select({
        place_id: placeKidspotMeta.place_id,
        name: placeKidspotMeta.name,
        address: placeKidspotMeta.address,
        category: placeKidspotMeta.category,
        kid_score: placeKidspotMeta.kid_score,
        ai_evidences: placeKidspotMeta.ai_evidences,
        curation_status: placeKidspotMeta.curation_status,
        description: placeKidspotMeta.description,
        custom_criteria: placeKidspotMeta.custom_criteria,
        ingested_at: placeKidspotMeta.ingested_at,
        updated_at: placeKidspotMeta.updated_at,
        curated_at: placeKidspotMeta.curated_at,
        city: placesKidspot.city,
      })
      .from(placeKidspotMeta)
      .innerJoin(placesKidspot, eq(placeKidspotMeta.place_id, placesKidspot.place_id))
      .where(where)
      .orderBy(desc(placeKidspotMeta.ingested_at))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(placeKidspotMeta)
      .innerJoin(placesKidspot, eq(placeKidspotMeta.place_id, placesKidspot.place_id))
      .where(where),
  ]);

  if (rows.length === 0) return { items: [], total: countResult[0]?.count ?? 0 };

  const placeIds = rows.map((r) => r.place_id);
  const photos = await db
    .select()
    .from(placePhotos)
    .where(and(inArray(placePhotos.place_id, placeIds), eq(placePhotos.deleted, false)))
    .orderBy(asc(placePhotos.order));

  const photosByPlace = new Map<string, PlacePhoto[]>();
  for (const p of photos) {
    if (!photosByPlace.has(p.place_id)) photosByPlace.set(p.place_id, []);
    photosByPlace.get(p.place_id)!.push(p);
  }

  return {
    items: rows.map((r) => ({ ...r, photos: photosByPlace.get(r.place_id) ?? [] })),
    total: countResult[0]?.count ?? 0,
  };
}

export async function countPendingCuration(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(placeKidspotMeta)
    .where(eq(placeKidspotMeta.curation_status, "pendente"));
  return row?.count ?? 0;
}

export async function upsertPlaceMeta(data: {
  place_id: string;
  name?: string;
  address?: string;
  category?: string;
  kid_score?: number;
  ai_evidences?: unknown;
  description?: string;
  city?: string;
}): Promise<void> {
  if (data.city) {
    await db
      .insert(placesKidspot)
      .values({
        place_id: data.place_id,
        city: data.city,
        lat: "0",
        lng: "0",
      })
      .onConflictDoNothing();
  }

  await db
    .insert(placeKidspotMeta)
    .values({
      place_id: data.place_id,
      name: data.name ?? null,
      address: data.address ?? null,
      category: data.category ?? null,
      kid_score: data.kid_score ?? null,
      ai_evidences: data.ai_evidences ?? null,
      description: data.description ?? null,
      curation_status: "pendente",
      ingested_at: new Date(),
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: placeKidspotMeta.place_id,
      set: {
        name: data.name ?? null,
        address: data.address ?? null,
        category: data.category ?? null,
        kid_score: data.kid_score ?? null,
        ai_evidences: data.ai_evidences ?? null,
        description: data.description ?? null,
        updated_at: new Date(),
      },
    });
}

export async function approveCurationItem(
  placeId: string,
  curatedBy: string,
  edits?: { name?: string; description?: string; custom_criteria?: unknown },
): Promise<void> {
  const set: Record<string, unknown> = {
    curation_status: "aprovado",
    curated_by: curatedBy,
    curated_at: new Date(),
    updated_at: new Date(),
  };
  if (edits?.name !== undefined) set.name = edits.name;
  if (edits?.description !== undefined) set.description = edits.description;
  if (edits?.custom_criteria !== undefined) set.custom_criteria = edits.custom_criteria;

  await db
    .update(placeKidspotMeta)
    .set(set)
    .where(eq(placeKidspotMeta.place_id, placeId));
}

export async function rejectCurationItem(placeId: string, curatedBy: string): Promise<void> {
  await db
    .update(placeKidspotMeta)
    .set({
      curation_status: "rejeitado",
      curated_by: curatedBy,
      curated_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(placeKidspotMeta.place_id, placeId));
}

/* ------------------------------------------------------------------ */
/* Place Photos                                                          */
/* ------------------------------------------------------------------ */

export async function listPlacePhotos(placeId: string): Promise<PlacePhoto[]> {
  return db
    .select()
    .from(placePhotos)
    .where(and(eq(placePhotos.place_id, placeId), eq(placePhotos.deleted, false)))
    .orderBy(asc(placePhotos.order));
}

export async function addPlacePhoto(data: {
  place_id: string;
  url: string;
  photo_reference?: string;
  order?: number;
}): Promise<PlacePhoto> {
  const [photo] = await db
    .insert(placePhotos)
    .values({
      place_id: data.place_id,
      url: data.url,
      photo_reference: data.photo_reference ?? null,
      order: data.order ?? 0,
      is_cover: false,
      deleted: false,
    })
    .returning();
  return photo;
}

export async function setCoverPhoto(placeId: string, photoId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(placePhotos)
      .set({ is_cover: false })
      .where(eq(placePhotos.place_id, placeId));
    await tx
      .update(placePhotos)
      .set({ is_cover: true })
      .where(and(eq(placePhotos.id, photoId), eq(placePhotos.place_id, placeId)));
  });
}

export async function deletePlacePhoto(photoId: string): Promise<void> {
  await db
    .update(placePhotos)
    .set({ deleted: true, is_cover: false })
    .where(eq(placePhotos.id, photoId));
}

/* ------------------------------------------------------------------ */
/* Sponsorship Plans                                                    */
/* ------------------------------------------------------------------ */

export async function listSponsorshipPlans(): Promise<SponsorshipPlan[]> {
  return db.select().from(sponsorshipPlans).orderBy(desc(sponsorshipPlans.priority));
}

export async function getSponsorshipPlanById(id: string): Promise<SponsorshipPlan | null> {
  const [plan] = await db.select().from(sponsorshipPlans).where(eq(sponsorshipPlans.id, id)).limit(1);
  return plan ?? null;
}

export async function createSponsorshipPlan(data: {
  name: string;
  priority: number;
  reference_price: number;
  benefits?: string | null;
}): Promise<SponsorshipPlan> {
  const [plan] = await db
    .insert(sponsorshipPlans)
    .values({
      name: data.name,
      priority: data.priority,
      reference_price: String(data.reference_price),
      benefits: data.benefits ?? null,
    })
    .returning();
  return plan;
}

export async function updateSponsorshipPlan(
  id: string,
  data: Partial<{ name: string; priority: number; reference_price: number; benefits: string | null }>,
): Promise<SponsorshipPlan | null> {
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.reference_price !== undefined) updates.reference_price = String(data.reference_price);
  if (data.benefits !== undefined) updates.benefits = data.benefits;

  const [updated] = await db
    .update(sponsorshipPlans)
    .set(updates)
    .where(eq(sponsorshipPlans.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteSponsorshipPlan(id: string): Promise<boolean> {
  const result = await db.delete(sponsorshipPlans).where(eq(sponsorshipPlans.id, id)).returning();
  return result.length > 0;
}

/* ------------------------------------------------------------------ */
/* Sponsorship Contracts                                                */
/* ------------------------------------------------------------------ */

export type ContractWithPlan = SponsorshipContract & {
  plan_name: string;
  plan_priority: number;
};

export async function listSponsorshipContracts(opts?: {
  status?: string;
  place_id?: string;
}): Promise<ContractWithPlan[]> {
  const conditions = [];
  if (opts?.status) conditions.push(eq(sponsorshipContracts.status, opts.status as SponsorshipContractStatus));
  if (opts?.place_id) conditions.push(eq(sponsorshipContracts.place_id, opts.place_id));

  const rows = await db
    .select({
      id: sponsorshipContracts.id,
      place_id: sponsorshipContracts.place_id,
      place_name: sponsorshipContracts.place_name,
      plan_id: sponsorshipContracts.plan_id,
      starts_at: sponsorshipContracts.starts_at,
      ends_at: sponsorshipContracts.ends_at,
      status: sponsorshipContracts.status,
      notes: sponsorshipContracts.notes,
      created_at: sponsorshipContracts.created_at,
      updated_at: sponsorshipContracts.updated_at,
      plan_name: sponsorshipPlans.name,
      plan_priority: sponsorshipPlans.priority,
    })
    .from(sponsorshipContracts)
    .innerJoin(sponsorshipPlans, eq(sponsorshipContracts.plan_id, sponsorshipPlans.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sponsorshipContracts.created_at));

  return rows;
}

export async function getSponsorshipContractById(id: string): Promise<ContractWithPlan | null> {
  const [row] = await db
    .select({
      id: sponsorshipContracts.id,
      place_id: sponsorshipContracts.place_id,
      place_name: sponsorshipContracts.place_name,
      plan_id: sponsorshipContracts.plan_id,
      starts_at: sponsorshipContracts.starts_at,
      ends_at: sponsorshipContracts.ends_at,
      status: sponsorshipContracts.status,
      notes: sponsorshipContracts.notes,
      created_at: sponsorshipContracts.created_at,
      updated_at: sponsorshipContracts.updated_at,
      plan_name: sponsorshipPlans.name,
      plan_priority: sponsorshipPlans.priority,
    })
    .from(sponsorshipContracts)
    .innerJoin(sponsorshipPlans, eq(sponsorshipContracts.plan_id, sponsorshipPlans.id))
    .where(eq(sponsorshipContracts.id, id))
    .limit(1);
  return row ?? null;
}

export async function createSponsorshipContract(data: {
  place_id: string;
  place_name: string;
  plan_id: string;
  starts_at: Date;
  ends_at: Date;
  notes?: string | null;
}): Promise<SponsorshipContract> {
  const [contract] = await db
    .insert(sponsorshipContracts)
    .values({
      place_id: data.place_id,
      place_name: data.place_name,
      plan_id: data.plan_id,
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      notes: data.notes ?? null,
    })
    .returning();
  return contract;
}

export async function updateSponsorshipContract(
  id: string,
  data: Partial<{ plan_id: string; starts_at: Date; ends_at: Date; status: SponsorshipContractStatus; notes: string | null }>,
): Promise<SponsorshipContract | null> {
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (data.plan_id !== undefined) updates.plan_id = data.plan_id;
  if (data.starts_at !== undefined) updates.starts_at = data.starts_at;
  if (data.ends_at !== undefined) updates.ends_at = data.ends_at;
  if (data.status !== undefined) updates.status = data.status;
  if (data.notes !== undefined) updates.notes = data.notes;

  const [updated] = await db
    .update(sponsorshipContracts)
    .set(updates)
    .where(eq(sponsorshipContracts.id, id))
    .returning();
  return updated ?? null;
}

export async function expireStaleContracts(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(sponsorshipContracts)
    .set({ status: "expirado", updated_at: now })
    .where(
      and(
        eq(sponsorshipContracts.status, "ativo"),
        lt(sponsorshipContracts.ends_at, now),
      ),
    )
    .returning();
  return result.length;
}

export async function getActiveSponsoredPlaceIds(): Promise<Map<string, number>> {
  const now = new Date();
  const rows = await db
    .select({
      place_id: sponsorshipContracts.place_id,
      priority: sponsorshipPlans.priority,
    })
    .from(sponsorshipContracts)
    .innerJoin(sponsorshipPlans, eq(sponsorshipContracts.plan_id, sponsorshipPlans.id))
    .where(
      and(
        eq(sponsorshipContracts.status, "ativo"),
        lte(sponsorshipContracts.starts_at, now),
        gt(sponsorshipContracts.ends_at, now),
      ),
    );

  const map = new Map<string, number>();
  for (const row of rows) {
    const existing = map.get(row.place_id);
    if (existing === undefined || row.priority > existing) {
      map.set(row.place_id, row.priority);
    }
  }
  return map;
}

export async function incrementImpressions(placeIds: string[]): Promise<void> {
  if (placeIds.length === 0) return;
  await db
    .update(placesKidspot)
    .set({ impression_count: sql`${placesKidspot.impression_count} + 1` })
    .where(inArray(placesKidspot.place_id, placeIds));
}

export async function incrementDetailAccess(placeId: string): Promise<void> {
  await db
    .update(placesKidspot)
    .set({ detail_access_count: sql`${placesKidspot.detail_access_count} + 1` })
    .where(eq(placesKidspot.place_id, placeId));
}

export async function getSponsorshipPerformance(contractId: string): Promise<{
  impressions: number;
  detail_accesses: number;
  avg_position: number | null;
} | null> {
  const contract = await getSponsorshipContractById(contractId);
  if (!contract) return null;

  const [stats] = await db
    .select({
      impression_count: placesKidspot.impression_count,
      detail_access_count: placesKidspot.detail_access_count,
    })
    .from(placesKidspot)
    .where(eq(placesKidspot.place_id, contract.place_id))
    .limit(1);

  return {
    impressions: stats?.impression_count ?? 0,
    detail_accesses: stats?.detail_access_count ?? 0,
    avg_position: null,
  };
}
