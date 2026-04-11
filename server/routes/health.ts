import { Router, type Response } from "express";
import { pool } from "../db";
import type { AuthRequest } from "../auth";

const router = Router();

router.get("/api/health", (_req: AuthRequest, res: Response) => {
  res.json({ ok: true });
});

router.get("/api/kidspot/ping-db", async (_req: AuthRequest, res: Response) => {
  try {
    await pool.query("SELECT 1");
    res.json({ db: true });
  } catch (err) {
    console.error("DB ping failed:", err);
    res.status(500).json({ db: false, error: "Database unreachable" });
  }
});

export default router;
