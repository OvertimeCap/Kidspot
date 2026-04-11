import { Router, type Response } from "express";
import { insertReviewSchema } from "@shared/schema";
import {
  createReview,
  getReviewsForPlace,
  toggleFavorite,
  getFavoritesForUser,
} from "../storage";
import { requireAuth, type AuthRequest } from "../auth";

const router = Router();

router.post("/api/reviews", requireAuth, async (req: AuthRequest, res: Response) => {
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

router.get("/api/reviews", async (req: AuthRequest, res: Response) => {
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

router.post("/api/favorites/toggle", requireAuth, async (req: AuthRequest, res: Response) => {
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

router.get("/api/favorites", requireAuth, async (req: AuthRequest, res: Response) => {
  const userKey = req.user!.userId;

  try {
    const favList = await getFavoritesForUser(userKey);
    res.json({ favorites: favList });
  } catch (err) {
    console.error("Get favorites error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
