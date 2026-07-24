/**
 * api/v1/routes/users.ts
 * ======================
 * Endpoints:
 *   GET    /api/v1/users            — List all users (admin/supervisor/superuser)
 *   GET    /api/v1/users/technicians — List technicians + vendors (all authenticated)
 *   GET    /api/v1/users/:id        — Get single user
 *   POST   /api/v1/users            — Create user (admin/superuser)
 *   PATCH  /api/v1/users/:id        — Update user (admin/superuser, or self for own profile)
 *   DELETE /api/v1/users/:id        — Delete user (superuser only)
 */

import { Router, Response } from "express";
import { requireAuth, requireRole, requireMinRole, AuthRequest } from "../middleware/auth.js";

// @ts-ignore
import db from "../../../database.js";

const router = Router();

const ok   = (res: Response, data: unknown, meta?: object) =>
  res.json({ status: "success", data, ...meta });

const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ status: "error", message });

// ─── GET /api/v1/users ────────────────────────────────────────────────────────
router.get(
  "/",
  requireAuth,
  requireMinRole("supervisor"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const rows = await db.query(
        `SELECT u.id, u.username, u.name, u.phone, u.is_active,
                r.name AS role, u.created_at
         FROM users u
         JOIN roles r ON r.id = u.role_id
         ORDER BY u.name`
      );
      ok(res, rows);
    } catch (err) {
      console.error("[API] GET /users error:", err);
      fail(res, 500, "Failed to fetch users.");
    }
  }
);

// ─── GET /api/v1/users/technicians ───────────────────────────────────────────
// Must be defined BEFORE /:id to avoid "technicians" being matched as an id
router.get(
  "/technicians",
  requireAuth,
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const rows = await db.query(
        `SELECT u.id, u.username, u.name, u.phone, u.is_active, r.name AS role
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.name IN ('technician', 'vendor')
         ORDER BY u.name`
      );
      ok(res, rows);
    } catch (err) {
      console.error("[API] GET /users/technicians error:", err);
      fail(res, 500, "Failed to fetch technicians.");
    }
  }
);

// ─── GET /api/v1/users/:id ────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  // Users may only view their own profile unless they are admin/superuser
  const { id } = req.params;
  const isOwnProfile = req.user!.userId === id;
  const canViewAll   = ["admin", "superuser", "supervisor"].includes(req.user!.role);

  if (!isOwnProfile && !canViewAll) {
    fail(res, 403, "You can only view your own profile.");
    return;
  }

  try {
    const rows = await db.query(
      `SELECT u.id, u.username, u.name, u.phone, u.is_active,
              r.name AS role, u.created_at
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [id]
    );
    if (!rows.length) { fail(res, 404, `User ${id} not found.`); return; }
    ok(res, rows[0]);
  } catch (err) {
    console.error("[API] GET /users/:id error:", err);
    fail(res, 500, "Failed to fetch user.");
  }
});

// ─── POST /api/v1/users ───────────────────────────────────────────────────────
/**
 * Body:
 *   username*  — unique login name
 *   password*  — plain text (hash with bcrypt in production)
 *   name*      — display name
 *   role*      — vendor | technician | supervisor | admin | superuser
 *   phone      — WhatsApp number (e.g. "628123456789")
 */
router.post(
  "/",
  requireAuth,
  requireRole(["admin", "superuser"]),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { username, password, name, role, phone } = req.body ?? {};

    if (!username || !password || !name || !role) {
      fail(res, 400, "username, password, name, and role are required.");
      return;
    }

    try {
      // Resolve role_id
      const roleRows = await db.query(
        `SELECT id FROM roles WHERE name = $1`, [role]
      );
      if (!roleRows.length) {
        fail(res, 400, `Unknown role: ${role}`);
        return;
      }
      const roleId = roleRows[0].id;

      // TODO (production): hash password with bcrypt before inserting
      const insertRows = await db.query(
        `INSERT INTO users (username, password_hash, name, phone, role_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, username, name, phone, is_active, created_at`,
        [username, password, name, phone ?? null, roleId]
      );

      await db.query(
        `INSERT INTO logs (timestamp, action, actor, details)
         VALUES (NOW(), 'USER_CREATE', $1, $2)`,
        [req.user!.username, `Created user ${username} with role ${role}`]
      );

      res.status(201).json({ status: "success", data: { ...insertRows[0], role } });
    } catch (err: any) {
      if (err.code === "23505" || String(err).includes("unique")) {
        fail(res, 409, `Username "${username}" already exists.`);
      } else {
        console.error("[API] POST /users error:", err);
        fail(res, 500, "Failed to create user.");
      }
    }
  }
);

// ─── PATCH /api/v1/users/:id ──────────────────────────────────────────────────
/**
 * Admin/superuser can update any field.
 * A user may update their own name and phone only (not role).
 * Password update: provide { password: "newpass" } — hash with bcrypt in production.
 */
router.patch("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const isOwnProfile = req.user!.userId === id;
  const isAdmin      = ["admin", "superuser"].includes(req.user!.role);

  if (!isOwnProfile && !isAdmin) {
    fail(res, 403, "You can only update your own profile.");
    return;
  }

  const setClauses: string[] = [];
  const params: unknown[]    = [];
  let p = 1;

  // Fields any authenticated user may update on their own profile
  const selfAllowed = ["name", "phone"];
  // Additional fields only admins may touch
  const adminAllowed = ["username", "is_active"];

  const allowed = isAdmin ? [...selfAllowed, ...adminAllowed] : selfAllowed;

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      setClauses.push(`${field} = $${p}`);
      params.push(req.body[field]);
      p++;
    }
  }

  // Password update (plain text — hash in production)
  if (req.body.password && (isOwnProfile || isAdmin)) {
    // TODO (production): const hashed = await bcrypt.hash(req.body.password, 10);
    setClauses.push(`password_hash = $${p}`);
    params.push(req.body.password);
    p++;
  }

  // Role change — superuser only
  if (req.body.role && req.user!.role === "superuser") {
    const roleRows = await db.query(`SELECT id FROM roles WHERE name = $1`, [req.body.role]);
    if (!roleRows.length) { fail(res, 400, `Unknown role: ${req.body.role}`); return; }
    setClauses.push(`role_id = $${p}`);
    params.push(roleRows[0].id);
    p++;
  }

  if (!setClauses.length) {
    fail(res, 400, "No updatable fields provided.");
    return;
  }

  try {
    params.push(id);
    await db.query(
      `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${p}`,
      params
    );

    const rows = await db.query(
      `SELECT u.id, u.username, u.name, u.phone, u.is_active, r.name AS role, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [id]
    );

    if (!rows.length) { fail(res, 404, `User ${id} not found.`); return; }

    await db.query(
      `INSERT INTO logs (timestamp, action, actor, details) VALUES (NOW(), 'USER_UPDATE', $1, $2)`,
      [req.user!.username, `Updated user ${id}`]
    );

    ok(res, rows[0]);
  } catch (err) {
    console.error("[API] PATCH /users/:id error:", err);
    fail(res, 500, "Failed to update user.");
  }
});

// ─── DELETE /api/v1/users/:id ─────────────────────────────────────────────────
router.delete(
  "/:id",
  requireAuth,
  requireRole(["superuser"]),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    if (req.user!.userId === id) {
      fail(res, 400, "You cannot delete your own account.");
      return;
    }

    try {
      const result = await db.query(
        `DELETE FROM users WHERE id = $1 RETURNING id, username`,
        [id]
      );
      if (!result.length) { fail(res, 404, `User ${id} not found.`); return; }

      await db.query(
        `INSERT INTO logs (timestamp, action, actor, details) VALUES (NOW(), 'USER_DELETE', $1, $2)`,
        [req.user!.username, `Deleted user ${id} (${result[0].username})`]
      );

      ok(res, { deleted: true, id });
    } catch (err) {
      console.error("[API] DELETE /users/:id error:", err);
      fail(res, 500, "Failed to delete user.");
    }
  }
);

export default router;