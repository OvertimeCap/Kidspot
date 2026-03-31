import type { Express, Response, NextFunction } from "express";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { pool, db } from "./db";
import { searchPlaces, getPlaceDetails, autocompletePlaces, geocodePlace } from "./google-places";
import { sendInviteEmail } from "./email";
import { runPipelineForCity, runPipelineForAllCities } from "./pipeline";
import { encryptApiKey, decryptApiKey, maskApiKey } from "./ai-crypto";
import {
  createReview,
  getReviewsForPlace,
  toggleFavorite,
  getFavoritesForUser,
  createUser,
  findUserByEmail,
  verifyPassword,
  findOrCreateGoogleUser,
  listUsers,
  updateUserRole,
  getUserById,
  createClaim,
  getClaimsForUser,
  listClaims,
  approveClaim,
  denyClaim,
  getApprovedAdminForPlace,
  getApprovedPlaceIds,
  createPartnerStory,
  getActiveStoriesForPlaces,
  getStoriesNearby,
  getStoryPhotos,
  getStoryPhotoById,
  getStoryById,
  createBackofficeUser,
  findBackofficeUserByEmail,
  findBackofficeUserById,
  findBackofficeUserByInviteToken,
  activateBackofficeUser,
  listBackofficeUsers,
  updateBackofficeUserRole,
  updateBackofficeUserStatus,
  updateBackofficeUserLastActive,
  verifyBackofficePassword,
  createAuditLog,
  listAuditLogs,
  listFilters,
  getActiveFilters,
  createFilter,
  updateFilter,
  toggleFilter,
  archiveExpiredFilters,
  createFeedback,
  listFeedback,
  countUnreadFeedback,
  resolveFeedback,
  rejectFeedback,
  addFeedbackToQueue,
  listCities,
  getCityById,
  createCity,
  updateCity,
  toggleCityActive,
  deleteCity,
  listCurationQueue,
  countPendingCuration,
  upsertPlaceMeta,
  approveCurationItem,
  rejectCurationItem,
  listPlacePhotos,
  addPlacePhoto,
  setCoverPhoto,
  deletePlacePhoto,
} from "./storage";
import { insertReviewSchema, insertClaimSchema, insertFeedbackSchema, insertFilterSchema, insertCitySchema, type UserRole, type BackofficeRole, aiPrompts, kidscoreRules, customCriteria, cities, pipelineRuns, placesKidspot, aiProviders, pipelineRouting } from "@shared/schema";
import { requireAuth, requireAdmin, signToken, signBackofficeToken, verifyBackofficeToken, requireBackofficeAuth, requireRole, type AuthRequest } from "./auth";
import { textSearchClaimable } from "./google-places";
import { invalidatePromptCache } from "./ai-review-analysis";
import { eq, desc, sql as sqlExpr } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";

export async function registerRoutes(app: Express): Promise<Server> {
  /* ------------------------------------------------------------------ */
  /* Backoffice middleware helpers                                        */
  /* ------------------------------------------------------------------ */

  function trackBackofficeActivity(req: AuthRequest, _res: Response, next: NextFunction): void {
    if (req.backofficeUser) {
      updateBackofficeUserLastActive(req.backofficeUser.backofficeUserId).catch(() => {});
    }
    next();
  }

  function withAudit(action: string, module: string) {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
      res.on("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 300 && req.backofficeUser) {
          createAuditLog({
            userId: req.backofficeUser.backofficeUserId,
            userEmail: req.backofficeUser.email,
            userRole: req.backofficeUser.role,
            action,
            module,
            ip: req.ip,
          }).catch(() => {});
        }
      });
      next();
    };
  }

  app.get("/api/health", (_req: AuthRequest, res: Response) => {
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------------ */
  /* Admin backoffice auth                                                */
  /* ------------------------------------------------------------------ */

  const adminLoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  app.post("/api/admin/auth/login", async (req: AuthRequest, res: Response) => {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { email, password } = parsed.data;

    try {
      const user = await findUserByEmail(email.toLowerCase());
      if (!user) {
        res.status(401).json({ error: "Credenciais inválidas" });
        return;
      }

      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        res.status(401).json({ error: "Credenciais inválidas" });
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
        name: user.name,
      });
      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    } catch (err) {
      console.error("Admin login error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/admin/auth/me", requireAdmin, async (req: AuthRequest, res: Response) => {
    const dbUser = await getUserById(req.user!.userId);
    if (!dbUser) {
      res.status(401).json({ error: "Usuário não encontrado" });
      return;
    }
    res.json({
      user: {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        role: dbUser.role,
      },
    });
  });

  app.get("/api/kidspot/ping-db", async (_req: AuthRequest, res: Response) => {
    try {
      await pool.query("SELECT 1");
      res.json({ db: true });
    } catch (err) {
      console.error("DB ping failed:", err);
      res.status(500).json({ db: false, error: "Database unreachable" });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Auth routes                                                          */
  /* ------------------------------------------------------------------ */

  const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
  });

  app.post("/api/auth/register", async (req: AuthRequest, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { name, email, password } = parsed.data;

    const existing = await findUserByEmail(email.toLowerCase());
    if (existing) {
      res.status(409).json({ error: "E-mail já cadastrado" });
      return;
    }

    try {
      const user = await createUser({ name, email: email.toLowerCase(), password });
      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      });
      res.status(201).json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, linked_place_id: user.linked_place_id ?? null, linked_place_name: user.linked_place_name ?? null, linked_place_address: user.linked_place_address ?? null },
      });
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  app.post("/api/auth/login", async (req: AuthRequest, res: Response) => {
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
        name: user.name,
      });
      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, linked_place_id: user.linked_place_id ?? null, linked_place_name: user.linked_place_name ?? null, linked_place_address: user.linked_place_address ?? null },
      });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req: AuthRequest, res: Response) => {
    const dbUser = await getUserById(req.user!.userId);
    if (!dbUser) {
      res.status(401).json({ error: "Usuário não encontrado" });
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
        linked_place_address: dbUser.linked_place_address,
      },
    });
  });

  const googleSchema = z.object({ accessToken: z.string().min(1) });

  app.post("/api/auth/google", async (req: AuthRequest, res: Response) => {
    const parsed = googleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "accessToken é obrigatório" });
      return;
    }

    try {
      const googleRes = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        { headers: { Authorization: `Bearer ${parsed.data.accessToken}` } },
      );

      if (!googleRes.ok) {
        res.status(401).json({ error: "Token Google inválido ou expirado" });
        return;
      }

      const profile = (await googleRes.json()) as {
        sub: string;
        email: string;
        name: string;
        email_verified: boolean;
      };

      if (!profile.email_verified) {
        res.status(401).json({ error: "E-mail Google não verificado" });
        return;
      }

      const user = await findOrCreateGoogleUser({
        email: profile.email,
        name: profile.name ?? profile.email.split("@")[0],
      });

      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      });

      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, linked_place_id: user.linked_place_id ?? null, linked_place_name: user.linked_place_name ?? null, linked_place_address: user.linked_place_address ?? null },
      });
    } catch (err) {
      console.error("Google auth error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Places photo proxy                                                   */
  /* ------------------------------------------------------------------ */

  app.get("/api/places/photo", async (req: AuthRequest, res: Response) => {
    const reference = req.query.reference as string;
    const maxwidth = (req.query.maxwidth as string) || "400";

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
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Places search / details                                              */
  /* ------------------------------------------------------------------ */

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
    "community_center",
  ] as const;

  const searchBodySchema = z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      radius: z.number().positive().max(10_000).default(5_000),
      establishmentType: z.enum(ESTABLISHMENT_TYPES).optional(),
      establishmentTypes: z.array(z.enum(ESTABLISHMENT_TYPES)).optional(),
      openNow: z.boolean().optional(),
      query: z.string().optional(),
      sortBy: z.enum(["kidScore", "distance", "rating"]).default("kidScore"),
    })
    .refine(
      (d) =>
        d.establishmentType != null ||
        (d.establishmentTypes != null && d.establishmentTypes.length > 0),
      { message: "Provide establishmentType or establishmentTypes" },
    );

  app.post("/api/places/search", async (req: AuthRequest, res: Response) => {
    const parsed = searchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const places = await searchPlaces(parsed.data);
      res.json({ places });
    } catch (err) {
      console.error("Places search error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/places/autocomplete", async (req: AuthRequest, res: Response) => {
    const input = (req.query.input as string) ?? "";
    const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
    const lng = req.query.lng ? parseFloat(req.query.lng as string) : undefined;

    try {
      const suggestions = await autocompletePlaces(input, lat, lng);
      res.json({ suggestions });
    } catch (err) {
      console.error("Autocomplete error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/places/geocode", async (req: AuthRequest, res: Response) => {
    const placeId = req.query.place_id as string;
    if (!placeId) {
      res.status(400).json({ error: "place_id query parameter is required" });
      return;
    }

    try {
      const result = await geocodePlace(placeId);
      res.json(result);
    } catch (err) {
      console.error("Geocode error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/places/details", async (req: AuthRequest, res: Response) => {
    const placeId = req.query.place_id as string;
    if (!placeId) {
      res.status(400).json({ error: "place_id query parameter is required" });
      return;
    }

    try {
      const details = await getPlaceDetails(placeId);
      res.json({ place: details });
    } catch (err) {
      console.error("Places details error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Places search for claimable establishments                          */
  /* ------------------------------------------------------------------ */

  app.get("/api/places/search-claimable", requireAuth, async (req: AuthRequest, res: Response) => {
    const q = (req.query.q as string) ?? "";
    const city = (req.query.city as string) ?? "";

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
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Reviews                                                              */
  /* ------------------------------------------------------------------ */

  app.post("/api/reviews", requireAuth, async (req: AuthRequest, res: Response) => {
    const parsed = insertReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const review = await createReview(parsed.data, req.user!.userId);
      res.status(201).json({ review });
    } catch (err) {
      console.error("Create review error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/reviews", async (req: AuthRequest, res: Response) => {
    const placeId = req.query.place_id as string;
    if (!placeId) {
      res.status(400).json({ error: "place_id query parameter is required" });
      return;
    }

    try {
      const reviewList = await getReviewsForPlace(placeId);
      res.json({ reviews: reviewList });
    } catch (err) {
      console.error("Get reviews error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Favorites (protected — require JWT)                                  */
  /* ------------------------------------------------------------------ */

  app.post("/api/favorites/toggle", requireAuth, async (req: AuthRequest, res: Response) => {
    const placeId = req.body?.place_id as string | undefined;
    if (!placeId) {
      res.status(400).json({ error: "place_id is required" });
      return;
    }

    const userKey = req.user!.userId;

    try {
      const result = await toggleFavorite(userKey, placeId);
      res.json(result);
    } catch (err) {
      console.error("Toggle favorite error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/favorites", requireAuth, async (req: AuthRequest, res: Response) => {
    const userKey = req.user!.userId;

    try {
      const favList = await getFavoritesForUser(userKey);
      res.json({ favorites: favList });
    } catch (err) {
      console.error("Get favorites error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Place Claims                                                         */
  /* ------------------------------------------------------------------ */

  const CLAIM_VALID_STATUSES = new Set(["pending", "approved", "denied"]);

  app.post("/api/claims", requireAuth, async (req: AuthRequest, res: Response) => {
    const parsed = insertClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const userId = req.user!.userId;

    try {
      const dbUser = await getUserById(userId);
      if (!dbUser) {
        res.status(401).json({ error: "Usuário não encontrado" });
        return;
      }

      if (dbUser.role !== "usuario") {
        res.status(403).json({ error: "Apenas usuários comuns podem solicitar vínculo com estabelecimento" });
        return;
      }

      if (dbUser.linked_place_id) {
        res.status(409).json({ error: "Você já possui um estabelecimento vinculado" });
        return;
      }

      const approvedAdmin = await getApprovedAdminForPlace(parsed.data.place_id);
      if (approvedAdmin) {
        res.status(409).json({ error: "Este local já possui um administrador aprovado" });
        return;
      }

      const existingClaims = await getClaimsForUser(userId);
      const hasPending = existingClaims.some((c) => c.status === "pending");
      if (hasPending) {
        res.status(409).json({ error: "Você já possui uma solicitação pendente" });
        return;
      }

      const claim = await createClaim(userId, parsed.data);
      res.status(201).json({ claim });
    } catch (err) {
      console.error("Create claim error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/claims/my", requireAuth, async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    try {
      const claims = await getClaimsForUser(userId);
      res.json({ claims });
    } catch (err) {
      console.error("Get my claims error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/admin/claims", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    const status = req.query.status as string | undefined;

    if (status !== undefined && !CLAIM_VALID_STATUSES.has(status)) {
      res.status(400).json({ error: `status inválido. Use: pending, approved ou denied` });
      return;
    }

    try {
      const claims = await listClaims(status);
      res.json({ claims });
    } catch (err) {
      console.error("List claims error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const reviewClaimSchema = z.object({
    action: z.enum(["approve", "deny"]),
  });

  app.patch("/api/admin/claims/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    const parsed = reviewClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const claimId = req.params.id as string;

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
            linked_place_address: result.user.linked_place_address,
          },
        });
      } else {
        const claim = await denyClaim(claimId, caller.id);
        res.json({ claim });
      }
    } catch (err) {
      const msg = (err as Error).message;
      console.error("Review claim error:", msg);
      if (msg.includes("não encontrada")) {
        res.status(404).json({ error: msg });
      } else if (msg.includes("já foi revisada") || msg.includes("já possui um administrador")) {
        res.status(409).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* Admin — user management                                             */
  /* ------------------------------------------------------------------ */

  const ADMIN_ONLY_ROLES: UserRole[] = ["admin", "colaborador"];

  app.get("/api/admin/users", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
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
        created_at: u.created_at,
      }));
      res.json({ users: safe });
    } catch (err) {
      console.error("List users error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const updateRoleSchema = z.object({
    role: z.enum(["admin", "colaborador", "parceiro", "estabelecimento", "usuario"]),
  });

  app.patch("/api/admin/users/:id/role", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }

    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const targetRole = parsed.data.role as UserRole;

    try {
      const userId = req.params.id as string;
      const targetUser = await getUserById(userId);
      if (!targetUser) {
        res.status(404).json({ error: "Usuário não encontrado" });
        return;
      }

      if (caller.role === "colaborador") {
        if (ADMIN_ONLY_ROLES.includes(targetUser.role)) {
          res.status(403).json({ error: "Colaboradores não podem alterar perfis de administradores ou colaboradores" });
          return;
        }
        if (ADMIN_ONLY_ROLES.includes(targetRole)) {
          res.status(403).json({ error: "Colaboradores não podem atribuir este perfil" });
          return;
        }
      }

      const updated = await updateUserRole(userId, targetRole);
      res.json({
        user: {
          id: updated!.id,
          name: updated!.name,
          email: updated!.email,
          role: updated!.role,
        },
      });
    } catch (err) {
      console.error("Update role error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Partner Stories                                                       */
  /* ------------------------------------------------------------------ */

  app.get("/api/stories/nearby", async (req: AuthRequest, res: Response) => {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const rawRadius = parseFloat((req.query.radius as string) || "8");

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ error: "lat e lng são obrigatórios e devem ser válidos" });
      return;
    }

    const radius = isFinite(rawRadius) && rawRadius > 0 ? Math.min(rawRadius, 50) : 8;

    try {
      const stories = await getStoriesNearby(lat, lng, radius);
      res.json({ stories });
    } catch (err) {
      console.error("Get stories nearby error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/stories", async (req: AuthRequest, res: Response) => {
    const placeIdsParam = req.query.place_ids as string | undefined;
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
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const ALLOWED_IMAGE_PREFIXES = [
    "data:image/jpeg;base64,",
    "data:image/jpg;base64,",
    "data:image/png;base64,",
    "data:image/webp;base64,",
    "data:image/gif;base64,",
    "data:image/heic;base64,",
    "data:image/heif;base64,",
  ];

  const isValidImageDataUri = (s: string) =>
    ALLOWED_IMAGE_PREFIXES.some((prefix) => s.startsWith(prefix));

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

  const createStorySchema = z.object({
    photos: z
      .array(
        z.string().refine(isValidImageDataUri, {
          message: "Cada foto deve ser uma imagem válida (jpeg, png, webp)",
        }),
      )
      .min(1)
      .max(10)
      .refine(
        (photos) => photos.every((p) => Buffer.byteLength(p, "utf8") <= MAX_PHOTO_BYTES),
        { message: "Cada foto deve ter no máximo 5 MB" },
      ),
  });

  app.post("/api/stories", requireAuth, async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;

    const dbUser = await getUserById(userId);
    if (!dbUser) {
      res.status(401).json({ error: "Usuário não encontrado" });
      return;
    }

    if (dbUser.role !== "parceiro" && dbUser.role !== "estabelecimento") {
      res.status(403).json({ error: "Apenas parceiros e estabelecimentos podem publicar stories" });
      return;
    }

    if (!dbUser.linked_place_id || !dbUser.linked_place_name) {
      res.status(403).json({ error: "Você precisa ter um local vinculado para publicar stories" });
      return;
    }

    const parsed = createStorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      let placeLat: number;
      let placeLng: number;
      try {
        const details = await getPlaceDetails(dbUser.linked_place_id);
        if (details?.location?.lat == null || details?.location?.lng == null) {
          res.status(422).json({ error: "Não foi possível obter as coordenadas do seu local. Tente novamente." });
          return;
        }
        placeLat = details.location.lat;
        placeLng = details.location.lng;
      } catch {
        res.status(422).json({ error: "Não foi possível obter as coordenadas do seu local. Verifique sua conexão e tente novamente." });
        return;
      }

      const story = await createPartnerStory(
        userId,
        dbUser.linked_place_id,
        dbUser.linked_place_name,
        parsed.data.photos,
        placeLat,
        placeLng,
      );
      res.status(201).json({ story });
    } catch (err) {
      console.error("Create story error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/stories/:id/photos", async (req: AuthRequest, res: Response) => {
    const storyId = req.params.id as string;

    try {
      const story = await getStoryById(storyId);
      if (!story) {
        res.status(404).json({ error: "Story não encontrado" });
        return;
      }

      if (story.expires_at < new Date()) {
        res.status(404).json({ error: "Story expirado" });
        return;
      }

      const photos = await getStoryPhotos(storyId);
      res.json({ photos: photos.map((p) => ({ id: p.id, order: p.order })) });
    } catch (err) {
      console.error("Get story photos error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/stories/photo/:photoId", async (req: AuthRequest, res: Response) => {
    const photoId = req.params.photoId as string;

    try {
      const photo = await getStoryPhotoById(photoId);
      if (!photo) {
        res.status(404).json({ error: "Foto não encontrada" });
        return;
      }

      const parentStory = await getStoryById(photo.story_id);
      if (!parentStory || parentStory.expires_at < new Date()) {
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
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Backoffice Auth                                                      */
  /* ------------------------------------------------------------------ */

  const backofficeLoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  app.post("/api/backoffice/auth/login", async (req: AuthRequest, res: Response) => {
    const parsed = backofficeLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { email, password } = parsed.data;

    try {
      const user = await findBackofficeUserByEmail(email);
      if (!user) {
        res.status(401).json({ error: "Credenciais inválidas" });
        return;
      }

      if (user.status !== "ativo") {
        res.status(401).json({ error: "Conta não ativa. Verifique seu e-mail de convite." });
        return;
      }

      if (!user.password_hash) {
        res.status(401).json({ error: "Conta não ativada. Por favor, ative sua conta pelo link no e-mail de convite." });
        return;
      }

      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        res.status(401).json({ error: "Credenciais inválidas" });
        return;
      }

      await createAuditLog({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: "login",
        module: "auth",
        ip: req.ip,
      });

      await updateBackofficeUserLastActive(user.id);

      const token = signBackofficeToken({
        backofficeUserId: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      });

      res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
        },
      });
    } catch (err) {
      console.error("Backoffice login error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* App Filters — public                                                 */
  /* ------------------------------------------------------------------ */

  app.get("/api/filters/active", async (_req: AuthRequest, res: Response) => {
    try {
      await archiveExpiredFilters();
      const filters = await getActiveFilters();
      res.json({ filters });
    } catch (err) {
      console.error("Get active filters error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* App Filters — admin                                                  */
  /* ------------------------------------------------------------------ */

  app.get("/api/admin/filters", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      await archiveExpiredFilters();
      const filters = await listFilters();
      res.json({ filters });
    } catch (err) {
      console.error("List filters error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/filters", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
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
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* Admin — AI Prompts (Módulo 1)                                       */
  /* ------------------------------------------------------------------ */

  app.get("/api/admin/ai-prompts", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const rows = await db.select().from(aiPrompts).orderBy(desc(aiPrompts.updated_at));
      res.json({ prompts: rows });
    } catch (err) {
      console.error("List prompts error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/admin/ai-prompts/active", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const active = await db.query.aiPrompts.findFirst({
        where: eq(aiPrompts.is_active, true),
        orderBy: (t, { desc }) => [desc(t.updated_at)],
      });
      res.json({ prompt: active ?? null });
    } catch (err) {
      console.error("Get active prompt error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const upsertPromptSchema = z.object({
    prompt: z.string().min(10, "Prompt muito curto"),
  });

  app.put("/api/admin/ai-prompts/active", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
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
        where: eq(aiPrompts.is_active, true),
        orderBy: (t, { desc }) => [desc(t.updated_at)],
      });
      if (existing) {
        const [updated] = await db
          .update(aiPrompts)
          .set({ prompt: parsed.data.prompt, updated_at: new Date(), created_by: caller.id })
          .where(eq(aiPrompts.id, existing.id))
          .returning();
        invalidatePromptCache();
        res.json({ prompt: updated });
      } else {
        const [created] = await db
          .insert(aiPrompts)
          .values({ name: "default", prompt: parsed.data.prompt, is_active: true, created_by: caller.id })
          .returning();
        invalidatePromptCache();
        res.status(201).json({ prompt: created });
      }
    } catch (err) {
      console.error("Upsert prompt error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const testPromptSchema = z.object({
    prompt: z.string().min(10),
    placeName: z.string().min(1),
    reviews: z.array(z.string()).min(1).max(5),
  });

  app.post("/api/admin/ai-prompts/test", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
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
      res.status(422).json({ error: "OPENAI_API_KEY não configurada no servidor" });
      return;
    }

    try {
      const { default: OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey });

      const combinedReviews = parsed.data.reviews
        .map((r, i) => `Review ${i + 1}: ${r}`)
        .join("\n\n");

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: parsed.data.prompt },
          {
            role: "user",
            content: `Estabelecimento: "${parsed.data.placeName}"\n\nReviews:\n${combinedReviews}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        res.status(500).json({ error: "IA não retornou resposta" });
        return;
      }
      const result = JSON.parse(content);
      res.json({ result });
    } catch (err) {
      console.error("Test prompt error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/backoffice/auth/me", requireBackofficeAuth, async (req: AuthRequest, res: Response) => {
    try {
      const user = await findBackofficeUserById(req.backofficeUser!.backofficeUserId);
      if (!user || user.status === "inativo") {
        res.status(401).json({ error: "Usuário não encontrado ou inativo" });
        return;
      }

      await updateBackofficeUserLastActive(user.id);

      res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
        },
      });
    } catch (err) {
      console.error("Backoffice me error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Admin — KidScore Rules (Módulo 3)                                   */
  /* ------------------------------------------------------------------ */

  app.get("/api/admin/kidscore-rules", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const rows = await db.select().from(kidscoreRules).orderBy(kidscoreRules.label);
      res.json({ rules: rows });
    } catch (err) {
      console.error("List kidscore rules error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });
  const activateAccountSchema = z.object({
    token: z.string().min(1),
    password: z.string().min(8),
  });

  app.post("/api/backoffice/auth/refresh", requireBackofficeAuth, trackBackofficeActivity, async (req: AuthRequest, res: Response) => {
    try {
      const caller = req.backofficeUser!;
      const user = await findBackofficeUserById(caller.backofficeUserId);
      if (!user || user.status === "inativo") {
        res.status(401).json({ error: "Sessão inválida" });
        return;
      }
      const newToken = signBackofficeToken({
        backofficeUserId: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      });
      await updateBackofficeUserLastActive(user.id);
      res.json({ token: newToken });
    } catch (err) {
      console.error("Backoffice refresh error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/backoffice/auth/activate", async (req: AuthRequest, res: Response) => {
    const parsed = activateAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { token, password } = parsed.data;

    try {
      const user = await findBackofficeUserByInviteToken(token);
      if (!user) {
        res.status(400).json({ error: "Token de convite inválido ou já utilizado" });
        return;
      }

      if (user.invite_token_expires_at && user.invite_token_expires_at < new Date()) {
        res.status(400).json({ error: "Token de convite expirado. Solicite um novo convite." });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const activated = await activateBackofficeUser(user.id, passwordHash);

      await createAuditLog({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: "ativou_conta",
        module: "auth",
        ip: req.ip,
      });

      const jwtToken = signBackofficeToken({
        backofficeUserId: activated.id,
        email: activated.email,
        role: activated.role,
        name: activated.name,
      });

      res.json({
        token: jwtToken,
        user: {
          id: activated.id,
          name: activated.name,
          email: activated.email,
          role: activated.role,
          status: activated.status,
        },
      });
    } catch (err) {
      console.error("Backoffice activate error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.patch("/api/admin/filters/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const filterId = req.params.id as string;
    const parsed = insertFilterSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const filter = await updateFilter(filterId, parsed.data);
      if (!filter) {
        res.status(404).json({ error: "Filtro não encontrado" });
        return;
      }
      res.json({ filter });
    } catch (err) {
      console.error("Update filter error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const updateRuleSchema = z.object({
    weight: z.number().int().min(0).max(1000).optional(),
    is_active: z.boolean().optional(),
    label: z.string().min(1).optional(),
  });

  app.patch("/api/admin/kidscore-rules/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
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
      const [updated] = await db
        .update(kidscoreRules)
        .set({ ...parsed.data, updated_at: new Date() })
        .where(eq(kidscoreRules.id, req.params.id as string))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Regra não encontrada" });
        return;
      }
      res.json({ rule: updated });
    } catch (err) {
      console.error("Update kidscore rule error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.patch("/api/admin/filters/:id/toggle", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const filterId = req.params.id as string;
    try {
      const filter = await toggleFilter(filterId);
      if (!filter) {
        res.status(404).json({ error: "Filtro não encontrado" });
        return;
      }
      res.json({ filter });
    } catch (err) {
      console.error("Toggle filter error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const bulkUpdateRulesSchema = z.object({
    rules: z.array(z.object({
      id: z.string(),
      weight: z.number().int().min(0).max(1000),
      is_active: z.boolean(),
    })),
  });

  app.put("/api/admin/kidscore-rules", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
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
        const [row] = await db
          .update(kidscoreRules)
          .set({ weight: rule.weight, is_active: rule.is_active, updated_at: new Date() })
          .where(eq(kidscoreRules.id, rule.id))
          .returning();
        if (row) updated.push(row);
      }
      res.json({ rules: updated });
    } catch (err) {
      console.error("Bulk update kidscore rules error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Admin — Custom Criteria (Módulo 4)                                  */
  /* ------------------------------------------------------------------ */

  app.get("/api/admin/custom-criteria", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const rows = await db.select().from(customCriteria).orderBy(customCriteria.created_at);
      res.json({ criteria: rows });
    } catch (err) {
      console.error("List custom criteria error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const createCriterionSchema = z.object({
    key: z.string().min(1).regex(/^[a-z_]+$/, "Chave deve conter apenas letras minúsculas e underscores"),
    label: z.string().min(1),
    field_type: z.enum(["boolean", "number", "text"]).default("boolean"),
    show_in_filter: z.boolean().default(true),
  });

  app.post("/api/admin/custom-criteria", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem criar critérios" });
      return;
    }
    const parsed = createCriterionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const [created] = await db
        .insert(customCriteria)
        .values({ ...parsed.data, is_active: true })
        .returning();
      res.status(201).json({ criterion: created });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("unique")) {
        res.status(409).json({ error: "Já existe um critério com essa chave" });
        return;
      }
      console.error("Create custom criterion error:", err);
      res.status(500).json({ error: msg });
    }
  });

  app.delete("/api/admin/custom-criteria/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem excluir critérios" });
      return;
    }
    try {
      const [deleted] = await db
        .delete(customCriteria)
        .where(eq(customCriteria.id, req.params.id as string))
        .returning();
      if (!deleted) {
        res.status(404).json({ error: "Critério não encontrado" });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      console.error("Delete custom criterion error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.patch("/api/admin/custom-criteria/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem editar critérios" });
      return;
    }
    const patchSchema = z.object({
      is_active: z.boolean().optional(),
      show_in_filter: z.boolean().optional(),
      label: z.string().min(1).optional(),
    });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const [updated] = await db
        .update(customCriteria)
        .set(parsed.data)
        .where(eq(customCriteria.id, req.params.id as string))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Critério não encontrado" });
        return;
      }
      res.json({ criterion: updated });
    } catch (err) {
      console.error("Patch custom criterion error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Backoffice — User Management (Super Admin only)                     */
  /* ------------------------------------------------------------------ */

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
    "parcerias",
  ] as const;

  const inviteSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    role: z.enum(["super_admin", "admin", "curador", "analista"]),
  });

  app.post(
    "/api/backoffice/users/invite",
    requireBackofficeAuth,
    requireRole("super_admin"),
    trackBackofficeActivity,
    async (req: AuthRequest, res: Response) => {
      const parsed = inviteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      const { name, email, role } = parsed.data;
      const caller = req.backofficeUser!;

      try {
        const existing = await findBackofficeUserByEmail(email);
        if (existing) {
          res.status(409).json({ error: "E-mail já cadastrado no backoffice" });
          return;
        }

        const inviteToken = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

        const user = await createBackofficeUser({
          name,
          email,
          role: role as BackofficeRole,
          createdBy: caller.backofficeUserId,
          inviteToken,
          inviteTokenExpiresAt: expiresAt,
        });

        await createAuditLog({
          userId: caller.backofficeUserId,
          userEmail: caller.email,
          userRole: caller.role,
          action: "convidou_usuario",
          module: "gestao_usuarios",
          targetId: user.id,
          payloadAfter: { name, email, role },
          ip: req.ip,
        });

        const proto = req.header("x-forwarded-proto") || req.protocol || "https";
        const host = req.header("x-forwarded-host") || req.get("host");
        const activationLink = `${proto}://${host}/backoffice/ativar?token=${inviteToken}`;

        const emailResult = await sendInviteEmail({
          to: email,
          name,
          role,
          activationLink,
          invitedBy: caller.name,
        });

        res.status(201).json({
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
          },
          activationLink,
          emailSent: emailResult.sent,
          message: emailResult.note,
        });
      } catch (err) {
        console.error("Backoffice invite error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/api/backoffice/users",
    requireBackofficeAuth,
    requireRole("super_admin"),
    trackBackofficeActivity,
    async (req: AuthRequest, res: Response) => {
      try {
        const users = await listBackofficeUsers();
        const safe = users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          status: u.status,
          created_at: u.created_at,
          last_active_at: u.last_active_at,
        }));
        res.json({ users: safe });
      } catch (err) {
        console.error("List backoffice users error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  const updateBackofficeRoleSchema = z.object({
    role: z.enum(["super_admin", "admin", "curador", "analista"]),
  });

  app.patch(
    "/api/backoffice/users/:id/role",
    requireBackofficeAuth,
    requireRole("super_admin"),
    trackBackofficeActivity,
    async (req: AuthRequest, res: Response) => {
      const parsed = updateBackofficeRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      const caller = req.backofficeUser!;
      const targetId = req.params.id as string;

      if (targetId === caller.backofficeUserId) {
        res.status(400).json({ error: "Você não pode alterar seu próprio perfil" });
        return;
      }

      try {
        const target = await findBackofficeUserById(targetId);
        if (!target) {
          res.status(404).json({ error: "Usuário não encontrado" });
          return;
        }

        const before = { role: target.role };
        const updated = await updateBackofficeUserRole(targetId, parsed.data.role as BackofficeRole);

        await createAuditLog({
          userId: caller.backofficeUserId,
          userEmail: caller.email,
          userRole: caller.role,
          action: "alterou_perfil",
          module: "gestao_usuarios",
          targetId,
          payloadBefore: before,
          payloadAfter: { role: parsed.data.role },
          ip: req.ip,
        });

        res.json({
          user: {
            id: updated!.id,
            name: updated!.name,
            email: updated!.email,
            role: updated!.role,
            status: updated!.status,
          },
        });
      } catch (err) {
        console.error("Update backoffice role error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  const updateBackofficeStatusSchema = z.object({
    status: z.enum(["ativo", "inativo"]),
  });

  app.patch(
    "/api/backoffice/users/:id/status",
    requireBackofficeAuth,
    requireRole("super_admin"),
    trackBackofficeActivity,
    async (req: AuthRequest, res: Response) => {
      const parsed = updateBackofficeStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      const caller = req.backofficeUser!;
      const targetId = req.params.id as string;

      if (targetId === caller.backofficeUserId) {
        res.status(400).json({ error: "Você não pode alterar seu próprio status" });
        return;
      }

      try {
        const target = await findBackofficeUserById(targetId);
        if (!target) {
          res.status(404).json({ error: "Usuário não encontrado" });
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
          ip: req.ip,
        });

        res.json({
          user: {
            id: updated!.id,
            name: updated!.name,
            email: updated!.email,
            role: updated!.role,
            status: updated!.status,
          },
        });
      } catch (err) {
        console.error("Update backoffice status error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /* Backoffice — Audit Log (Super Admin only)                           */
  /* ------------------------------------------------------------------ */

  app.get(
    "/api/backoffice/audit-log",
    requireBackofficeAuth,
    requireRole("super_admin"),
    async (req: AuthRequest, res: Response) => {
      const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 200);
      const offset = parseInt((req.query.offset as string) || "0", 10);
      const userId = req.query.user_id as string | undefined;
      const userEmail = req.query.user_email as string | undefined;
      const mod = req.query.module as string | undefined;
      const dateFrom = req.query.date_from ? new Date(req.query.date_from as string) : undefined;
      const dateTo = req.query.date_to ? new Date(req.query.date_to as string) : undefined;

      try {
        const result = await listAuditLogs({ limit, offset, userId, userEmail, module: mod, dateFrom, dateTo });
        res.json(result);
      } catch (err) {
        console.error("List audit log error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /* Backoffice — Operational module routes (RBAC enforced)              */
  /* ------------------------------------------------------------------ */

  app.get("/api/backoffice/prompts", requireBackofficeAuth, requireRole("super_admin", "admin", "analista"), trackBackofficeActivity,
    (_req: AuthRequest, res: Response) => res.json({ module: "gestao_prompts", items: [] }));

  app.get("/api/backoffice/filtros", requireBackofficeAuth, requireRole("super_admin", "admin", "analista"), trackBackofficeActivity,
    (_req: AuthRequest, res: Response) => res.json({ module: "filtros_app", items: [] }));

  app.get("/api/backoffice/kidscore", requireBackofficeAuth, requireRole("super_admin", "admin", "analista"), trackBackofficeActivity,
    (_req: AuthRequest, res: Response) => res.json({ module: "kidscore", config: {} }));

  app.get("/api/backoffice/criterios", requireBackofficeAuth, requireRole("super_admin", "admin"), trackBackofficeActivity,
    (_req: AuthRequest, res: Response) => res.json({ module: "criterios_customizados", items: [] }));

  app.get("/api/backoffice/curadoria", requireBackofficeAuth, requireRole("super_admin", "admin", "curador", "analista"), trackBackofficeActivity,
    (_req: AuthRequest, res: Response) => res.json({ module: "fila_curadoria", items: [] }));

  app.get("/api/backoffice/galeria", requireBackofficeAuth, requireRole("super_admin", "admin", "curador"), trackBackofficeActivity,
    (_req: AuthRequest, res: Response) => res.json({ module: "galeria", items: [] }));

  app.get("/api/backoffice/operacao-ia", requireBackofficeAuth, requireRole("super_admin", "admin", "curador", "analista"), trackBackofficeActivity,
    (_req: AuthRequest, res: Response) => res.json({ module: "operacao_ia", stats: {} }));

  app.get("/api/backoffice/comunidade", requireBackofficeAuth, requireRole("super_admin", "admin", "curador", "analista"), trackBackofficeActivity,
    (_req: AuthRequest, res: Response) => res.json({ module: "comunidade", items: [] }));

  app.get("/api/backoffice/cidades", requireBackofficeAuth, requireRole("super_admin", "admin", "analista"), trackBackofficeActivity,
    (_req: AuthRequest, res: Response) => res.json({ module: "gestao_cidades", items: [] }));

  app.get("/api/backoffice/provedores-ia", requireBackofficeAuth, requireRole("super_admin"), trackBackofficeActivity,
    (_req: AuthRequest, res: Response) => res.json({ module: "provedores_ia", providers: [] }));

  app.get("/api/backoffice/parcerias", requireBackofficeAuth, requireRole("super_admin", "admin", "curador", "analista"), trackBackofficeActivity,
    (_req: AuthRequest, res: Response) => res.json({ module: "parcerias", items: [] }));

  /* ------------------------------------------------------------------ */
  /* Backoffice — Permission check endpoint                              */
  /* ------------------------------------------------------------------ */

  app.get("/api/backoffice/permissions", requireBackofficeAuth, trackBackofficeActivity, (req: AuthRequest, res: Response) => {
    const role = req.backofficeUser!.role;

    const permissions: Record<string, "full" | "read" | "none" | "partial"> = {
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
      parcerias: role === "super_admin" || role === "admin" ? "full" : role === "curador" || role === "analista" ? "read" : "none",
    };

    res.json({ role, permissions });
  });

  /* ------------------------------------------------------------------ */
  /* Community Feedback — public                                         */
  /* ------------------------------------------------------------------ */

  app.post("/api/feedback", async (req: AuthRequest, res: Response) => {
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
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Community Feedback — admin                                           */
  /* ------------------------------------------------------------------ */

  app.get("/api/admin/feedback", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const type = req.query.type as string | undefined;
    const status = req.query.status as string | undefined;
    const VALID_TYPES = new Set(["sugestao", "denuncia", "fechado"]);
    const VALID_STATUSES = new Set(["pendente", "resolvido", "rejeitado"]);
    if (type && !VALID_TYPES.has(type)) {
      res.status(400).json({ error: "type inválido" });
      return;
    }
    if (status && !VALID_STATUSES.has(status)) {
      res.status(400).json({ error: "status inválido" });
      return;
    }
    try {
      const items = await listFeedback({ type, status });
      const unreadCount = await countUnreadFeedback();
      res.json({ feedback: items, unreadCount });
    } catch (err) {
      console.error("List feedback error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/api/admin/feedback/unread-count", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const count = await countUnreadFeedback();
      res.json({ count });
    } catch (err) {
      console.error("Feedback unread count error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const feedbackActionSchema = z.object({
    action: z.enum(["resolver", "rejeitar", "adicionar_fila"]),
  });

  app.patch("/api/admin/feedback/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const parsed = feedbackActionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const feedbackId = req.params.id as string;
    try {
      if (parsed.data.action === "resolver") {
        const feedback = await resolveFeedback(feedbackId, caller.id);
        if (!feedback) {
          res.status(404).json({ error: "Feedback não encontrado" });
          return;
        }
        res.json({ feedback });
      } else if (parsed.data.action === "rejeitar") {
        const feedback = await rejectFeedback(feedbackId, caller.id);
        if (!feedback) {
          res.status(404).json({ error: "Feedback não encontrado" });
          return;
        }
        res.json({ feedback });
      } else {
        const result = await addFeedbackToQueue(feedbackId, caller.id);
        if (!result) {
          res.status(404).json({ error: "Feedback não encontrado" });
          return;
        }
        res.json({ feedback: result.feedback, queued_place_id: result.place_id });
      }
    } catch (err) {
      console.error("Feedback action error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Admin — Cities (Módulo 9 + Módulo 7)                               */
  /* ------------------------------------------------------------------ */

  const updateCitySchema = insertCitySchema.partial();

  app.get("/api/admin/cities", requireBackofficeAuth, trackBackofficeActivity, async (req: AuthRequest, res: Response) => {
    const search = req.query.search as string | undefined;
    try {
      const cityList = await listCities(search);
      res.json({ cities: cityList });
    } catch (err) {
      console.error("List cities error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/cities", requireBackofficeAuth, requireRole("super_admin", "admin"), trackBackofficeActivity,
    async (req: AuthRequest, res: Response) => {
      const parsed = insertCitySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const city = await createCity(parsed.data);
        res.status(201).json({ city });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("unique")) {
          res.status(409).json({ error: "Cidade já cadastrada" });
          return;
        }
        console.error("Create city error:", err);
        res.status(500).json({ error: msg });
      }
    }
  );

  app.patch("/api/admin/cities/:id", requireBackofficeAuth, requireRole("super_admin", "admin"), trackBackofficeActivity,
    async (req: AuthRequest, res: Response) => {
      const parsed = updateCitySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const cityId = req.params.id as string;
      try {
        const city = await updateCity(cityId, parsed.data);
        if (!city) {
          res.status(404).json({ error: "Cidade não encontrada" });
          return;
        }
        res.json({ city });
      } catch (err) {
        console.error("Update city error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  app.patch("/api/admin/cities/:id/toggle", requireBackofficeAuth, requireRole("super_admin", "admin"), trackBackofficeActivity,
    async (req: AuthRequest, res: Response) => {
      const cityId = req.params.id as string;
      try {
        const city = await toggleCityActive(cityId);
        if (!city) {
          res.status(404).json({ error: "Cidade não encontrada" });
          return;
        }
        res.json({ city });
      } catch (err) {
        console.error("Toggle city error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  app.delete("/api/admin/cities/:id", requireBackofficeAuth, requireRole("super_admin", "admin"), trackBackofficeActivity,
    async (req: AuthRequest, res: Response) => {
      const cityId = req.params.id as string;
      try {
        const deleted = await deleteCity(cityId);
        if (!deleted) {
          res.status(404).json({ error: "Cidade não encontrada" });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        console.error("Delete city error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  /* ------------------------------------------------------------------ */
  /* Pipeline control                                                    */
  /* ------------------------------------------------------------------ */

  const pipelineRunSchema = z.object({
    city_id: z.string().optional(),
  });

  app.post("/api/admin/pipeline/run", requireBackofficeAuth, requireRole("super_admin", "admin", "curador"), trackBackofficeActivity,
    async (req: AuthRequest, res: Response) => {
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
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  app.get("/api/admin/pipeline/runs", requireBackofficeAuth, trackBackofficeActivity,
    async (req: AuthRequest, res: Response) => {
      const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 200);
      const offset = parseInt((req.query.offset as string) || "0", 10);

      try {
        const [rows, countResult] = await Promise.all([
          db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.started_at)).limit(limit).offset(offset),
          db.select({ count: sqlExpr<number>`count(*)::int` }).from(pipelineRuns),
        ]);
        res.json({ runs: rows, total: countResult[0]?.count ?? 0 });
      } catch (err) {
        console.error("List pipeline runs error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  /* ------------------------------------------------------------------ */
  /* Places curation (status management)                                 */
  /* ------------------------------------------------------------------ */

  app.get("/api/admin/places/pending", requireBackofficeAuth, requireRole("super_admin", "admin", "curador"), trackBackofficeActivity,
    async (req: AuthRequest, res: Response) => {
      const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 200);
      const offset = parseInt((req.query.offset as string) || "0", 10);
      try {
        const [rows, countResult] = await Promise.all([
          db.select().from(placesKidspot).where(eq(placesKidspot.status, "pendente")).orderBy(desc(placesKidspot.created_at)).limit(limit).offset(offset),
          db.select({ count: sqlExpr<number>`count(*)::int` }).from(placesKidspot).where(eq(placesKidspot.status, "pendente")),
        ]);
        res.json({ places: rows, total: countResult[0]?.count ?? 0 });
      } catch (err) {
        console.error("List pending places error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  const updatePlaceStatusSchema = z.object({
    status: z.enum(["aprovado", "rejeitado"]),
  });

  app.patch("/api/admin/places/:place_id/status", requireBackofficeAuth, requireRole("super_admin", "admin", "curador"), trackBackofficeActivity,
    async (req: AuthRequest, res: Response) => {
      const parsed = updatePlaceStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const [updated] = await db.update(placesKidspot)
          .set({ status: parsed.data.status })
          .where(eq(placesKidspot.place_id, req.params.place_id as string))
          .returning();
        if (!updated) {
          res.status(404).json({ error: "Local não encontrado" });
          return;
        }
        res.json({ place: updated });
      } catch (err) {
        console.error("Update place status error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  /* ------------------------------------------------------------------ */
  /* AI Provider Hub — provider management                               */
  /* ------------------------------------------------------------------ */

  const PROVIDER_LABELS: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic / Claude",
    perplexity: "Perplexity",
    google: "Google Gemini",
  };

  const PROVIDER_MODELS: Record<string, string[]> = {
    openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    anthropic: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-3-5-sonnet-20241022"],
    perplexity: ["llama-3.1-sonar-large-128k-online", "llama-3.1-sonar-small-128k-online"],
    google: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-exp"],
  };

  const PROVIDER_NAMES = ["openai", "anthropic", "perplexity", "google"] as const;
  type ProviderName = typeof PROVIDER_NAMES[number];

  app.get("/api/admin/ai-providers", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const rows = await db.select().from(aiProviders);
      const rowsByProvider = Object.fromEntries(rows.map((r) => [r.provider, r]));
      const providers = PROVIDER_NAMES.map((p) => {
        const row = rowsByProvider[p];
        return {
          provider: p,
          label: PROVIDER_LABELS[p],
          configured: !!(row?.encrypted_key),
          is_active: row?.is_active ?? false,
          tested_at: row?.tested_at ?? null,
          masked_key: row?.encrypted_key ? maskApiKey(decryptApiKey(row.encrypted_key)) : null,
          available_models: PROVIDER_MODELS[p] ?? [],
        };
      });
      res.json({ providers });
    } catch (err) {
      console.error("List AI providers error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const upsertProviderKeySchema = z.object({
    api_key: z.string().min(1, "Chave de API é obrigatória"),
  });

  app.put("/api/admin/ai-providers/:provider", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem configurar provedores de IA" });
      return;
    }
    const provider = req.params.provider as ProviderName;
    if (!PROVIDER_NAMES.includes(provider)) {
      res.status(400).json({ error: "Provedor inválido" });
      return;
    }
    const parsed = upsertProviderKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const encrypted = encryptApiKey(parsed.data.api_key);
      await db
        .insert(aiProviders)
        .values({ provider, encrypted_key: encrypted, is_active: true })
        .onConflictDoUpdate({
          target: [aiProviders.provider],
          set: { encrypted_key: encrypted, is_active: true, updated_at: new Date() },
        });
      res.json({ ok: true, masked_key: maskApiKey(parsed.data.api_key) });
    } catch (err) {
      console.error("Save AI provider key error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/admin/ai-providers/:provider/test", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    const provider = req.params.provider as ProviderName;
    if (!PROVIDER_NAMES.includes(provider)) {
      res.status(400).json({ error: "Provedor inválido" });
      return;
    }
    try {
      const row = await db.query.aiProviders.findFirst({
        where: eq(aiProviders.provider, provider),
      });
      if (!row?.encrypted_key) {
        res.status(400).json({ error: "Provedor não configurado. Cadastre uma chave de API primeiro." });
        return;
      }
      const apiKey = decryptApiKey(row.encrypted_key);
      let testPassed = false;
      let errorMsg = "";

      if (provider === "openai") {
        const OpenAI = (await import("openai")).default;
        const client = new OpenAI({ apiKey });
        const resp = await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Say ok" }],
          max_tokens: 5,
        });
        testPassed = !!(resp.choices[0]?.message?.content);
      } else if (provider === "anthropic") {
        const httpRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5",
            max_tokens: 5,
            messages: [{ role: "user", content: "Say ok" }],
          }),
        });
        testPassed = httpRes.ok;
        if (!testPassed) {
          const d = await httpRes.json() as { error?: { message?: string } };
          errorMsg = d.error?.message || `HTTP ${httpRes.status}`;
        }
      } else if (provider === "perplexity") {
        const httpRes = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.1-sonar-small-128k-online",
            messages: [{ role: "user", content: "Say ok" }],
            max_tokens: 5,
          }),
        });
        testPassed = httpRes.ok;
        if (!testPassed) {
          const d = await httpRes.json() as { error?: { message?: string } };
          errorMsg = d.error?.message || `HTTP ${httpRes.status}`;
        }
      } else if (provider === "google") {
        const httpRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: "Say ok" }] }] }),
          },
        );
        testPassed = httpRes.ok;
        if (!testPassed) {
          const d = await httpRes.json() as { error?: { message?: string } };
          errorMsg = d.error?.message || `HTTP ${httpRes.status}`;
        }
      }

      if (testPassed) {
        await db
          .update(aiProviders)
          .set({ tested_at: new Date(), updated_at: new Date() })
          .where(eq(aiProviders.provider, provider));
        res.json({ ok: true, message: "Conexão testada com sucesso!" });
      } else {
        res.status(400).json({ ok: false, error: errorMsg || "Falha na conexão com o provedor" });
      }
    } catch (err) {
      console.error("Test AI provider error:", err);
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* AI Provider Hub — pipeline routing                                   */
  /* ------------------------------------------------------------------ */

  app.get("/api/admin/pipeline-routing", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    try {
      const rows = await db.select().from(pipelineRouting);
      res.json({ routing: rows });
    } catch (err) {
      console.error("List pipeline routing error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const updateRoutingSchema = z.object({
    primary_provider: z.enum(["openai", "anthropic", "perplexity", "google"]).nullable().optional(),
    model: z.string().min(1).nullable().optional(),
    fallback_order: z.array(z.enum(["openai", "anthropic", "perplexity", "google"])).optional(),
  });

  const PIPELINE_STAGES = ["place_discovery", "review_analysis", "description_generation", "score_calculation"] as const;
  type PipelineStage = typeof PIPELINE_STAGES[number];

  app.patch("/api/admin/pipeline-routing/:stage", requireAuth, async (req: AuthRequest, res: Response) => {
    const caller = await getUserById(req.user!.userId);
    if (!caller || caller.role !== "admin") {
      res.status(403).json({ error: "Apenas administradores podem alterar o roteamento do pipeline" });
      return;
    }
    const stage = req.params.stage as PipelineStage;
    if (!PIPELINE_STAGES.includes(stage)) {
      res.status(400).json({ error: "Etapa inválida" });
      return;
    }
    const parsed = updateRoutingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const setClause: Partial<{
        primary_provider: string | null;
        model: string | null;
        fallback_order: string[];
        updated_at: Date;
      }> = { updated_at: new Date() };
      if (parsed.data.primary_provider !== undefined) setClause.primary_provider = parsed.data.primary_provider ?? null;
      if (parsed.data.model !== undefined) setClause.model = parsed.data.model ?? null;
      if (parsed.data.fallback_order !== undefined) setClause.fallback_order = parsed.data.fallback_order;

      const [updated] = await db
        .update(pipelineRouting)
        .set(setClause as never)
        .where(eq(pipelineRouting.stage, stage))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Etapa não encontrada" });
        return;
      }
      res.json({ routing: updated });
    } catch (err) {
      console.error("Update pipeline routing error:", err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Admin — Curation Queue (Módulos 5 e 6)                             */
  /* ------------------------------------------------------------------ */

  async function requireAdminOrCollaborator(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
    const caller = await getUserById(req.user.userId);
    if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
      res.status(403).json({ error: "Acesso negado" });
      return;
    }
    (req as AuthRequest & { caller: typeof caller }).caller = caller;
    next();
  }

  app.get(
    "/api/admin/curation/queue",
    requireAuth,
    requireAdminOrCollaborator,
    async (req: AuthRequest, res: Response) => {
      const status = (req.query.status as string) || "pendente";
      const city = req.query.city as string | undefined;
      const category = req.query.category as string | undefined;
      const minKidScore = req.query.min_kid_score ? parseInt(req.query.min_kid_score as string, 10) : undefined;
      const maxKidScore = req.query.max_kid_score ? parseInt(req.query.max_kid_score as string, 10) : undefined;
      const limit = Math.min(parseInt((req.query.limit as string) || "20", 10), 100);
      const offset = parseInt((req.query.offset as string) || "0", 10);

      const validStatuses = ["pendente", "aprovado", "rejeitado"];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ error: "status inválido" });
        return;
      }

      try {
        const result = await listCurationQueue({
          status: status as "pendente" | "aprovado" | "rejeitado",
          city,
          category,
          minKidScore,
          maxKidScore,
          limit,
          offset,
        });
        res.json(result);
      } catch (err) {
        console.error("Curation queue error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/api/admin/curation/pending-count",
    requireAuth,
    requireAdminOrCollaborator,
    async (_req: AuthRequest, res: Response) => {
      try {
        const count = await countPendingCuration();
        res.json({ count });
      } catch (err) {
        console.error("Pending count error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  const curationApproveSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    custom_criteria: z.record(z.unknown()).optional(),
  });

  app.post(
    "/api/admin/curation/:placeId/approve",
    requireAuth,
    requireAdminOrCollaborator,
    async (req: AuthRequest, res: Response) => {
      const placeId = req.params.placeId as string;
      const parsed = curationApproveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }

      try {
        await approveCurationItem(placeId, req.user!.userId, parsed.data);
        res.json({ ok: true });
      } catch (err) {
        console.error("Approve curation error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.post(
    "/api/admin/curation/:placeId/reject",
    requireAuth,
    requireAdminOrCollaborator,
    async (req: AuthRequest, res: Response) => {
      const placeId = req.params.placeId as string;

      try {
        await rejectCurationItem(placeId, req.user!.userId);
        res.json({ ok: true });
      } catch (err) {
        console.error("Reject curation error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
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
      order: z.number().int().optional(),
    })).optional(),
  });

  app.post(
    "/api/admin/curation/ingest",
    requireAuth,
    requireAdminOrCollaborator,
    async (req: AuthRequest, res: Response) => {
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
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /* Admin — Place Photos                                                 */
  /* ------------------------------------------------------------------ */

  app.get(
    "/api/admin/curation/:placeId/photos",
    requireAuth,
    requireAdminOrCollaborator,
    async (req: AuthRequest, res: Response) => {
      const placeId = req.params.placeId as string;
      try {
        const photos = await listPlacePhotos(placeId);
        res.json({ photos });
      } catch (err) {
        console.error("List photos error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.patch(
    "/api/admin/photos/:photoId/cover",
    requireAuth,
    requireAdminOrCollaborator,
    async (req: AuthRequest, res: Response) => {
      const photoId = req.params.photoId as string;
      const placeId = req.body.place_id as string;

      if (!placeId) {
        res.status(400).json({ error: "place_id is required" });
        return;
      }

      try {
        await setCoverPhoto(placeId, photoId);
        res.json({ ok: true });
      } catch (err) {
        console.error("Set cover error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.delete(
    "/api/admin/photos/:photoId",
    requireAuth,
    requireAdminOrCollaborator,
    async (req: AuthRequest, res: Response) => {
      const photoId = req.params.photoId as string;

      try {
        await deletePlacePhoto(photoId);
        res.json({ ok: true });
      } catch (err) {
        console.error("Delete photo error:", err);
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  const httpServer = createServer(app);
  return httpServer;
}
