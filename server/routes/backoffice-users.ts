import { Router, type Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import {
  createBackofficeUser,
  findBackofficeUserByEmail,
  findBackofficeUserById,
  listBackofficeUsers,
  updateBackofficeUserRole,
  updateBackofficeUserStatus,
  createAuditLog,
  listAuditLogs,
} from "../storage";
import { sendInviteEmail } from "../email";
import { requireBackofficeAuth, requireRole, type AuthRequest } from "../auth";
import { trackBackofficeActivity } from "./helpers";
import type { BackofficeRole } from "@shared/schema";

const router = Router();

const inviteSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(["super_admin", "admin", "curador", "analista"]),
});

router.post(
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

router.get(
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

router.patch(
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

router.patch(
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

router.get(
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

export default router;
