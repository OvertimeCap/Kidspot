import { Router, type Response } from "express";
import { z } from "zod";
import { insertFeedbackSchema } from "@shared/schema";
import {
  getUserById,
  createFeedback,
  listFeedback,
  countUnreadFeedback,
  resolveFeedback,
  rejectFeedback,
  addFeedbackToQueue,
} from "../storage";
import { requireAuth, type AuthRequest } from "../auth";

const router = Router();

router.post("/api/feedback", async (req: AuthRequest, res: Response) => {
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

router.get("/api/admin/feedback/unread-count", requireAuth, async (req: AuthRequest, res: Response) => {
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

router.get("/api/admin/feedback", requireAuth, async (req: AuthRequest, res: Response) => {
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

const feedbackActionSchema = z.object({
  action: z.enum(["resolver", "rejeitar", "adicionar_fila"]),
});

router.patch("/api/admin/feedback/:id", requireAuth, async (req: AuthRequest, res: Response) => {
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

export default router;
