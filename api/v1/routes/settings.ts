/**
 * api/v1/routes/settings.ts
 * =========================
 * GET   /api/v1/settings         — Fetch all settings (authenticated)
 * GET   /api/v1/settings/:key    — Fetch a single setting by key
 * PATCH /api/v1/settings/:key    — Update a setting value (admin/superuser only)
 * POST  /api/v1/settings         — Create a new setting (superuser only)
 * DELETE /api/v1/settings/:key   — Delete a setting (superuser only)
 *
 * Settings are stored in the `settings` table as key-value pairs.
 * Example keys: company_name, whatsapp_number, default_ticket_prefix, etc.
 */

import { Router, Response } from "express";
import { requireAuth, requireRole, requireMinRole, AuthRequest } from "../middleware/auth.js";
// @ts-ignore
import db from "../../../database.js";

const router = Router();

const ok   = (res: Response, data: unknown) =>
  res.json({ status: "success", data });
const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ status: "error", message });

// ─── GET /api/v1/settings ─────────────────────────────────────────────────────
router.get("/", requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rows = await db.query(
      `SELECT key, value, description, updated_at FROM settings ORDER BY key`
    );
    // Return as an object map for convenient frontend access: { key: value, ... }
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    ok(res, { list: rows, map });
  } catch (err) {
    console.error("[API] GET /settings error:", err);
    fail(res, 500, "Failed to fetch settings.");
  }
});

// ─── GET /api/v1/settings/:key ────────────────────────────────────────────────
router.get("/:key", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rows = await db.query(
      `SELECT key, value, description, updated_at FROM settings WHERE key = $1`,
      [req.params.key]
    );
    if (!rows.length) { fail(res, 404, `Setting "${req.params.key}" not found.`); return; }
    ok(res, rows[0]);
  } catch (err) {
    console.error("[API] GET /settings/:key error:", err);
    fail(res, 500, "Failed to fetch setting.");
  }
});

// ─── PATCH /api/v1/settings/:key ──────────────────────────────────────────────
router.patch(
  "/:key",
  requireAuth,
  requireRole(["admin", "superuser"]),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { key } = req.params;
    const { value, description } = req.body ?? {};

    if (value === undefined) {
      fail(res, 400, "value is required.");
      return;
    }

    try {
      const setClauses = [`value = $1`, `updated_at = NOW()`];
      const params: unknown[] = [value];
      let p = 2;

      if (description !== undefined) {
        setClauses.push(`description = $${p}`);
        params.push(description);
        p++;
      }

      params.push(key);
      const result = await db.query(
        `UPDATE settings SET ${setClauses.join(", ")} WHERE key = $${p} RETURNING *`,
        params
      );

      if (!result.length) { fail(res, 404, `Setting "${key}" not found.`); return; }

      await db.query(
        `INSERT INTO logs (timestamp, action, actor, details) VALUES (NOW(), 'SETTING_UPDATE', $1, $2)`,
        [req.user!.username, `Updated setting "${key}" = "${value}"`]
      );

      ok(res, result[0]);
    } catch (err) {
      console.error("[API] PATCH /settings/:key error:", err);
      fail(res, 500, "Failed to update setting.");
    }
  }
);

// ─── POST /api/v1/settings ────────────────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  requireRole(["superuser"]),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { key, value, description } = req.body ?? {};

    if (!key || value === undefined) {
      fail(res, 400, "key and value are required.");
      return;
    }

    try {
      const rows = await db.query(
        `INSERT INTO settings (key, value, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = NOW()
         RETURNING *`,
        [key, value, description ?? null]
      );

      await db.query(
        `INSERT INTO logs (timestamp, action, actor, details) VALUES (NOW(), 'SETTING_CREATE', $1, $2)`,
        [req.user!.username, `Created/upserted setting "${key}"`]
      );

      res.status(201).json({ status: "success", data: rows[0] });
    } catch (err) {
      console.error("[API] POST /settings error:", err);
      fail(res, 500, "Failed to create setting.");
    }
  }
);

// ─── DELETE /api/v1/settings/:key ─────────────────────────────────────────────
router.delete(
  "/:key",
  requireAuth,
  requireRole(["superuser"]),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { key } = req.params;
    try {
      const result = await db.query(
        `DELETE FROM settings WHERE key = $1 RETURNING key`,
        [key]
      );
      if (!result.length) { fail(res, 404, `Setting "${key}" not found.`); return; }

      await db.query(
        `INSERT INTO logs (timestamp, action, actor, details) VALUES (NOW(), 'SETTING_DELETE', $1, $2)`,
        [req.user!.username, `Deleted setting "${key}"`]
      );

      ok(res, { deleted: true, key });
    } catch (err) {
      console.error("[API] DELETE /settings/:key error:", err);
      fail(res, 500, "Failed to delete setting.");
    }
  }
);

export default router;