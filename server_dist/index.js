// server/index.ts
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

// server/routes.ts
import { createServer } from "node:http";
import { z } from "zod";

// server/db.ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
var { Pool } = pg;
var connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "NEON_DATABASE_URL or DATABASE_URL must be set. Did you forget to provision a database?"
  );
}
var pool = new Pool({ connectionString });
var db = drizzle(pool, { schema });

// server/kid-score.ts
var ALLOWED_TYPES = /* @__PURE__ */ new Set([
  "playground",
  "amusement_center",
  "park",
  "zoo",
  "tourist_attraction",
  "restaurant",
  "cafe",
  "bakery",
  "shopping_mall",
  "sports_club",
  "community_center",
  // common Google synonym kept for coverage
  "amusement_park"
]);
var KID_KEYWORDS = [
  "kids",
  "kid",
  "kids area",
  "kids club",
  "infantil",
  "crian\xE7a",
  "crian\xE7as",
  "family",
  "family friendly",
  "playground",
  "brinquedoteca",
  "parquinho",
  "recrea\xE7\xE3o",
  "recreacao",
  "espa\xE7o kids",
  "espaco kids",
  "baby",
  "menu infantil",
  "cadeir\xE3o",
  "cadeirao",
  "trocador",
  "parque",
  "jardim",
  "zoo",
  "zool\xF3gico",
  "zoologico"
];
var KID_AUTO_PASS_TYPES = /* @__PURE__ */ new Set([
  // Public outdoor spaces — inherently kid-relevant
  "park",
  "playground",
  "amusement_park",
  // Leisure venues — inherently kid-relevant
  "amusement_center",
  "zoo",
  "community_center",
  "sports_club",
  // Food establishments — pass Layer 2, gated by Layer 3 quality check
  "restaurant",
  "cafe",
  "bakery",
  "shopping_mall"
]);
var BLOCK_KEYWORDS = [
  "advocacia",
  "advocaticia",
  "contabilidade",
  "contabil",
  "cart\xF3rio",
  "cartorio",
  "oficina",
  "consultoria",
  "transportadora",
  "ind\xFAstria",
  "industria",
  "f\xE1brica",
  "fabrica",
  "dep\xF3sito",
  "deposito",
  "material el\xE9trico",
  "material eletrico",
  "cl\xEDnica",
  "clinica",
  "hospital",
  "farm\xE1cia",
  "farmacia",
  "posto",
  "combust\xEDvel",
  "combustivel",
  "igreja",
  "condom\xEDnio",
  "condominio"
];
var TIER1_KEYWORDS = [
  // ── Português ──────────────────────────────────────────────────
  ["brinquedoteca", "Brinquedoteca"],
  ["parquinho", "Parquinho"],
  ["playground", "Playground"],
  ["area kids", "\xC1rea Kids"],
  ["espaco kids", "Espa\xE7o Kids"],
  ["monitora", "Monitores infantis"],
  ["monitor infantil", "Monitores infantis"],
  ["fraldario", "Frald\xE1rio"],
  ["trocador", "Frald\xE1rio"],
  ["menu infantil", "Menu infantil"],
  ["cardapio infantil", "Menu infantil"],
  ["piscina infantil", "Piscina infantil"],
  ["pula pula", "\xC1rea Kids"],
  ["toboga", "\xC1rea Kids"],
  ["escorregador", "\xC1rea Kids"],
  // ── Inglês ─────────────────────────────────────────────────────
  ["playroom", "Brinquedoteca"],
  ["kids area", "\xC1rea Kids"],
  ["kids room", "\xC1rea Kids"],
  ["play area", "\xC1rea Kids"],
  ["children area", "\xC1rea Kids"],
  ["kids corner", "\xC1rea Kids"],
  ["kids menu", "Menu infantil"],
  ["children menu", "Menu infantil"],
  ["diaper", "Frald\xE1rio"],
  ["changing table", "Frald\xE1rio"],
  ["ball pit", "\xC1rea Kids"],
  ["soft play", "\xC1rea Kids"]
];
var TIER2_KEYWORDS = [
  // ── Português ──────────────────────────────────────────────────
  ["crianca", "Fam\xEDlia"],
  ["infantil", "Fam\xEDlia"],
  ["familia", "Fam\xEDlia"],
  ["fralda", "Fam\xEDlia"],
  // ── Inglês ─────────────────────────────────────────────────────
  ["child friendly", "Fam\xEDlia"],
  ["family friendly", "Fam\xEDlia"],
  ["kid friendly", "Fam\xEDlia"],
  ["children welcome", "Fam\xEDlia"],
  ["kids welcome", "Fam\xEDlia"],
  ["toddler", "Fam\xEDlia"],
  ["stroller", "Fam\xEDlia"],
  ["kids", "Fam\xEDlia"]
];
var FAMILY_REVIEW_KEYWORD_MAP = [
  ...TIER1_KEYWORDS,
  ...TIER2_KEYWORDS
];
function analyseReviews(reviewTexts) {
  let tier1Highlight;
  let tier1ReviewsCount = 0;
  let tier2ReviewsCount = 0;
  const tier1Labels = /* @__PURE__ */ new Set();
  const tier2Labels = /* @__PURE__ */ new Set();
  for (const text of reviewTexts) {
    const norm = normalise(text);
    let hasTier1 = false;
    let hasTier2 = false;
    for (const [kw, label] of TIER1_KEYWORDS) {
      if (norm.includes(normalise(kw))) {
        hasTier1 = true;
        tier1Labels.add(label);
        if (!tier1Highlight)
          tier1Highlight = label;
      }
    }
    if (!hasTier1) {
      for (const [kw, label] of TIER2_KEYWORDS) {
        if (norm.includes(normalise(kw))) {
          hasTier2 = true;
          tier2Labels.add(label);
        }
      }
    }
    if (hasTier1)
      tier1ReviewsCount++;
    else if (hasTier2)
      tier2ReviewsCount++;
  }
  return {
    tier1Highlight,
    tier1ReviewsCount,
    tier1DistinctLabels: tier1Labels.size,
    tier2ReviewsCount,
    tier2DistinctLabels: tier2Labels.size
  };
}
function calculateReviewBonus(analysis) {
  const tier1 = analysis.tier1ReviewsCount * 15 + analysis.tier1DistinctLabels * 10;
  const tier2 = analysis.tier2ReviewsCount * 3 + analysis.tier2DistinctLabels * 2;
  return tier1 + tier2;
}
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371e3;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function normalise(str) {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function containsAny(text, keywords) {
  const n = normalise(text);
  return keywords.some((kw) => n.includes(normalise(kw)));
}
function filterByAllowedTypes(places) {
  return places.filter((p) => p.types.some((t) => ALLOWED_TYPES.has(t)));
}
function filterByBlocklist(places) {
  return places.filter((p) => !containsAny(p.name, BLOCK_KEYWORDS));
}
function filterByKidEvidence(places) {
  return places.filter(
    (p) => p.types.some((t) => KID_AUTO_PASS_TYPES.has(t)) || containsAny(p.name, KID_KEYWORDS)
  );
}
var QUALITY_GATE_EXEMPT_TYPES = /* @__PURE__ */ new Set([
  "park",
  "playground",
  "amusement_park"
]);
function filterByQuality(places) {
  return places.filter((p) => {
    if (p.types.some((t) => QUALITY_GATE_EXEMPT_TYPES.has(t)))
      return true;
    const rating = p.rating ?? 0;
    const reviewCount = p.user_ratings_total ?? 0;
    const isCommercial = p.types.some(
      (t) => ["restaurant", "cafe", "bakery", "shopping_mall"].includes(t)
    );
    if (isCommercial) {
      return rating >= 4.2 && reviewCount >= 20 && (p.photos?.length ?? 0) > 0;
    }
    return rating >= 3.8 && reviewCount >= 5;
  });
}
function applyKidFilters(places) {
  return filterByQuality(
    filterByKidEvidence(
      filterByAllowedTypes(
        filterByBlocklist(places)
      )
    )
  );
}
function filterOpenNow(places) {
  return places.filter(
    (p) => p.opening_hours == null || p.opening_hours.open_now !== false
  );
}
function calculateKidScore(place, originLat, originLng, kidFlags = {}, reviewTexts = [], enrichment = {}) {
  const breakdown = {
    type_bonus: 0,
    espaco_kids_bonus: 0,
    trocador_bonus: 0,
    cadeirao_bonus: 0,
    rating_bonus: 0,
    proximity_bonus: 0,
    review_bonus: 0,
    foursquare_bonus: 0,
    cross_source_bonus: 0
  };
  const premiumKidTypes = /* @__PURE__ */ new Set(["playground", "amusement_center", "amusement_park", "zoo"]);
  if (place.types.some((t) => premiumKidTypes.has(t))) {
    breakdown.type_bonus = 40;
  }
  if (kidFlags.espaco_kids)
    breakdown.espaco_kids_bonus = 25;
  if (kidFlags.trocador)
    breakdown.trocador_bonus = 20;
  if (kidFlags.cadeirao)
    breakdown.cadeirao_bonus = 15;
  if ((place.rating ?? 0) >= 4.2 && (place.user_ratings_total ?? 0) >= 20) {
    breakdown.rating_bonus = 10;
  }
  const distanceMeters = haversineMeters(
    originLat,
    originLng,
    place.location.lat,
    place.location.lng
  );
  if (distanceMeters <= 1e3) {
    breakdown.proximity_bonus = 10;
  }
  const reviewAnalysis = analyseReviews(reviewTexts);
  breakdown.review_bonus = calculateReviewBonus(reviewAnalysis);
  breakdown.review_bonus += enrichment.aiReviewBonus ?? 0;
  breakdown.foursquare_bonus = enrichment.foursquareBonus ?? 0;
  breakdown.cross_source_bonus = enrichment.crossSourceBonus ?? 0;
  const TYPE_AUTO_HIGHLIGHTS = {
    playground: "Playground",
    amusement_center: "Centro de divers\xF5es",
    amusement_park: "Parque de divers\xF5es",
    zoo: "Zool\xF3gico"
  };
  const typeHighlight = place.types.map((t) => TYPE_AUTO_HIGHLIGHTS[t]).find((h) => h !== void 0);
  const family_highlight = reviewAnalysis.tier1Highlight ?? typeHighlight;
  const kid_score = breakdown.type_bonus + breakdown.espaco_kids_bonus + breakdown.trocador_bonus + breakdown.cadeirao_bonus + breakdown.rating_bonus + breakdown.proximity_bonus + breakdown.review_bonus + breakdown.foursquare_bonus + breakdown.cross_source_bonus;
  return {
    ...place,
    kid_score,
    kid_score_breakdown: breakdown,
    distance_meters: Math.round(distanceMeters),
    ...family_highlight ? { family_highlight } : {}
  };
}
function sortResults(places, sortBy) {
  const copy = [...places];
  function byPopularity(a, b) {
    const totalDiff = (b.user_ratings_total ?? 0) - (a.user_ratings_total ?? 0);
    if (totalDiff !== 0)
      return totalDiff;
    const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
    if (ratingDiff !== 0)
      return ratingDiff;
    return (a.distance_meters ?? Infinity) - (b.distance_meters ?? Infinity);
  }
  switch (sortBy) {
    case "distance":
      copy.sort((a, b) => {
        const distDiff = (a.distance_meters ?? Infinity) - (b.distance_meters ?? Infinity);
        if (distDiff !== 0)
          return distDiff;
        const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
        if (ratingDiff !== 0)
          return ratingDiff;
        return (b.user_ratings_total ?? 0) - (a.user_ratings_total ?? 0);
      });
      break;
    case "rating":
      copy.sort(byPopularity);
      break;
    case "kidScore":
    default:
      copy.sort((a, b) => {
        const aHas = a.family_highlight ? 1 : 0;
        const bHas = b.family_highlight ? 1 : 0;
        if (bHas !== aHas)
          return bHas - aHas;
        const scoreDiff = b.kid_score - a.kid_score;
        if (scoreDiff !== 0)
          return scoreDiff;
        return byPopularity(a, b);
      });
      break;
  }
  return copy;
}

// server/storage.ts
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
  cityDemand
} from "@shared/schema";
import bcrypt from "bcryptjs";
async function getNonApprovedPlaceIds(placeIds) {
  if (placeIds.length === 0)
    return /* @__PURE__ */ new Set();
  const rows = await db.select({ place_id: placesKidspot.place_id }).from(placesKidspot).where(
    and(
      inArray(placesKidspot.place_id, placeIds),
      sql`${placesKidspot.status} != 'aprovado'`
    )
  );
  return new Set(rows.map((r) => r.place_id));
}
async function upsertPlace(place) {
  const [row] = await db.insert(placesKidspot).values(place).onConflictDoNothing().returning();
  if (row)
    return row;
  const existing = await db.query.placesKidspot.findFirst({
    where: eq(placesKidspot.place_id, place.place_id)
  });
  return existing;
}
async function createReview(review, userId) {
  const [row] = await db.insert(reviews).values({ ...review, user_id: userId }).returning();
  return row;
}
async function getReviewsForPlace(placeId) {
  return db.query.reviews.findMany({
    where: eq(reviews.place_id, placeId),
    orderBy: (r, { desc: desc3 }) => [desc3(r.created_at)]
  });
}
async function toggleFavorite(userId, placeId) {
  const existing = await db.query.favorites.findFirst({
    where: and(
      eq(favorites.user_id, userId),
      eq(favorites.place_id, placeId)
    )
  });
  if (existing) {
    await db.delete(favorites).where(
      and(
        eq(favorites.user_id, userId),
        eq(favorites.place_id, placeId)
      )
    );
    return { added: false };
  }
  await db.insert(favorites).values({ user_id: userId, place_id: placeId });
  return { added: true };
}
async function getFavoritesForUser(userId) {
  return db.query.favorites.findMany({
    where: eq(favorites.user_id, userId),
    orderBy: (f, { desc: desc3 }) => [desc3(f.created_at)]
  });
}
async function getAggregatedKidFlagsForPlaces(placeIds) {
  const result = /* @__PURE__ */ new Map();
  if (placeIds.length === 0)
    return result;
  const rows = await db.query.reviews.findMany({
    where: inArray(reviews.place_id, placeIds),
    columns: { place_id: true, kid_flags: true }
  });
  for (const row of rows) {
    const flags = row.kid_flags;
    const existing = result.get(row.place_id) ?? {};
    result.set(row.place_id, {
      espaco_kids: existing.espaco_kids || flags.espaco_kids,
      trocador: existing.trocador || flags.trocador,
      cadeirao: existing.cadeirao || flags.cadeirao
    });
  }
  return result;
}
async function createUser(data) {
  const password_hash = await bcrypt.hash(data.password, 10);
  const [user] = await db.insert(users).values({ name: data.name, email: data.email, password_hash }).returning();
  return user;
}
async function adminCreateUser(data) {
  const password_hash = await bcrypt.hash(data.password, 10);
  const [user] = await db.insert(users).values({ name: data.name, email: data.email.toLowerCase(), password_hash, role: data.role }).returning();
  return user;
}
async function findUserByEmail(email) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase())
  });
  return user ?? null;
}
async function getUserById(id) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, id)
  });
  return user ?? null;
}
async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
async function findOrCreateGoogleUser(data) {
  const existing = await findUserByEmail(data.email);
  if (existing)
    return existing;
  const password_hash = await bcrypt.hash(
    Math.random().toString(36) + Date.now().toString(36),
    10
  );
  const [user] = await db.insert(users).values({ name: data.name, email: data.email.toLowerCase(), password_hash }).returning();
  return user;
}
async function listUsers(limit = 100, offset = 0) {
  return db.query.users.findMany({
    orderBy: [desc(users.created_at)],
    limit,
    offset
  });
}
async function updateUserRole(id, role) {
  const [updated] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
  return updated ?? null;
}
async function createClaim(userId, data) {
  const [row] = await db.insert(placeClaims).values({
    user_id: userId,
    place_id: data.place_id,
    place_name: data.place_name,
    place_address: data.place_address,
    place_photo_reference: data.place_photo_reference ?? null,
    contact_phone: data.contact_phone
  }).returning();
  return row;
}
async function getClaimsForUser(userId) {
  return db.query.placeClaims.findMany({
    where: eq(placeClaims.user_id, userId),
    orderBy: [desc(placeClaims.created_at)]
  });
}
async function listClaims(status) {
  const conditions = status ? and(eq(placeClaims.status, status)) : void 0;
  const rows = await db.select({
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
    user_email: users.email
  }).from(placeClaims).innerJoin(users, eq(placeClaims.user_id, users.id)).where(conditions).orderBy(desc(placeClaims.created_at));
  return rows;
}
async function approveClaim(claimId, reviewerId) {
  return db.transaction(async (tx) => {
    const claim = await tx.query.placeClaims.findFirst({
      where: eq(placeClaims.id, claimId)
    });
    if (!claim)
      throw new Error("Reivindica\xE7\xE3o n\xE3o encontrada");
    if (claim.status !== "pending")
      throw new Error("Reivindica\xE7\xE3o j\xE1 foi revisada");
    const existingApproved = await tx.query.placeClaims.findFirst({
      where: and(
        eq(placeClaims.place_id, claim.place_id),
        eq(placeClaims.status, "approved")
      )
    });
    if (existingApproved) {
      throw new Error("Este local j\xE1 possui um administrador aprovado");
    }
    const [updatedClaim] = await tx.update(placeClaims).set({
      status: "approved",
      admin_user_id: claim.user_id,
      reviewed_by: reviewerId,
      reviewed_at: /* @__PURE__ */ new Date()
    }).where(and(eq(placeClaims.id, claimId), eq(placeClaims.status, "pending"))).returning();
    if (!updatedClaim)
      throw new Error("Reivindica\xE7\xE3o j\xE1 foi revisada por outro administrador");
    const currentUser = await tx.query.users.findFirst({ where: eq(users.id, claim.user_id) });
    if (!currentUser)
      throw new Error("Usu\xE1rio solicitante n\xE3o encontrado");
    if (currentUser.linked_place_id)
      throw new Error("O usu\xE1rio j\xE1 possui um estabelecimento vinculado");
    await tx.update(placeClaims).set({
      status: "denied",
      reviewed_by: reviewerId,
      reviewed_at: /* @__PURE__ */ new Date()
    }).where(
      and(
        eq(placeClaims.place_id, claim.place_id),
        eq(placeClaims.status, "pending"),
        ne(placeClaims.id, claimId)
      )
    );
    const [updatedUser] = await tx.update(users).set({
      role: "estabelecimento",
      linked_place_id: claim.place_id,
      linked_place_name: claim.place_name,
      linked_place_address: claim.place_address
    }).where(eq(users.id, claim.user_id)).returning();
    return { claim: updatedClaim, user: updatedUser };
  });
}
async function denyClaim(claimId, reviewerId) {
  const claim = await db.query.placeClaims.findFirst({
    where: eq(placeClaims.id, claimId)
  });
  if (!claim)
    throw new Error("Reivindica\xE7\xE3o n\xE3o encontrada");
  if (claim.status !== "pending")
    throw new Error("Reivindica\xE7\xE3o j\xE1 foi revisada");
  const [updated] = await db.update(placeClaims).set({
    status: "denied",
    reviewed_by: reviewerId,
    reviewed_at: /* @__PURE__ */ new Date()
  }).where(eq(placeClaims.id, claimId)).returning();
  return updated;
}
async function getApprovedAdminForPlace(placeId) {
  const claim = await db.query.placeClaims.findFirst({
    where: and(
      eq(placeClaims.place_id, placeId),
      eq(placeClaims.status, "approved")
    )
  });
  return claim?.admin_user_id ?? null;
}
async function getApprovedPlaceIds() {
  const rows = await db.query.placeClaims.findMany({
    where: eq(placeClaims.status, "approved"),
    columns: { place_id: true }
  });
  return new Set(rows.map((r) => r.place_id));
}
async function createPartnerStory(userId, placeId, placeName, photoDataList, placeLat, placeLng) {
  if (photoDataList.length === 0)
    throw new Error("Pelo menos uma foto \xE9 obrigat\xF3ria");
  if (photoDataList.length > 10)
    throw new Error("M\xE1ximo de 10 fotos por story");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1e3);
  return db.transaction(async (tx) => {
    const [story] = await tx.insert(partnerStories).values({
      user_id: userId,
      place_id: placeId,
      place_name: placeName,
      place_lat: placeLat != null ? String(placeLat) : null,
      place_lng: placeLng != null ? String(placeLng) : null,
      expires_at: expiresAt
    }).returning();
    await tx.insert(storyPhotos).values(
      photoDataList.map((photo_data, index) => ({
        story_id: story.id,
        photo_data,
        order: index
      }))
    );
    return story;
  });
}
async function getStoriesNearby(lat, lng, radiusKm = 8) {
  const now = /* @__PURE__ */ new Date();
  const rows = await db.select({
    id: partnerStories.id,
    user_id: partnerStories.user_id,
    place_id: partnerStories.place_id,
    place_name: partnerStories.place_name,
    place_lat: partnerStories.place_lat,
    place_lng: partnerStories.place_lng,
    expires_at: partnerStories.expires_at,
    created_at: partnerStories.created_at,
    user_role: users.role
  }).from(partnerStories).innerJoin(users, eq(partnerStories.user_id, users.id)).where(
    and(
      gt(partnerStories.expires_at, now),
      sql`${partnerStories.place_lat} IS NOT NULL`,
      sql`${partnerStories.place_lng} IS NOT NULL`,
      sql`6371 * acos(LEAST(1.0, cos(radians(${lat})) * cos(radians(${partnerStories.place_lat}::float8)) * cos(radians(${partnerStories.place_lng}::float8) - radians(${lng})) + sin(radians(${lat})) * sin(radians(${partnerStories.place_lat}::float8)))) <= ${radiusKm}`
    )
  ).orderBy(desc(partnerStories.created_at));
  if (rows.length === 0)
    return [];
  const storyIds = rows.map((r) => r.id);
  const firstPhotos = await db.select({
    story_id: storyPhotos.story_id,
    id: storyPhotos.id,
    order: storyPhotos.order
  }).from(storyPhotos).where(inArray(storyPhotos.story_id, storyIds));
  const firstPhotoMap = /* @__PURE__ */ new Map();
  for (const photo of firstPhotos) {
    const existing = firstPhotoMap.get(photo.story_id);
    if (existing === void 0 || photo.order < existing.order) {
      firstPhotoMap.set(photo.story_id, { id: photo.id, order: photo.order });
    }
  }
  const result = rows.map((r) => ({
    ...r,
    user_role: r.user_role,
    first_photo_id: firstPhotoMap.get(r.id)?.id ?? null
  }));
  result.sort((a, b) => {
    const roleOrder = (role) => role === "parceiro" ? 0 : 1;
    const diff = roleOrder(a.user_role) - roleOrder(b.user_role);
    if (diff !== 0)
      return diff;
    return b.created_at.getTime() - a.created_at.getTime();
  });
  return result;
}
async function getActiveStoriesForPlaces(placeIds) {
  if (placeIds.length === 0)
    return [];
  const now = /* @__PURE__ */ new Date();
  const rows = await db.select({
    id: partnerStories.id,
    user_id: partnerStories.user_id,
    place_id: partnerStories.place_id,
    place_name: partnerStories.place_name,
    place_lat: partnerStories.place_lat,
    place_lng: partnerStories.place_lng,
    expires_at: partnerStories.expires_at,
    created_at: partnerStories.created_at,
    user_role: users.role
  }).from(partnerStories).innerJoin(users, eq(partnerStories.user_id, users.id)).where(
    and(
      inArray(partnerStories.place_id, placeIds),
      gt(partnerStories.expires_at, now)
    )
  ).orderBy(desc(partnerStories.created_at));
  if (rows.length === 0)
    return [];
  const storyIds = rows.map((r) => r.id);
  const firstPhotos = await db.select({
    story_id: storyPhotos.story_id,
    id: storyPhotos.id,
    order: storyPhotos.order
  }).from(storyPhotos).where(inArray(storyPhotos.story_id, storyIds));
  const firstPhotoMap = /* @__PURE__ */ new Map();
  for (const photo of firstPhotos) {
    const existing = firstPhotoMap.get(photo.story_id);
    if (existing === void 0 || photo.order < existing.order) {
      firstPhotoMap.set(photo.story_id, { id: photo.id, order: photo.order });
    }
  }
  const result = rows.map((r) => ({
    ...r,
    first_photo_id: firstPhotoMap.get(r.id)?.id ?? null,
    user_role: r.user_role
  }));
  result.sort((a, b) => {
    const roleOrder = (role) => role === "parceiro" ? 0 : 1;
    const diff = roleOrder(a.user_role) - roleOrder(b.user_role);
    if (diff !== 0)
      return diff;
    return b.created_at.getTime() - a.created_at.getTime();
  });
  return result;
}
async function getStoryPhotos(storyId) {
  return db.select().from(storyPhotos).where(eq(storyPhotos.story_id, storyId)).orderBy(storyPhotos.order);
}
async function getStoryPhotoById(photoId) {
  const [photo] = await db.select().from(storyPhotos).where(eq(storyPhotos.id, photoId)).limit(1);
  return photo ?? null;
}
async function getStoryById(storyId) {
  const [story] = await db.select().from(partnerStories).where(eq(partnerStories.id, storyId)).limit(1);
  return story ?? null;
}
async function createBackofficeUser(data) {
  const [user] = await db.insert(backofficeUsers).values({
    name: data.name,
    email: data.email.toLowerCase(),
    role: data.role,
    status: "pendente",
    invite_token: data.inviteToken,
    invite_token_expires_at: data.inviteTokenExpiresAt,
    created_by: data.createdBy
  }).returning();
  return user;
}
async function findBackofficeUserByEmail(email) {
  const user = await db.query.backofficeUsers.findFirst({
    where: eq(backofficeUsers.email, email.toLowerCase())
  });
  return user ?? null;
}
async function findBackofficeUserById(id) {
  const user = await db.query.backofficeUsers.findFirst({
    where: eq(backofficeUsers.id, id)
  });
  return user ?? null;
}
async function findBackofficeUserByInviteToken(token) {
  const user = await db.query.backofficeUsers.findFirst({
    where: eq(backofficeUsers.invite_token, token)
  });
  return user ?? null;
}
async function activateBackofficeUser(id, passwordHash) {
  const [user] = await db.update(backofficeUsers).set({
    password_hash: passwordHash,
    status: "ativo",
    invite_token: null,
    invite_token_expires_at: null
  }).where(eq(backofficeUsers.id, id)).returning();
  return user;
}
async function listBackofficeUsers() {
  return db.query.backofficeUsers.findMany({
    orderBy: [desc(backofficeUsers.created_at)]
  });
}
async function updateBackofficeUserRole(id, role) {
  const [updated] = await db.update(backofficeUsers).set({ role }).where(eq(backofficeUsers.id, id)).returning();
  return updated ?? null;
}
async function updateBackofficeUserStatus(id, status) {
  const [updated] = await db.update(backofficeUsers).set({ status }).where(eq(backofficeUsers.id, id)).returning();
  return updated ?? null;
}
async function listFilters() {
  return db.query.appFilters.findMany({
    orderBy: (t, { desc: desc3 }) => [desc3(t.updated_at)]
  });
}
async function getActiveFilters() {
  return db.query.appFilters.findMany({
    where: eq(appFilters.active, true),
    orderBy: (t, { asc: asc2 }) => [asc2(t.name)]
  });
}
async function createFilter(data) {
  const payload = {
    ...data,
    starts_at: data.starts_at ? new Date(data.starts_at) : null,
    ends_at: data.ends_at ? new Date(data.ends_at) : null
  };
  const [filter] = await db.insert(appFilters).values(payload).returning();
  return filter;
}
async function updateFilter(id, data) {
  const { starts_at, ends_at, ...rest } = data;
  const payload = {
    ...rest,
    ...starts_at !== void 0 ? { starts_at: starts_at ? new Date(starts_at) : null } : {},
    ...ends_at !== void 0 ? { ends_at: ends_at ? new Date(ends_at) : null } : {},
    updated_at: /* @__PURE__ */ new Date()
  };
  const [updated] = await db.update(appFilters).set(payload).where(eq(appFilters.id, id)).returning();
  return updated ?? null;
}
async function toggleFilter(id) {
  const filter = await db.query.appFilters.findFirst({
    where: eq(appFilters.id, id)
  });
  if (!filter)
    return null;
  const [updated] = await db.update(appFilters).set({ active: !filter.active, updated_at: /* @__PURE__ */ new Date() }).where(eq(appFilters.id, id)).returning();
  return updated ?? null;
}
async function updateBackofficeUserLastActive(id) {
  await db.update(backofficeUsers).set({ last_active_at: /* @__PURE__ */ new Date() }).where(eq(backofficeUsers.id, id));
}
async function createAuditLog(data) {
  await db.insert(auditLog).values({
    user_id: data.userId,
    user_email: data.userEmail,
    user_role: data.userRole,
    action: data.action,
    module: data.module,
    target_id: data.targetId ?? null,
    payload_before: data.payloadBefore ?? null,
    payload_after: data.payloadAfter ?? null,
    ip: data.ip ?? null
  });
}
async function listAuditLogs(opts) {
  const { limit = 50, offset = 0, userId, userEmail, module: mod, dateFrom, dateTo } = opts;
  const conditions = [];
  if (userId)
    conditions.push(eq(auditLog.user_id, userId));
  if (userEmail)
    conditions.push(like(auditLog.user_email, `%${userEmail}%`));
  if (mod)
    conditions.push(eq(auditLog.module, mod));
  if (dateFrom)
    conditions.push(gte(auditLog.created_at, dateFrom));
  if (dateTo)
    conditions.push(lte(auditLog.created_at, dateTo));
  const where = conditions.length > 0 ? and(...conditions) : void 0;
  const [entries, countResult] = await Promise.all([
    db.query.auditLog.findMany({
      where,
      orderBy: [desc(auditLog.created_at)],
      limit,
      offset
    }),
    db.select({ count: sql`count(*)::int` }).from(auditLog).where(where)
  ]);
  return { entries, total: countResult[0]?.count ?? 0 };
}
async function archiveExpiredFilters() {
  const now = /* @__PURE__ */ new Date();
  const result = await db.update(appFilters).set({ active: false, updated_at: /* @__PURE__ */ new Date() }).where(
    and(
      eq(appFilters.seasonal, true),
      eq(appFilters.active, true),
      lt(appFilters.ends_at, now)
    )
  ).returning();
  return result.length;
}
async function createFeedback(data) {
  const [row] = await db.insert(communityFeedback).values({
    type: data.type,
    content: data.content,
    place_id: data.place_id ?? null,
    place_name: data.place_name ?? null,
    user_id: data.user_id ?? null
  }).returning();
  return row;
}
async function listFeedback(opts) {
  const conditions = [];
  if (opts?.type)
    conditions.push(eq(communityFeedback.type, opts.type));
  if (opts?.status)
    conditions.push(eq(communityFeedback.status, opts.status));
  const rows = await db.select({
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
    user_email: users.email
  }).from(communityFeedback).leftJoin(users, eq(communityFeedback.user_id, users.id)).where(conditions.length > 0 ? and(...conditions) : void 0).orderBy(desc(communityFeedback.created_at)).limit(opts?.limit ?? 100).offset(opts?.offset ?? 0);
  return rows;
}
async function countUnreadFeedback() {
  const [row] = await db.select({ count: sql`count(*)` }).from(communityFeedback).where(eq(communityFeedback.status, "pendente"));
  return Number(row?.count ?? 0);
}
async function resolveFeedback(id, resolvedById) {
  const [updated] = await db.update(communityFeedback).set({ status: "resolvido", resolved_at: /* @__PURE__ */ new Date(), resolved_by: resolvedById }).where(eq(communityFeedback.id, id)).returning();
  return updated ?? null;
}
async function rejectFeedback(id, resolvedById) {
  const [updated] = await db.update(communityFeedback).set({ status: "rejeitado", resolved_at: /* @__PURE__ */ new Date(), resolved_by: resolvedById }).where(eq(communityFeedback.id, id)).returning();
  return updated ?? null;
}
async function addFeedbackToQueue(id, resolvedById) {
  const feedback = await db.query.communityFeedback.findFirst({
    where: eq(communityFeedback.id, id)
  });
  if (!feedback)
    return null;
  const [updated] = await db.update(communityFeedback).set({ status: "resolvido", resolved_at: /* @__PURE__ */ new Date(), resolved_by: resolvedById }).where(eq(communityFeedback.id, id)).returning();
  const placeId = feedback.place_id ?? `feedback_${id}`;
  if (feedback.place_id) {
    await db.insert(placesKidspot).values({
      place_id: feedback.place_id,
      city: "Pendente",
      lat: "0",
      lng: "0",
      tags: { status: "pendente", source: "feedback", feedback_id: id }
    }).onConflictDoNothing();
  }
  return { feedback: updated, place_id: placeId };
}
async function listCities(search) {
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    return db.select().from(cities).where(ilike(cities.nome, term)).orderBy(desc(cities.criado_em));
  }
  return db.select().from(cities).orderBy(desc(cities.criado_em));
}
async function listActiveCities(search) {
  const conditions = [eq(cities.ativa, true)];
  if (search && search.trim()) {
    conditions.push(ilike(cities.nome, `%${search.trim()}%`));
  }
  return db.select({ id: cities.id, nome: cities.nome, estado: cities.estado, latitude: cities.latitude, longitude: cities.longitude }).from(cities).where(and(...conditions)).orderBy(asc(cities.nome));
}
async function getCityById(id) {
  const [city] = await db.select().from(cities).where(eq(cities.id, id)).limit(1);
  return city ?? null;
}
async function createCity(data) {
  const [city] = await db.insert(cities).values({
    nome: data.nome,
    estado: data.estado,
    latitude: String(data.latitude),
    longitude: String(data.longitude),
    raio_km: data.raio_km,
    frequencia: data.frequencia,
    parametros_prompt: data.parametros_prompt ?? null,
    ativa: data.ativa ?? true
  }).returning();
  return city;
}
async function updateCity(id, data) {
  const updates = {};
  if (data.nome !== void 0)
    updates.nome = data.nome;
  if (data.estado !== void 0)
    updates.estado = data.estado;
  if (data.latitude !== void 0)
    updates.latitude = String(data.latitude);
  if (data.longitude !== void 0)
    updates.longitude = String(data.longitude);
  if (data.raio_km !== void 0)
    updates.raio_km = data.raio_km;
  if (data.frequencia !== void 0)
    updates.frequencia = data.frequencia;
  if (data.parametros_prompt !== void 0)
    updates.parametros_prompt = data.parametros_prompt;
  if (data.ativa !== void 0)
    updates.ativa = data.ativa;
  if (Object.keys(updates).length === 0)
    return getCityById(id);
  const [city] = await db.update(cities).set(updates).where(eq(cities.id, id)).returning();
  return city ?? null;
}
async function toggleCityActive(id) {
  const city = await getCityById(id);
  if (!city)
    return null;
  const [updated] = await db.update(cities).set({ ativa: !city.ativa }).where(eq(cities.id, id)).returning();
  return updated ?? null;
}
async function deleteCity(id) {
  const result = await db.delete(cities).where(eq(cities.id, id)).returning();
  return result.length > 0;
}
async function listCurationQueue(opts) {
  const { status = "pendente", city, category, minKidScore, maxKidScore, placeType, limit = 20, offset = 0 } = opts;
  const conditions = [eq(placeKidspotMeta.curation_status, status)];
  if (city)
    conditions.push(ilike(placesKidspot.city, `%${city}%`));
  if (category)
    conditions.push(ilike(placeKidspotMeta.category, `%${category}%`));
  if (minKidScore != null)
    conditions.push(gte(placeKidspotMeta.kid_score, minKidScore));
  if (maxKidScore != null)
    conditions.push(lte(placeKidspotMeta.kid_score, maxKidScore));
  if (placeType)
    conditions.push(eq(placeKidspotMeta.place_type, placeType));
  const where = and(...conditions);
  const [rows, countResult] = await Promise.all([
    db.select({
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
      place_type: placeKidspotMeta.place_type,
      city: placesKidspot.city
    }).from(placeKidspotMeta).innerJoin(placesKidspot, eq(placeKidspotMeta.place_id, placesKidspot.place_id)).where(where).orderBy(desc(placeKidspotMeta.ingested_at)).limit(limit).offset(offset),
    db.select({ count: sql`count(*)::int` }).from(placeKidspotMeta).innerJoin(placesKidspot, eq(placeKidspotMeta.place_id, placesKidspot.place_id)).where(where)
  ]);
  if (rows.length === 0)
    return { items: [], total: countResult[0]?.count ?? 0 };
  const placeIds = rows.map((r) => r.place_id);
  const photos = await db.select().from(placePhotos).where(and(inArray(placePhotos.place_id, placeIds), eq(placePhotos.deleted, false))).orderBy(asc(placePhotos.order));
  const photosByPlace = /* @__PURE__ */ new Map();
  for (const p of photos) {
    if (!photosByPlace.has(p.place_id))
      photosByPlace.set(p.place_id, []);
    photosByPlace.get(p.place_id).push(p);
  }
  return {
    items: rows.map((r) => ({ ...r, photos: photosByPlace.get(r.place_id) ?? [] })),
    total: countResult[0]?.count ?? 0
  };
}
async function countPendingCuration() {
  const [row] = await db.select({ count: sql`count(*)::int` }).from(placeKidspotMeta).where(eq(placeKidspotMeta.curation_status, "pendente"));
  return row?.count ?? 0;
}
async function upsertPlaceMeta(data) {
  if (data.city) {
    await db.insert(placesKidspot).values({
      place_id: data.place_id,
      city: data.city,
      lat: "0",
      lng: "0"
    }).onConflictDoNothing();
  }
  await db.insert(placeKidspotMeta).values({
    place_id: data.place_id,
    name: data.name ?? null,
    address: data.address ?? null,
    category: data.category ?? null,
    kid_score: data.kid_score ?? null,
    ai_evidences: data.ai_evidences ?? null,
    description: data.description ?? null,
    curation_status: "pendente",
    ingested_at: /* @__PURE__ */ new Date(),
    updated_at: /* @__PURE__ */ new Date()
  }).onConflictDoUpdate({
    target: placeKidspotMeta.place_id,
    set: {
      name: data.name ?? null,
      address: data.address ?? null,
      category: data.category ?? null,
      kid_score: data.kid_score ?? null,
      ai_evidences: data.ai_evidences ?? null,
      description: data.description ?? null,
      updated_at: /* @__PURE__ */ new Date()
    }
  });
}
async function upsertPlaceWithCity(data) {
  await db.insert(placesKidspot).values({
    place_id: data.place_id,
    city: data.city,
    ciudad_id: data.ciudad_id,
    lat: String(data.lat),
    lng: String(data.lng)
  }).onConflictDoUpdate({
    target: placesKidspot.place_id,
    set: {
      ciudad_id: data.ciudad_id,
      lat: String(data.lat),
      lng: String(data.lng)
    }
  });
}
async function approveCurationItem(placeId, curatedBy, edits) {
  const set = {
    curation_status: "aprovado",
    curated_by: curatedBy,
    curated_at: /* @__PURE__ */ new Date(),
    updated_at: /* @__PURE__ */ new Date()
  };
  if (edits?.name !== void 0)
    set.name = edits.name;
  if (edits?.description !== void 0)
    set.description = edits.description;
  if (edits?.custom_criteria !== void 0)
    set.custom_criteria = edits.custom_criteria;
  if (edits?.place_type !== void 0)
    set.place_type = edits.place_type;
  await db.update(placeKidspotMeta).set(set).where(eq(placeKidspotMeta.place_id, placeId));
}
async function rejectCurationItem(placeId, curatedBy) {
  await db.update(placeKidspotMeta).set({
    curation_status: "rejeitado",
    curated_by: curatedBy,
    curated_at: /* @__PURE__ */ new Date(),
    updated_at: /* @__PURE__ */ new Date()
  }).where(eq(placeKidspotMeta.place_id, placeId));
}
async function listPlacePhotos(placeId) {
  return db.select().from(placePhotos).where(and(eq(placePhotos.place_id, placeId), eq(placePhotos.deleted, false))).orderBy(asc(placePhotos.order));
}
async function addPlacePhoto(data) {
  const [photo] = await db.insert(placePhotos).values({
    place_id: data.place_id,
    url: data.url,
    photo_reference: data.photo_reference ?? null,
    order: data.order ?? 0,
    is_cover: false,
    deleted: false
  }).returning();
  return photo;
}
async function setCoverPhoto(placeId, photoId) {
  await db.transaction(async (tx) => {
    await tx.update(placePhotos).set({ is_cover: false }).where(eq(placePhotos.place_id, placeId));
    await tx.update(placePhotos).set({ is_cover: true }).where(and(eq(placePhotos.id, photoId), eq(placePhotos.place_id, placeId)));
  });
}
async function deletePlacePhoto(photoId) {
  await db.update(placePhotos).set({ deleted: true, is_cover: false }).where(eq(placePhotos.id, photoId));
}
async function listSponsorshipPlans() {
  return db.select().from(sponsorshipPlans).orderBy(desc(sponsorshipPlans.priority));
}
async function createSponsorshipPlan(data) {
  const [plan] = await db.insert(sponsorshipPlans).values({
    name: data.name,
    priority: data.priority,
    reference_price: String(data.reference_price),
    benefits: data.benefits ?? null
  }).returning();
  return plan;
}
async function updateSponsorshipPlan(id, data) {
  const updates = { updated_at: /* @__PURE__ */ new Date() };
  if (data.name !== void 0)
    updates.name = data.name;
  if (data.priority !== void 0)
    updates.priority = data.priority;
  if (data.reference_price !== void 0)
    updates.reference_price = String(data.reference_price);
  if (data.benefits !== void 0)
    updates.benefits = data.benefits;
  const [updated] = await db.update(sponsorshipPlans).set(updates).where(eq(sponsorshipPlans.id, id)).returning();
  return updated ?? null;
}
async function deleteSponsorshipPlan(id) {
  const result = await db.delete(sponsorshipPlans).where(eq(sponsorshipPlans.id, id)).returning();
  return result.length > 0;
}
async function listSponsorshipContracts(opts) {
  const conditions = [];
  if (opts?.status)
    conditions.push(eq(sponsorshipContracts.status, opts.status));
  if (opts?.place_id)
    conditions.push(eq(sponsorshipContracts.place_id, opts.place_id));
  const rows = await db.select({
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
    plan_priority: sponsorshipPlans.priority
  }).from(sponsorshipContracts).innerJoin(sponsorshipPlans, eq(sponsorshipContracts.plan_id, sponsorshipPlans.id)).where(conditions.length > 0 ? and(...conditions) : void 0).orderBy(desc(sponsorshipContracts.created_at));
  return rows;
}
async function getSponsorshipContractById(id) {
  const [row] = await db.select({
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
    plan_priority: sponsorshipPlans.priority
  }).from(sponsorshipContracts).innerJoin(sponsorshipPlans, eq(sponsorshipContracts.plan_id, sponsorshipPlans.id)).where(eq(sponsorshipContracts.id, id)).limit(1);
  return row ?? null;
}
async function createSponsorshipContract(data) {
  const [contract] = await db.insert(sponsorshipContracts).values({
    place_id: data.place_id,
    place_name: data.place_name,
    plan_id: data.plan_id,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
    notes: data.notes ?? null
  }).returning();
  return contract;
}
async function updateSponsorshipContract(id, data) {
  const updates = { updated_at: /* @__PURE__ */ new Date() };
  if (data.plan_id !== void 0)
    updates.plan_id = data.plan_id;
  if (data.starts_at !== void 0)
    updates.starts_at = data.starts_at;
  if (data.ends_at !== void 0)
    updates.ends_at = data.ends_at;
  if (data.status !== void 0)
    updates.status = data.status;
  if (data.notes !== void 0)
    updates.notes = data.notes;
  const [updated] = await db.update(sponsorshipContracts).set(updates).where(eq(sponsorshipContracts.id, id)).returning();
  return updated ?? null;
}
async function expireStaleContracts() {
  const now = /* @__PURE__ */ new Date();
  const result = await db.update(sponsorshipContracts).set({ status: "expirado", updated_at: now }).where(
    and(
      eq(sponsorshipContracts.status, "ativo"),
      lt(sponsorshipContracts.ends_at, now)
    )
  ).returning();
  return result.length;
}
async function getActiveSponsoredPlaceIds() {
  const now = /* @__PURE__ */ new Date();
  const rows = await db.select({
    place_id: sponsorshipContracts.place_id,
    priority: sponsorshipPlans.priority
  }).from(sponsorshipContracts).innerJoin(sponsorshipPlans, eq(sponsorshipContracts.plan_id, sponsorshipPlans.id)).where(
    and(
      eq(sponsorshipContracts.status, "ativo"),
      lte(sponsorshipContracts.starts_at, now),
      gt(sponsorshipContracts.ends_at, now)
    )
  );
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const existing = map.get(row.place_id);
    if (existing === void 0 || row.priority > existing) {
      map.set(row.place_id, row.priority);
    }
  }
  return map;
}
async function incrementImpressions(placeIds) {
  if (placeIds.length === 0)
    return;
  await db.update(placesKidspot).set({ impression_count: sql`${placesKidspot.impression_count} + 1` }).where(inArray(placesKidspot.place_id, placeIds));
}
async function incrementDetailAccess(placeId) {
  await db.update(placesKidspot).set({ detail_access_count: sql`${placesKidspot.detail_access_count} + 1` }).where(eq(placesKidspot.place_id, placeId));
}
async function getSponsorshipPerformance(contractId) {
  const contract = await getSponsorshipContractById(contractId);
  if (!contract)
    return null;
  const [stats] = await db.select({
    impression_count: placesKidspot.impression_count,
    detail_access_count: placesKidspot.detail_access_count
  }).from(placesKidspot).where(eq(placesKidspot.place_id, contract.place_id)).limit(1);
  return {
    impressions: stats?.impression_count ?? 0,
    detail_accesses: stats?.detail_access_count ?? 0,
    avg_position: null
  };
}
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
async function checkCityByCoords(lat, lng) {
  const allCities = await db.select().from(cities);
  if (allCities.length === 0)
    return null;
  let nearest = null;
  let nearestDist = Infinity;
  for (const city of allCities) {
    const dist = haversineKm(lat, lng, parseFloat(city.latitude), parseFloat(city.longitude));
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = city;
    }
  }
  if (!nearest)
    return null;
  return { city: nearest, enabled: nearest.ativa && nearestDist <= nearest.raio_km, distance_km: nearestDist };
}
async function getPublishedPlacesByCity(cityId, placeType) {
  const conditions = [
    eq(placeKidspotMeta.curation_status, "aprovado"),
    eq(placesKidspot.ciudad_id, cityId)
  ];
  if (placeType)
    conditions.push(eq(placeKidspotMeta.place_type, placeType));
  const rows = await db.select({
    place_id: placeKidspotMeta.place_id,
    name: placeKidspotMeta.name,
    address: placeKidspotMeta.address,
    category: placeKidspotMeta.category,
    kid_score: placeKidspotMeta.kid_score,
    display_order: placeKidspotMeta.display_order,
    ai_evidences: placeKidspotMeta.ai_evidences,
    lat: placesKidspot.lat,
    lng: placesKidspot.lng
  }).from(placeKidspotMeta).innerJoin(placesKidspot, eq(placeKidspotMeta.place_id, placesKidspot.place_id)).where(and(...conditions)).orderBy(asc(placeKidspotMeta.display_order), asc(placeKidspotMeta.ingested_at));
  if (rows.length === 0)
    return [];
  const placeIds = rows.map((r) => r.place_id);
  const [allPhotos, sponsoredMap] = await Promise.all([
    db.select({ place_id: placePhotos.place_id, url: placePhotos.url, is_cover: placePhotos.is_cover }).from(placePhotos).where(
      and(
        inArray(placePhotos.place_id, placeIds),
        eq(placePhotos.deleted, false)
      )
    ).orderBy(desc(placePhotos.is_cover), asc(placePhotos.order)),
    getActiveSponsoredPlaceIds()
  ]);
  const coverByPlace = /* @__PURE__ */ new Map();
  for (const p of allPhotos) {
    if (!coverByPlace.has(p.place_id))
      coverByPlace.set(p.place_id, p.url);
  }
  return rows.map((r) => {
    const evidences = Array.isArray(r.ai_evidences) ? r.ai_evidences : [];
    return {
      place_id: r.place_id,
      name: r.name,
      address: r.address,
      category: r.category,
      kid_score: r.kid_score,
      display_order: r.display_order,
      cover_photo_url: coverByPlace.get(r.place_id) ?? null,
      is_sponsored: sponsoredMap.has(r.place_id),
      family_highlight: evidences[0] ?? null,
      lat: r.lat,
      lng: r.lng
    };
  });
}
async function updatePlaceDisplayOrder(placeId, order) {
  await db.update(placeKidspotMeta).set({ display_order: order, updated_at: /* @__PURE__ */ new Date() }).where(eq(placeKidspotMeta.place_id, placeId));
}
async function removeFromPublished(placeId) {
  await db.update(placeKidspotMeta).set({ curation_status: "pendente", curated_by: null, curated_at: null, display_order: 0, updated_at: /* @__PURE__ */ new Date() }).where(eq(placeKidspotMeta.place_id, placeId));
}
async function addToPublished(placeId, cityId, curatedBy) {
  const [maxRow] = await db.select({ max: sql`coalesce(max(${placeKidspotMeta.display_order}), 0)` }).from(placeKidspotMeta).innerJoin(placesKidspot, eq(placeKidspotMeta.place_id, placesKidspot.place_id)).where(
    and(
      eq(placeKidspotMeta.curation_status, "aprovado"),
      eq(placesKidspot.ciudad_id, cityId)
    )
  );
  const nextOrder = (maxRow?.max ?? 0) + 1;
  await db.update(placeKidspotMeta).set({
    curation_status: "aprovado",
    curated_by: curatedBy,
    curated_at: /* @__PURE__ */ new Date(),
    display_order: nextOrder,
    updated_at: /* @__PURE__ */ new Date()
  }).where(eq(placeKidspotMeta.place_id, placeId));
}
async function getPublishedPlacesByCityAdmin(cityId) {
  const rows = await db.select({
    place_id: placeKidspotMeta.place_id,
    name: placeKidspotMeta.name,
    address: placeKidspotMeta.address,
    category: placeKidspotMeta.category,
    kid_score: placeKidspotMeta.kid_score,
    display_order: placeKidspotMeta.display_order,
    ai_evidences: placeKidspotMeta.ai_evidences,
    curated_at: placeKidspotMeta.curated_at,
    lat: placesKidspot.lat,
    lng: placesKidspot.lng
  }).from(placeKidspotMeta).innerJoin(placesKidspot, eq(placeKidspotMeta.place_id, placesKidspot.place_id)).where(
    and(
      eq(placeKidspotMeta.curation_status, "aprovado"),
      eq(placesKidspot.ciudad_id, cityId)
    )
  ).orderBy(asc(placeKidspotMeta.display_order), asc(placeKidspotMeta.ingested_at));
  if (rows.length === 0)
    return [];
  const placeIds = rows.map((r) => r.place_id);
  const [allPhotos, sponsoredMap] = await Promise.all([
    db.select({ place_id: placePhotos.place_id, url: placePhotos.url, is_cover: placePhotos.is_cover }).from(placePhotos).where(
      and(
        inArray(placePhotos.place_id, placeIds),
        eq(placePhotos.deleted, false)
      )
    ).orderBy(desc(placePhotos.is_cover), asc(placePhotos.order)),
    getActiveSponsoredPlaceIds()
  ]);
  const coverByPlace = /* @__PURE__ */ new Map();
  for (const p of allPhotos) {
    if (!coverByPlace.has(p.place_id))
      coverByPlace.set(p.place_id, p.url);
  }
  return rows.map((r) => {
    const evidences = Array.isArray(r.ai_evidences) ? r.ai_evidences : [];
    return {
      place_id: r.place_id,
      name: r.name,
      address: r.address,
      category: r.category,
      kid_score: r.kid_score,
      display_order: r.display_order,
      cover_photo_url: coverByPlace.get(r.place_id) ?? null,
      is_sponsored: sponsoredMap.has(r.place_id),
      family_highlight: evidences[0] ?? null,
      lat: r.lat,
      lng: r.lng,
      curated_at: r.curated_at
    };
  });
}
async function searchPlacesForPublishing(cityId, q) {
  return db.select({
    place_id: placeKidspotMeta.place_id,
    name: placeKidspotMeta.name,
    address: placeKidspotMeta.address,
    category: placeKidspotMeta.category,
    kid_score: placeKidspotMeta.kid_score
  }).from(placeKidspotMeta).innerJoin(placesKidspot, eq(placeKidspotMeta.place_id, placesKidspot.place_id)).where(
    and(
      eq(placesKidspot.ciudad_id, cityId),
      sql`${placeKidspotMeta.curation_status} != 'aprovado'`,
      q.trim() ? or(
        ilike(placeKidspotMeta.name, `%${q.trim()}%`),
        ilike(placeKidspotMeta.address, `%${q.trim()}%`)
      ) : void 0
    )
  ).orderBy(desc(placeKidspotMeta.kid_score)).limit(20);
}
function extractEstado(label) {
  const parts = label.split(",").map((s) => s.trim());
  if (parts.length >= 2)
    return parts[parts.length - 2] || null;
  return null;
}
async function recordCityDemand(cidadeLabel, latitude, longitude, estadoOverride) {
  const estado = estadoOverride !== void 0 ? estadoOverride : extractEstado(cidadeLabel);
  await db.insert(cityDemand).values({
    cidade_label: cidadeLabel,
    estado,
    latitude: String(latitude),
    longitude: String(longitude),
    count: 1,
    last_searched_at: /* @__PURE__ */ new Date()
  }).onConflictDoUpdate({
    target: cityDemand.cidade_label,
    set: {
      count: sql`${cityDemand.count} + 1`,
      last_searched_at: /* @__PURE__ */ new Date()
    }
  });
}
async function listCityDemand(estado) {
  return db.select().from(cityDemand).where(estado ? eq(cityDemand.estado, estado) : void 0).orderBy(desc(cityDemand.count), desc(cityDemand.last_searched_at));
}
async function deleteCityDemand(id) {
  await db.delete(cityDemand).where(eq(cityDemand.id, id));
}

// server/foursquare.ts
import { enrichmentCache } from "@shared/schema";
import { eq as eq2, and as and2 } from "drizzle-orm";
var FOURSQUARE_API_KEY = process.env.FOURSQUARE_API_KEY;
var FSQ_BASE = "https://api.foursquare.com/v3/places";
var FETCH_TIMEOUT_MS = 5e3;
var CACHE_TTL_DAYS = 7;
if (!FOURSQUARE_API_KEY) {
  console.warn("FOURSQUARE_API_KEY is not set \u2014 Foursquare enrichment will be skipped");
}
async function fetchWithTimeout(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: FOURSQUARE_API_KEY,
        Accept: "application/json"
      }
    });
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`Foursquare fetch timed out: ${label}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
function normalise2(str) {
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim();
}
function nameSimilarity(a, b) {
  const na = normalise2(a);
  const nb = normalise2(b);
  if (na === nb)
    return 1;
  if (na.includes(nb) || nb.includes(na))
    return 0.8;
  const wordsA = new Set(na.split(/\s+/));
  const wordsB = new Set(nb.split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  const union = /* @__PURE__ */ new Set([...wordsA, ...wordsB]);
  return intersection.length / union.size;
}
async function getCachedEnrichment(placeId) {
  try {
    const cached = await db.query.enrichmentCache.findFirst({
      where: and2(
        eq2(enrichmentCache.place_id, placeId),
        eq2(enrichmentCache.source, "foursquare")
      )
    });
    if (cached && new Date(cached.expires_at) > /* @__PURE__ */ new Date()) {
      const data = cached.data;
      if (data.fsq_id === "")
        return { hit: true, data: null };
      return { hit: true, data };
    }
    return { hit: false, data: null };
  } catch {
    return { hit: false, data: null };
  }
}
async function setCachedEnrichment(placeId, data) {
  const expiresAt = /* @__PURE__ */ new Date();
  expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);
  try {
    await db.insert(enrichmentCache).values({
      place_id: placeId,
      source: "foursquare",
      data,
      expires_at: expiresAt
    }).onConflictDoUpdate({
      target: [enrichmentCache.place_id, enrichmentCache.source],
      set: { data, expires_at: expiresAt }
    });
  } catch (err) {
    console.warn("Failed to cache Foursquare enrichment:", err);
  }
}
async function searchFoursquareNearby(lat, lng, query, radius = 1e3) {
  if (!FOURSQUARE_API_KEY)
    return [];
  const params = new URLSearchParams({
    ll: `${lat},${lng}`,
    query,
    radius: String(radius),
    limit: "5",
    fields: "fsq_id,name,rating,popularity,categories,stats"
  });
  let res;
  try {
    res = await fetchWithTimeout(`${FSQ_BASE}/search?${params.toString()}`, "searchFoursquareNearby");
  } catch {
    return [];
  }
  if (!res.ok)
    return [];
  const data = await res.json();
  return (data.results ?? []).map((r) => ({
    fsq_id: r.fsq_id,
    name: r.name,
    rating: r.rating,
    popularity: r.popularity ?? 0,
    categories: (r.categories ?? []).map((c) => c.name),
    stats_total_photos: r.stats?.total_photos ?? 0,
    stats_total_tips: r.stats?.total_tips ?? 0,
    stats_total_ratings: r.stats?.total_ratings ?? 0
  }));
}
async function fetchAndCacheFoursquare(placeName, lat, lng, placeId) {
  if (!FOURSQUARE_API_KEY)
    return null;
  const results = await searchFoursquareNearby(lat, lng, placeName, 500);
  if (results.length === 0)
    return null;
  let bestMatch = null;
  let bestScore = 0;
  for (const r of results) {
    const sim = nameSimilarity(placeName, r.name);
    if (sim > bestScore && sim >= 0.4) {
      bestScore = sim;
      bestMatch = r;
    }
  }
  if (bestMatch) {
    await setCachedEnrichment(placeId, bestMatch);
  } else {
    await setCachedEnrichment(placeId, { fsq_id: "", name: "", rating: void 0, popularity: 0, categories: [], stats_total_photos: 0, stats_total_tips: 0, stats_total_ratings: 0 });
  }
  return bestMatch;
}
async function matchFoursquarePlace(placeName, lat, lng, placeId) {
  const cached = await getCachedEnrichment(placeId);
  if (cached.hit)
    return cached.data;
  fetchAndCacheFoursquare(placeName, lat, lng, placeId).catch(
    (err) => console.error(`[Foursquare] background enrichment failed for ${placeId}:`, err)
  );
  return null;
}
function calculateFoursquareBonus(match) {
  if (!match)
    return 0;
  let bonus = 0;
  if (match.rating !== void 0) {
    if (match.rating >= 8)
      bonus += 5;
    else if (match.rating >= 7)
      bonus += 3;
    else if (match.rating >= 6)
      bonus += 2;
  }
  if (match.popularity >= 0.8)
    bonus += 3;
  else if (match.popularity >= 0.5)
    bonus += 2;
  const reviewCount = match.stats_total_ratings + match.stats_total_tips;
  if (reviewCount >= 100)
    bonus += 5;
  else if (reviewCount >= 50)
    bonus += 4;
  else if (reviewCount >= 20)
    bonus += 3;
  else if (reviewCount >= 5)
    bonus += 1;
  if (match.stats_total_photos >= 30)
    bonus += 2;
  else if (match.stats_total_photos >= 10)
    bonus += 1;
  return bonus;
}
function calculateCrossSourceBonus(googleRating, googleReviewCount, match) {
  if (!match)
    return 0;
  const gRating = googleRating ?? 0;
  const gCount = googleReviewCount ?? 0;
  const fRating = match.rating;
  const googleIsStrong = gRating >= 4.2 && gCount >= 20;
  const foursquareIsStrong = fRating !== void 0 && fRating >= 7 && match.stats_total_tips >= 5;
  if (googleIsStrong && foursquareIsStrong)
    return 10;
  const googleIsDecent = gRating >= 3.8 && gCount >= 10;
  const foursquareIsDecent = fRating !== void 0 && fRating >= 6 && match.popularity >= 0.3;
  if (googleIsDecent && foursquareIsDecent)
    return 5;
  return 0;
}

// server/ai-review-analysis.ts
import OpenAI from "openai";
import { enrichmentCache as enrichmentCache2, aiPrompts, aiProviders, pipelineRouting } from "@shared/schema";
import { eq as eq3, and as and3 } from "drizzle-orm";

// server/ai-crypto.ts
import crypto from "crypto";
var ALGORITHM = "aes-256-gcm";
var KEY_LEN = 32;
var IV_LEN = 12;
var TAG_LEN = 16;
function getDerivedKey() {
  const seed = process.env.AI_CRYPTO_SECRET || process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "kidspot-dev-fallback-secret-key";
  return crypto.scryptSync(seed, "kidspot-ai-salt-v1", KEY_LEN);
}
function encryptApiKey(plaintext) {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}
function decryptApiKey(ciphertext) {
  const key = getDerivedKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}
function maskApiKey(plaintext) {
  if (plaintext.length <= 8)
    return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
  const prefix = plaintext.slice(0, 6);
  return prefix + "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
}

// server/ai-review-analysis.ts
var CACHE_TTL_DAYS2 = 7;
var FALLBACK_SYSTEM_PROMPT = `Voc\xEA \xE9 um assistente especializado em avaliar se um estabelecimento \xE9 adequado para fam\xEDlias com crian\xE7as pequenas (0-10 anos).

Analise os textos de reviews fornecidos e identifique sinais de que o lugar \xE9 family-friendly.

Procure por men\xE7\xF5es a:
- Infraestrutura infantil: brinquedoteca, playground, \xE1rea kids, espa\xE7o kids, piscina infantil
- Equipamentos: trocador/frald\xE1rio, cadeir\xE3o/cadeirinha, banheiro fam\xEDlia
- Card\xE1pio infantil, por\xE7\xF5es kids, menu crian\xE7as
- Seguran\xE7a: ambiente seguro, cercado, monitorado
- Acessibilidade para carrinhos de beb\xEA
- Espa\xE7o amplo para crian\xE7as brincarem
- Atendimento receptivo a fam\xEDlias
- Filas r\xE1pidas ou atendimento priorit\xE1rio para fam\xEDlias
- Atividades ou eventos para crian\xE7as

Responda APENAS com um JSON v\xE1lido neste formato:
{
  "family_score": <n\xFAmero de 0 a 100>,
  "highlights": [<lista de at\xE9 3 destaques curtos em portugu\xEAs, ex: "Brinquedoteca monitorada", "Card\xE1pio kids">],
  "confidence": "<high|medium|low>"
}

- family_score: 0 = nenhuma evid\xEAncia familiar, 100 = excelente para fam\xEDlias
- Se n\xE3o houver nenhuma men\xE7\xE3o a crian\xE7as/fam\xEDlia, retorne score 0 e lista vazia
- confidence: high = m\xFAltiplas men\xE7\xF5es claras, medium = algumas men\xE7\xF5es, low = ind\xEDcios vagos`;
var cachedPrompt = null;
var promptCacheTime = 0;
var PROMPT_CACHE_TTL_MS = 6e4;
async function getActiveSystemPrompt() {
  const now = Date.now();
  if (cachedPrompt && now - promptCacheTime < PROMPT_CACHE_TTL_MS) {
    return cachedPrompt;
  }
  try {
    const active = await db.query.aiPrompts.findFirst({
      where: eq3(aiPrompts.is_active, true),
      orderBy: (t, { desc: desc3 }) => [desc3(t.updated_at)]
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
function invalidatePromptCache() {
  cachedPrompt = null;
  promptCacheTime = 0;
}
var routingCacheTime = 0;
var routingCache = null;
var ROUTING_CACHE_TTL_MS = 3e4;
async function getReviewAnalysisRouting() {
  const now = Date.now();
  if (routingCache && now - routingCacheTime < ROUTING_CACHE_TTL_MS) {
    return routingCache;
  }
  try {
    const routing = await db.query.pipelineRouting.findFirst({
      where: eq3(pipelineRouting.stage, "review_analysis")
    });
    if (!routing?.primary_provider) {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey)
        return null;
      const config = { primary: { provider: "openai", model: "gpt-4o-mini", apiKey: openaiKey }, fallbacks: [] };
      routingCache = config;
      routingCacheTime = now;
      return config;
    }
    const providerRows = await db.select().from(aiProviders);
    const providerMap = Object.fromEntries(providerRows.map((r) => [r.provider, r]));
    const primaryRow = providerMap[routing.primary_provider];
    let primaryConfig = null;
    if (primaryRow?.encrypted_key && primaryRow.is_active) {
      primaryConfig = {
        provider: routing.primary_provider,
        model: routing.model || "gpt-4o-mini",
        apiKey: decryptApiKey(primaryRow.encrypted_key)
      };
    } else if (routing.primary_provider === "openai" && process.env.OPENAI_API_KEY) {
      primaryConfig = { provider: "openai", model: routing.model || "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY };
    }
    if (!primaryConfig)
      return null;
    const fallbackOrder = routing.fallback_order || [];
    const fallbacks = [];
    for (const fbProvider of fallbackOrder) {
      if (fbProvider === routing.primary_provider)
        continue;
      const fbRow = providerMap[fbProvider];
      if (fbRow?.encrypted_key && fbRow.is_active) {
        fallbacks.push({ provider: fbProvider, model: "gpt-4o-mini", apiKey: decryptApiKey(fbRow.encrypted_key) });
      } else if (fbProvider === "openai" && process.env.OPENAI_API_KEY) {
        fallbacks.push({ provider: "openai", model: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY });
      }
    }
    const result = { primary: primaryConfig, fallbacks };
    routingCache = result;
    routingCacheTime = now;
    return result;
  } catch (err) {
    console.warn("[AI] failed to load routing config, falling back to env:", err);
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey)
      return null;
    return { primary: { provider: "openai", model: "gpt-4o-mini", apiKey: openaiKey }, fallbacks: [] };
  }
}
var NEGATIVE_SENTINEL = { family_score: -1, highlights: [], confidence: "low" };
async function getCachedAnalysis(placeId) {
  try {
    const cached = await db.query.enrichmentCache.findFirst({
      where: and3(
        eq3(enrichmentCache2.place_id, placeId),
        eq3(enrichmentCache2.source, "openai_review")
      )
    });
    if (cached && new Date(cached.expires_at) > /* @__PURE__ */ new Date()) {
      const data = cached.data;
      if (data.family_score === -1)
        return { hit: true, data: null };
      return { hit: true, data };
    }
    return { hit: false, data: null };
  } catch {
    return { hit: false, data: null };
  }
}
async function setCachedAnalysis(placeId, data) {
  const expiresAt = /* @__PURE__ */ new Date();
  expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS2);
  try {
    await db.insert(enrichmentCache2).values({
      place_id: placeId,
      source: "openai_review",
      data,
      expires_at: expiresAt
    }).onConflictDoUpdate({
      target: [enrichmentCache2.place_id, enrichmentCache2.source],
      set: { data, expires_at: expiresAt }
    });
  } catch (err) {
    console.warn("Failed to cache AI review analysis:", err);
  }
}
var activeRequests = 0;
var MAX_CONCURRENT_AI = 5;
var AI_REQUEST_TIMEOUT_MS = 1e4;
async function callOpenAI(config, systemPrompt, userContent) {
  const client = new OpenAI({ apiKey: config.apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" }
    }, { signal: controller.signal });
    clearTimeout(timer);
    const content = response.choices[0]?.message?.content;
    if (!content)
      return null;
    return JSON.parse(content);
  } finally {
    clearTimeout(timer);
  }
}
async function callAnthropic(config, systemPrompt, userContent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model || "claude-haiku-4-5",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }]
      })
    });
    clearTimeout(timer);
    if (!resp.ok)
      return null;
    const data = await resp.json();
    const text = data.content?.find((c) => c.type === "text")?.text;
    if (!text)
      return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match)
      return null;
    return JSON.parse(match[0]);
  } finally {
    clearTimeout(timer);
  }
}
async function callPerplexity(config, systemPrompt, userContent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model || "llama-3.1-sonar-small-128k-online",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        max_tokens: 300
      })
    });
    clearTimeout(timer);
    if (!resp.ok)
      return null;
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text)
      return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match)
      return null;
    return JSON.parse(match[0]);
  } finally {
    clearTimeout(timer);
  }
}
async function callGoogle(config, systemPrompt, userContent) {
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
          generationConfig: { maxOutputTokens: 300, temperature: 0.1 }
        })
      }
    );
    clearTimeout(timer);
    if (!resp.ok)
      return null;
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text)
      return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match)
      return null;
    return JSON.parse(match[0]);
  } finally {
    clearTimeout(timer);
  }
}
async function callProvider(config, systemPrompt, userContent) {
  switch (config.provider) {
    case "openai":
      return callOpenAI(config, systemPrompt, userContent);
    case "anthropic":
      return callAnthropic(config, systemPrompt, userContent);
    case "perplexity":
      return callPerplexity(config, systemPrompt, userContent);
    case "google":
      return callGoogle(config, systemPrompt, userContent);
    default:
      return null;
  }
}
function validateAnalysis(parsed) {
  return typeof parsed.family_score === "number" && Array.isArray(parsed.highlights) && ["high", "medium", "low"].includes(parsed.confidence);
}
async function fetchAndCacheAIAnalysis(placeId, placeName, reviewTexts) {
  if (activeRequests >= MAX_CONCURRENT_AI)
    return null;
  const routing = await getReviewAnalysisRouting();
  if (!routing)
    return null;
  const systemPrompt = await getActiveSystemPrompt();
  const combinedReviews = reviewTexts.slice(0, 5).map((r, i) => `Review ${i + 1}: ${r}`).join("\n\n");
  const userContent = `Estabelecimento: "${placeName}"

Reviews:
${combinedReviews}`;
  activeRequests++;
  try {
    const configs = [routing.primary, ...routing.fallbacks];
    for (const config of configs) {
      try {
        const result = await callProvider(config, systemPrompt, userContent);
        if (result && validateAnalysis(result)) {
          result.family_score = Math.max(0, Math.min(100, Math.round(result.family_score)));
          result.highlights = result.highlights.slice(0, 3);
          await setCachedAnalysis(placeId, result);
          return result;
        }
      } catch (err) {
        console.warn(`[AI] provider ${config.provider} failed for ${placeName}, trying fallback:`, err);
      }
    }
    await setCachedAnalysis(placeId, NEGATIVE_SENTINEL);
    return null;
  } catch (err) {
    console.warn("AI review analysis failed for", placeName, ":", err);
    await setCachedAnalysis(placeId, NEGATIVE_SENTINEL);
    return null;
  } finally {
    activeRequests--;
  }
}
async function analyzeReviewsWithAI(placeId, placeName, reviewTexts) {
  if (reviewTexts.length === 0)
    return null;
  const cached = await getCachedAnalysis(placeId);
  if (cached.hit)
    return cached.data;
  fetchAndCacheAIAnalysis(placeId, placeName, reviewTexts).catch(
    (err) => console.error(`[AI] background analysis failed for ${placeId}:`, err)
  );
  return null;
}
function calculateAIReviewBonus(analysis) {
  if (!analysis)
    return 0;
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

// server/google-places.ts
var GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!GOOGLE_PLACES_API_KEY) {
  console.warn("GOOGLE_PLACES_API_KEY is not set \u2014 Places API calls will fail");
}
var PLACES_BASE = "https://maps.googleapis.com/maps/api/place";
var GEOCODING_BASE = "https://maps.googleapis.com/maps/api/geocode";
var FETCH_TIMEOUT_MS2 = 8e3;
async function fetchWithTimeout2(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS2);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`Google Places fetch timed out: ${label}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
var CITY_BIASES = {
  Franca: { lat: -20.5386, lng: -47.4009 },
  "Ribeir\xE3o Preto": { lat: -21.1704, lng: -47.8102 }
};
var KID_TEXT_QUERIES = [
  "parque playground infantil",
  "brinquedoteca \xE1rea kids",
  "restaurante infantil crian\xE7as",
  "espa\xE7o kids monitores"
];
function pickMinimal(place) {
  const geometry = place.geometry;
  const photos = place.photos;
  return {
    place_id: place.place_id,
    name: place.name,
    formatted_address: place.formatted_address || place.vicinity || "",
    location: geometry?.location ?? { lat: 0, lng: 0 },
    types: place.types ?? [],
    rating: place.rating,
    user_ratings_total: place.user_ratings_total,
    photos: photos?.slice(0, 1).map((p) => ({ photo_reference: p.photo_reference }))
  };
}
function deduplicateAndSort(places) {
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const p of places) {
    if (!seen.has(p.place_id)) {
      seen.add(p.place_id);
      unique.push(p);
    }
  }
  unique.sort((a, b) => (b.user_ratings_total ?? 0) - (a.user_ratings_total ?? 0));
  return unique;
}
async function textSearchOne(query, lat, lng, radius = 1e4) {
  const params = new URLSearchParams({
    query,
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR"
  });
  if (lat !== void 0 && lng !== void 0) {
    params.set("location", `${lat},${lng}`);
    params.set("radius", String(radius));
  }
  let res;
  try {
    res = await fetchWithTimeout2(`${PLACES_BASE}/textsearch/json?${params.toString()}`, "textSearchOne");
  } catch {
    return [];
  }
  if (!res.ok)
    return [];
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS")
    return [];
  return (data.results ?? []).map(pickMinimal);
}
async function searchPlacesByText(city, query) {
  const bias = CITY_BIASES[city];
  const lat = bias?.lat;
  const lng = bias?.lng;
  let queries;
  if (query) {
    queries = [`${query} infantil crian\xE7a em ${city} SP Brasil`];
  } else {
    queries = KID_TEXT_QUERIES.map((q) => `${q} em ${city} SP Brasil`);
  }
  const results = await Promise.allSettled(
    queries.map((q) => textSearchOne(q, lat, lng, 1e4))
  );
  const all = [];
  for (const r of results) {
    if (r.status === "fulfilled")
      all.push(...r.value);
  }
  return deduplicateAndSort(all);
}
var REVIEW_FETCH_TIMEOUT_MS = 5e3;
var REVIEW_ENRICH_TOP_N = 30;
async function fetchPlaceReviews(placeId) {
  if (!GOOGLE_PLACES_API_KEY)
    return [];
  const qs = new URLSearchParams({
    place_id: placeId,
    fields: "reviews,editorial_summary",
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR"
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVIEW_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${PLACES_BASE}/details/json?${qs.toString()}`, {
      signal: controller.signal
    });
    if (!res.ok)
      return [];
    const data = await res.json();
    if (data.status !== "OK" || !data.result)
      return [];
    const texts = [];
    const overview = data.result.editorial_summary?.overview;
    if (overview && overview.trim().length > 0)
      texts.push(overview.trim());
    for (const r of data.result.reviews ?? []) {
      const t = r.text?.trim() ?? "";
      if (t.length > 0)
        texts.push(t);
    }
    return texts;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
async function fetchGooglePlaces(params) {
  if (!GOOGLE_PLACES_API_KEY)
    return [];
  const clampedRadius = Math.min(params.radius, 1e4);
  const qs = new URLSearchParams({
    location: `${params.latitude},${params.longitude}`,
    radius: String(clampedRadius),
    type: params.type,
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR"
  });
  if (params.query)
    qs.set("keyword", params.query);
  let res;
  try {
    res = await fetchWithTimeout2(
      `${PLACES_BASE}/nearbysearch/json?${qs.toString()}`,
      `fetchGooglePlaces type="${params.type}"`
    );
  } catch {
    return [];
  }
  if (!res.ok)
    return [];
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS")
    return [];
  return (data.results ?? []).map((r) => ({
    place_id: r.place_id,
    name: r.name,
    address: r.formatted_address ?? r.vicinity ?? "",
    location: r.geometry?.location ?? { lat: 0, lng: 0 },
    types: r.types ?? [],
    rating: r.rating,
    user_ratings_total: r.user_ratings_total,
    opening_hours: r.opening_hours,
    photos: r.photos?.slice(0, 1).map((p) => ({ photo_reference: p.photo_reference }))
  }));
}
async function searchPlaces(params) {
  const { latitude, longitude, radius, establishmentType, establishmentTypes, openNow, query, sortBy = "kidScore" } = params;
  const typesToSearch = establishmentTypes && establishmentTypes.length > 0 ? establishmentTypes : establishmentType ? [establishmentType] : [];
  if (typesToSearch.length === 0)
    return [];
  const fetchResults = await Promise.allSettled(
    typesToSearch.map(
      (t) => fetchGooglePlaces({ latitude, longitude, radius, type: t, query })
    )
  );
  const combined = fetchResults.flatMap(
    (r) => r.status === "fulfilled" ? r.value : []
  );
  const seen = /* @__PURE__ */ new Set();
  let raw = combined.filter((p) => {
    if (seen.has(p.place_id))
      return false;
    seen.add(p.place_id);
    return true;
  });
  if (openNow) {
    raw = filterOpenNow(raw);
  }
  raw = applyKidFilters(raw);
  const nonApprovedIds = await getNonApprovedPlaceIds(raw.map((p) => p.place_id));
  if (nonApprovedIds.size > 0) {
    raw = raw.filter((p) => !nonApprovedIds.has(p.place_id));
  }
  await Promise.allSettled(
    raw.map(
      (p) => upsertPlace({
        place_id: p.place_id,
        city: "unknown",
        lat: String(p.location.lat),
        lng: String(p.location.lng)
      })
    )
  );
  const kidFlagsMap = await getAggregatedKidFlagsForPlaces(raw.map((p) => p.place_id));
  const firstPass = raw.map(
    (p) => calculateKidScore(p, latitude, longitude, kidFlagsMap.get(p.place_id) ?? {})
  );
  const sortedFirstPass = sortResults(firstPass, sortBy);
  const topCandidates = sortedFirstPass.slice(0, REVIEW_ENRICH_TOP_N);
  const restCandidates = sortedFirstPass.slice(REVIEW_ENRICH_TOP_N);
  const topRawPlaces = raw.filter(
    (p) => topCandidates.some((tc) => tc.place_id === p.place_id)
  );
  const useEnrichment = sortBy === "kidScore";
  const [reviewResults, foursquareResults] = await Promise.all([
    Promise.allSettled(
      topCandidates.map((p) => fetchPlaceReviews(p.place_id))
    ),
    useEnrichment ? Promise.allSettled(
      topRawPlaces.map(
        (p) => matchFoursquarePlace(p.name, p.location.lat, p.location.lng, p.place_id)
      )
    ) : Promise.resolve(topRawPlaces.map(() => ({ status: "fulfilled", value: null })))
  ]);
  const reviewsMap = /* @__PURE__ */ new Map();
  topCandidates.forEach((p, i) => {
    const r = reviewResults[i];
    reviewsMap.set(p.place_id, r.status === "fulfilled" ? r.value : []);
  });
  const foursquareMatchMap = /* @__PURE__ */ new Map();
  const foursquareMap = /* @__PURE__ */ new Map();
  topRawPlaces.forEach((p, i) => {
    const r = foursquareResults[i];
    const match = r.status === "fulfilled" ? r.value : null;
    foursquareMatchMap.set(p.place_id, match);
    foursquareMap.set(p.place_id, calculateFoursquareBonus(match));
  });
  const aiMap = /* @__PURE__ */ new Map();
  if (useEnrichment) {
    const placesWithReviews = topRawPlaces.filter(
      (p) => (reviewsMap.get(p.place_id)?.length ?? 0) > 0
    );
    const aiResults = await Promise.allSettled(
      placesWithReviews.map(
        (p) => analyzeReviewsWithAI(p.place_id, p.name, reviewsMap.get(p.place_id) ?? [])
      )
    );
    placesWithReviews.forEach((p, i) => {
      const r = aiResults[i];
      const analysis = r.status === "fulfilled" ? r.value : null;
      aiMap.set(p.place_id, calculateAIReviewBonus(analysis));
    });
  }
  const enrichedTop = topRawPlaces.map((p) => {
    const fsqMatch = foursquareMatchMap.get(p.place_id) ?? null;
    return calculateKidScore(
      p,
      latitude,
      longitude,
      kidFlagsMap.get(p.place_id) ?? {},
      reviewsMap.get(p.place_id) ?? [],
      {
        foursquareBonus: foursquareMap.get(p.place_id) ?? 0,
        aiReviewBonus: aiMap.get(p.place_id) ?? 0,
        crossSourceBonus: calculateCrossSourceBonus(p.rating, p.user_ratings_total, fsqMatch)
      }
    );
  });
  const allScored = [...enrichedTop, ...restCandidates];
  return sortResults(allScored, sortBy);
}
async function autocompletePlaces(input, lat, lng) {
  if (!GOOGLE_PLACES_API_KEY || input.trim().length === 0)
    return [];
  const qs = new URLSearchParams({
    input: input.trim(),
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR",
    components: "country:br",
    types: "(cities)"
  });
  if (lat !== void 0 && lng !== void 0) {
    qs.set("location", `${lat},${lng}`);
    qs.set("radius", "200000");
  }
  let res;
  try {
    res = await fetchWithTimeout2(`${PLACES_BASE}/autocomplete/json?${qs.toString()}`, "autocompletePlaces");
  } catch {
    return [];
  }
  if (!res.ok)
    return [];
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS")
    return [];
  return (data.predictions ?? []).slice(0, 5).map((p) => ({
    place_id: p.place_id,
    description: p.description
  }));
}
async function autocompleteEstablishments(input, lat, lng) {
  if (!GOOGLE_PLACES_API_KEY || input.trim().length === 0)
    return [];
  const qs = new URLSearchParams({
    input: input.trim(),
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR",
    components: "country:br",
    types: "establishment"
  });
  if (lat !== void 0 && lng !== void 0) {
    qs.set("location", `${lat},${lng}`);
    qs.set("radius", "50000");
  }
  let res;
  try {
    res = await fetchWithTimeout2(`${PLACES_BASE}/autocomplete/json?${qs.toString()}`, "autocompleteEstablishments");
  } catch {
    return [];
  }
  if (!res.ok)
    return [];
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS")
    return [];
  return (data.predictions ?? []).slice(0, 8).map((p) => ({
    place_id: p.place_id,
    description: p.description,
    main_text: p.structured_formatting?.main_text ?? p.description,
    secondary_text: p.structured_formatting?.secondary_text ?? ""
  }));
}
async function geocodeCityPlace(placeId) {
  if (!GOOGLE_PLACES_API_KEY)
    throw new Error("API key not configured");
  const qs = new URLSearchParams({
    place_id: placeId,
    fields: "address_components,geometry",
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR"
  });
  const res = await fetchWithTimeout2(`${PLACES_BASE}/details/json?${qs.toString()}`, "geocodeCityPlace");
  if (!res.ok)
    throw new Error(`Geocode request failed: ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK")
    throw new Error(`Geocode status: ${data.status}`);
  const loc = data.result.geometry?.location;
  if (!loc)
    throw new Error("No geometry in geocode result");
  const components = data.result.address_components ?? [];
  const localityComp = components.find((c) => c.types.includes("locality") || c.types.includes("administrative_area_level_2"));
  const stateComp = components.find((c) => c.types.includes("administrative_area_level_1"));
  if (!localityComp)
    throw new Error("Could not extract city name from address components");
  if (!stateComp)
    throw new Error("Could not extract state from address components");
  return {
    nome: localityComp.long_name,
    estado: stateComp.short_name,
    latitude: loc.lat,
    longitude: loc.lng
  };
}
async function geocodePlace(placeId) {
  if (!GOOGLE_PLACES_API_KEY)
    throw new Error("API key not configured");
  const qs = new URLSearchParams({
    place_id: placeId,
    fields: "geometry,formatted_address",
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR"
  });
  const res = await fetchWithTimeout2(`${PLACES_BASE}/details/json?${qs.toString()}`, "geocodePlace");
  if (!res.ok)
    throw new Error(`Geocode request failed: ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK")
    throw new Error(`Geocode status: ${data.status}`);
  const loc = data.result.geometry?.location;
  if (!loc)
    throw new Error("No geometry in geocode result");
  return {
    lat: loc.lat,
    lng: loc.lng,
    label: data.result.formatted_address ?? placeId
  };
}
async function textSearchClaimable(query, city) {
  if (!GOOGLE_PLACES_API_KEY)
    return [];
  const searchQuery = city ? `${query} em ${city}` : query;
  const params = new URLSearchParams({
    query: searchQuery,
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR",
    type: "establishment"
  });
  let res;
  try {
    res = await fetchWithTimeout2(`${PLACES_BASE}/textsearch/json?${params.toString()}`, "textSearchClaimable");
  } catch {
    return [];
  }
  if (!res.ok)
    return [];
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS")
    return [];
  return (data.results ?? []).slice(0, 10).map((r) => ({
    place_id: r.place_id,
    name: r.name,
    address: r.formatted_address ?? r.vicinity ?? "",
    photo_reference: r.photos?.[0]?.photo_reference
  }));
}
async function getPlaceDetails(placeId) {
  const fields = [
    "place_id",
    "name",
    "formatted_address",
    "geometry",
    "types",
    "rating",
    "user_ratings_total",
    "opening_hours",
    "photos",
    "website",
    "formatted_phone_number"
  ].join(",");
  const params = new URLSearchParams({
    place_id: placeId,
    fields,
    key: GOOGLE_PLACES_API_KEY,
    language: "pt-BR"
  });
  const url = `${PLACES_BASE}/details/json?${params.toString()}`;
  const res = await fetchWithTimeout2(url, "getPlaceDetails");
  if (!res.ok)
    throw new Error(`Google Places Details failed: ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK")
    throw new Error(`Google Places status: ${data.status}`);
  const r = data.result;
  const geometry = r.geometry;
  const openingHours = r.opening_hours;
  const photos = r.photos;
  return {
    place_id: r.place_id,
    name: r.name,
    formatted_address: r.formatted_address ?? "",
    location: geometry?.location ?? { lat: 0, lng: 0 },
    types: r.types ?? [],
    rating: r.rating,
    user_ratings_total: r.user_ratings_total,
    opening_hours: openingHours ? { open_now: openingHours.open_now, weekday_text: openingHours.weekday_text } : void 0,
    photos: photos?.slice(0, 5).map((p) => ({ photo_reference: p.photo_reference })),
    website: r.website,
    formatted_phone_number: r.formatted_phone_number
  };
}
async function reverseGeocodeCity(lat, lng) {
  const qs = new URLSearchParams({
    latlng: `${lat},${lng}`,
    result_type: "locality",
    language: "pt-BR",
    key: GOOGLE_PLACES_API_KEY
  });
  try {
    const res = await fetchWithTimeout2(`${GEOCODING_BASE}/json?${qs.toString()}`, "reverseGeocodeCity");
    const data = await res.json();
    const result = data.results?.[0];
    if (!result)
      return null;
    const label = result.formatted_address;
    const stateComponent = result.address_components?.find(
      (c) => c.types.includes("administrative_area_level_1")
    );
    const estado = stateComponent?.long_name ?? null;
    return { label, estado };
  } catch {
    return null;
  }
}

// server/email.ts
import nodemailer from "nodemailer";
function createTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host)
    return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : void 0
  });
}
async function sendInviteEmail(opts) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || "noreply@kidspot.app";
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#7C3AED;">Convite para o Backoffice KidSpot</h2>
      <p>Ol\xE1, <strong>${opts.name}</strong>!</p>
      <p><strong>${opts.invitedBy}</strong> te convidou para colaborar no backoffice do KidSpot com o perfil <strong>${opts.role}</strong>.</p>
      <p>Clique no bot\xE3o abaixo para ativar sua conta (link v\xE1lido por <strong>72 horas</strong>):</p>
      <p style="text-align:center;margin:32px 0;">
        <a href="${opts.activationLink}"
           style="background:#7C3AED;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
          Ativar minha conta
        </a>
      </p>
      <p style="color:#6B7280;font-size:13px;">Se voc\xEA n\xE3o esperava este convite, ignore este e-mail.</p>
    </div>
  `;
  if (!transporter) {
    console.info(
      `[KidSpot Email \u2013 dev mode] Invite to ${opts.to} (${opts.role}):
  ${opts.activationLink}`
    );
    return {
      sent: false,
      note: "SMTP n\xE3o configurado. O link de ativa\xE7\xE3o est\xE1 dispon\xEDvel na resposta da API."
    };
  }
  await transporter.sendMail({
    from,
    to: opts.to,
    subject: "Voc\xEA foi convidado para o Backoffice KidSpot",
    html
  });
  return { sent: true, note: `E-mail de convite enviado para ${opts.to}.` };
}

// server/pipeline.ts
import { cities as cities2, pipelineRuns, placesKidspot as placesKidspot2, pipelineBlacklist } from "@shared/schema";
import { eq as eq4, and as and4, inArray as inArray2 } from "drizzle-orm";
var COST_PER_TEXT_SEARCH = 0.032;
var TEXT_SEARCH_REQUESTS_PER_CITY = 4;
async function ingestCity(cityId, cityName, lat, lng) {
  let placesFound = 0;
  let newPending = 0;
  let failures = 0;
  try {
    const rawPlaces = await searchPlacesByText(cityName);
    const filtered = applyKidFilters(
      rawPlaces.map((p) => ({
        ...p,
        types: p.types ?? [],
        name: p.name ?? ""
      }))
    );
    const blacklisted = await db.select({ place_id: pipelineBlacklist.place_id }).from(pipelineBlacklist);
    const blacklistSet = new Set(blacklisted.map((b) => b.place_id));
    const notBlacklisted = filtered.filter((p) => !blacklistSet.has(p.place_id));
    placesFound = notBlacklisted.length;
    for (const place of notBlacklisted) {
      try {
        const existing = await db.query.placesKidspot.findFirst({
          where: eq4(placesKidspot2.place_id, place.place_id)
        });
        if (!existing) {
          await db.insert(placesKidspot2).values({
            place_id: place.place_id,
            city: cityName,
            ciudad_id: cityId,
            lat: String(place.location?.lat ?? 0),
            lng: String(place.location?.lng ?? 0),
            status: "pendente"
          });
          await upsertPlaceMeta({ place_id: place.place_id, city: cityName });
          newPending++;
        }
      } catch {
        failures++;
      }
    }
  } catch {
    failures++;
  }
  const estimatedCost = TEXT_SEARCH_REQUESTS_PER_CITY * COST_PER_TEXT_SEARCH;
  return { placesFound, newPending, failures, estimatedCost };
}
async function runPipelineForCity(cityId) {
  const city = await db.query.cities.findFirst({
    where: and4(eq4(cities2.id, cityId), eq4(cities2.ativa, true))
  });
  if (!city) {
    throw new Error("Cidade n\xE3o encontrada ou n\xE3o est\xE1 ativa");
  }
  const [run] = await db.insert(pipelineRuns).values({
    city_id: city.id,
    city_name: city.nome,
    status: "running",
    places_found: 0,
    new_pending: 0,
    failures: 0,
    estimated_cost_usd: "0"
  }).returning();
  try {
    const result = await ingestCity(city.id, city.nome, Number(city.latitude), Number(city.longitude));
    const [updated] = await db.update(pipelineRuns).set({
      status: "completed",
      places_found: result.placesFound,
      new_pending: result.newPending,
      failures: result.failures,
      estimated_cost_usd: String(result.estimatedCost.toFixed(4)),
      finished_at: /* @__PURE__ */ new Date()
    }).where(eq4(pipelineRuns.id, run.id)).returning();
    await db.update(cities2).set({ ultima_varredura: /* @__PURE__ */ new Date() }).where(eq4(cities2.id, cityId));
    return {
      run_id: updated.id,
      city_name: city.nome,
      places_found: result.placesFound,
      new_pending: result.newPending,
      failures: result.failures,
      estimated_cost_usd: result.estimatedCost,
      status: "completed"
    };
  } catch (err) {
    const errorMessage = err.message;
    await db.update(pipelineRuns).set({
      status: "failed",
      error_message: errorMessage,
      finished_at: /* @__PURE__ */ new Date()
    }).where(eq4(pipelineRuns.id, run.id));
    return {
      run_id: run.id,
      city_name: city.nome,
      places_found: 0,
      new_pending: 0,
      failures: 1,
      estimated_cost_usd: 0,
      status: "failed",
      error_message: errorMessage
    };
  }
}
async function previewPipelineForCity(cityId, limit = 50) {
  const city = await db.query.cities.findFirst({
    where: and4(eq4(cities2.id, cityId), eq4(cities2.ativa, true))
  });
  if (!city)
    throw new Error("Cidade n\xE3o encontrada ou n\xE3o est\xE1 ativa");
  const rawPlaces = await searchPlacesByText(city.nome);
  const filtered = applyKidFilters(
    rawPlaces.map((p) => ({ ...p, types: p.types ?? [], name: p.name ?? "" }))
  );
  const blacklisted = await db.select({ place_id: pipelineBlacklist.place_id }).from(pipelineBlacklist);
  const blacklistSet = new Set(blacklisted.map((b) => b.place_id));
  const withoutBlacklisted = filtered.filter((p) => !blacklistSet.has(p.place_id));
  const limited = withoutBlacklisted.slice(0, limit);
  const placeIds = limited.map((p) => p.place_id);
  const existingRows = placeIds.length > 0 ? await db.select({ place_id: placesKidspot2.place_id }).from(placesKidspot2).where(inArray2(placesKidspot2.place_id, placeIds)) : [];
  const existingSet = new Set(existingRows.map((r) => r.place_id));
  await db.update(cities2).set({ ultima_varredura: /* @__PURE__ */ new Date() }).where(eq4(cities2.id, cityId));
  return {
    city_name: city.nome,
    places: limited.map((p) => ({
      place_id: p.place_id,
      name: p.name,
      formatted_address: p.formatted_address,
      types: p.types,
      rating: p.rating,
      user_ratings_total: p.user_ratings_total,
      location: p.location,
      already_exists: existingSet.has(p.place_id)
    }))
  };
}
async function aiSearchForCity(cityId, limit = 50) {
  const city = await db.query.cities.findFirst({
    where: and4(eq4(cities2.id, cityId), eq4(cities2.ativa, true))
  });
  if (!city)
    throw new Error("Cidade n\xE3o encontrada ou n\xE3o est\xE1 ativa");
  const rawPlaces = await searchPlacesByText(city.nome);
  const limited = rawPlaces.slice(0, limit);
  await db.update(cities2).set({ ultima_varredura: /* @__PURE__ */ new Date() }).where(eq4(cities2.id, cityId));
  return {
    city_name: city.nome,
    places: limited.map((p) => ({
      place_id: p.place_id,
      name: p.name ?? "",
      formatted_address: p.formatted_address,
      types: p.types ?? [],
      rating: p.rating,
      user_ratings_total: p.user_ratings_total,
      location: p.location
    }))
  };
}
async function applyCriteriaToPlaces(cityId, rawPlaces) {
  const blacklisted = await db.select({ place_id: pipelineBlacklist.place_id }).from(pipelineBlacklist);
  const blacklistSet = new Set(blacklisted.map((b) => b.place_id));
  const withTypes = rawPlaces.map((p) => ({ ...p, types: p.types ?? [], name: p.name ?? "" }));
  const filtered = applyKidFilters(withTypes);
  const filteredSet = new Set(filtered.map((p) => p.place_id));
  const placeIds = rawPlaces.map((p) => p.place_id);
  const existingRows = placeIds.length > 0 ? await db.select({ place_id: placesKidspot2.place_id }).from(placesKidspot2).where(inArray2(placesKidspot2.place_id, placeIds)) : [];
  const existingSet = new Set(existingRows.map((r) => r.place_id));
  return {
    places: rawPlaces.map((p) => {
      const isBlacklisted = blacklistSet.has(p.place_id);
      const passedFilters = filteredSet.has(p.place_id);
      const passed = passedFilters && !isBlacklisted;
      let rejection_reason;
      if (isBlacklisted)
        rejection_reason = "Na blacklist";
      else if (!passedFilters)
        rejection_reason = "N\xE3o atende crit\xE9rios kid-friendly";
      return {
        place_id: p.place_id,
        name: p.name,
        formatted_address: p.formatted_address,
        types: p.types,
        rating: p.rating,
        user_ratings_total: p.user_ratings_total,
        location: p.location,
        already_exists: existingSet.has(p.place_id),
        passed_criteria: passed,
        rejection_reason
      };
    })
  };
}
async function runPipelineForAllCities() {
  const activeCities = await db.query.cities.findMany({
    where: eq4(cities2.ativa, true)
  });
  if (activeCities.length === 0) {
    throw new Error("Nenhuma cidade ativa cadastrada");
  }
  const results = await Promise.allSettled(
    activeCities.map((c) => runPipelineForCity(c.id))
  );
  return results.map((r, i) => {
    if (r.status === "fulfilled")
      return r.value;
    return {
      run_id: "",
      city_name: activeCities[i]?.nome ?? "Desconhecida",
      places_found: 0,
      new_pending: 0,
      failures: 1,
      estimated_cost_usd: 0,
      status: "failed",
      error_message: r.reason.message
    };
  });
}

// server/routes.ts
import { insertReviewSchema, insertClaimSchema, insertFeedbackSchema, insertFilterSchema, insertCitySchema, insertSponsorshipPlanSchema, insertSponsorshipContractSchema, aiPrompts as aiPrompts2, kidscoreRules, customCriteria, pipelineRuns as pipelineRuns2, placesKidspot as placesKidspot3, aiProviders as aiProviders2, pipelineRouting as pipelineRouting2, pipelineBlacklist as pipelineBlacklist2 } from "@shared/schema";

// server/auth.ts
import jwt from "jsonwebtoken";
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET environment variable must be set in production");
    }
    return "kidspot-dev-secret-change-in-production";
  }
  return secret;
}
var JWT_EXPIRES_IN = "7d";
var BACKOFFICE_JWT_EXPIRES_IN = "2h";
function signToken(payload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}
function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}
function signBackofficeToken(payload) {
  return jwt.sign({ ...payload, type: "backoffice" }, getJwtSecret(), {
    expiresIn: BACKOFFICE_JWT_EXPIRES_IN
  });
}
function verifyBackofficeToken(token) {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (decoded.type !== "backoffice")
      return null;
    return decoded;
  } catch {
    return null;
  }
}
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token de autentica\xE7\xE3o necess\xE1rio" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Token inv\xE1lido ou expirado" });
    return;
  }
  req.user = payload;
  next();
}
function requireBackofficeAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token de autentica\xE7\xE3o do backoffice necess\xE1rio" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyBackofficeToken(token);
  if (!payload) {
    res.status(401).json({ error: "Token inv\xE1lido ou expirado. Fa\xE7a login novamente." });
    return;
  }
  req.backofficeUser = payload;
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.backofficeUser) {
      res.status(401).json({ error: "Autentica\xE7\xE3o necess\xE1ria" });
      return;
    }
    if (!roles.includes(req.backofficeUser.role)) {
      res.status(403).json({ error: "Permiss\xE3o insuficiente para esta opera\xE7\xE3o" });
      return;
    }
    next();
  };
}
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token de autentica\xE7\xE3o necess\xE1rio" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Token inv\xE1lido ou expirado" });
    return;
  }
  if (payload.role !== "admin") {
    res.status(403).json({ error: "Acesso restrito a administradores" });
    return;
  }
  req.user = payload;
  next();
}

// server/routes.ts
import { eq as eq5, desc as desc2, and as and5, ilike as ilike2, sql as sqlExpr } from "drizzle-orm";
import crypto2 from "crypto";
import bcrypt2 from "bcryptjs";
async function registerRoutes(app2) {
  function trackBackofficeActivity(req, _res, next) {
    if (req.backofficeUser) {
      updateBackofficeUserLastActive(req.backofficeUser.backofficeUserId).catch(() => {
      });
    }
    next();
  }
  function withAudit(action, module) {
    return (req, res, next) => {
      res.on("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 300 && req.backofficeUser) {
          createAuditLog({
            userId: req.backofficeUser.backofficeUserId,
            userEmail: req.backofficeUser.email,
            userRole: req.backofficeUser.role,
            action,
            module,
            ip: req.ip
          }).catch(() => {
          });
        }
      });
      next();
    };
  }
  app2.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  const adminLoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  });
  app2.post("/api/admin/auth/login", async (req, res) => {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { email, password } = parsed.data;
    try {
      const user = await findUserByEmail(email.toLowerCase());
      if (!user) {
        res.status(401).json({ error: "Credenciais inv\xE1lidas" });
        return;
      }
      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: "Credenciais inv\xE1lidas" });
        return;
      }
      if (user.role !== "admin") {
        res.status(403).json({ error: "Acesso restrito a administradores" });
        return;
      }
      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      });
      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role }
      });
    } catch (err) {
      console.error("Admin login error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/auth/me", requireAdmin, async (req, res) => {
    const dbUser = await getUserById(req.user.userId);
    if (!dbUser) {
      res.status(401).json({ error: "Usu\xE1rio n\xE3o encontrado" });
      return;
    }
    res.json({
      user: {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        role: dbUser.role
      }
    });
  });
  app2.get("/api/kidspot/ping-db", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ db: true });
    } catch (err) {
      console.error("DB ping failed:", err);
      res.status(500).json({ db: false, error: "Database unreachable" });
    }
  });
  const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6)
  });
  app2.post("/api/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { name, email, password } = parsed.data;
    const existing = await findUserByEmail(email.toLowerCase());
    if (existing) {
      res.status(409).json({ error: "E-mail j\xE1 cadastrado" });
      return;
    }
    try {
      const user = await createUser({ name, email: email.toLowerCase(), password });
      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      });
      res.status(201).json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, linked_place_id: user.linked_place_id ?? null, linked_place_name: user.linked_place_name ?? null, linked_place_address: user.linked_place_address ?? null }
      });
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  });
  app2.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { email, password } = parsed.data;
    try {
      const user = await findUserByEmail(email.toLowerCase());
      if (!user) {
        res.status(401).json({ error: "E-mail ou senha incorretos" });
        return;
      }
      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: "E-mail ou senha incorretos" });
        return;
      }
      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      });
      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, linked_place_id: user.linked_place_id ?? null, linked_place_name: user.linked_place_name ?? null, linked_place_address: user.linked_place_address ?? null }
      });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/auth/me", requireAuth, async (req, res) => {
    const dbUser = await getUserById(req.user.userId);
    if (!dbUser) {
      res.status(401).json({ error: "Usu\xE1rio n\xE3o encontrado" });
      return;
    }
    res.json({
      user: {
        userId: dbUser.id,
        email: dbUser.email,
        role: dbUser.role,
        name: dbUser.name,
        linked_place_id: dbUser.linked_place_id,
        linked_place_name: dbUser.linked_place_name,
        linked_place_address: dbUser.linked_place_address
      }
    });
  });
  const googleSchema = z.object({ accessToken: z.string().min(1) });
  app2.post("/api/auth/google", async (req, res) => {
    const parsed = googleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "accessToken \xE9 obrigat\xF3rio" });
      return;
    }
    try {
      const googleRes = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        { headers: { Authorization: `Bearer ${parsed.data.accessToken}` } }
      );
      if (!googleRes.ok) {
        res.status(401).json({ error: "Token Google inv\xE1lido ou expirado" });
        return;
      }
      const profile = await googleRes.json();
      if (!profile.email_verified) {
        res.status(401).json({ error: "E-mail Google n\xE3o verificado" });
        return;
      }
      const user = await findOrCreateGoogleUser({
        email: profile.email,
        name: profile.name ?? profile.email.split("@")[0]
      });
      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      });
      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, linked_place_id: user.linked_place_id ?? null, linked_place_name: user.linked_place_name ?? null, linked_place_address: user.linked_place_address ?? null }
      });
    } catch (err) {
      console.error("Google auth error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/places/photo", async (req, res) => {
    const reference = req.query.reference;
    const maxwidth = req.query.maxwidth || "400";
    if (!reference) {
      res.status(400).json({ error: "reference is required" });
      return;
    }
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "API key not configured" });
      return;
    }
    try {
      const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxwidth}&photo_reference=${encodeURIComponent(reference)}&key=${apiKey}`;
      const photoRes = await fetch(url);
      const buffer = await photoRes.arrayBuffer();
      const contentType = photoRes.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(Buffer.from(buffer));
    } catch (err) {
      console.error("Photo proxy error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const ESTABLISHMENT_TYPES = [
    "playground",
    "park",
    "amusement_center",
    "restaurant",
    "cafe",
    "bakery",
    "shopping_mall",
    "zoo",
    "tourist_attraction",
    "sports_club",
    "community_center"
  ];
  const searchBodySchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
    radius: z.number().positive().max(1e4).default(5e3),
    establishmentType: z.enum(ESTABLISHMENT_TYPES).optional(),
    establishmentTypes: z.array(z.enum(ESTABLISHMENT_TYPES)).optional(),
    openNow: z.boolean().optional(),
    query: z.string().optional(),
    sortBy: z.enum(["kidScore", "distance", "rating"]).default("kidScore")
  }).refine(
    (d) => d.establishmentType != null || d.establishmentTypes != null && d.establishmentTypes.length > 0,
    { message: "Provide establishmentType or establishmentTypes" }
  );
  app2.post("/api/places/search", async (req, res) => {
    const parsed = searchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const [places, sponsoredMap] = await Promise.all([
        searchPlaces(parsed.data),
        getActiveSponsoredPlaceIds()
      ]);
      const augmented = places.map((p) => ({
        ...p,
        is_sponsored: sponsoredMap.has(p.place_id)
      }));
      if (sponsoredMap.size > 0) {
        augmented.sort((a, b) => {
          const aPrio = sponsoredMap.get(a.place_id) ?? -1;
          const bPrio = sponsoredMap.get(b.place_id) ?? -1;
          if (bPrio !== aPrio)
            return bPrio - aPrio;
          return 0;
        });
      }
      const placeIds = augmented.map((p) => p.place_id);
      incrementImpressions(placeIds).catch(() => {
      });
      res.json({ places: augmented });
    } catch (err) {
      console.error("Places search error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/places/autocomplete", async (req, res) => {
    const input = req.query.input ?? "";
    const lat = req.query.lat ? parseFloat(req.query.lat) : void 0;
    const lng = req.query.lng ? parseFloat(req.query.lng) : void 0;
    try {
      const suggestions = await autocompletePlaces(input, lat, lng);
      res.json({ suggestions });
    } catch (err) {
      console.error("Autocomplete error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/places/geocode", async (req, res) => {
    const placeId = req.query.place_id;
    if (!placeId) {
      res.status(400).json({ error: "place_id query parameter is required" });
      return;
    }
    try {
      const result = await geocodePlace(placeId);
      res.json(result);
    } catch (err) {
      console.error("Geocode error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/places/details", async (req, res) => {
    const placeId = req.query.place_id;
    if (!placeId) {
      res.status(400).json({ error: "place_id query parameter is required" });
      return;
    }
    try {
      const [details, sponsoredMap] = await Promise.all([
        getPlaceDetails(placeId),
        getActiveSponsoredPlaceIds()
      ]);
      incrementDetailAccess(placeId).catch(() => {
      });
      res.json({ place: { ...details, is_sponsored: sponsoredMap.has(placeId) } });
    } catch (err) {
      console.error("Places details error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/places/search-claimable", requireAuth, async (req, res) => {
    const q = req.query.q ?? "";
    const city = req.query.city ?? "";
    if (!q || q.trim().length < 2) {
      res.status(400).json({ error: "Informe pelo menos 2 caracteres para buscar" });
      return;
    }
    try {
      const approvedIds = await getApprovedPlaceIds();
      const results = await textSearchClaimable(q.trim(), city.trim());
      const filtered = results.filter((p) => !approvedIds.has(p.place_id));
      res.json({ places: filtered });
    } catch (err) {
      console.error("Search claimable error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/reviews", requireAuth, async (req, res) => {
    const parsed = insertReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const review = await createReview(parsed.data, req.user.userId);
      res.status(201).json({ review });
    } catch (err) {
      console.error("Create review error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/reviews", async (req, res) => {
    const placeId = req.query.place_id;
    if (!placeId) {
      res.status(400).json({ error: "place_id query parameter is required" });
      return;
    }
    try {
      const reviewList = await getReviewsForPlace(placeId);
      res.json({ reviews: reviewList });
    } catch (err) {
      console.error("Get reviews error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/favorites/toggle", requireAuth, async (req, res) => {
    const placeId = req.body?.place_id;
    if (!placeId) {
      res.status(400).json({ error: "place_id is required" });
      return;
    }
    const userKey = req.user.userId;
    try {
      const result = await toggleFavorite(userKey, placeId);
      res.json(result);
    } catch (err) {
      console.error("Toggle favorite error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/favorites", requireAuth, async (req, res) => {
    const userKey = req.user.userId;
    try {
      const favList = await getFavoritesForUser(userKey);
      res.json({ favorites: favList });
    } catch (err) {
      console.error("Get favorites error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const CLAIM_VALID_STATUSES = /* @__PURE__ */ new Set(["pending", "approved", "denied"]);
  app2.post("/api/claims", requireAuth, async (req, res) => {
    const parsed = insertClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const userId = req.user.userId;
    try {
      const dbUser = await getUserById(userId);
      if (!dbUser) {
        res.status(401).json({ error: "Usu\xE1rio n\xE3o encontrado" });
        return;
      }
      if (dbUser.role !== "usuario") {
        res.status(403).json({ error: "Apenas usu\xE1rios comuns podem solicitar v\xEDnculo com estabelecimento" });
        return;
      }
      if (dbUser.linked_place_id) {
        res.status(409).json({ error: "Voc\xEA j\xE1 possui um estabelecimento vinculado" });
        return;
      }
      const approvedAdmin = await getApprovedAdminForPlace(parsed.data.place_id);
      if (approvedAdmin) {
        res.status(409).json({ error: "Este local j\xE1 possui um administrador aprovado" });
        return;
      }
      const existingClaims = await getClaimsForUser(userId);
      const hasPending = existingClaims.some((c) => c.status === "pending");
      if (hasPending) {
        res.status(409).json({ error: "Voc\xEA j\xE1 possui uma solicita\xE7\xE3o pendente" });
        return;
      }
      const claim = await createClaim(userId, parsed.data);
      res.status(201).json({ claim });
    } catch (err) {
      console.error("Create claim error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/claims/my", requireAuth, async (req, res) => {
    const userId = req.user.userId;
    try {
      const claims = await getClaimsForUser(userId);
      res.json({ claims });
    } catch (err) {
      console.error("Get my claims error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/claims", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const status = req.query.status;
    if (status !== void 0 && !CLAIM_VALID_STATUSES.has(status)) {
      res.status(400).json({ error: `status inv\xE1lido. Use: pending, approved ou denied` });
      return;
    }
    try {
      const claims = await listClaims(status);
      res.json({ claims });
    } catch (err) {
      console.error("List claims error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const reviewClaimSchema = z.object({
    action: z.enum(["approve", "deny"])
  });
  app2.patch("/api/admin/claims/:id", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const parsed = reviewClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const claimId = req.params.id;
    try {
      if (parsed.data.action === "approve") {
        const result = await approveClaim(claimId, caller.id);
        res.json({
          claim: result.claim,
          user: {
            id: result.user.id,
            name: result.user.name,
            email: result.user.email,
            role: result.user.role,
            linked_place_id: result.user.linked_place_id,
            linked_place_name: result.user.linked_place_name,
            linked_place_address: result.user.linked_place_address
          }
        });
      } else {
        const claim = await denyClaim(claimId, caller.id);
        res.json({ claim });
      }
    } catch (err) {
      const msg = err.message;
      console.error("Review claim error:", msg);
      if (msg.includes("n\xE3o encontrada")) {
        res.status(404).json({ error: msg });
      } else if (msg.includes("j\xE1 foi revisada") || msg.includes("j\xE1 possui um administrador")) {
        res.status(409).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });
  const ADMIN_ONLY_ROLES = ["admin", "colaborador"];
  app2.get("/api/admin/users", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const userList = await listUsers();
      const safe = userList.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        created_at: u.created_at
      }));
      res.json({ users: safe });
    } catch (err) {
      console.error("List users error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const createUserSchema = z.object({
    name: z.string().min(2, "Nome deve ter ao menos 2 caracteres"),
    email: z.string().email("E-mail inv\xE1lido"),
    password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
    role: z.enum(["admin", "colaborador", "parceiro", "estabelecimento", "usuario"])
  });
  app2.post("/api/admin/users", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Acesso negado: apenas administradores podem criar usu\xE1rios" });
      return;
    }
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { name, email, password, role } = parsed.data;
    try {
      const existing = await findUserByEmail(email);
      if (existing) {
        res.status(409).json({ error: "J\xE1 existe um usu\xE1rio com este e-mail" });
        return;
      }
      const user = await adminCreateUser({ name, email, password, role });
      res.status(201).json({
        user: { id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.created_at }
      });
    } catch (err) {
      console.error("Admin create user error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const updateRoleSchema = z.object({
    role: z.enum(["admin", "colaborador", "parceiro", "estabelecimento", "usuario"])
  });
  app2.patch("/api/admin/users/:id/role", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const targetRole = parsed.data.role;
    try {
      const userId = req.params.id;
      const targetUser = await getUserById(userId);
      if (!targetUser) {
        res.status(404).json({ error: "Usu\xE1rio n\xE3o encontrado" });
        return;
      }
      if (caller.role === "colaborador") {
        if (ADMIN_ONLY_ROLES.includes(targetUser.role)) {
          res.status(403).json({ error: "Colaboradores n\xE3o podem alterar perfis de administradores ou colaboradores" });
          return;
        }
        if (ADMIN_ONLY_ROLES.includes(targetRole)) {
          res.status(403).json({ error: "Colaboradores n\xE3o podem atribuir este perfil" });
          return;
        }
      }
      const updated = await updateUserRole(userId, targetRole);
      res.json({
        user: {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          role: updated.role
        }
      });
    } catch (err) {
      console.error("Update role error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/stories/nearby", async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const rawRadius = parseFloat(req.query.radius || "8");
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ error: "lat e lng s\xE3o obrigat\xF3rios e devem ser v\xE1lidos" });
      return;
    }
    const radius = isFinite(rawRadius) && rawRadius > 0 ? Math.min(rawRadius, 50) : 8;
    try {
      const stories = await getStoriesNearby(lat, lng, radius);
      res.json({ stories });
    } catch (err) {
      console.error("Get stories nearby error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/stories", async (req, res) => {
    const placeIdsParam = req.query.place_ids;
    if (!placeIdsParam) {
      res.status(400).json({ error: "place_ids query parameter is required" });
      return;
    }
    const placeIds = placeIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (placeIds.length === 0) {
      res.json({ stories: [] });
      return;
    }
    try {
      const stories = await getActiveStoriesForPlaces(placeIds);
      res.json({ stories });
    } catch (err) {
      console.error("Get stories error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const ALLOWED_IMAGE_PREFIXES = [
    "data:image/jpeg;base64,",
    "data:image/jpg;base64,",
    "data:image/png;base64,",
    "data:image/webp;base64,",
    "data:image/gif;base64,",
    "data:image/heic;base64,",
    "data:image/heif;base64,"
  ];
  const isValidImageDataUri = (s) => ALLOWED_IMAGE_PREFIXES.some((prefix) => s.startsWith(prefix));
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const createStorySchema = z.object({
    photos: z.array(
      z.string().refine(isValidImageDataUri, {
        message: "Cada foto deve ser uma imagem v\xE1lida (jpeg, png, webp)"
      })
    ).min(1).max(10).refine(
      (photos) => photos.every((p) => Buffer.byteLength(p, "utf8") <= MAX_PHOTO_BYTES),
      { message: "Cada foto deve ter no m\xE1ximo 5 MB" }
    )
  });
  app2.post("/api/stories", requireAuth, async (req, res) => {
    const userId = req.user.userId;
    const dbUser = await getUserById(userId);
    if (!dbUser) {
      res.status(401).json({ error: "Usu\xE1rio n\xE3o encontrado" });
      return;
    }
    if (dbUser.role !== "parceiro" && dbUser.role !== "estabelecimento") {
      res.status(403).json({ error: "Apenas parceiros e estabelecimentos podem publicar stories" });
      return;
    }
    if (!dbUser.linked_place_id || !dbUser.linked_place_name) {
      res.status(403).json({ error: "Voc\xEA precisa ter um local vinculado para publicar stories" });
      return;
    }
    const parsed = createStorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      let placeLat;
      let placeLng;
      try {
        const details = await getPlaceDetails(dbUser.linked_place_id);
        if (details?.location?.lat == null || details?.location?.lng == null) {
          res.status(422).json({ error: "N\xE3o foi poss\xEDvel obter as coordenadas do seu local. Tente novamente." });
          return;
        }
        placeLat = details.location.lat;
        placeLng = details.location.lng;
      } catch {
        res.status(422).json({ error: "N\xE3o foi poss\xEDvel obter as coordenadas do seu local. Verifique sua conex\xE3o e tente novamente." });
        return;
      }
      const story = await createPartnerStory(
        userId,
        dbUser.linked_place_id,
        dbUser.linked_place_name,
        parsed.data.photos,
        placeLat,
        placeLng
      );
      res.status(201).json({ story });
    } catch (err) {
      console.error("Create story error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/stories/:id/photos", async (req, res) => {
    const storyId = req.params.id;
    try {
      const story = await getStoryById(storyId);
      if (!story) {
        res.status(404).json({ error: "Story n\xE3o encontrado" });
        return;
      }
      if (story.expires_at < /* @__PURE__ */ new Date()) {
        res.status(404).json({ error: "Story expirado" });
        return;
      }
      const photos = await getStoryPhotos(storyId);
      res.json({ photos: photos.map((p) => ({ id: p.id, order: p.order })) });
    } catch (err) {
      console.error("Get story photos error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/stories/photo/:photoId", async (req, res) => {
    const photoId = req.params.photoId;
    try {
      const photo = await getStoryPhotoById(photoId);
      if (!photo) {
        res.status(404).json({ error: "Foto n\xE3o encontrada" });
        return;
      }
      const parentStory = await getStoryById(photo.story_id);
      if (!parentStory || parentStory.expires_at < /* @__PURE__ */ new Date()) {
        res.status(404).json({ error: "Story expirado" });
        return;
      }
      const base64Data = photo.photo_data;
      const matches = base64Data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      if (matches) {
        const contentType = matches[1];
        const buffer = Buffer.from(matches[2], "base64");
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(buffer);
      } else {
        const buffer = Buffer.from(base64Data, "base64");
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(buffer);
      }
    } catch (err) {
      console.error("Get story photo error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const backofficeLoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  });
  app2.post("/api/backoffice/auth/login", async (req, res) => {
    const parsed = backofficeLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { email, password } = parsed.data;
    try {
      const user = await findBackofficeUserByEmail(email);
      if (!user) {
        res.status(401).json({ error: "Credenciais inv\xE1lidas" });
        return;
      }
      if (user.status !== "ativo") {
        res.status(401).json({ error: "Conta n\xE3o ativa. Verifique seu e-mail de convite." });
        return;
      }
      if (!user.password_hash) {
        res.status(401).json({ error: "Conta n\xE3o ativada. Por favor, ative sua conta pelo link no e-mail de convite." });
        return;
      }
      const validPassword = await bcrypt2.compare(password, user.password_hash);
      if (!validPassword) {
        res.status(401).json({ error: "Credenciais inv\xE1lidas" });
        return;
      }
      await createAuditLog({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: "login",
        module: "auth",
        ip: req.ip
      });
      await updateBackofficeUserLastActive(user.id);
      const token = signBackofficeToken({
        backofficeUserId: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      });
      res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status
        }
      });
    } catch (err) {
      console.error("Backoffice login error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/filters/active", async (_req, res) => {
    try {
      await archiveExpiredFilters();
      const filters = await getActiveFilters();
      res.json({ filters });
    } catch (err) {
      console.error("Get active filters error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/filters", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      await archiveExpiredFilters();
      const filters = await listFilters();
      res.json({ filters });
    } catch (err) {
      console.error("List filters error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/admin/filters", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const parsed = insertFilterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const filter = await createFilter(parsed.data);
      res.status(201).json({ filter });
    } catch (err) {
      console.error("Create filter error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/ai-prompts", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const rows = await db.select().from(aiPrompts2).orderBy(desc2(aiPrompts2.updated_at));
      res.json({ prompts: rows });
    } catch (err) {
      console.error("List prompts error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/ai-prompts/active", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const active = await db.query.aiPrompts.findFirst({
        where: eq5(aiPrompts2.is_active, true),
        orderBy: (t, { desc: desc3 }) => [desc3(t.updated_at)]
      });
      res.json({ prompt: active ?? null });
    } catch (err) {
      console.error("Get active prompt error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const upsertPromptSchema = z.object({
    prompt: z.string().min(10, "Prompt muito curto")
  });
  app2.put("/api/admin/ai-prompts/active", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem editar prompts" });
      return;
    }
    const parsed = upsertPromptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const existing = await db.query.aiPrompts.findFirst({
        where: eq5(aiPrompts2.is_active, true),
        orderBy: (t, { desc: desc3 }) => [desc3(t.updated_at)]
      });
      if (existing) {
        const [updated] = await db.update(aiPrompts2).set({ prompt: parsed.data.prompt, updated_at: /* @__PURE__ */ new Date(), created_by: caller.id }).where(eq5(aiPrompts2.id, existing.id)).returning();
        invalidatePromptCache();
        res.json({ prompt: updated });
      } else {
        const [created] = await db.insert(aiPrompts2).values({ name: "default", prompt: parsed.data.prompt, is_active: true, created_by: caller.id }).returning();
        invalidatePromptCache();
        res.status(201).json({ prompt: created });
      }
    } catch (err) {
      console.error("Upsert prompt error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const testPromptSchema = z.object({
    prompt: z.string().min(10),
    placeName: z.string().min(1),
    reviews: z.array(z.string()).min(1).max(5)
  });
  app2.post("/api/admin/ai-prompts/test", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const parsed = testPromptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(422).json({ error: "OPENAI_API_KEY n\xE3o configurada no servidor" });
      return;
    }
    try {
      const { default: OpenAI2 } = await import("openai");
      const openai = new OpenAI2({ apiKey });
      const combinedReviews = parsed.data.reviews.map((r, i) => `Review ${i + 1}: ${r}`).join("\n\n");
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: parsed.data.prompt },
          {
            role: "user",
            content: `Estabelecimento: "${parsed.data.placeName}"

Reviews:
${combinedReviews}`
          }
        ],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: "json_object" }
      });
      const content = response.choices[0]?.message?.content;
      if (!content) {
        res.status(500).json({ error: "IA n\xE3o retornou resposta" });
        return;
      }
      const result = JSON.parse(content);
      res.json({ result });
    } catch (err) {
      console.error("Test prompt error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/backoffice/auth/me", requireBackofficeAuth, async (req, res) => {
    try {
      const user = await findBackofficeUserById(req.backofficeUser.backofficeUserId);
      if (!user || user.status === "inativo") {
        res.status(401).json({ error: "Usu\xE1rio n\xE3o encontrado ou inativo" });
        return;
      }
      await updateBackofficeUserLastActive(user.id);
      res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status
        }
      });
    } catch (err) {
      console.error("Backoffice me error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/kidscore-rules", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const rows = await db.select().from(kidscoreRules).orderBy(kidscoreRules.label);
      res.json({ rules: rows });
    } catch (err) {
      console.error("List kidscore rules error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const activateAccountSchema = z.object({
    token: z.string().min(1),
    password: z.string().min(8)
  });
  app2.post("/api/backoffice/auth/refresh", requireBackofficeAuth, trackBackofficeActivity, async (req, res) => {
    try {
      const caller = req.backofficeUser;
      const user = await findBackofficeUserById(caller.backofficeUserId);
      if (!user || user.status === "inativo") {
        res.status(401).json({ error: "Sess\xE3o inv\xE1lida" });
        return;
      }
      const newToken = signBackofficeToken({
        backofficeUserId: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      });
      await updateBackofficeUserLastActive(user.id);
      res.json({ token: newToken });
    } catch (err) {
      console.error("Backoffice refresh error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/backoffice/auth/activate", async (req, res) => {
    const parsed = activateAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { token, password } = parsed.data;
    try {
      const user = await findBackofficeUserByInviteToken(token);
      if (!user) {
        res.status(400).json({ error: "Token de convite inv\xE1lido ou j\xE1 utilizado" });
        return;
      }
      if (user.invite_token_expires_at && user.invite_token_expires_at < /* @__PURE__ */ new Date()) {
        res.status(400).json({ error: "Token de convite expirado. Solicite um novo convite." });
        return;
      }
      const passwordHash = await bcrypt2.hash(password, 10);
      const activated = await activateBackofficeUser(user.id, passwordHash);
      await createAuditLog({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: "ativou_conta",
        module: "auth",
        ip: req.ip
      });
      const jwtToken = signBackofficeToken({
        backofficeUserId: activated.id,
        email: activated.email,
        role: activated.role,
        name: activated.name
      });
      res.json({
        token: jwtToken,
        user: {
          id: activated.id,
          name: activated.name,
          email: activated.email,
          role: activated.role,
          status: activated.status
        }
      });
    } catch (err) {
      console.error("Backoffice activate error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.patch("/api/admin/filters/:id", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const filterId = req.params.id;
    const parsed = insertFilterSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const filter = await updateFilter(filterId, parsed.data);
      if (!filter) {
        res.status(404).json({ error: "Filtro n\xE3o encontrado" });
        return;
      }
      res.json({ filter });
    } catch (err) {
      console.error("Update filter error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const updateRuleSchema = z.object({
    weight: z.number().int().min(0).max(1e3).optional(),
    is_active: z.boolean().optional(),
    label: z.string().min(1).optional()
  });
  app2.patch("/api/admin/kidscore-rules/:id", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem editar regras de ranqueamento" });
      return;
    }
    const parsed = updateRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const [updated] = await db.update(kidscoreRules).set({ ...parsed.data, updated_at: /* @__PURE__ */ new Date() }).where(eq5(kidscoreRules.id, req.params.id)).returning();
      if (!updated) {
        res.status(404).json({ error: "Regra n\xE3o encontrada" });
        return;
      }
      res.json({ rule: updated });
    } catch (err) {
      console.error("Update kidscore rule error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.patch("/api/admin/filters/:id/toggle", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const filterId = req.params.id;
    try {
      const filter = await toggleFilter(filterId);
      if (!filter) {
        res.status(404).json({ error: "Filtro n\xE3o encontrado" });
        return;
      }
      res.json({ filter });
    } catch (err) {
      console.error("Toggle filter error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const bulkUpdateRulesSchema = z.object({
    rules: z.array(z.object({
      id: z.string(),
      weight: z.number().int().min(0).max(1e3),
      is_active: z.boolean()
    }))
  });
  app2.put("/api/admin/kidscore-rules", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem editar regras de ranqueamento" });
      return;
    }
    const parsed = bulkUpdateRulesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const updated = [];
      for (const rule of parsed.data.rules) {
        const [row] = await db.update(kidscoreRules).set({ weight: rule.weight, is_active: rule.is_active, updated_at: /* @__PURE__ */ new Date() }).where(eq5(kidscoreRules.id, rule.id)).returning();
        if (row)
          updated.push(row);
      }
      res.json({ rules: updated });
    } catch (err) {
      console.error("Bulk update kidscore rules error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/custom-criteria", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const rows = await db.select().from(customCriteria).orderBy(customCriteria.created_at);
      res.json({ criteria: rows });
    } catch (err) {
      console.error("List custom criteria error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const createCriterionSchema = z.object({
    key: z.string().min(1).regex(/^[a-z_]+$/, "Chave deve conter apenas letras min\xFAsculas e underscores"),
    label: z.string().min(1),
    field_type: z.enum(["boolean", "number", "text"]).default("boolean"),
    show_in_filter: z.boolean().default(true)
  });
  app2.post("/api/admin/custom-criteria", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem criar crit\xE9rios" });
      return;
    }
    const parsed = createCriterionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const [created] = await db.insert(customCriteria).values({ ...parsed.data, is_active: true }).returning();
      res.status(201).json({ criterion: created });
    } catch (err) {
      const msg = err.message;
      if (msg.includes("unique")) {
        res.status(409).json({ error: "J\xE1 existe um crit\xE9rio com essa chave" });
        return;
      }
      console.error("Create custom criterion error:", err);
      res.status(500).json({ error: msg });
    }
  });
  app2.delete("/api/admin/custom-criteria/:id", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem excluir crit\xE9rios" });
      return;
    }
    try {
      const [deleted] = await db.delete(customCriteria).where(eq5(customCriteria.id, req.params.id)).returning();
      if (!deleted) {
        res.status(404).json({ error: "Crit\xE9rio n\xE3o encontrado" });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      console.error("Delete custom criterion error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.patch("/api/admin/custom-criteria/:id", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem editar crit\xE9rios" });
      return;
    }
    const patchSchema = z.object({
      is_active: z.boolean().optional(),
      show_in_filter: z.boolean().optional(),
      label: z.string().min(1).optional()
    });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const [updated] = await db.update(customCriteria).set(parsed.data).where(eq5(customCriteria.id, req.params.id)).returning();
      if (!updated) {
        res.status(404).json({ error: "Crit\xE9rio n\xE3o encontrado" });
        return;
      }
      res.json({ criterion: updated });
    } catch (err) {
      console.error("Patch custom criterion error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const BACKOFFICE_MODULES = [
    "gestao_prompts",
    "filtros_app",
    "kidscore",
    "criterios_customizados",
    "fila_curadoria",
    "galeria",
    "operacao_ia",
    "comunidade",
    "gestao_cidades",
    "provedores_ia",
    "gestao_usuarios",
    "parcerias"
  ];
  const inviteSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    role: z.enum(["super_admin", "admin", "curador", "analista"])
  });
  app2.post(
    "/api/backoffice/users/invite",
    requireBackofficeAuth,
    requireRole("super_admin"),
    trackBackofficeActivity,
    async (req, res) => {
      const parsed = inviteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const { name, email, role } = parsed.data;
      const caller = req.backofficeUser;
      try {
        const existing = await findBackofficeUserByEmail(email);
        if (existing) {
          res.status(409).json({ error: "E-mail j\xE1 cadastrado no backoffice" });
          return;
        }
        const inviteToken = crypto2.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1e3);
        const user = await createBackofficeUser({
          name,
          email,
          role,
          createdBy: caller.backofficeUserId,
          inviteToken,
          inviteTokenExpiresAt: expiresAt
        });
        await createAuditLog({
          userId: caller.backofficeUserId,
          userEmail: caller.email,
          userRole: caller.role,
          action: "convidou_usuario",
          module: "gestao_usuarios",
          targetId: user.id,
          payloadAfter: { name, email, role },
          ip: req.ip
        });
        const proto = req.header("x-forwarded-proto") || req.protocol || "https";
        const host = req.header("x-forwarded-host") || req.get("host");
        const activationLink = `${proto}://${host}/backoffice/ativar?token=${inviteToken}`;
        const emailResult = await sendInviteEmail({
          to: email,
          name,
          role,
          activationLink,
          invitedBy: caller.name
        });
        res.status(201).json({
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status
          },
          activationLink,
          emailSent: emailResult.sent,
          message: emailResult.note
        });
      } catch (err) {
        console.error("Backoffice invite error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.get(
    "/api/backoffice/users",
    requireBackofficeAuth,
    requireRole("super_admin"),
    trackBackofficeActivity,
    async (req, res) => {
      try {
        const users2 = await listBackofficeUsers();
        const safe = users2.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          status: u.status,
          created_at: u.created_at,
          last_active_at: u.last_active_at
        }));
        res.json({ users: safe });
      } catch (err) {
        console.error("List backoffice users error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  const updateBackofficeRoleSchema = z.object({
    role: z.enum(["super_admin", "admin", "curador", "analista"])
  });
  app2.patch(
    "/api/backoffice/users/:id/role",
    requireBackofficeAuth,
    requireRole("super_admin"),
    trackBackofficeActivity,
    async (req, res) => {
      const parsed = updateBackofficeRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const caller = req.backofficeUser;
      const targetId = req.params.id;
      if (targetId === caller.backofficeUserId) {
        res.status(400).json({ error: "Voc\xEA n\xE3o pode alterar seu pr\xF3prio perfil" });
        return;
      }
      try {
        const target = await findBackofficeUserById(targetId);
        if (!target) {
          res.status(404).json({ error: "Usu\xE1rio n\xE3o encontrado" });
          return;
        }
        const before = { role: target.role };
        const updated = await updateBackofficeUserRole(targetId, parsed.data.role);
        await createAuditLog({
          userId: caller.backofficeUserId,
          userEmail: caller.email,
          userRole: caller.role,
          action: "alterou_perfil",
          module: "gestao_usuarios",
          targetId,
          payloadBefore: before,
          payloadAfter: { role: parsed.data.role },
          ip: req.ip
        });
        res.json({
          user: {
            id: updated.id,
            name: updated.name,
            email: updated.email,
            role: updated.role,
            status: updated.status
          }
        });
      } catch (err) {
        console.error("Update backoffice role error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  const updateBackofficeStatusSchema = z.object({
    status: z.enum(["ativo", "inativo"])
  });
  app2.patch(
    "/api/backoffice/users/:id/status",
    requireBackofficeAuth,
    requireRole("super_admin"),
    trackBackofficeActivity,
    async (req, res) => {
      const parsed = updateBackofficeStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const caller = req.backofficeUser;
      const targetId = req.params.id;
      if (targetId === caller.backofficeUserId) {
        res.status(400).json({ error: "Voc\xEA n\xE3o pode alterar seu pr\xF3prio status" });
        return;
      }
      try {
        const target = await findBackofficeUserById(targetId);
        if (!target) {
          res.status(404).json({ error: "Usu\xE1rio n\xE3o encontrado" });
          return;
        }
        const before = { status: target.status };
        const updated = await updateBackofficeUserStatus(targetId, parsed.data.status);
        await createAuditLog({
          userId: caller.backofficeUserId,
          userEmail: caller.email,
          userRole: caller.role,
          action: parsed.data.status === "ativo" ? "ativou_usuario" : "desativou_usuario",
          module: "gestao_usuarios",
          targetId,
          payloadBefore: before,
          payloadAfter: { status: parsed.data.status },
          ip: req.ip
        });
        res.json({
          user: {
            id: updated.id,
            name: updated.name,
            email: updated.email,
            role: updated.role,
            status: updated.status
          }
        });
      } catch (err) {
        console.error("Update backoffice status error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.get(
    "/api/backoffice/audit-log",
    requireBackofficeAuth,
    requireRole("super_admin"),
    async (req, res) => {
      const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
      const offset = parseInt(req.query.offset || "0", 10);
      const userId = req.query.user_id;
      const userEmail = req.query.user_email;
      const mod = req.query.module;
      const dateFrom = req.query.date_from ? new Date(req.query.date_from) : void 0;
      const dateTo = req.query.date_to ? new Date(req.query.date_to) : void 0;
      try {
        const result = await listAuditLogs({ limit, offset, userId, userEmail, module: mod, dateFrom, dateTo });
        res.json(result);
      } catch (err) {
        console.error("List audit log error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.get(
    "/api/backoffice/prompts",
    requireBackofficeAuth,
    requireRole("super_admin", "admin", "analista"),
    trackBackofficeActivity,
    (_req, res) => res.json({ module: "gestao_prompts", items: [] })
  );
  app2.get(
    "/api/backoffice/filtros",
    requireBackofficeAuth,
    requireRole("super_admin", "admin", "analista"),
    trackBackofficeActivity,
    (_req, res) => res.json({ module: "filtros_app", items: [] })
  );
  app2.get(
    "/api/backoffice/kidscore",
    requireBackofficeAuth,
    requireRole("super_admin", "admin", "analista"),
    trackBackofficeActivity,
    (_req, res) => res.json({ module: "kidscore", config: {} })
  );
  app2.get(
    "/api/backoffice/criterios",
    requireBackofficeAuth,
    requireRole("super_admin", "admin"),
    trackBackofficeActivity,
    (_req, res) => res.json({ module: "criterios_customizados", items: [] })
  );
  app2.get(
    "/api/backoffice/curadoria",
    requireBackofficeAuth,
    requireRole("super_admin", "admin", "curador", "analista"),
    trackBackofficeActivity,
    (_req, res) => res.json({ module: "fila_curadoria", items: [] })
  );
  app2.get(
    "/api/backoffice/galeria",
    requireBackofficeAuth,
    requireRole("super_admin", "admin", "curador"),
    trackBackofficeActivity,
    (_req, res) => res.json({ module: "galeria", items: [] })
  );
  app2.get(
    "/api/backoffice/operacao-ia",
    requireBackofficeAuth,
    requireRole("super_admin", "admin", "curador", "analista"),
    trackBackofficeActivity,
    (_req, res) => res.json({ module: "operacao_ia", stats: {} })
  );
  app2.get(
    "/api/backoffice/comunidade",
    requireBackofficeAuth,
    requireRole("super_admin", "admin", "curador", "analista"),
    trackBackofficeActivity,
    (_req, res) => res.json({ module: "comunidade", items: [] })
  );
  app2.get(
    "/api/backoffice/cidades",
    requireBackofficeAuth,
    requireRole("super_admin", "admin", "analista"),
    trackBackofficeActivity,
    (_req, res) => res.json({ module: "gestao_cidades", items: [] })
  );
  app2.get(
    "/api/backoffice/provedores-ia",
    requireBackofficeAuth,
    requireRole("super_admin"),
    trackBackofficeActivity,
    (_req, res) => res.json({ module: "provedores_ia", providers: [] })
  );
  app2.get(
    "/api/backoffice/parcerias",
    requireBackofficeAuth,
    requireRole("super_admin", "admin", "curador", "analista"),
    trackBackofficeActivity,
    (_req, res) => res.json({ module: "parcerias", items: [] })
  );
  app2.get("/api/backoffice/permissions", requireBackofficeAuth, trackBackofficeActivity, (req, res) => {
    const role = req.backofficeUser.role;
    const permissions = {
      gestao_prompts: role === "super_admin" || role === "admin" ? "full" : role === "analista" ? "read" : "none",
      filtros_app: role === "super_admin" || role === "admin" ? "full" : role === "analista" ? "read" : "none",
      kidscore: role === "super_admin" || role === "admin" ? "full" : role === "analista" ? "read" : "none",
      criterios_customizados: role === "super_admin" || role === "admin" ? "full" : "none",
      fila_curadoria: role === "super_admin" || role === "admin" || role === "curador" ? "full" : role === "analista" ? "read" : "none",
      galeria: role === "super_admin" || role === "admin" || role === "curador" ? "full" : "none",
      operacao_ia: role === "super_admin" || role === "admin" ? "full" : role === "curador" ? "partial" : role === "analista" ? "read" : "none",
      comunidade: role === "super_admin" || role === "admin" || role === "curador" ? "full" : role === "analista" ? "read" : "none",
      gestao_cidades: role === "super_admin" || role === "admin" ? "full" : role === "analista" ? "read" : "none",
      provedores_ia: role === "super_admin" ? "full" : "none",
      gestao_usuarios: role === "super_admin" ? "full" : "none",
      parcerias: role === "super_admin" || role === "admin" ? "full" : role === "curador" || role === "analista" ? "read" : "none"
    };
    res.json({ role, permissions });
  });
  app2.get(
    "/api/backoffice/demanda-cidades",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      try {
        const estado = req.query.estado || void 0;
        const items = await listCityDemand(estado);
        res.json({ demands: items, total: items.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.delete(
    "/api/backoffice/demanda-cidades/:id",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      try {
        await deleteCityDemand(req.params.id);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.post("/api/feedback", async (req, res) => {
    const parsed = insertFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const userId = req.user?.userId;
      const feedback = await createFeedback({ ...parsed.data, user_id: userId });
      res.status(201).json({ feedback });
    } catch (err) {
      console.error("Create feedback error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/feedback", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const type = req.query.type;
    const status = req.query.status;
    const VALID_TYPES = /* @__PURE__ */ new Set(["sugestao", "denuncia", "fechado"]);
    const VALID_STATUSES = /* @__PURE__ */ new Set(["pendente", "resolvido", "rejeitado"]);
    if (type && !VALID_TYPES.has(type)) {
      res.status(400).json({ error: "type inv\xE1lido" });
      return;
    }
    if (status && !VALID_STATUSES.has(status)) {
      res.status(400).json({ error: "status inv\xE1lido" });
      return;
    }
    try {
      const items = await listFeedback({ type, status });
      const unreadCount = await countUnreadFeedback();
      res.json({ feedback: items, unreadCount });
    } catch (err) {
      console.error("List feedback error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/feedback/unread-count", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const count2 = await countUnreadFeedback();
      res.json({ count: count2 });
    } catch (err) {
      console.error("Feedback unread count error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const feedbackActionSchema = z.object({
    action: z.enum(["resolver", "rejeitar", "adicionar_fila"])
  });
  app2.patch("/api/admin/feedback/:id", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const parsed = feedbackActionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const feedbackId = req.params.id;
    try {
      if (parsed.data.action === "resolver") {
        const feedback = await resolveFeedback(feedbackId, caller.id);
        if (!feedback) {
          res.status(404).json({ error: "Feedback n\xE3o encontrado" });
          return;
        }
        res.json({ feedback });
      } else if (parsed.data.action === "rejeitar") {
        const feedback = await rejectFeedback(feedbackId, caller.id);
        if (!feedback) {
          res.status(404).json({ error: "Feedback n\xE3o encontrado" });
          return;
        }
        res.json({ feedback });
      } else {
        const result = await addFeedbackToQueue(feedbackId, caller.id);
        if (!result) {
          res.status(404).json({ error: "Feedback n\xE3o encontrado" });
          return;
        }
        res.json({ feedback: result.feedback, queued_place_id: result.place_id });
      }
    } catch (err) {
      console.error("Feedback action error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const updateCitySchema = insertCitySchema.partial();
  app2.get("/api/admin/cities/geocode", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const placeId = req.query.place_id;
    if (!placeId) {
      res.status(400).json({ error: "place_id \xE9 obrigat\xF3rio" });
      return;
    }
    try {
      const result = await geocodeCityPlace(placeId);
      res.json(result);
    } catch (err) {
      console.error("City geocode error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/cities/active-prompt", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const active = await db.query.aiPrompts.findFirst({
        where: eq5(aiPrompts2.is_active, true),
        orderBy: (t, { desc: desc3 }) => [desc3(t.updated_at)]
      });
      res.json({ prompt: active?.prompt ?? null });
    } catch (err) {
      console.error("Active prompt fetch error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/cities", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const search = req.query.search;
    try {
      const cityList = await listCities(search);
      res.json({ cities: cityList });
    } catch (err) {
      console.error("List cities error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.post(
    "/api/admin/cities",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const parsed = insertCitySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const city = await createCity(parsed.data);
        res.status(201).json({ city });
      } catch (err) {
        const msg = err.message;
        if (msg.includes("unique")) {
          res.status(409).json({ error: "Cidade j\xE1 cadastrada" });
          return;
        }
        console.error("Create city error:", err);
        res.status(500).json({ error: msg });
      }
    }
  );
  app2.patch(
    "/api/admin/cities/:id",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const parsed = updateCitySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const cityId = req.params.id;
      try {
        const city = await updateCity(cityId, parsed.data);
        if (!city) {
          res.status(404).json({ error: "Cidade n\xE3o encontrada" });
          return;
        }
        res.json({ city });
      } catch (err) {
        console.error("Update city error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.patch(
    "/api/admin/cities/:id/toggle",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const cityId = req.params.id;
      try {
        const city = await toggleCityActive(cityId);
        if (!city) {
          res.status(404).json({ error: "Cidade n\xE3o encontrada" });
          return;
        }
        res.json({ city });
      } catch (err) {
        console.error("Toggle city error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.delete(
    "/api/admin/cities/:id",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const cityId = req.params.id;
      try {
        const deleted = await deleteCity(cityId);
        if (!deleted) {
          res.status(404).json({ error: "Cidade n\xE3o encontrada" });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        console.error("Delete city error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  const pipelineRunSchema = z.object({
    city_id: z.string().optional()
  });
  app2.post(
    "/api/admin/pipeline/run",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const parsed = pipelineRunSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const { city_id } = parsed.data;
      try {
        if (city_id) {
          const result = await runPipelineForCity(city_id);
          res.json({ results: [result] });
        } else {
          const results = await runPipelineForAllCities();
          res.json({ results });
        }
      } catch (err) {
        console.error("Pipeline run error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.get(
    "/api/admin/pipeline/runs",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
      const offset = parseInt(req.query.offset || "0", 10);
      try {
        const [rows, countResult] = await Promise.all([
          db.select().from(pipelineRuns2).orderBy(desc2(pipelineRuns2.started_at)).limit(limit).offset(offset),
          db.select({ count: sqlExpr`count(*)::int` }).from(pipelineRuns2)
        ]);
        res.json({ runs: rows, total: countResult[0]?.count ?? 0 });
      } catch (err) {
        console.error("List pipeline runs error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.post(
    "/api/admin/pipeline/preview",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const schema2 = z.object({
        city_id: z.string(),
        limit: z.number().int().min(1).max(200).optional().default(50)
      });
      const parsed = schema2.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const result = await previewPipelineForCity(parsed.data.city_id, parsed.data.limit);
        res.json(result);
      } catch (err) {
        console.error("Pipeline preview error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.post(
    "/api/admin/pipeline/triage",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const schema2 = z.object({
        city_id: z.string(),
        city_name: z.string(),
        places: z.array(z.object({
          place_id: z.string(),
          name: z.string(),
          formatted_address: z.string().optional().default(""),
          types: z.array(z.string()).optional().default([]),
          lat: z.number(),
          lng: z.number()
        }))
      });
      const parsed = schema2.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        let inserted = 0;
        for (const place of parsed.data.places) {
          const existing = await db.query.placesKidspot.findFirst({
            where: eq5(placesKidspot3.place_id, place.place_id)
          });
          if (!existing) {
            await db.insert(placesKidspot3).values({
              place_id: place.place_id,
              city: parsed.data.city_name,
              ciudad_id: parsed.data.city_id,
              lat: String(place.lat),
              lng: String(place.lng),
              status: "pendente"
            });
            await upsertPlaceMeta({ place_id: place.place_id, city: parsed.data.city_name });
            inserted++;
          }
        }
        res.json({ inserted });
      } catch (err) {
        console.error("Pipeline triage error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.post(
    "/api/admin/pipeline/ai-search",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const schema2 = z.object({
        city_id: z.string(),
        limit: z.number().int().min(1).max(200).optional().default(50)
      });
      const parsed = schema2.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const result = await aiSearchForCity(parsed.data.city_id, parsed.data.limit);
        res.json({ city_name: result.city_name, places: result.places, total: result.places.length });
      } catch (err) {
        console.error("Pipeline ai-search error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.post(
    "/api/admin/pipeline/apply-criteria",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const placeSchema = z.object({
        place_id: z.string(),
        name: z.string(),
        formatted_address: z.string().optional().default(""),
        types: z.array(z.string()).optional().default([]),
        rating: z.number().optional(),
        user_ratings_total: z.number().optional(),
        location: z.object({ lat: z.number(), lng: z.number() })
      });
      const schema2 = z.object({
        city_id: z.string(),
        city_name: z.string(),
        places: z.array(placeSchema)
      });
      const parsed = schema2.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const result = await applyCriteriaToPlaces(parsed.data.city_id, parsed.data.places);
        const passed = result.places.filter((p) => p.passed_criteria).length;
        const rejected = result.places.length - passed;
        res.json({ places: result.places, passed, rejected });
      } catch (err) {
        console.error("Pipeline apply-criteria error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.get(
    "/api/admin/blacklist",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      try {
        const cityId = req.query.city_id;
        const search = req.query.search;
        const conditions = [];
        if (cityId)
          conditions.push(eq5(pipelineBlacklist2.city_id, cityId));
        if (search)
          conditions.push(ilike2(pipelineBlacklist2.nome, `%${search}%`));
        const where = conditions.length > 0 ? and5(...conditions) : void 0;
        const rows = await db.select().from(pipelineBlacklist2).where(where).orderBy(desc2(pipelineBlacklist2.excluido_em));
        res.json({ items: rows });
      } catch (err) {
        console.error("List blacklist error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.post(
    "/api/admin/blacklist",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const schema2 = z.object({
        items: z.array(z.object({
          place_id: z.string(),
          city_id: z.string().optional(),
          city_name: z.string().optional(),
          nome: z.string(),
          tipo: z.string().optional()
        }))
      });
      const parsed = schema2.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        let added = 0;
        for (const item of parsed.data.items) {
          const existing = await db.query.pipelineBlacklist.findFirst({
            where: eq5(pipelineBlacklist2.place_id, item.place_id)
          });
          if (!existing) {
            await db.insert(pipelineBlacklist2).values({
              place_id: item.place_id,
              city_id: item.city_id ?? null,
              city_name: item.city_name ?? null,
              nome: item.nome,
              tipo: item.tipo ?? null,
              excluido_por: caller.id
            });
            added++;
          }
        }
        res.json({ added });
      } catch (err) {
        console.error("Add to blacklist error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.delete(
    "/api/admin/blacklist/:id",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      try {
        await db.delete(pipelineBlacklist2).where(eq5(pipelineBlacklist2.id, req.params.id));
        res.json({ ok: true });
      } catch (err) {
        console.error("Remove from blacklist error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.get(
    "/api/admin/places/pending",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
      const offset = parseInt(req.query.offset || "0", 10);
      try {
        const [rows, countResult] = await Promise.all([
          db.select().from(placesKidspot3).where(eq5(placesKidspot3.status, "pendente")).orderBy(desc2(placesKidspot3.created_at)).limit(limit).offset(offset),
          db.select({ count: sqlExpr`count(*)::int` }).from(placesKidspot3).where(eq5(placesKidspot3.status, "pendente"))
        ]);
        res.json({ places: rows, total: countResult[0]?.count ?? 0 });
      } catch (err) {
        console.error("List pending places error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  const updatePlaceStatusSchema = z.object({
    status: z.enum(["aprovado", "rejeitado"])
  });
  app2.patch(
    "/api/admin/places/:place_id/status",
    requireAuth,
    async (req, res) => {
      const caller = await getUserById(req.user.userId);
      if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
        res.status(403).json({ error: "Acesso negado" });
        return;
      }
      const parsed = updatePlaceStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const [updated] = await db.update(placesKidspot3).set({ status: parsed.data.status }).where(eq5(placesKidspot3.place_id, req.params.place_id)).returning();
        if (!updated) {
          res.status(404).json({ error: "Local n\xE3o encontrado" });
          return;
        }
        res.json({ place: updated });
      } catch (err) {
        console.error("Update place status error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  const PROVIDER_LABELS = {
    openai: "OpenAI",
    anthropic: "Anthropic / Claude",
    perplexity: "Perplexity",
    google: "Google Gemini"
  };
  const PROVIDER_MODELS = {
    openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    anthropic: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-3-5-sonnet-20241022"],
    perplexity: ["llama-3.1-sonar-large-128k-online", "llama-3.1-sonar-small-128k-online"],
    google: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-exp"]
  };
  const PROVIDER_NAMES = ["openai", "anthropic", "perplexity", "google"];
  app2.get("/api/admin/ai-providers", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const rows = await db.select().from(aiProviders2);
      const rowsByProvider = Object.fromEntries(rows.map((r) => [r.provider, r]));
      const providers = PROVIDER_NAMES.map((p) => {
        const row = rowsByProvider[p];
        return {
          provider: p,
          label: PROVIDER_LABELS[p],
          configured: !!row?.encrypted_key,
          is_active: row?.is_active ?? false,
          tested_at: row?.tested_at ?? null,
          masked_key: row?.encrypted_key ? maskApiKey(decryptApiKey(row.encrypted_key)) : null,
          available_models: PROVIDER_MODELS[p] ?? []
        };
      });
      res.json({ providers });
    } catch (err) {
      console.error("List AI providers error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const upsertProviderKeySchema = z.object({
    api_key: z.string().min(1, "Chave de API \xE9 obrigat\xF3ria")
  });
  app2.put("/api/admin/ai-providers/:provider", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem configurar provedores de IA" });
      return;
    }
    const provider = req.params.provider;
    if (!PROVIDER_NAMES.includes(provider)) {
      res.status(400).json({ error: "Provedor inv\xE1lido" });
      return;
    }
    const parsed = upsertProviderKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const encrypted = encryptApiKey(parsed.data.api_key);
      await db.insert(aiProviders2).values({ provider, encrypted_key: encrypted, is_active: true }).onConflictDoUpdate({
        target: [aiProviders2.provider],
        set: { encrypted_key: encrypted, is_active: true, updated_at: /* @__PURE__ */ new Date() }
      });
      res.json({ ok: true, masked_key: maskApiKey(parsed.data.api_key) });
    } catch (err) {
      console.error("Save AI provider key error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/admin/ai-providers/:provider/test", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const provider = req.params.provider;
    if (!PROVIDER_NAMES.includes(provider)) {
      res.status(400).json({ error: "Provedor inv\xE1lido" });
      return;
    }
    try {
      const row = await db.query.aiProviders.findFirst({
        where: eq5(aiProviders2.provider, provider)
      });
      if (!row?.encrypted_key) {
        res.status(400).json({ error: "Provedor n\xE3o configurado. Cadastre uma chave de API primeiro." });
        return;
      }
      const apiKey = decryptApiKey(row.encrypted_key);
      let testPassed = false;
      let errorMsg = "";
      if (provider === "openai") {
        const OpenAI2 = (await import("openai")).default;
        const client = new OpenAI2({ apiKey });
        const resp = await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Say ok" }],
          max_tokens: 5
        });
        testPassed = !!resp.choices[0]?.message?.content;
      } else if (provider === "anthropic") {
        const httpRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5",
            max_tokens: 5,
            messages: [{ role: "user", content: "Say ok" }]
          })
        });
        testPassed = httpRes.ok;
        if (!testPassed) {
          const d = await httpRes.json();
          errorMsg = d.error?.message || `HTTP ${httpRes.status}`;
        }
      } else if (provider === "perplexity") {
        const httpRes = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.1-sonar-small-128k-online",
            messages: [{ role: "user", content: "Say ok" }],
            max_tokens: 5
          })
        });
        testPassed = httpRes.ok;
        if (!testPassed) {
          const d = await httpRes.json();
          errorMsg = d.error?.message || `HTTP ${httpRes.status}`;
        }
      } else if (provider === "google") {
        const httpRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: "Say ok" }] }] })
          }
        );
        testPassed = httpRes.ok;
        if (!testPassed) {
          const d = await httpRes.json();
          errorMsg = d.error?.message || `HTTP ${httpRes.status}`;
        }
      }
      if (testPassed) {
        await db.update(aiProviders2).set({ tested_at: /* @__PURE__ */ new Date(), updated_at: /* @__PURE__ */ new Date() }).where(eq5(aiProviders2.provider, provider));
        res.json({ ok: true, message: "Conex\xE3o testada com sucesso!" });
      } else {
        res.status(400).json({ ok: false, error: errorMsg || "Falha na conex\xE3o com o provedor" });
      }
    } catch (err) {
      console.error("Test AI provider error:", err);
      res.status(400).json({ ok: false, error: err.message });
    }
  });
  app2.get("/api/admin/pipeline-routing", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const rows = await db.select().from(pipelineRouting2);
      res.json({ routing: rows });
    } catch (err) {
      console.error("List pipeline routing error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  const updateRoutingSchema = z.object({
    primary_provider: z.enum(["openai", "anthropic", "perplexity", "google"]).nullable().optional(),
    model: z.string().min(1).nullable().optional(),
    fallback_order: z.array(z.enum(["openai", "anthropic", "perplexity", "google"])).optional()
  });
  const PIPELINE_STAGES = ["place_discovery", "review_analysis", "description_generation", "score_calculation"];
  app2.patch("/api/admin/pipeline-routing/:stage", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem alterar o roteamento do pipeline" });
      return;
    }
    const stage = req.params.stage;
    if (!PIPELINE_STAGES.includes(stage)) {
      res.status(400).json({ error: "Etapa inv\xE1lida" });
      return;
    }
    const parsed = updateRoutingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const setClause = { updated_at: /* @__PURE__ */ new Date() };
      if (parsed.data.primary_provider !== void 0)
        setClause.primary_provider = parsed.data.primary_provider ?? null;
      if (parsed.data.model !== void 0)
        setClause.model = parsed.data.model ?? null;
      if (parsed.data.fallback_order !== void 0)
        setClause.fallback_order = parsed.data.fallback_order;
      const [updated] = await db.update(pipelineRouting2).set(setClause).where(eq5(pipelineRouting2.stage, stage)).returning();
      if (!updated) {
        res.status(404).json({ error: "Etapa n\xE3o encontrada" });
        return;
      }
      res.json({ routing: updated });
    } catch (err) {
      console.error("Update pipeline routing error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  async function requireAdminOrCollaborator(req, res, next) {
    if (!req.user) {
      res.status(401).json({ error: "N\xE3o autenticado" });
      return;
    }
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    req.caller = caller;
    next();
  }
  app2.get(
    "/api/admin/curation/queue",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const status = req.query.status || "pendente";
      const city = req.query.city;
      const category = req.query.category;
      const minKidScore = req.query.min_kid_score ? parseInt(req.query.min_kid_score, 10) : void 0;
      const maxKidScore = req.query.max_kid_score ? parseInt(req.query.max_kid_score, 10) : void 0;
      const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
      const offset = parseInt(req.query.offset || "0", 10);
      const placeType = req.query.place_type;
      const validStatuses = ["pendente", "aprovado", "rejeitado"];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ error: "status inv\xE1lido" });
        return;
      }
      try {
        const result = await listCurationQueue({
          status,
          city,
          category,
          minKidScore,
          maxKidScore,
          placeType: placeType === "comer" || placeType === "parques" ? placeType : void 0,
          limit,
          offset
        });
        res.json(result);
      } catch (err) {
        console.error("Curation queue error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.get(
    "/api/admin/curation/pending-count",
    requireAuth,
    requireAdminOrCollaborator,
    async (_req, res) => {
      try {
        const count2 = await countPendingCuration();
        res.json({ count: count2 });
      } catch (err) {
        console.error("Pending count error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  const curationApproveSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    custom_criteria: z.record(z.unknown()).optional(),
    place_type: z.enum(["comer", "parques"]).optional()
  });
  app2.post(
    "/api/admin/curation/:placeId/approve",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const placeId = req.params.placeId;
      const parsed = curationApproveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        await approveCurationItem(placeId, req.user.userId, parsed.data);
        res.json({ ok: true });
      } catch (err) {
        console.error("Approve curation error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.post(
    "/api/admin/curation/:placeId/reject",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const placeId = req.params.placeId;
      try {
        await rejectCurationItem(placeId, req.user.userId);
        res.json({ ok: true });
      } catch (err) {
        console.error("Reject curation error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  const ingestPlaceSchema = z.object({
    place_id: z.string().min(1),
    name: z.string().optional(),
    address: z.string().optional(),
    category: z.string().optional(),
    city: z.string().optional(),
    kid_score: z.number().int().min(0).max(100).optional(),
    ai_evidences: z.array(z.string()).optional(),
    description: z.string().optional(),
    photos: z.array(z.object({
      url: z.string().url(),
      photo_reference: z.string().optional(),
      order: z.number().int().optional()
    })).optional()
  });
  app2.post(
    "/api/admin/curation/ingest",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const parsed = ingestPlaceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const { place_id, photos, ...meta } = parsed.data;
        await upsertPlaceMeta({ place_id, ...meta });
        if (photos && photos.length > 0) {
          for (const p of photos) {
            await addPlacePhoto({ place_id, ...p });
          }
        }
        res.status(201).json({ ok: true });
      } catch (err) {
        console.error("Ingest place error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.get(
    "/api/admin/curation/:placeId/photos",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const placeId = req.params.placeId;
      try {
        const photos = await listPlacePhotos(placeId);
        res.json({ photos });
      } catch (err) {
        console.error("List photos error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.patch(
    "/api/admin/photos/:photoId/cover",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const photoId = req.params.photoId;
      const placeId = req.body.place_id;
      if (!placeId) {
        res.status(400).json({ error: "place_id is required" });
        return;
      }
      try {
        await setCoverPhoto(placeId, photoId);
        res.json({ ok: true });
      } catch (err) {
        console.error("Set cover error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.delete(
    "/api/admin/photos/:photoId",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const photoId = req.params.photoId;
      try {
        await deletePlacePhoto(photoId);
        res.json({ ok: true });
      } catch (err) {
        console.error("Delete photo error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.get("/api/admin/sponsorship/plans", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const plans = await listSponsorshipPlans();
      res.json({ plans });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/admin/sponsorship/plans", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const parsed = insertSponsorshipPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const plan = await createSponsorshipPlan({
        name: parsed.data.name,
        priority: parsed.data.priority,
        reference_price: parsed.data.reference_price,
        benefits: parsed.data.benefits ?? null
      });
      res.status(201).json({ plan });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.patch("/api/admin/sponsorship/plans/:id", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const { id } = req.params;
    const parsed = insertSponsorshipPlanSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const plan = await updateSponsorshipPlan(id, {
        ...parsed.data,
        reference_price: parsed.data.reference_price
      });
      if (!plan) {
        res.status(404).json({ error: "Plano n\xE3o encontrado" });
        return;
      }
      res.json({ plan });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.delete("/api/admin/sponsorship/plans/:id", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const { id } = req.params;
    try {
      const ok = await deleteSponsorshipPlan(id);
      if (!ok) {
        res.status(404).json({ error: "Plano n\xE3o encontrado" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/sponsorship/contracts", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const status = req.query.status;
    const place_id = req.query.place_id;
    try {
      await expireStaleContracts();
      const contracts = await listSponsorshipContracts({ status, place_id });
      res.json({ contracts });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.post("/api/admin/sponsorship/contracts", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const parsed = insertSponsorshipContractSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const contract = await createSponsorshipContract({
        place_id: parsed.data.place_id,
        place_name: parsed.data.place_name,
        plan_id: parsed.data.plan_id,
        starts_at: new Date(parsed.data.starts_at),
        ends_at: new Date(parsed.data.ends_at),
        notes: parsed.data.notes ?? null
      });
      res.status(201).json({ contract });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.patch("/api/admin/sponsorship/contracts/:id", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const { id } = req.params;
    const updateSchema = z.object({
      plan_id: z.string().optional(),
      starts_at: z.string().datetime().optional(),
      ends_at: z.string().datetime().optional(),
      status: z.enum(["ativo", "expirado", "cancelado"]).optional(),
      notes: z.string().optional().nullable()
    });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const contract = await updateSponsorshipContract(id, {
        ...parsed.data,
        starts_at: parsed.data.starts_at ? new Date(parsed.data.starts_at) : void 0,
        ends_at: parsed.data.ends_at ? new Date(parsed.data.ends_at) : void 0
      });
      if (!contract) {
        res.status(404).json({ error: "Contrato n\xE3o encontrado" });
        return;
      }
      res.json({ contract });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/sponsorship/contracts/:id/performance", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const { id } = req.params;
    try {
      const perf = await getSponsorshipPerformance(id);
      if (!perf) {
        res.status(404).json({ error: "Contrato n\xE3o encontrado" });
        return;
      }
      res.json({ performance: perf });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/admin/sponsorship/search-places", requireAuth, async (req, res) => {
    const caller = await getUserById(req.user.userId);
    if (!caller || caller.role !== "admin" && caller.role !== "colaborador") {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const q = req.query.q ?? "";
    const city = req.query.city ?? "";
    if (!q || q.trim().length < 2) {
      res.status(400).json({ error: "Informe pelo menos 2 caracteres" });
      return;
    }
    try {
      const results = await textSearchClaimable(q.trim(), city.trim());
      res.json({ places: results.slice(0, 10) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/cities/check", async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const label = (req.query.label || "").trim() || null;
    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: "lat e lng s\xE3o obrigat\xF3rios" });
      return;
    }
    try {
      const result = await checkCityByCoords(lat, lng);
      if (!result || !result.enabled) {
        (async () => {
          try {
            if (label) {
              await recordCityDemand(label, lat, lng);
            } else {
              const geo = await reverseGeocodeCity(lat, lng);
              if (geo)
                await recordCityDemand(geo.label, lat, lng, geo.estado);
            }
          } catch (e) {
            console.error("recordCityDemand error:", e);
          }
        })();
      }
      if (!result) {
        res.json({ enabled: false, city_id: null, city_name: null });
        return;
      }
      res.json({
        enabled: result.enabled,
        city_id: result.city.id,
        city_name: result.city.nome,
        distance_km: Math.round(result.distance_km * 10) / 10
      });
    } catch (err) {
      console.error("City check error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/cities/list", async (req, res) => {
    const search = req.query.search;
    try {
      const cities4 = await listActiveCities(search);
      res.json({ cities: cities4 });
    } catch (err) {
      console.error("List active cities error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get("/api/cities/:cityId/places", async (req, res) => {
    const cityId = req.params.cityId;
    const placeType = req.query.place_type;
    try {
      const places = await getPublishedPlacesByCity(
        cityId,
        placeType === "comer" || placeType === "parques" ? placeType : void 0
      );
      res.json({ places });
    } catch (err) {
      console.error("Curated places error:", err);
      res.status(500).json({ error: err.message });
    }
  });
  app2.get(
    "/api/admin/published/places",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const cityId = req.query.city_id;
      if (!cityId) {
        res.status(400).json({ error: "city_id \xE9 obrigat\xF3rio" });
        return;
      }
      try {
        const places = await getPublishedPlacesByCityAdmin(cityId);
        res.json({ places });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.get(
    "/api/admin/published/search-places",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const cityId = req.query.city_id;
      const q = req.query.q ?? "";
      if (!cityId) {
        res.status(400).json({ error: "city_id \xE9 obrigat\xF3rio" });
        return;
      }
      try {
        const places = await searchPlacesForPublishing(cityId, q);
        res.json({ places });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.patch(
    "/api/admin/published/:placeId/order",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const placeId = req.params.placeId;
      const parsed = z.object({ order: z.number().int().min(0) }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        await updatePlaceDisplayOrder(placeId, parsed.data.order);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.delete(
    "/api/admin/published/:placeId",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const placeId = req.params.placeId;
      try {
        await removeFromPublished(placeId);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.post(
    "/api/admin/published",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const parsed = z.object({
        place_id: z.string().min(1),
        city_id: z.string().min(1)
      }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        await addToPublished(parsed.data.place_id, parsed.data.city_id, req.user.userId);
        res.status(201).json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.get(
    "/api/admin/google-places/autocomplete",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const input = req.query.input;
      const lat = req.query.lat ? parseFloat(req.query.lat) : void 0;
      const lng = req.query.lng ? parseFloat(req.query.lng) : void 0;
      if (!input || input.trim().length === 0) {
        res.json({ suggestions: [] });
        return;
      }
      try {
        const suggestions = await autocompleteEstablishments(input.trim(), lat, lng);
        res.json({ suggestions });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
  app2.get(
    "/api/admin/google-places/details/:placeId",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const placeId = req.params.placeId;
      if (!placeId) {
        res.status(400).json({ error: "placeId is required" });
        return;
      }
      try {
        const details = await getPlaceDetails(placeId);
        res.json({ place: details });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
  const ingestAndPublishSchema = z.object({
    place_id: z.string().min(1),
    name: z.string().min(1),
    address: z.string().optional().default(""),
    category: z.string().optional().default(""),
    city: z.string().min(1),
    ciudad_id: z.string().min(1),
    lat: z.number().default(0),
    lng: z.number().default(0),
    photo_reference: z.string().optional()
  });
  app2.post(
    "/api/admin/google-places/ingest-and-publish",
    requireAuth,
    requireAdminOrCollaborator,
    async (req, res) => {
      const parsed = ingestAndPublishSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const { place_id, name, address, category, city, ciudad_id, lat, lng, photo_reference } = parsed.data;
      const userId = req.user.userId;
      try {
        await upsertPlaceWithCity({ place_id, city, ciudad_id, lat, lng });
        await upsertPlaceMeta({ place_id, name, address, category, city });
        if (photo_reference) {
          const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${encodeURIComponent(photo_reference)}&key=${process.env.GOOGLE_PLACES_API_KEY || ""}`;
          await addPlacePhoto({ place_id, url: photoUrl, photo_reference, order: 0 });
        }
        await addToPublished(place_id, ciudad_id, userId);
        res.status(201).json({ ok: true });
      } catch (err) {
        console.error("Ingest and publish error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  const httpServer = createServer(app2);
  return httpServer;
}

// server/config-defaults.ts
import { aiPrompts as aiPrompts3, kidscoreRules as kidscoreRules2, customCriteria as customCriteria2, pipelineRouting as pipelineRouting3 } from "@shared/schema";
import { count } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
var DEFAULT_AI_PROMPT = `Voc\xEA \xE9 um assistente especializado em avaliar se um estabelecimento \xE9 adequado para fam\xEDlias com crian\xE7as pequenas (0-10 anos).

Analise os textos de reviews fornecidos e identifique sinais de que o lugar \xE9 family-friendly.

Procure por men\xE7\xF5es a:
- Infraestrutura infantil: brinquedoteca, playground, \xE1rea kids, espa\xE7o kids, piscina infantil
- Equipamentos: trocador/frald\xE1rio, cadeir\xE3o/cadeirinha, banheiro fam\xEDlia
- Card\xE1pio infantil, por\xE7\xF5es kids, menu crian\xE7as
- Seguran\xE7a: ambiente seguro, cercado, monitorado
- Acessibilidade para carrinhos de beb\xEA
- Espa\xE7o amplo para crian\xE7as brincarem
- Atendimento receptivo a fam\xEDlias
- Filas r\xE1pidas ou atendimento priorit\xE1rio para fam\xEDlias
- Atividades ou eventos para crian\xE7as

Responda APENAS com um JSON v\xE1lido neste formato:
{
  "family_score": <n\xFAmero de 0 a 100>,
  "highlights": [<lista de at\xE9 3 destaques curtos em portugu\xEAs, ex: "Brinquedoteca monitorada", "Card\xE1pio kids">],
  "confidence": "<high|medium|low>"
}

- family_score: 0 = nenhuma evid\xEAncia familiar, 100 = excelente para fam\xEDlias
- Se n\xE3o houver nenhuma men\xE7\xE3o a crian\xE7as/fam\xEDlia, retorne score 0 e lista vazia
- confidence: high = m\xFAltiplas men\xE7\xF5es claras, medium = algumas men\xE7\xF5es, low = ind\xEDcios vagos`;
var DEFAULT_KIDSCORE_RULES = [
  { key: "type_bonus_premium", label: "B\xF4nus por tipo premium (playground, zoo, etc)", weight: 40 },
  { key: "espaco_kids", label: "Espa\xE7o Kids", weight: 25 },
  { key: "trocador", label: "Frald\xE1rio / Trocador", weight: 20 },
  { key: "cadeirao", label: "Cadeir\xE3o", weight: 15 },
  { key: "rating_bonus", label: "B\xF4nus de qualidade (nota \u2265 4.2, \u2265 20 avalia\xE7\xF5es)", weight: 10 },
  { key: "proximity_bonus", label: "B\xF4nus de proximidade (\u2264 1 km)", weight: 10 },
  { key: "tier1_review_per_review", label: "Ponto por review Tier 1 (infra infantil espec\xEDfica)", weight: 15 },
  { key: "tier1_review_per_label", label: "Ponto por label Tier 1 distinto", weight: 10 },
  { key: "tier2_review_per_review", label: "Ponto por review Tier 2 (sinal familiar gen\xE9rico)", weight: 3 },
  { key: "tier2_review_per_label", label: "Ponto por label Tier 2 distinto", weight: 2 }
];
var DEFAULT_CUSTOM_CRITERIA = [
  { key: "espaco_kids", label: "Espa\xE7o Kids", field_type: "boolean", show_in_filter: true },
  { key: "trocador", label: "Frald\xE1rio / Trocador", field_type: "boolean", show_in_filter: true },
  { key: "cadeirao", label: "Cadeir\xE3o", field_type: "boolean", show_in_filter: true },
  { key: "banheiro_familia", label: "Banheiro Fam\xEDlia", field_type: "boolean", show_in_filter: true },
  { key: "seguro", label: "Ambiente Seguro", field_type: "boolean", show_in_filter: true }
];
async function runMigrations() {
  const migrationsDir = path.resolve(process.cwd(), "server", "migrations");
  if (!fs.existsSync(migrationsDir))
    return;
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql2 = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    try {
      await pool.query(sql2);
      console.log(`[migrations] applied: ${file}`);
    } catch (err) {
      console.warn(`[migrations] ${file} failed (may already be applied):`, err.message);
    }
  }
}
var DEFAULT_PIPELINE_STAGES = [
  { stage: "place_discovery", primary_provider: "openai", model: "gpt-4o-mini", fallback_order: [] },
  { stage: "review_analysis", primary_provider: "openai", model: "gpt-4o-mini", fallback_order: [] },
  { stage: "description_generation", primary_provider: "openai", model: "gpt-4o-mini", fallback_order: [] },
  { stage: "score_calculation", primary_provider: "openai", model: "gpt-4o-mini", fallback_order: [] }
];
async function seedConfigDefaults() {
  try {
    await runMigrations();
  } catch (err) {
    console.warn("[migrations] failed:", err);
  }
  try {
    const [promptCount] = await db.select({ count: count() }).from(aiPrompts3);
    if ((promptCount?.count ?? 0) === 0) {
      await db.insert(aiPrompts3).values({
        name: "default",
        prompt: DEFAULT_AI_PROMPT,
        is_active: true
      });
      console.log("[seed] ai_prompts: inserted default prompt");
    }
    const [ruleCount] = await db.select({ count: count() }).from(kidscoreRules2);
    if ((ruleCount?.count ?? 0) === 0) {
      await db.insert(kidscoreRules2).values(
        DEFAULT_KIDSCORE_RULES.map((r) => ({ ...r, is_active: true }))
      );
      console.log("[seed] kidscore_rules: inserted", DEFAULT_KIDSCORE_RULES.length, "rules");
    }
    const [criteriaCount] = await db.select({ count: count() }).from(customCriteria2);
    if ((criteriaCount?.count ?? 0) === 0) {
      await db.insert(customCriteria2).values(
        DEFAULT_CUSTOM_CRITERIA.map((c) => ({ ...c, is_active: true }))
      );
      console.log("[seed] custom_criteria: inserted", DEFAULT_CUSTOM_CRITERIA.length, "criteria");
    }
    const [routingCount] = await db.select({ count: count() }).from(pipelineRouting3);
    if ((routingCount?.count ?? 0) === 0) {
      await db.insert(pipelineRouting3).values(DEFAULT_PIPELINE_STAGES);
      console.log("[seed] pipeline_routing: inserted", DEFAULT_PIPELINE_STAGES.length, "stages");
    }
  } catch (err) {
    console.warn("[seed] config defaults failed:", err);
  }
}

// server/index.ts
import * as fs2 from "fs";
import * as path2 from "path";
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      limit: "55mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false, limit: "55mb" }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path3 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path3.startsWith("/api"))
        return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const isAuthRoute = path3.startsWith("/api/auth/login") || path3.startsWith("/api/auth/register") || path3.startsWith("/api/admin/auth/login");
        const hasToken = capturedJsonResponse && "token" in capturedJsonResponse;
        const safeResponse = isAuthRoute || hasToken ? { ...capturedJsonResponse, token: capturedJsonResponse.token ? "[REDACTED]" : void 0 } : capturedJsonResponse;
        logLine += ` :: ${JSON.stringify(safeResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path2.resolve(process.cwd(), "app.json");
    const appJsonContent = fs2.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path2.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs2.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs2.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function serveAdminPanel(app2) {
  const adminTemplatePath = path2.resolve(
    process.cwd(),
    "server",
    "templates",
    "admin.html"
  );
  if (!fs2.existsSync(adminTemplatePath)) {
    log("Admin template not found, skipping /admin route");
    return;
  }
  app2.use("/admin", (req, res) => {
    const adminHtml = fs2.readFileSync(adminTemplatePath, "utf-8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.removeHeader("ETag");
    res.status(200).send(adminHtml);
  });
  log("Admin panel served at /admin");
}
function configureExpoAndLanding(app2) {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    log("Dev mode: proxying web traffic \u2192 Metro at http://localhost:8081");
    const metroProxy = createProxyMiddleware({
      target: "http://localhost:8081",
      changeOrigin: true,
      ws: true,
      pathFilter: (path3) => !path3.startsWith("/api") && !path3.startsWith("/admin"),
      on: {
        proxyReq: (proxyReq) => {
          proxyReq.removeHeader("origin");
        },
        error: (_err, _req, res) => {
          if (res && "writeHead" in res) {
            res.status(503).send(
              `<html><head><meta http-equiv="refresh" content="3"></head>
               <body style="font-family:sans-serif;text-align:center;padding:60px">
               <p>Starting Expo bundler\u2026 the page will refresh automatically.</p>
               </body></html>`
            );
          }
        }
      }
    });
    app2.use((req, res, next) => {
      if (req.path.startsWith("/api"))
        return next();
      if (req.path.startsWith("/admin"))
        return next();
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return serveExpoManifest(platform, res);
      }
      return next();
    });
    app2.use(metroProxy);
    return;
  }
  const templatePath = path2.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs2.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api"))
      return next();
    if (req.path !== "/" && req.path !== "/manifest")
      return next();
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({ req, res, landingPageTemplate, appName });
    }
    next();
  });
  app2.use("/assets", express.static(path2.resolve(process.cwd(), "assets")));
  app2.use(express.static(path2.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  serveAdminPanel(app);
  configureExpoAndLanding(app);
  await seedConfigDefaults();
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0"
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
})();
