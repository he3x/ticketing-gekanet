#!/usr/bin/env node
/**
 * migrate-data.js
 * ================
 * Reads the existing db.json flat-file and inserts all records into
 * a MySQL (or PostgreSQL) relational database.
 *
 * Prerequisites:
 *   1. Run schema.sql against your database first:
 *        mysql -u root -p your_db < schema.sql
 *        -- OR --
 *        psql -U postgres -d your_db -f schema.sql
 *
 *   2. Install the appropriate driver:
 *        npm install mysql2          # for MySQL / MariaDB
 *        npm install pg              # for PostgreSQL
 *
 *   3. Create a .env file (or set environment variables):
 *        DB_DRIVER=mysql2            # or "pg"
 *        DB_HOST=127.0.0.1
 *        DB_PORT=3306                # 5432 for PostgreSQL
 *        DB_USER=root
 *        DB_PASSWORD=yourpassword
 *        DB_NAME=ticketing_gekanet
 *
 * Usage:
 *   node migrate-data.js [--dry-run]
 *
 * Flags:
 *   --dry-run   Print all SQL statements without executing them.
 *   --verbose   Print each inserted row.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─── CLI Flags ─────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");

// ─── Load .env (manual parse, no dependency required) ─────────────────────────
function loadEnv(filePath = path.join(__dirname, ".env")) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv();

// ─── Config ────────────────────────────────────────────────────────────────────
const DRIVER   = (process.env.DB_DRIVER   || "mysql2").toLowerCase();
const DB_HOST  = process.env.DB_HOST      || "127.0.0.1";
const DB_PORT  = parseInt(process.env.DB_PORT || (DRIVER === "pg" ? "5432" : "3306"), 10);
const DB_USER  = process.env.DB_USER      || "root";
const DB_PASS  = process.env.DB_PASSWORD  || "";
const DB_NAME  = process.env.DB_NAME      || "ticketing_gekanet";
const DB_FILE  = path.join(__dirname, "db.json");

// ─── Logging helpers ──────────────────────────────────────────────────────────
const log   = (...a) => console.log("[migrate]", ...a);
const info  = (...a) => console.log("\x1b[36m[info]\x1b[0m",  ...a);
const ok    = (...a) => console.log("\x1b[32m[ok]\x1b[0m",    ...a);
const warn  = (...a) => console.warn("\x1b[33m[warn]\x1b[0m", ...a);
const err   = (...a) => console.error("\x1b[31m[err]\x1b[0m", ...a);

// ─── Database adapter ─────────────────────────────────────────────────────────
/**
 * Returns a thin { query(sql, params), close() } object for both mysql2 and pg.
 * All queries use positional placeholders: ? for mysql2, $1 $2 for pg.
 */
async function createAdapter() {
  if (DRIVER === "pg") {
    const { default: pg } = await import("pg");
    const { Pool } = pg;
    const pool = new Pool({
      host: DB_HOST, port: DB_PORT,
      user: DB_USER, password: DB_PASS,
      database: DB_NAME,
    });
    let _conn;
    return {
      // pg uses $1, $2 … placeholders; we convert ? placeholders here
      async query(sql, params = []) {
        const pgSql = sql.replace(/\?/g, (_, i) => {
          // count how many ? came before this one
          let count = 0;
          for (let j = 0; j < sql.indexOf("?", i * 0); j++) {
            if (sql[j] === "?") count++;
          }
          return `$${++count}`;
        });
        // Simpler replacement: convert sequentially
        let idx = 0;
        const converted = sql.replace(/\?/g, () => `$${++idx}`);
        const res = await pool.query(converted, params);
        return [res.rows]; // match mysql2 shape: [rows, fields]
      },
      async beginTransaction() { await pool.query("BEGIN"); },
      async commit()           { await pool.query("COMMIT"); },
      async rollback()         { await pool.query("ROLLBACK"); },
      async close()            { await pool.end(); },
    };
  } else {
    // Default: mysql2
    const mysql = require("mysql2/promise");
    const conn = await mysql.createConnection({
      host: DB_HOST, port: DB_PORT,
      user: DB_USER, password: DB_PASS,
      database: DB_NAME,
      multipleStatements: false,
    });
    return {
      async query(sql, params = []) { return conn.execute(sql, params); },
      async beginTransaction()      { return conn.beginTransaction(); },
      async commit()                { return conn.commit(); },
      async rollback()              { return conn.rollback(); },
      async close()                 { return conn.end(); },
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toTimestamp(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace("T", " ");
}

function toBigInt(id) {
  if (!id) return null;
  const n = BigInt(id);
  return n;
}

/** Map JSON role string → roles.id (seeded in schema.sql in order 1-5) */
const ROLE_MAP = {
  admin:       1,
  technician:  2,
  vendor:      3,
  supervisor:  4,
  superuser:   5,
};

// ─── Counters ─────────────────────────────────────────────────────────────────
let stats = { roles: 0, users: 0, tickets: 0, ticket_technicians: 0, settings: 0, logs: 0, skipped: 0, errors: 0 };

// ─── Dry-run helper ───────────────────────────────────────────────────────────
async function exec(db, sql, params = [], label = "") {
  if (DRY_RUN) {
    const preview = params.map(p => (p === null ? "NULL" : `'${String(p).slice(0, 40)}'`)).join(", ");
    console.log(`  [DRY-RUN] ${sql.split("\n")[0].trim()}  -- (${preview})`);
    return;
  }
  try {
    await db.query(sql, params);
    if (VERBOSE && label) ok(`  Inserted ${label}`);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY" || e.code === "23505" /* pg duplicate */) {
      warn(`  Skipped duplicate: ${label || sql.split("\n")[0].trim()}`);
      stats.skipped++;
    } else {
      err(`  Failed (${label || ""}): ${e.message}`);
      stats.errors++;
    }
  }
}

// ─── Main Migration ───────────────────────────────────────────────────────────
async function migrate() {
  log("=".repeat(60));
  log("ISP Ticketing System – JSON → SQL Migration");
  log("=".repeat(60));

  if (DRY_RUN) warn("DRY-RUN mode: No data will be written to the database.");

  // 1. Read db.json
  if (!fs.existsSync(DB_FILE)) {
    err(`db.json not found at: ${DB_FILE}`);
    err("Please ensure the JSON database file exists before migrating.");
    process.exit(1);
  }

  let jsonDB;
  try {
    jsonDB = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch (e) {
    err("Failed to parse db.json:", e.message);
    process.exit(1);
  }

  const users    = Array.isArray(jsonDB.users)   ? jsonDB.users   : [];
  const tickets  = Array.isArray(jsonDB.tickets)  ? jsonDB.tickets : [];
  const logs     = Array.isArray(jsonDB.logs)     ? jsonDB.logs    : [];
  const settings = jsonDB.settings || {};

  info(`Found: ${users.length} users, ${tickets.length} tickets, ${logs.length} logs`);

  // 2. Connect to database
  let db;
  if (!DRY_RUN) {
    info(`Connecting to ${DRIVER.toUpperCase()} at ${DB_HOST}:${DB_PORT} / ${DB_NAME} …`);
    try {
      db = await createAdapter();
      ok("Connected.");
    } catch (e) {
      err("Could not connect to database:", e.message);
      err("Check your .env DB_* settings and make sure the database server is running.");
      process.exit(1);
    }
  } else {
    db = {
      query: () => {},
      beginTransaction: () => {},
      commit: () => {},
      rollback: () => {},
      close: () => {},
    };
  }

  try {
    await db.beginTransaction();

    // ── 2a. Verify roles exist (seeded by schema.sql) ─────────────────────────
    log("\n── Step 1/5: Verifying roles …");
    if (!DRY_RUN) {
      const [rows] = await db.query("SELECT COUNT(*) AS cnt FROM roles");
      const count = rows[0]?.cnt ?? rows[0]?.count ?? 0;
      if (parseInt(count, 10) < 5) {
        err("Roles are missing. Run schema.sql first to seed the roles table.");
        await db.rollback();
        await db.close();
        process.exit(1);
      }
      ok(`  ${count} roles found.`);
      stats.roles = parseInt(count, 10);
    }

    // ── 2b. Migrate Users ─────────────────────────────────────────────────────
    log(`\n── Step 2/5: Migrating ${users.length} users …`);
    for (const u of users) {
      const roleId = ROLE_MAP[u.role];
      if (!roleId) {
        warn(`  Unknown role "${u.role}" for user "${u.username}" – skipping.`);
        stats.skipped++;
        continue;
      }
      // Convert string ID to a numeric bigint
      let userId;
      try {
        userId = BigInt(u.id).toString();
      } catch (_) {
        warn(`  Invalid user ID "${u.id}" for "${u.username}" – skipping.`);
        stats.skipped++;
        continue;
      }

      await exec(
        db,
        `INSERT INTO users (id, username, password_hash, role_id, name, phone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [userId, u.username, u.password, roleId, u.name, u.phone || null],
        `user "${u.username}" (${u.role})`
      );
      stats.users++;
    }
    ok(`  ${stats.users} users processed.`);

    // ── 2c. Migrate Tickets ───────────────────────────────────────────────────
    log(`\n── Step 3/5: Migrating ${tickets.length} tickets …`);
    for (const t of tickets) {
      let ticketId;
      try {
        ticketId = BigInt(t.id).toString();
      } catch (_) {
        warn(`  Invalid ticket ID "${t.id}" – skipping.`);
        stats.skipped++;
        continue;
      }

      const type   = ["installation", "maintenance", "dismantle"].includes(t.type) ? t.type : "maintenance";
      const status = ["open", "in-progress", "completed", "cancelled"].includes(t.status) ? t.status : "open";

      await exec(
        db,
        `INSERT INTO tickets (
           id, created_at, completed_at,
           type, status,
           customer_name, address, location_url, phone,
           issue, package, notes,
           attachment_url, attachment_name,
           report, technician_notes, report_attachment_url, report_attachment_name,
           billing_entered
         ) VALUES (
           ?, ?, ?,
           ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?,
           ?, ?, ?, ?,
           ?
         )`,
        [
          ticketId,
          toTimestamp(t.createdAt)   || new Date().toISOString().slice(0,19).replace("T"," "),
          toTimestamp(t.completedAt) || null,
          type,
          status,
          t.customerName  || "",
          t.address       || "",
          t.locationUrl   || null,
          t.phone         || "",
          t.issue         || null,
          t.package       || null,
          t.notes         || null,
          t.attachmentUrl     || null,
          t.attachmentName    || null,
          t.report            || null,
          t.technicianNotes   || null,
          t.reportAttachmentUrl  || null,
          t.reportAttachmentName || null,
          t.billingEntered ? 1 : 0,
        ],
        `ticket #${ticketId} (${t.customerName || "unknown"})`
      );
      stats.tickets++;

      // ── 2d. Migrate ticket_technicians (junction) ─────────────────────────
      const assignedIds = new Set();

      // Legacy single technicianId
      if (t.technicianId) assignedIds.add(String(t.technicianId));

      // Multi-assigned technicians array
      if (Array.isArray(t.assignedTechnicianIds)) {
        for (const tid of t.assignedTechnicianIds) assignedIds.add(String(tid));
      }

      for (const userId of assignedIds) {
        // Verify user exists in migration set (avoid FK violation)
        const userExists = users.some(u => String(u.id) === userId);
        if (!userExists) {
          warn(`  ticket #${ticketId}: referenced user ID "${userId}" not found – skipping assignment.`);
          stats.skipped++;
          continue;
        }
        let userIdBig;
        try { userIdBig = BigInt(userId).toString(); } catch (_) { continue; }

        await exec(
          db,
          `INSERT INTO ticket_technicians (ticket_id, user_id) VALUES (?, ?)`,
          [ticketId, userIdBig],
          `ticket_technicians #${ticketId} → user #${userIdBig}`
        );
        stats.ticket_technicians++;
      }
    }
    ok(`  ${stats.tickets} tickets processed, ${stats.ticket_technicians} technician assignments.`);

    // ── 2e. Migrate Settings ─────────────────────────────────────────────────
    log("\n── Step 4/5: Migrating settings …");
    const settingsUpsert = DRIVER === "pg"
      ? `INSERT INTO settings (
           id,
           whatsapp_group,
           template_installation, template_maintenance, template_dismantle, template_closed,
           media_retention_days
         ) VALUES (1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           whatsapp_group        = EXCLUDED.whatsapp_group,
           template_installation = EXCLUDED.template_installation,
           template_maintenance  = EXCLUDED.template_maintenance,
           template_dismantle    = EXCLUDED.template_dismantle,
           template_closed       = EXCLUDED.template_closed,
           media_retention_days  = EXCLUDED.media_retention_days`
      : `INSERT INTO settings (
           id,
           whatsapp_group,
           template_installation, template_maintenance, template_dismantle, template_closed,
           media_retention_days
         ) VALUES (1, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           whatsapp_group        = VALUES(whatsapp_group),
           template_installation = VALUES(template_installation),
           template_maintenance  = VALUES(template_maintenance),
           template_dismantle    = VALUES(template_dismantle),
           template_closed       = VALUES(template_closed),
           media_retention_days  = VALUES(media_retention_days)`;
    await exec(
      db,
      settingsUpsert,
      [
        settings.whatsappGroup         || null,
        settings.templateInstallation  || "",
        settings.templateMaintenance   || "",
        settings.templateDismantle     || "",
        settings.templateClosed        || "",
        settings.mediaRetentionDays    || 60,
      ],
      "settings row"
    );
    stats.settings = 1;
    ok("  Settings migrated.");

    // ── 2f. Migrate Logs ─────────────────────────────────────────────────────
    log(`\n── Step 5/5: Migrating ${logs.length} log entries …`);
    // Logs can have duplicate numeric IDs when log.id = Date.now() collides.
    // We assign a synthetic sequential ID to avoid PK conflicts.
    let logIdSeq = BigInt(Date.now()) * 1000n;  // base offset to avoid real collisions

    for (const l of logs) {
      let logId;
      try {
        logId = BigInt(l.id).toString();
      } catch (_) {
        logId = (logIdSeq++).toString();
      }

      await exec(
        db,
      DRIVER === "pg"
        ? `INSERT INTO logs (id, timestamp, action, actor, details)
           VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
        : `INSERT IGNORE INTO logs (id, timestamp, action, actor, details)
           VALUES (?, ?, ?, ?, ?)`,
        [
          logId,
          toTimestamp(l.timestamp) || new Date().toISOString().slice(0,19).replace("T"," "),
          l.action  || "UNKNOWN",
          l.user    || "System",
          l.details || "",
        ],
        `log #${logId}`
      );
      stats.logs++;
    }
    ok(`  ${stats.logs} log entries processed.`);

    // ── Commit ────────────────────────────────────────────────────────────────
    if (!DRY_RUN) {
      await db.commit();
    }

    // ─── Summary ─────────────────────────────────────────────────────────────
    log("\n" + "=".repeat(60));
    log(DRY_RUN ? "DRY-RUN COMPLETE – no data written." : "MIGRATION COMPLETE ✓");
    log("=".repeat(60));
    log(`  Roles verified    : ${stats.roles}`);
    log(`  Users inserted    : ${stats.users}`);
    log(`  Tickets inserted  : ${stats.tickets}`);
    log(`  Tech assignments  : ${stats.ticket_technicians}`);
    log(`  Settings upserted : ${stats.settings}`);
    log(`  Log entries ins.  : ${stats.logs}`);
    log(`  Skipped (dup/err) : ${stats.skipped}`);
    log(`  Errors            : ${stats.errors}`);
    log("=".repeat(60));

    if (stats.errors > 0) {
      warn("Some rows had errors. Review the output above.");
    } else {
      ok("All records migrated without errors.");
    }

    if (!DRY_RUN) {
      log("\nNOTE: The original db.json has NOT been deleted or modified.");
      log("      Verify the data in your SQL database before removing the JSON file.");
    }

  } catch (e) {
    err("Fatal migration error:", e.message);
    if (!DRY_RUN) {
      await db.rollback();
      err("Transaction rolled back – no data was written.");
    }
    process.exit(1);
  } finally {
    if (!DRY_RUN) await db.close();
  }
}

migrate();