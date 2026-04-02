import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import type { UserRole, BackofficeRole } from "@shared/schema";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET environment variable must be set in production");
    }
    return "kidspot-dev-secret-change-in-production";
  }
  return secret;
}

const JWT_EXPIRES_IN = "7d";
const BACKOFFICE_JWT_EXPIRES_IN = "2h";

export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  name: string;
}

export interface BackofficeJWTPayload {
  backofficeUserId: string;
  email: string;
  role: BackofficeRole;
  name: string;
  type: "backoffice";
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as JWTPayload;
  } catch {
    return null;
  }
}

export function signBackofficeToken(payload: Omit<BackofficeJWTPayload, "type">): string {
  return jwt.sign({ ...payload, type: "backoffice" }, getJwtSecret(), {
    expiresIn: BACKOFFICE_JWT_EXPIRES_IN,
  });
}

export function verifyBackofficeToken(token: string): BackofficeJWTPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as BackofficeJWTPayload;
    if (decoded.type !== "backoffice") return null;
    return decoded;
  } catch {
    return null;
  }
}

export interface AuthRequest extends Request {
  user?: JWTPayload;
  backofficeUser?: BackofficeJWTPayload;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token de autenticação necessário" });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);

  if (!payload) {
    res.status(401).json({ error: "Token inválido ou expirado" });
    return;
  }

  req.user = payload;
  next();
}

export function requireBackofficeAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token de autenticação do backoffice necessário" });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyBackofficeToken(token);

  if (!payload) {
    res.status(401).json({ error: "Token inválido ou expirado. Faça login novamente." });
    return;
  }

  req.backofficeUser = payload;
  next();
}

export function requireRole(...roles: BackofficeRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.backofficeUser) {
      res.status(401).json({ error: "Autenticação necessária" });
      return;
    }
    if (!roles.includes(req.backofficeUser.role)) {
      res.status(403).json({ error: "Permissão insuficiente para esta operação" });
      return;
    }
    next();
  };
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (payload) req.user = payload;
  }
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token de autenticação necessário" });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);

  if (!payload) {
    res.status(401).json({ error: "Token inválido ou expirado" });
    return;
  }

  if (payload.role !== "admin") {
    res.status(403).json({ error: "Acesso restrito a administradores" });
    return;
  }

  req.user = payload;
  next();
}
