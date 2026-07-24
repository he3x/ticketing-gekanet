/**
 * api/v1/routes/logs.ts
 * =====================
 * GET  /api/v1/logs        — Paginated audit log (admin/superuser/supervisor)
 * GET  /api/v1/logs/export — Download logs as CSV (admin/superuser only)
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

// ─── GET /api/v1/logs ─────────────────────────────────────────────────────────
router.get(
  "/",
  requireAuth,
  requireMinRole("supervisor"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const page   = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10));
      const limit  = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "100"), 10)));
      const offset = (page - 1) * limit;

      const params: unknown[] = [];
      const filters: string[] = [];
      let p = 1;

      if (req.query.actor) {
        filters.push(`actor ILIKE $${p}`);
        params.push(`%${req.query.actor}%`);
        p++;
      }
      if (req.query.action) {
        filters.push(`action = $${p}`);
        params.push(req.query.action);
        p++;
      }
      if (req.query.from) {
        filters.push(`timestamp >= $${p}`);
        params.push(req.query.from);
        p++;
      }
      if (req.query.to) {
        filters.push(`timestamp <= $${p}`);
        params.push(req.query.to);
        p++;
      }

      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

      const [rows, countRows] = await Promise.all([
        db.query(
          `SELECT id, timestamp, action, actor, details
           FROM logs ${where}
           ORDER BY timestamp DESC
           LIMIT $${p} OFFSET $${p + 1}`,
          [...params, limit, offset]
        ),
        db.query(
          `SELECT COUNT(*) AS total FROM logs ${where}`,
          params
        ),
      ]);

      const total = parseInt(countRows[0]?.total ?? "0", 10);
      ok(res, rows, { pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (err) {
      console.error("[API] GET /logs error:", err);
      fail(res, 500, "Failed to fetch logs.");
    }
  }
);

// ─── GET /api/v1/logs/export ──────────────────────────────────────────────────
router.get(
  "/export",
  requireAuth,
  requireRole(["admin", "superuser"]),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const rows = await db.query(
        `SELECT id, timestamp, action, actor, details
         FROM logs ORDER BY timestamp DESC LIMIT 10000`
      );

      const header = "id,timestamp,action,actor,details\n";
      const csvBody = rows
        .map((r: any) =>
          [
            r.id,
            r.timestamp,
            r.action,
            `"${String(r.actor ?? "").replace(/"/g, '""')}"`,
            `"${String(r.details ?? "").replace(/"/g, '""')}"`,
          ].join(",")
        )
        .join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="logs-${Date.now()}.csv"`);
      res.send(header + csvBody);
    } catch (err) {
      console.error("[API] GET /logs/export error:", err);
      fail(res, 500, "Failed to export logs.");
    }
  }
);

export default router;