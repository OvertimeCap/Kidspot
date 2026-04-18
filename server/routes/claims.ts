import { Router, type Response } from "express";
import { z } from "zod";
import { insertClaimSchema, type UserRole } from "@shared/schema";
import {
  getUserById,
  createClaim,
  getClaimsForUser,
  listClaims,
  approveClaim,
  denyClaim,
  getApprovedAdminForPlace,
  listUsers,
  findUserByEmail,
  adminCreateUser,
  updateUserRole,
} from "../storage";
import { requireAuth, type AuthRequest } from "../auth";

const router = Router();

const CLAIM_VALID_STATUSES = new Set(["pending", "approved", "denied"]);
const ADMIN_ONLY_ROLES: UserRole[] = ["admin", "colaborador"];

router.post("/api/claims", requireAuth, async (req: AuthRequest, res: Response) => {
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

router.get("/api/claims/my", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const claims = await getClaimsForUser(userId);
    res.json({ claims });
  } catch (err) {
    console.error("Get my claims error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/admin/claims", requireAuth, async (req: AuthRequest, res: Response) => {
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

router.patch("/api/admin/claims/:id", requireAuth, async (req: AuthRequest, res: Response) => {
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

router.get("/api/admin/users", requireAuth, async (req: AuthRequest, res: Response) => {
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

const createUserSchema = z.object({
  name: z.string().min(2, "Nome deve ter ao menos 2 caracteres"),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
  role: z.enum(["admin", "colaborador", "parceiro", "estabelecimento", "usuario"]),
});

router.post("/api/admin/users", requireAuth, async (req: AuthRequest, res: Response) => {
  const caller = await getUserById(req.user!.userId);
  if (!caller || caller.role !== "admin") {
    res.status(403).json({ error: "Acesso negado: apenas administradores podem criar usuários" });
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
      res.status(409).json({ error: "Já existe um usuário com este e-mail" });
      return;
    }

    const user = await adminCreateUser({ name, email, password, role: role as UserRole });
    res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.created_at },
    });
  } catch (err) {
    console.error("Admin create user error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

const updateRoleSchema = z.object({
  role: z.enum(["admin", "colaborador", "parceiro", "estabelecimento", "usuario"]),
});

router.patch("/api/admin/users/:id/role", requireAuth, async (req: AuthRequest, res: Response) => {
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

export default router;
