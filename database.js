/**
 * database.js
 * ============
 * SQL connection pool that replaces the JSON flat-file database (db.json).
 *
 * Supports both MySQL/MariaDB (mysql2) and PostgreSQL (pg).
 * The driver is selected via the DB_DRIVER environment variable.
 *
 * Environment variables (.env):
 *   DB_DRIVER     = mysql2 | pg          (default: mysql2)
 *   DB_HOST       = 127.0.0.1
 *   DB_PORT       = 3306 | 5432
 *   DB_USER       = root | postgres
 *   DB_PASSWORD   = yourpassword
 *   DB_NAME       = ticketing_gekanet
 *   DB_POOL_MIN   = 2
 *   DB_POOL_MAX   = 10
 *
 * Usage:
 *   import db from "./database.js";
 *
 *   const rows    = await db.query("SELECT * FROM tickets WHERE status = ?", ["open"]);
 *   const user    = await db.users.findByUsername("admin");
 *   const tickets = await db.tickets.findAll({ role: "technician", userId: "123" });
 *   const settings = await db.settings.get();
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require  = createRequire(import.meta.url);

// ─── Load .env ────────────────────────────────────────────────────────────────
function loadEnv(filePath = path.join(__dirname, ".env")) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key   = trimmed.slice(0, eqIndex).trim();
    let   value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv();

// ─── Config ───────────────────────────────────────────────────────────────────
const DRIVER    = (process.env.DB_DRIVER   || "mysql2").toLowerCase();
const DB_HOST   =  process.env.DB_HOST     || "127.0.0.1";
const DB_PORT   =  parseInt(process.env.DB_PORT || (DRIVER === "pg" ? "5432" : "3306"), 10);
const DB_USER   =  process.env.DB_USER     || (DRIVER === "pg" ? "postgres" : "root");
const DB_PASS   =  process.env.DB_PASSWORD || "";
const DB_NAME   =  process.env.DB_NAME     || "ticketing_gekanet";
const POOL_MIN  =  parseInt(process.env.DB_POOL_MIN || "2",  10);
const POOL_MAX  =  parseInt(process.env.DB_POOL_MAX || "10", 10);

// ─── Driver-specific SQL fragments ───────────────────────────────────────────
// GROUP_CONCAT (MySQL) vs STRING_AGG (PostgreSQL)
const SQL_GROUP_CONCAT = DRIVER === "pg"
  ? "STRING_AGG(tt.user_id::TEXT, ',')"
  : "GROUP_CONCAT(tt.user_id)";

// INSERT OR IGNORE duplicate rows
const SQL_INSERT_OR_IGNORE = (table, cols, placeholders) =>
  DRIVER === "pg"
    ? `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
    : `INSERT IGNORE INTO ${table} (${cols}) VALUES (${placeholders})`;

// ─── Pool singleton ───────────────────────────────────────────────────────────
let _pool = null;

function getPool() {
  if (_pool) return _pool;

  if (DRIVER === "pg") {
    const pg = _require("pg");
    _pool = new pg.Pool({
      host:                    DB_HOST,
      port:                    DB_PORT,
      user:                    DB_USER,
      password:                DB_PASS,
      database:                DB_NAME,
      min:                     POOL_MIN,
      max:                     POOL_MAX,
      idleTimeoutMillis:       30_000,
      connectionTimeoutMillis: 5_000,
    });
    _pool.on("error", (err) => {
      console.error("[DB] Unexpected pool error:", err.message);
    });
  } else {
    const mysql = _require("mysql2/promise");
    _pool = mysql.createPool({
      host:               DB_HOST,
      port:               DB_PORT,
      user:               DB_USER,
      password:           DB_PASS,
      database:           DB_NAME,
      waitForConnections: true,
      connectionLimit:    POOL_MAX,
      queueLimit:         0,
      timezone:           "Z",
    });
  }

  return _pool;
}

// ─── Core query helper ────────────────────────────────────────────────────────
/**
 * Execute a parameterised SQL query.
 * For MySQL:      uses ? placeholders
 * For PostgreSQL: automatically converts ? → $1, $2, …
 *
 * @param {string}  sql     – SQL string with ? placeholders
 * @param {any[]}   params  – Bound parameter values
 * @returns {Promise<any[]>} – Array of result rows
 */
async function query(sql, params = []) {
  const pool = getPool();

  if (DRIVER === "pg") {
    let idx = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
    const result = await pool.query(pgSql, params);
    return result.rows;
  } else {
    const [rows] = await pool.execute(sql, params);
    return rows;
  }
}

/**
 * Execute a query inside a transaction.
 * @param {(q: typeof query) => Promise<T>} fn  – Callback receiving a bound query fn
 * @returns {Promise<T>}
 */
async function transaction(fn) {
  const pool = getPool();

  if (DRIVER === "pg") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const txQuery = async (sql, params = []) => {
        let idx = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
        const result = await client.query(pgSql, params);
        return result.rows;
      };
      const result = await fn(txQuery);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } else {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const txQuery = async (sql, params = []) => {
        const [rows] = await conn.execute(sql, params);
        return rows;
      };
      const result = await fn(txQuery);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

// ─── RBAC helpers ─────────────────────────────────────────────────────────────
const ROLES = {
  admin:      "admin",
  technician: "technician",
  vendor:     "vendor",
  supervisor: "supervisor",
  superuser:  "superuser",
};

// ─── Users API ────────────────────────────────────────────────────────────────
const users = {
  /** Find a user by username + password (plain-text; replace with bcrypt in production) */
  async findByCredentials(username, password) {
    const rows = await query(
      `SELECT u.id, u.username, u.name, u.phone, r.name AS role
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.username = ? AND u.password_hash = ?
       LIMIT 1`,
      [username, password]
    );
    return rows[0] || null;
  },

  /** Get all users (no password) */
  async findAll() {
    return query(
      `SELECT u.id, u.username, u.name, u.phone, r.name AS role
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.name`
    );
  },

  /** Get only technicians and vendors (for ticket assignment) */
  async findTechnicians() {
    return query(
      `SELECT u.id, u.username, u.name, u.phone, r.name AS role
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.name IN ('technician', 'vendor')
       ORDER BY u.name`
    );
  },

  /** Get user by ID */
  async findById(id) {
    const rows = await query(
      `SELECT u.id, u.username, u.name, u.phone, r.name AS role
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?
       LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

  /**
   * Create a new user.
   * @param {{ username, password, role, name, phone? }} data
   */
  async create({ username, password, role, name, phone = null }) {
    const roleRows = await query("SELECT id FROM roles WHERE name = ? LIMIT 1", [role]);
    if (!roleRows.length) throw new Error(`Unknown role: ${role}`);
    const roleId = roleRows[0].id;

    const id = Date.now().toString();
    await query(
      `INSERT INTO users (id, username, password_hash, role_id, name, phone)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, username, password, roleId, name, phone || null]
    );
    return { id, username, name, role, phone };
  },

  /**
   * Update a user.
   * @param {string} id
   * @param {{ username?, password?, role?, name?, phone? }} data
   */
  async update(id, data) {
    const sets   = [];
    const params = [];

    if (data.username !== undefined) { sets.push("username = ?");      params.push(data.username); }
    if (data.password !== undefined && data.password) {
      sets.push("password_hash = ?"); params.push(data.password);
    }
    if (data.name  !== undefined) { sets.push("name = ?");  params.push(data.name); }
    if (data.phone !== undefined) { sets.push("phone = ?"); params.push(data.phone || null); }

    if (data.role !== undefined) {
      const roleRows = await query("SELECT id FROM roles WHERE name = ? LIMIT 1", [data.role]);
      if (!roleRows.length) throw new Error(`Unknown role: ${data.role}`);
      sets.push("role_id = ?");
      params.push(roleRows[0].id);
    }

    if (!sets.length) return users.findById(id);

    params.push(id);
    await query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
    return users.findById(id);
  },

  /** Delete user by ID */
  async delete(id) {
    const result = await query("DELETE FROM users WHERE id = ?", [id]);
    return (result?.affectedRows ?? result?.rowCount ?? 0) > 0;
  },
};

// ─── Tickets API ──────────────────────────────────────────────────────────────
const tickets = {
  /**
   * Get tickets with optional role-based filtering.
   * Technicians / vendors only see open (unassigned) or their own tickets.
   */
  async findAll({ userId, role } = {}) {
    const isRestricted = role === "technician" || role === "vendor";

    const base = `
      SELECT
        t.*,
        ${SQL_GROUP_CONCAT} AS assigned_technician_ids
      FROM tickets t
      LEFT JOIN ticket_technicians tt ON tt.ticket_id = t.id
    `;

    if (isRestricted && userId) {
      // Use EXISTS subqueries — works identically in MySQL and PostgreSQL
      const rows = await query(
        `${base}
         WHERE (
           t.status = 'open'
           AND NOT EXISTS (
             SELECT 1 FROM ticket_technicians te WHERE te.ticket_id = t.id
           )
         ) OR EXISTS (
           SELECT 1 FROM ticket_technicians te
           WHERE te.ticket_id = t.id AND te.user_id = ?
         )
         GROUP BY t.id
         ORDER BY t.created_at DESC`,
        [String(userId)]
      );
      return rows.map(normaliseTicket);
    }

    const rows = await query(`${base} GROUP BY t.id ORDER BY t.created_at DESC`);
    return rows.map(normaliseTicket);
  },

  /** Get single ticket by ID */
  async findById(id) {
    const rows = await query(
      `SELECT t.*, ${SQL_GROUP_CONCAT} AS assigned_technician_ids
       FROM tickets t
       LEFT JOIN ticket_technicians tt ON tt.ticket_id = t.id
       WHERE t.id = ?
       GROUP BY t.id
       LIMIT 1`,
      [id]
    );
    return rows.length ? normaliseTicket(rows[0]) : null;
  },

  /**
   * Create a ticket and its technician assignments in a single transaction.
   * @param {object} data – ticket fields (camelCase from request body)
   */
  async create(data) {
    const id = Date.now().toString();
    return transaction(async (q) => {
      await q(
        `INSERT INTO tickets (
           id, created_at, type, status,
           customer_name, address, location_url, phone,
           issue, package, notes,
           attachment_url, attachment_name,
           billing_entered
         ) VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.type   || "maintenance",
          data.status || "open",
          data.customerName || "",
          data.address      || "",
          data.locationUrl  || null,
          data.phone        || "",
          data.issue        || null,
          data.package      || null,
          data.notes        || null,
          data.attachmentUrl  || null,
          data.attachmentName || null,
          data.billingEntered ? 1 : 0,
        ]
      );

      // Populate junction table (skip duplicates)
      const assignedIds = buildAssignedIds(data);
      for (const uid of assignedIds) {
        await q(
          SQL_INSERT_OR_IGNORE(
            "ticket_technicians",
            "ticket_id, user_id",
            "?, ?"
          ),
          [id, uid]
        );
      }

      return tickets.findById(id);
    });
  },

  /**
   * Update ticket fields and re-sync technician assignments.
   * @param {string} id
   * @param {object} data – partial update (camelCase)
   */
  async update(id, data) {
    return transaction(async (q) => {
      const sets   = [];
      const params = [];

      const fieldMap = {
        status:               "status",
        type:                 "type",
        customerName:         "customer_name",
        address:              "address",
        locationUrl:          "location_url",
        phone:                "phone",
        issue:                "issue",
        package:              "package",
        notes:                "notes",
        attachmentUrl:        "attachment_url",
        attachmentName:       "attachment_name",
        report:               "report",
        technicianNotes:      "technician_notes",
        reportAttachmentUrl:  "report_attachment_url",
        reportAttachmentName: "report_attachment_name",
        billingEntered:       "billing_entered",
        completedAt:          "completed_at",
      };

      for (const [jsKey, sqlCol] of Object.entries(fieldMap)) {
        if (data[jsKey] !== undefined) {
          sets.push(`${sqlCol} = ?`);
          if (jsKey === "billingEntered") {
            params.push(data[jsKey] ? 1 : 0);
          } else if (jsKey === "completedAt") {
            params.push(data[jsKey] ? new Date(data[jsKey]) : null);
          } else {
            params.push(data[jsKey] ?? null);
          }
        }
      }

      // Auto-set completedAt when status → completed
      if (data.status === "completed" && data.completedAt === undefined) {
        sets.push("completed_at = NOW()");
      }

      if (sets.length) {
        params.push(id);
        await q(`UPDATE tickets SET ${sets.join(", ")} WHERE id = ?`, params);
      }

      // Re-sync junction table if assignedTechnicianIds was provided
      if (data.assignedTechnicianIds !== undefined || data.technicianId !== undefined) {
        await q("DELETE FROM ticket_technicians WHERE ticket_id = ?", [id]);
        const assignedIds = buildAssignedIds(data);
        for (const uid of assignedIds) {
          await q(
            SQL_INSERT_OR_IGNORE(
              "ticket_technicians",
              "ticket_id, user_id",
              "?, ?"
            ),
            [id, uid]
          );
        }
      }

      return tickets.findById(id);
    });
  },

  /** Delete a ticket (cascade removes ticket_technicians) */
  async delete(id) {
    const result = await query("DELETE FROM tickets WHERE id = ?", [id]);
    return (result?.affectedRows ?? result?.rowCount ?? 0) > 0;
  },
};

// ─── Settings API ─────────────────────────────────────────────────────────────
const settings = {
  async get() {
    const rows = await query("SELECT * FROM settings WHERE id = 1 LIMIT 1");
    if (!rows.length) return getDefaultSettings();
    return fromSqlSettings(rows[0]);
  },

  async save(data) {
    const current = await settings.get();
    const merged  = { ...current, ...data };

    const values = [
      merged.whatsappGroup        || null,
      merged.templateInstallation || "",
      merged.templateMaintenance  || "",
      merged.templateDismantle    || "",
      merged.templateClosed       || "",
      merged.mediaRetentionDays   || 60,
    ];

    if (DRIVER === "pg") {
      await query(
        `INSERT INTO settings (
           id, whatsapp_group,
           template_installation, template_maintenance, template_dismantle, template_closed,
           media_retention_days
         ) VALUES (1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           whatsapp_group        = EXCLUDED.whatsapp_group,
           template_installation = EXCLUDED.template_installation,
           template_maintenance  = EXCLUDED.template_maintenance,
           template_dismantle    = EXCLUDED.template_dismantle,
           template_closed       = EXCLUDED.template_closed,
           media_retention_days  = EXCLUDED.media_retention_days`,
        values
      );
    } else {
      await query(
        `INSERT INTO settings (
           id, whatsapp_group,
           template_installation, template_maintenance, template_dismantle, template_closed,
           media_retention_days
         ) VALUES (1, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           whatsapp_group        = VALUES(whatsapp_group),
           template_installation = VALUES(template_installation),
           template_maintenance  = VALUES(template_maintenance),
           template_dismantle    = VALUES(template_dismantle),
           template_closed       = VALUES(template_closed),
           media_retention_days  = VALUES(media_retention_days)`,
        values
      );
    }

    return settings.get();
  },
};

// ─── Logs API ─────────────────────────────────────────────────────────────────
const logs = {
  /** Return the last N log entries (default 500) */
  async findAll(limit = 500) {
    // PostgreSQL: "user" is a reserved keyword — must be double-quoted as an alias
    // MySQL: backticks not needed for simple identifiers, plain alias works fine
    const actorAlias = DRIVER === "pg" ? 'actor AS "user"' : "actor AS user";
    return query(
      `SELECT id, timestamp, action, ${actorAlias}, details FROM logs ORDER BY timestamp DESC LIMIT ?`,
      [limit]
    );
  },

  /**
   * Append a log entry and trim the table to 500 rows.
   * @param {string} action
   * @param {string} actor   – user name or "System"
   * @param {string} details
   */
  async add(action, actor, details) {
    const id = Date.now().toString();
    await query(
      "INSERT INTO logs (id, action, actor, details) VALUES (?, ?, ?, ?)",
      [id, action, actor || "System", details || ""]
    );

    // Trim: keep only the 500 newest rows
    // Works in both MySQL and PostgreSQL
    await query(
      `DELETE FROM logs WHERE id NOT IN (
         SELECT id FROM (
           SELECT id FROM logs ORDER BY timestamp DESC LIMIT 500
         ) AS sub
       )`
    );
  },
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Convert a SQL ticket row back to the camelCase shape expected by the frontend */
function normaliseTicket(row) {
  const ids = row.assigned_technician_ids
    ? String(row.assigned_technician_ids).split(",").filter(Boolean)
    : [];

  return {
    id:                    String(row.id),
    createdAt:             row.created_at instanceof Date
                             ? row.created_at.toISOString()
                             : String(row.created_at || ""),
    completedAt:           row.completed_at instanceof Date
                             ? row.completed_at.toISOString()
                             : (row.completed_at ? String(row.completed_at) : undefined),
    type:                  row.type,
    status:                row.status,
    customerName:          row.customer_name,
    address:               row.address,
    locationUrl:           row.location_url    || undefined,
    phone:                 row.phone           || "",
    issue:                 row.issue           || undefined,
    package:               row.package         || undefined,
    notes:                 row.notes           || undefined,
    attachmentUrl:         row.attachment_url  || undefined,
    attachmentName:        row.attachment_name || undefined,
    report:                row.report          || undefined,
    technicianNotes:       row.technician_notes       || undefined,
    reportAttachmentUrl:   row.report_attachment_url  || undefined,
    reportAttachmentName:  row.report_attachment_name || undefined,
    billingEntered:        Boolean(row.billing_entered),
    assignedTechnicianIds: ids,
  };
}

/** Build a de-duplicated Set of user IDs from both technicianId and assignedTechnicianIds */
function buildAssignedIds(data) {
  const set = new Set();
  if (data.technicianId) set.add(String(data.technicianId));
  if (Array.isArray(data.assignedTechnicianIds)) {
    for (const id of data.assignedTechnicianIds) set.add(String(id));
  }
  return set;
}

/** Convert SQL settings row → camelCase object */
function fromSqlSettings(row) {
  return {
    whatsappGroup:        row.whatsapp_group        || "",
    templateInstallation: row.template_installation || "",
    templateMaintenance:  row.template_maintenance  || "",
    templateDismantle:    row.template_dismantle     || "",
    templateClosed:       row.template_closed        || "",
    mediaRetentionDays:   row.media_retention_days  || 60,
  };
}

function getDefaultSettings() {
  return {
    whatsappGroup:        "",
    templateInstallation: "Tiket Pemasangan Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nPaket: {detail}\nTeknisi: {technician}{location}{link}",
    templateMaintenance:  "Tiket Maintenance Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nKendala: {detail}\nTeknisi: {technician}{location}{link}",
    templateDismantle:    "Tiket Dismantle Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nAlasan: {detail}\nTeknisi: {technician}{location}{link}",
    templateClosed:       "Tiket {id} Selesai!\nPelanggan: {customerName}\nStatus: Selesai\nTeknisi: {technician}\nLaporan: {report}{location}{link}",
    mediaRetentionDays:   60,
  };
}

// ─── Health check ─────────────────────────────────────────────────────────────
async function ping() {
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function close() {
  if (!_pool) return;
  await _pool.end();
  _pool = null;
}

// ─── Public API ───────────────────────────────────────────────────────────────
const db = {
  // Core
  query,
  transaction,
  ping,
  close,

  // Domain helpers
  users,
  tickets,
  settings,
  logs,

  // Metadata
  driver: DRIVER,
  ROLES,
};

export default db;