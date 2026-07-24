/**
 * api/v1/routes/tickets.ts
 * ========================
 * RESTful Ticketing module — v1 API (PostgreSQL-backed).
 *
 * Endpoints:
 *   GET    /api/v1/tickets            — List tickets (filtered by role)
 *   POST   /api/v1/tickets            — Create a new ticket
 *   GET    /api/v1/tickets/:id        — Get a single ticket
 *   PUT    /api/v1/tickets/:id        — Full update of a ticket
 *   PATCH  /api/v1/tickets/:id        — Partial update / status change
 *   DELETE /api/v1/tickets/:id        — Delete a ticket (admin/superuser only)
 *
 * RBAC:
 *   All routes require requireAuth.
 *   DELETE requires requireRole(["admin","superuser"]).
 *   Technicians/vendors only see tickets assigned to them or unassigned open ones.
 */

import { Router, Response } from "express";
import {
  requireAuth,
  requireRole,
  AuthRequest,
} from "../middleware/auth.js";

// @ts-ignore
import db from "../../../database.js";
// @ts-ignore
import {
  sendNewTicketNotification,
  sendTicketClosedNotification,
} from "../../../services/wa-notify.js";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ok = (res: Response, data: unknown, meta?: object) =>
  res.json({ status: "success", data, ...meta });

const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ status: "error", message });

/** Safely parse a comma-separated string into a string array */
function splitIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Convert a DB row (snake_case) → the camelCase Ticket shape the frontend expects.
 */
function mapTicket(row: any): any {
  if (!row) return row;
  return {
    id: row.id,
    externalId: row.external_id,
    type: row.type,
    status: row.status,
    customerName: row.customer_name ?? row.customerName ?? "",
    address: row.address ?? "",
    phone: row.phone ?? "",
    issue: row.issue ?? undefined,
    package: row.package_name ?? row.package ?? undefined,
    locationUrl: row.location_url ?? row.locationUrl ?? undefined,
    notes: row.notes ?? undefined,
    technicianNotes: row.technician_notes ?? row.technicianNotes ?? undefined,
    report: row.report ?? undefined,
    billingEntered: row.billing_entered ?? row.billingEntered ?? false,
    // Attachments are served from ticket_attachments table (loaded in GET /:id)
    reportAttachmentUrl: row.report_attachment_url ?? row.reportAttachmentUrl ?? undefined,
    reportAttachmentName: row.report_attachment_name ?? row.reportAttachmentName ?? undefined,
    attachmentUrl: row.attachment_url ?? row.attachmentUrl ?? undefined,
    attachmentName: row.attachment_name ?? row.attachmentName ?? undefined,
    createdBy: row.created_by ?? row.createdBy ?? undefined,
    createdAt: row.created_at ?? row.createdAt ?? undefined,
    updatedAt: row.updated_at ?? row.updatedAt ?? undefined,
    completedAt: row.completed_at ?? row.completedAt ?? undefined,
    assignedTechnicianIds: Array.isArray(row.assigned_technician_ids)
      ? row.assigned_technician_ids
      : splitIds(row.assigned_technician_ids),
    attachments: row.attachments ?? undefined,
  };
}

// ─── Full column list (reused in every SELECT) ────────────────────────────────
const TICKET_COLS = `
  t.id, t.external_id, t.type, t.status,
  t.customer_name, t.address, t.phone,
  t.package_name, t.issue, t.report,
  t.location_url, t.notes, t.technician_notes,
  t.billing_entered, t.completed_at,
  t.created_by, t.created_at, t.updated_at
`.trim();

// ─── GET /api/v1/tickets ──────────────────────────────────────────────────────
/**
 * Query params:
 *   status   — filter by status  (open | in-progress | completed | cancelled)
 *   type     — filter by type    (installation | maintenance | dismantle)
 *   page     — page number       (default 1)
 *   limit    — page size         (default 50, max 200)
 */
router.get(
  "/",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
      const limit = Math.min(
        200,
        Math.max(1, parseInt(String(req.query.limit ?? "50"), 10))
      );
      const offset = (page - 1) * limit;

      const filters: string[] = [];
      const params: unknown[] = [];
      let p = 1;

      // Role-based filter
      const role = req.user!.role;
      const userId = req.user!.userId;

      if (role === "technician" || role === "vendor") {
        filters.push(`(
          (t.status = 'open' AND NOT EXISTS (
            SELECT 1 FROM ticket_technicians tt2 WHERE tt2.ticket_id = t.id
          ))
          OR EXISTS (
            SELECT 1 FROM ticket_technicians tt WHERE tt.ticket_id = t.id AND tt.user_id = $${p}
          )
        )`);
        params.push(userId);
        p++;
      }

      if (req.query.status) {
        filters.push(`t.status = $${p}`);
        params.push(req.query.status);
        p++;
      }
      if (req.query.type) {
        filters.push(`t.type = $${p}`);
        params.push(req.query.type);
        p++;
      }

      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

      const sql = `
        SELECT
          ${TICKET_COLS},
          STRING_AGG(tt.user_id::TEXT, ',') AS assigned_technician_ids
        FROM tickets t
        LEFT JOIN ticket_technicians tt ON tt.ticket_id = t.id
        ${where}
        GROUP BY t.id
        ORDER BY t.created_at DESC
        LIMIT $${p} OFFSET $${p + 1}
      `;
      params.push(limit, offset);

      const countSql = `
        SELECT COUNT(DISTINCT t.id) AS total
        FROM tickets t
        LEFT JOIN ticket_technicians tt ON tt.ticket_id = t.id
        ${where}
      `;
      const countParams = params.slice(0, p - 1);

      const [rows, countRows] = await Promise.all([
        db.query(sql, params),
        db.query(countSql, countParams),
      ]);

      const total = parseInt(countRows[0]?.total ?? "0", 10);
      const tickets = rows.map((r: any) => mapTicket(r));

      ok(res, tickets, {
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      console.error("[API] GET /tickets error:", err);
      fail(res, 500, "Failed to fetch tickets.");
    }
  }
);

// ─── GET /api/v1/tickets/:id ──────────────────────────────────────────────────
router.get(
  "/:id",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const rows = await db.query(
        `SELECT
           ${TICKET_COLS},
           STRING_AGG(tt.user_id::TEXT, ',') AS assigned_technician_ids
         FROM tickets t
         LEFT JOIN ticket_technicians tt ON tt.ticket_id = t.id
         WHERE t.id = $1
         GROUP BY t.id`,
        [req.params.id]
      );

      if (!rows.length) {
        fail(res, 404, `Ticket ${req.params.id} not found.`);
        return;
      }

      const rawTicket = {
        ...rows[0],
        assigned_technician_ids: splitIds(rows[0].assigned_technician_ids),
      };

      // Load attachments from the dedicated table
      const attachments = await db.query(
        `SELECT id, url, original_name, mime_type, created_at
         FROM ticket_attachments WHERE ticket_id = $1 ORDER BY created_at`,
        [req.params.id]
      );
      rawTicket.attachments = attachments;

      ok(res, mapTicket(rawTicket));
    } catch (err) {
      console.error("[API] GET /tickets/:id error:", err);
      fail(res, 500, "Failed to fetch ticket.");
    }
  }
);

// ─── POST /api/v1/tickets ─────────────────────────────────────────────────────
/**
 * Body (camelCase or snake_case accepted):
 *   type*              — installation | maintenance | dismantle
 *   customer_name*     — customer full name
 *   address*           — service address
 *   phone              — customer phone
 *   package_name       — internet package (for installation)
 *   issue              — problem description (for maintenance/dismantle)
 *   location_url       — Google Maps link
 *   notes              — admin notes
 *   technician_notes   — technician internal notes
 *   assigned_technician_ids — string[] of user IDs
 *   created_by         — username of creator
 */
router.post(
  "/",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const b = req.body ?? {};

    // Accept both camelCase (frontend) and snake_case (API clients)
    const type = b.type;
    const customer_name = b.customer_name ?? b.customerName;
    const address = b.address;
    const phone = b.phone;
    const package_name = b.package_name ?? b.package;
    const issue = b.issue;
    const location_url = b.location_url ?? b.locationUrl;
    const notes = b.notes ?? null;
    const technician_notes = b.technician_notes ?? b.technicianNotes;
    const assigned_technician_ids =
      b.assigned_technician_ids ?? b.assignedTechnicianIds ?? [];
    const created_by = b.created_by ?? b.createdBy;

    if (!type || !customer_name || !address) {
      fail(res, 400, "type, customer_name, and address are required.");
      return;
    }

    const validTypes = ["installation", "maintenance", "dismantle"];
    if (!validTypes.includes(type)) {
      fail(res, 400, `type must be one of: ${validTypes.join(", ")}`);
      return;
    }

    try {
      // Insert ticket
      const insertRows = await db.query(
        `INSERT INTO tickets
           (type, status, customer_name, address, phone,
            package_name, issue, location_url, notes, technician_notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING
           id, external_id, type, status, customer_name, address, phone,
           package_name, issue, location_url, notes, technician_notes,
           billing_entered, completed_at,
           created_by, created_at, updated_at`,
        [
          type,
          "open",
          customer_name,
          address,
          phone ?? null,
          package_name ?? null,
          issue ?? null,
          location_url ?? null,
          notes,
          technician_notes ?? null,
          created_by ?? req.user?.username ?? "api",
        ]
      );

      const ticket = insertRows[0];

      // Insert technician assignments
      const ids: string[] = Array.isArray(assigned_technician_ids)
        ? assigned_technician_ids
        : splitIds(assigned_technician_ids);

      if (ids.length) {
        for (const uid of ids) {
          await db.query(
            `INSERT INTO ticket_technicians (ticket_id, user_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [ticket.id, uid]
          );
        }
      }
      ticket.assigned_technician_ids = ids;

      // Audit log
      await db.query(
        `INSERT INTO logs (timestamp, action, actor, details)
         VALUES (NOW(), 'TICKET_CREATE', $1, $2)`,
        [
          created_by ?? req.user?.username ?? "api",
          `Created ticket #${ticket.external_id} for ${customer_name}`,
        ]
      );

      // ── WhatsApp notification (fire-and-forget) ──────────────────────────
      sendNewTicketNotification(ticket, ids).catch(console.error);

      res.status(201).json({ status: "success", data: mapTicket(ticket) });
    } catch (err) {
      console.error("[API] POST /tickets error:", err);
      fail(res, 500, "Failed to create ticket.");
    }
  }
);

// ─── PATCH /api/v1/tickets/:id ────────────────────────────────────────────────
/**
 * Partial update. Accepted fields (camelCase or snake_case):
 *   status, type, customer_name, address, phone,
 *   package_name, issue, report, location_url, notes,
 *   technician_notes, billing_entered, completed_at,
 *   assigned_technician_ids (replaces existing assignments)
 */
router.patch(
  "/:id",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const b = req.body ?? {};

    // Normalise camelCase → snake_case
    const bodyNorm: Record<string, unknown> = {
      ...b,
      customer_name: b.customer_name ?? b.customerName,
      package_name: b.package_name ?? b.package,
      location_url: b.location_url ?? b.locationUrl,
      notes: b.notes,
      technician_notes: b.technician_notes ?? b.technicianNotes,
      billing_entered: b.billing_entered ?? b.billingEntered,
      completed_at: b.completed_at ?? b.completedAt,
      assigned_technician_ids:
        b.assigned_technician_ids ?? b.assignedTechnicianIds,
    };

    const allowed = [
      "status",
      "type",
      "customer_name",
      "address",
      "phone",
      "package_name",
      "issue",
      "report",
      "location_url",
      "notes",
      "technician_notes",
      "billing_entered",
      "completed_at",
    ];

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    for (const field of allowed) {
      if (bodyNorm[field] !== undefined) {
        setClauses.push(`${field} = $${p}`);
        params.push(bodyNorm[field]);
        p++;
      }
    }

    const assignedIds = bodyNorm.assigned_technician_ids;
    if (!setClauses.length && assignedIds === undefined) {
      fail(res, 400, "No updatable fields provided.");
      return;
    }

    try {
      // Update scalar fields
      if (setClauses.length) {
        setClauses.push(`updated_at = NOW()`);
        params.push(id);
        await db.query(
          `UPDATE tickets SET ${setClauses.join(", ")} WHERE id = $${p}`,
          params
        );
      }

      // Replace technician assignments if provided
      if (assignedIds !== undefined) {
        await db.query(
          `DELETE FROM ticket_technicians WHERE ticket_id = $1`,
          [id]
        );
        const ids: string[] = Array.isArray(assignedIds)
          ? (assignedIds as string[])
          : splitIds(assignedIds as string);
        for (const uid of ids) {
          await db.query(
            `INSERT INTO ticket_technicians (ticket_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [id, uid]
          );
        }
      }

      // Audit log
      const updatedBy =
        req.body.updated_by ?? req.user?.username ?? "api";
      await db.query(
        `INSERT INTO logs (timestamp, action, actor, details)
         VALUES (NOW(), 'TICKET_UPDATE', $1, $2)`,
        [
          updatedBy,
          `Updated ticket ${id}${
            req.body.status ? ` → status: ${req.body.status}` : ""
          }`,
        ]
      );

      // Return fresh record
      const rows = await db.query(
        `SELECT ${TICKET_COLS},
                STRING_AGG(tt.user_id::TEXT, ',') AS assigned_technician_ids
         FROM tickets t
         LEFT JOIN ticket_technicians tt ON tt.ticket_id = t.id
         WHERE t.id = $1 GROUP BY t.id`,
        [id]
      );

      if (!rows.length) {
        fail(res, 404, `Ticket ${id} not found.`);
        return;
      }

      const updatedTicket = {
        ...rows[0],
        assigned_technician_ids: splitIds(rows[0].assigned_technician_ids),
      };

      // ── WhatsApp closed notification (fire-and-forget) ────────────────────
      if (req.body.status === "completed" || b.status === "completed") {
        sendTicketClosedNotification(
          updatedTicket,
          updatedTicket.assigned_technician_ids
        ).catch(console.error);
      }

      ok(res, mapTicket(updatedTicket));
    } catch (err) {
      console.error("[API] PATCH /tickets/:id error:", err);
      fail(res, 500, "Failed to update ticket.");
    }
  }
);

// ─── PUT /api/v1/tickets/:id ──────────────────────────────────────────────────
/**
 * Full replacement — same logic as PATCH but semantically a full update.
 */
router.put(
  "/:id",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    const allowed = [
      "status",
      "type",
      "customer_name",
      "address",
      "phone",
      "package_name",
      "issue",
      "report",
      "location_url",
      "notes",
      "technician_notes",
      "billing_entered",
      "completed_at",
    ];

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        setClauses.push(`${field} = $${p}`);
        params.push(req.body[field]);
        p++;
      }
    }

    if (
      !setClauses.length &&
      req.body.assigned_technician_ids === undefined
    ) {
      fail(res, 400, "No updatable fields provided.");
      return;
    }

    try {
      if (setClauses.length) {
        setClauses.push(`updated_at = NOW()`);
        params.push(id);
        await db.query(
          `UPDATE tickets SET ${setClauses.join(", ")} WHERE id = $${p}`,
          params
        );
      }

      if (req.body.assigned_technician_ids !== undefined) {
        await db.query(
          `DELETE FROM ticket_technicians WHERE ticket_id = $1`,
          [id]
        );
        const ids: string[] = Array.isArray(req.body.assigned_technician_ids)
          ? req.body.assigned_technician_ids
          : splitIds(req.body.assigned_technician_ids);
        for (const uid of ids) {
          await db.query(
            `INSERT INTO ticket_technicians (ticket_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [id, uid]
          );
        }
      }

      const updatedBy =
        req.body.updated_by ?? req.user?.username ?? "api";
      await db.query(
        `INSERT INTO logs (timestamp, action, actor, details) VALUES (NOW(), 'TICKET_UPDATE', $1, $2)`,
        [updatedBy, `Full-updated ticket ${id}`]
      );

      const rows = await db.query(
        `SELECT ${TICKET_COLS},
                STRING_AGG(tt.user_id::TEXT, ',') AS assigned_technician_ids
         FROM tickets t
         LEFT JOIN ticket_technicians tt ON tt.ticket_id = t.id
         WHERE t.id = $1 GROUP BY t.id`,
        [id]
      );

      if (!rows.length) {
        fail(res, 404, `Ticket ${id} not found.`);
        return;
      }

      const updatedTicket = {
        ...rows[0],
        assigned_technician_ids: splitIds(rows[0].assigned_technician_ids),
      };

      // ── WhatsApp closed notification (fire-and-forget) ────────────────────
      if (req.body.status === "completed") {
        sendTicketClosedNotification(
          updatedTicket,
          updatedTicket.assigned_technician_ids
        ).catch(console.error);
      }

      ok(res, mapTicket(updatedTicket));
    } catch (err) {
      console.error("[API] PUT /tickets/:id error:", err);
      fail(res, 500, "Failed to update ticket.");
    }
  }
);

// ─── POST /api/v1/tickets/:id/resend-notification ────────────────────────────
/**
 * Resend the WhatsApp new-ticket notification for an existing open ticket.
 * Restricted to non-technician, non-vendor roles.
 */
router.post(
  "/:id/resend-notification",
  requireAuth,
  requireRole(["admin", "superuser", "supervisor"]),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
      const rows = await db.query(
        `SELECT ${TICKET_COLS},
                STRING_AGG(tt.user_id::TEXT, ',') AS assigned_technician_ids
         FROM tickets t
         LEFT JOIN ticket_technicians tt ON tt.ticket_id = t.id
         WHERE t.id = $1
         GROUP BY t.id`,
        [id]
      );

      if (!rows.length) {
        fail(res, 404, `Ticket ${id} not found.`);
        return;
      }

      const ticket = rows[0];
      if (ticket.status !== "open") {
        fail(res, 400, "Notification can only be resent for open tickets.");
        return;
      }

      const techIds = splitIds(ticket.assigned_technician_ids);

      // Fire-and-forget — mirrors the pattern used on POST /tickets
      sendNewTicketNotification(ticket, techIds).catch(console.error);

      await db.query(
        `INSERT INTO logs (timestamp, action, actor, details) VALUES (NOW(), 'TICKET_RESEND_NOTIF', $1, $2)`,
        [req.user!.username, `Resent WhatsApp notification for ticket ${id}`]
      );

      ok(res, { resent: true, ticketId: id });
    } catch (err) {
      console.error("[API] POST /tickets/:id/resend-notification error:", err);
      fail(res, 500, "Failed to resend notification.");
    }
  }
);

// ─── DELETE /api/v1/tickets/:id ───────────────────────────────────────────────
/**
 * Hard-delete a ticket and all related records.
 * Restricted to admin and superuser roles.
 */
router.delete(
  "/:id",
  requireAuth,
  requireRole(["admin", "superuser"]),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
      // Cascade deletes (ticket_technicians, ticket_attachments) via FK ON DELETE CASCADE
      const result = await db.query(
        `DELETE FROM tickets WHERE id = $1 RETURNING id`,
        [id]
      );

      if (!result.length) {
        fail(res, 404, `Ticket ${id} not found.`);
        return;
      }

      await db.query(
        `INSERT INTO logs (timestamp, action, actor, details) VALUES (NOW(), 'TICKET_DELETE', $1, $2)`,
        [req.user!.username, `Deleted ticket ${id}`]
      );

      ok(res, { deleted: true, id });
    } catch (err) {
      console.error("[API] DELETE /tickets/:id error:", err);
      fail(res, 500, "Failed to delete ticket.");
    }
  }
);

export default router;