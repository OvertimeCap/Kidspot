import type { Response, NextFunction } from "express";
import { updateBackofficeUserLastActive, createAuditLog, getUserById } from "../storage";
import type { AuthRequest } from "../auth";

export type PartnerRequest = AuthRequest & { dbUser: NonNullable<Awaited<ReturnType<typeof getUserById>>> };

export function trackBackofficeActivity(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (req.backofficeUser) {
    updateBackofficeUserLastActive(req.backofficeUser.backofficeUserId).catch(() => {});
  }
  next();
}

export function withAudit(action: string, module: string) {
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

export async function requireAdminOrCollaborator(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  const caller = await getUserById(req.user.userId);
  if (!caller || (caller.role !== "admin" && caller.role !== "colaborador")) {
    res.status(403).json({ error: "Acesso negado" });
    return;
  }
  (req as AuthRequest & { caller: typeof caller }).caller = caller;
  next();
}

export async function requirePartnerWithPlace(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  const dbUser = await getUserById(req.user.userId);
  if (!dbUser) { res.status(401).json({ error: "Usuário não encontrado" }); return; }
  if (dbUser.role !== "parceiro" && dbUser.role !== "estabelecimento") {
    res.status(403).json({ error: "Acesso exclusivo para parceiros e estabelecimentos" });
    return;
  }
  if (!dbUser.linked_place_id) {
    res.status(403).json({ error: "Você precisa ter um local vinculado" });
    return;
  }
  (req as AuthRequest & { dbUser: typeof dbUser }).dbUser = dbUser;
  next();
}

export const ESTABLISHMENT_TYPES = [
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
