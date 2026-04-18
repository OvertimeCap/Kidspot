import { Router, type Response } from "express";
import { z } from "zod";
import {
  createUser,
  adminCreateUser,
  findUserByEmail,
  verifyPassword,
  findOrCreateGoogleUser,
  getUserById,
} from "../storage";
import { requireAuth, requireAdmin, signToken, type AuthRequest } from "../auth";

const router = Router();

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/api/admin/auth/login", async (req: AuthRequest, res: Response) => {
  const parsed = adminLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const user = await findUserByEmail(email.toLowerCase());
    if (!user) {
      res.status(401).json({ error: "Credenciais inválidas" });
      return;
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Credenciais inválidas" });
      return;
    }

    if (user.role !== "admin") {
      res.status(403).json({ error: "Acesso restrito a administradores" });
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
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/admin/auth/me", requireAdmin, async (req: AuthRequest, res: Response) => {
  const dbUser = await getUserById(req.user!.userId);
  if (!dbUser) {
    res.status(401).json({ error: "Usuário não encontrado" });
    return;
  }
  res.json({
    user: {
      id: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      role: dbUser.role,
    },
  });
});

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});

router.post("/api/auth/register", async (req: AuthRequest, res: Response) => {
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

router.post("/api/auth/login", async (req: AuthRequest, res: Response) => {
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

router.get("/api/auth/me", requireAuth, async (req: AuthRequest, res: Response) => {
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

router.post("/api/auth/google", async (req: AuthRequest, res: Response) => {
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

export default router;
