import type { Express, Response } from "express";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { pool } from "./db";
import { searchPlaces, getPlaceDetails, autocompletePlaces, geocodePlace } from "./google-places";
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
} from "./storage";
import { insertReviewSchema, insertClaimSchema, type UserRole } from "@shared/schema";
import { requireAuth, signToken, type AuthRequest } from "./auth";
import { textSearchClaimable } from "./google-places";

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/health", (_req: AuthRequest, res: Response) => {
    res.json({ ok: true });
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
    const radius = parseFloat((req.query.radius as string) || "8");

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: "lat e lng são obrigatórios" });
      return;
    }

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
      let placeLat: number | undefined;
      let placeLng: number | undefined;
      try {
        const details = await getPlaceDetails(dbUser.linked_place_id);
        if (details?.location) {
          placeLat = details.location.lat;
          placeLng = details.location.lng;
        }
      } catch {
        // Non-fatal: story will be created without coordinates
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

  const httpServer = createServer(app);
  return httpServer;
}
