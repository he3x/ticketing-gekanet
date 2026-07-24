/**
 * api/v1/routes/auth.ts
 * =====================
 * POST /api/v1/auth/login   — Returns a JWT on successful authentication
 * POST /api/v1/auth/refresh — (stub) Placeholder for token refresh logic
 * GET  /api/v1/auth/me      — Returns current user info from the JWT
 *
 * RBAC: login is public; /me requires a valid token.
 */

import { Router, Request, Response } from "express";
import { signToken, requireAuth, AuthRequest } from "../middleware/auth.js";

// database.js is a plain ESM module — import via relative path
// @ts-ignore — no type declarations for database.js
import db from "../../../database.js";

const router = Router();

// ─── Response helpers ─────────────────────────────────────────────────────────
const ok  = (res: Response, data: unknown, meta?: object) =>
  res.json({ status: "success", data, ...meta });

const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ status: "error", message });

// ─── POST /api/v1/auth/login ──────────────────────────────────────────────────
/**
 * Body: { username: string, password: string }
 *
 * Success (200):
 *   {
 *     status: "success",
 *     data: { userId, username, role, name },
 *     token: "<JWT>",
 *     expiresIn: "8h"
 *   }
 *
 * Failure (401): { status: "error", message: "..." }
 *
 * NOTE: Passwords in the migrated DB are stored as plain text (from the original
 * JSON db). For production, replace the plain-text comparison below with a
 * bcrypt.compare() call after hashing all passwords.
 */
router.post("/login", async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    fail(res, 400, "username and password are required.");
    return;
  }

  try {
    // Fetch user + role name from PostgreSQL via database.js
    const rows = await db.query(
      `SELECT u.id, u.username, u.password_hash, u.name, u.phone,
              r.name AS role
       FROM   users u
       JOIN   roles r ON r.id = u.role_id
       WHERE  u.username = $1
       LIMIT  1`,
      [username]
    );

    const user = rows[0];

    if (!user) {
      fail(res, 401, "Invalid credentials.");
      return;
    }

    // ── Password check ────────────────────────────────────────────────────────
    // TODO (production): replace this with:
    //   const match = await bcrypt.compare(password, user.password_hash);
    //   if (!match) { fail(res, 401, "Invalid credentials."); return; }
    const match = password === user.password_hash;
    if (!match) {
      fail(res, 401, "Invalid credentials.");
      return;
    }

    // ── Issue JWT ─────────────────────────────────────────────────────────────
    const token = signToken({
      id:       user.id,
      username: user.username,
      role:     user.role,
      name:     user.name,
    });

    // Log the login action to the DB
    await db.query(
      `INSERT INTO logs (timestamp, action, actor, details)
       VALUES (NOW(), 'LOGIN', $1, $2)`,
      [user.username, `User ${user.username} logged in via API v1`]
    );

    ok(res, {
      userId:   String(user.id),
      username: user.username,
      role:     user.role,
      name:     user.name,
      phone:    user.phone ?? null,
    }, { token, expiresIn: process.env.JWT_EXPIRES || "8h" });

  } catch (err: unknown) {
    console.error("[API] /auth/login error:", err);
    fail(res, 500, "Internal server error during authentication.");
  }
});

// ─── GET /api/v1/auth/me ──────────────────────────────────────────────────────
/**
 * Returns the current user's profile from the JWT payload (no DB hit).
 * Requires: Authorization: Bearer <token>
 */
router.get("/me", requireAuth, (req: AuthRequest, res: Response): void => {
  ok(res, req.user);
});

// ─── POST /api/v1/auth/refresh ────────────────────────────────────────────────
/**
 * Stub — implement a refresh-token flow here if needed.
 * For now it re-issues a new JWT if the current token is still valid.
 */
router.post("/refresh", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const u = req.user!;
    const newToken = signToken({ id: u.userId, username: u.username, role: u.role, name: u.name });
    ok(res, { userId: u.userId, username: u.username, role: u.role, name: u.name },
       { token: newToken, expiresIn: process.env.JWT_EXPIRES || "8h" });
  } catch (err) {
    fail(res, 500, "Failed to refresh token.");
  }
});

export default router;