/**
 * api/v1/middleware/auth.ts
 * =========================
 * JWT verification middleware + RBAC helper for all /api/v1/* routes.
 *
 * Usage in a route file:
 *   import { requireAuth, requireRole } from "../middleware/auth.js";
 *
 *   router.get("/", requireAuth, requireRole(["admin", "supervisor"]), handler);
 *
 * The JWT payload shape:
 *   { userId: string, username: string, role: string, name: string }
 *
 * Environment:
 *   JWT_SECRET  — must be set in .env (min 32 chars recommended)
 *   JWT_EXPIRES — token lifetime, default "8h"
 */

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
  name: string;
  iat?: number;
  exp?: number;
}

/** Extends Express Request with the decoded JWT payload */
export interface AuthRequest extends Request {
  user?: JwtPayload;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
export const JWT_SECRET  = process.env.JWT_SECRET  || "CHANGE_THIS_SECRET_IN_PRODUCTION_MIN_32_CHARS";
export const JWT_EXPIRES = process.env.JWT_EXPIRES || "8h";

// Role hierarchy (higher index = more privileged)
const ROLE_LEVELS: Record<string, number> = {
  vendor:     1,
  technician: 2,
  supervisor: 3,
  admin:      4,
  superuser:  5,
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Sign a JWT for the given user record */
export function signToken(user: { id: string | number; username: string; role: string; name: string }): string {
  const payload: JwtPayload = {
    userId:   String(user.id),
    username: user.username,
    role:     user.role,
    name:     user.name,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES } as jwt.SignOptions);
}

/** Standard error response helper */
function sendError(res: Response, status: number, message: string) {
  return res.status(status).json({ status: "error", message });
}

// ─── Middleware ────────────────────────────────────────────────────────────────

/**
 * requireAuth
 * -----------
 * Verifies the Bearer token in the Authorization header.
 * Attaches the decoded payload to `req.user` on success.
 *
 * Place this FIRST on any protected route:
 *   router.get("/protected", requireAuth, handler);
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendError(res, 401, "Missing or malformed Authorization header. Expected: Bearer <token>");
    return;
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      sendError(res, 401, "Token has expired. Please log in again.");
    } else if (err instanceof jwt.JsonWebTokenError) {
      sendError(res, 401, "Invalid token. Please log in again.");
    } else {
      sendError(res, 500, "Token verification failed.");
    }
  }
}

/**
 * requireRole
 * -----------
 * Restricts a route to users whose role is in the allowed list.
 * Must be used AFTER requireAuth.
 *
 * Example — only admins and supervisors:
 *   router.delete("/:id", requireAuth, requireRole(["admin", "superuser"]), handler);
 *
 * Passing "supervisor" will also allow all roles above it (admin, superuser)
 * when using requireMinRole instead.
 */
export function requireRole(allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 401, "Authentication required.");
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      sendError(
        res, 403,
        `Access denied. Required role(s): ${allowedRoles.join(", ")}. Your role: ${req.user.role}`
      );
      return;
    }
    next();
  };
}

/**
 * requireMinRole
 * --------------
 * Restricts a route to users at or above the minimum role level.
 * Uses the ROLE_LEVELS hierarchy defined above.
 *
 * Example — technician and above:
 *   router.get("/", requireAuth, requireMinRole("technician"), handler);
 */
export function requireMinRole(minRole: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 401, "Authentication required.");
      return;
    }
    const userLevel = ROLE_LEVELS[req.user.role]  ?? 0;
    const minLevel  = ROLE_LEVELS[minRole]         ?? 999;
    if (userLevel < minLevel) {
      sendError(
        res, 403,
        `Access denied. Minimum required role: ${minRole}. Your role: ${req.user.role}`
      );
      return;
    }
    next();
  };
}