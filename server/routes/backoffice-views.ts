import { Router, type Response } from "express";
import {
  listCityDemand,
  deleteCityDemand,
} from "../storage";
import { requireAdmin, requireBackofficeAuth, requireRole, type AuthRequest } from "../auth";
import { trackBackofficeActivity } from "./helpers";

const router = Router();

router.get("/api/backoffice/prompts", requireBackofficeAuth, requireRole("super_admin", "admin", "analista"), trackBackofficeActivity,
  (_req: AuthRequest, res: Response) => res.json({ module: "gestao_prompts", items: [] }));

router.get("/api/backoffice/filtros", requireBackofficeAuth, requireRole("super_admin", "admin", "analista"), trackBackofficeActivity,
  (_req: AuthRequest, res: Response) => res.json({ module: "filtros_app", items: [] }));

router.get("/api/backoffice/kidscore", requireBackofficeAuth, requireRole("super_admin", "admin", "analista"), trackBackofficeActivity,
  (_req: AuthRequest, res: Response) => res.json({ module: "kidscore", config: {} }));

router.get("/api/backoffice/criterios", requireBackofficeAuth, requireRole("super_admin", "admin"), trackBackofficeActivity,
  (_req: AuthRequest, res: Response) => res.json({ module: "criterios_customizados", items: [] }));

router.get("/api/backoffice/curadoria", requireBackofficeAuth, requireRole("super_admin", "admin", "curador", "analista"), trackBackofficeActivity,
  (_req: AuthRequest, res: Response) => res.json({ module: "fila_curadoria", items: [] }));

router.get("/api/backoffice/galeria", requireBackofficeAuth, requireRole("super_admin", "admin", "curador"), trackBackofficeActivity,
  (_req: AuthRequest, res: Response) => res.json({ module: "galeria", items: [] }));

router.get("/api/backoffice/operacao-ia", requireBackofficeAuth, requireRole("super_admin", "admin", "curador", "analista"), trackBackofficeActivity,
  (_req: AuthRequest, res: Response) => res.json({ module: "operacao_ia", stats: {} }));

router.get("/api/backoffice/comunidade", requireBackofficeAuth, requireRole("super_admin", "admin", "curador", "analista"), trackBackofficeActivity,
  (_req: AuthRequest, res: Response) => res.json({ module: "comunidade", items: [] }));

router.get("/api/backoffice/cidades", requireBackofficeAuth, requireRole("super_admin", "admin", "analista"), trackBackofficeActivity,
  (_req: AuthRequest, res: Response) => res.json({ module: "gestao_cidades", items: [] }));

router.get("/api/backoffice/provedores-ia", requireBackofficeAuth, requireRole("super_admin"), trackBackofficeActivity,
  (_req: AuthRequest, res: Response) => res.json({ module: "provedores_ia", providers: [] }));

router.get("/api/backoffice/parcerias", requireBackofficeAuth, requireRole("super_admin", "admin", "curador", "analista"), trackBackofficeActivity,
  (_req: AuthRequest, res: Response) => res.json({ module: "parcerias", items: [] }));

router.get("/api/backoffice/permissions", requireBackofficeAuth, trackBackofficeActivity, (req: AuthRequest, res: Response) => {
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

router.get(
  "/api/admin/demanda-cidades",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const estado = (req.query.estado as string) || undefined;
      const items = await listCityDemand(estado);
      res.json({ demands: items, total: items.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

router.delete(
  "/api/admin/demanda-cidades/:id",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      await deleteCityDemand(req.params.id as string);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

export default router;
