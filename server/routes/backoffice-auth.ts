import { Router, type Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  findBackofficeUserByEmail,
  findBackofficeUserById,
  findBackofficeUserByInviteToken,
  activateBackofficeUser,
  updateBackofficeUserLastActive,
  createAuditLog,
} from "../storage";
import { requireBackofficeAuth, signBackofficeToken, type AuthRequest } from "../auth";
import { trackBackofficeActivity } from "./helpers";

const router = Router();

const backofficeLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/api/backoffice/auth/login", async (req: AuthRequest, res: Response) => {
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

router.get("/api/backoffice/auth/me", requireBackofficeAuth, async (req: AuthRequest, res: Response) => {
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

router.post("/api/backoffice/auth/refresh", requireBackofficeAuth, trackBackofficeActivity, async (req: AuthRequest, res: Response) => {
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

const activateAccountSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

router.post("/api/backoffice/auth/activate", async (req: AuthRequest, res: Response) => {
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

export default router;
