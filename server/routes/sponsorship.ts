import { Router, type Response } from "express";
import { z } from "zod";
import { insertSponsorshipPlanSchema, insertSponsorshipContractSchema } from "@shared/schema";
import {
  getUserById,
  listSponsorshipPlans,
  createSponsorshipPlan,
  updateSponsorshipPlan,
  deleteSponsorshipPlan,
  listSponsorshipContracts,
  createSponsorshipContract,
  updateSponsorshipContract,
  expireStaleContracts,
  getSponsorshipPerformance,
} from "../storage";
import { textSearchClaimable } from "../google-places";
import { requireAuth, type AuthRequest } from "../auth";

const router = Router();

router.get("/api/admin/sponsorship/plans", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  try {
    const plans = await listSponsorshipPlans();
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/api/admin/sponsorship/plans", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
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
      benefits: parsed.data.benefits ?? null,
    });
    res.status(201).json({ plan });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch("/api/admin/sponsorship/plans/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
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
      reference_price: parsed.data.reference_price,
    });
    if (!plan) { res.status(404).json({ error: "Plano não encontrado" }); return; }
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete("/api/admin/sponsorship/plans/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || caller.role !== "admin") {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  const { id } = req.params;
  try {
    const ok = await deleteSponsorshipPlan(id);
    if (!ok) { res.status(404).json({ error: "Plano não encontrado" }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/admin/sponsorship/search-places", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  const q = (req.query.q as string) ?? "";
  const city = (req.query.city as string) ?? "";

  if (!q || q.trim().length < 2) {
    res.status(400).json({ error: "Informe pelo menos 2 caracteres" });
    return;
  }

  try {
    const results = await textSearchClaimable(q.trim(), city.trim());
    res.json({ places: results.slice(0, 10) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/admin/sponsorship/contracts", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  const status = req.query.status as string | undefined;
  const place_id = req.query.place_id as string | undefined;
  try {
    await expireStaleContracts();
    const contracts = await listSponsorshipContracts({ status, place_id });
    res.json({ contracts });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/api/admin/sponsorship/contracts", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
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
      notes: parsed.data.notes ?? null,
    });
    res.status(201).json({ contract });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/admin/sponsorship/contracts/:id/performance", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  const { id } = req.params;
  try {
    const perf = await getSponsorshipPerformance(id);
    if (!perf) { res.status(404).json({ error: "Contrato não encontrado" }); return; }
    res.json({ performance: perf });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch("/api/admin/sponsorship/contracts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
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
    notes: z.string().optional().nullable(),
  });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const contract = await updateSponsorshipContract(id, {
      ...parsed.data,
      starts_at: parsed.data.starts_at ? new Date(parsed.data.starts_at) : undefined,
      ends_at: parsed.data.ends_at ? new Date(parsed.data.ends_at) : undefined,
    });
    if (!contract) { res.status(404).json({ error: "Contrato não encontrado" }); return; }
    res.json({ contract });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
