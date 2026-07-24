/**
 * test-db.mjs
 * Quick smoke-test for database.js — run with: node test-db.mjs
 * Delete this file after confirming everything works.
 */
import db from "./database.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

console.log(`\n[DB] Driver: ${db.driver}`);
console.log("─────────────────────────────────────────");

// 1. Ping
await test("ping() returns true", async () => {
  const ok = await db.ping();
  if (!ok) throw new Error("ping returned false");
});

// 2. Raw query
await test("SELECT 1 works", async () => {
  const rows = await db.query("SELECT 1 AS val");
  if (!rows.length || rows[0].val === undefined) throw new Error("unexpected result");
});

// 3. Roles table
await test("roles table has 5 rows", async () => {
  const rows = await db.query("SELECT COUNT(*) AS cnt FROM roles");
  const cnt = parseInt(rows[0].cnt, 10);
  if (cnt !== 5) throw new Error(`expected 5 roles, got ${cnt}`);
});

// 4. Users API – findAll (may be empty on fresh install)
await test("users.findAll() returns array", async () => {
  const rows = await db.users.findAll();
  if (!Array.isArray(rows)) throw new Error("not an array");
  console.log(`       → ${rows.length} user(s) found`);
});

// 5. Tickets API – findAll
await test("tickets.findAll() returns array", async () => {
  const rows = await db.tickets.findAll();
  if (!Array.isArray(rows)) throw new Error("not an array");
  console.log(`       → ${rows.length} ticket(s) found`);
});

// 6. Settings API – get
await test("settings.get() returns object", async () => {
  const s = await db.settings.get();
  if (typeof s !== "object" || s === null) throw new Error("not an object");
  if (!("whatsappGroup" in s)) throw new Error("missing whatsappGroup key");
});

// 7. Logs API – add + findAll
await test("logs.add() + findAll() works", async () => {
  await db.logs.add("test", "smoke-test", "connection test");
  const rows = await db.logs.findAll(10);
  if (!Array.isArray(rows)) throw new Error("not an array");
  if (!rows.some(r => r.action === "test")) throw new Error("log entry not found");
  // Clean up the test log
  await db.query("DELETE FROM logs WHERE action = 'test' AND actor = 'smoke-test'");
});

// 8. Transaction rollback safety
await test("transaction() rolls back on error", async () => {
  const testId = "9999999999999"; // numeric string — valid BIGINT
  try {
    await db.transaction(async (q) => {
      await q("INSERT INTO logs (id, action, actor, details) VALUES (?, ?, ?, ?)",
              [testId, "rollback", "smoke-test", ""]);
      throw new Error("intentional rollback");
    });
  } catch { /* expected */ }
  const rows = await db.query("SELECT id FROM logs WHERE id = ?", [testId]);
  if (rows.length > 0) throw new Error("row was not rolled back");
});

console.log("─────────────────────────────────────────");
console.log(`  ${passed} passed, ${failed} failed\n`);

await db.close();
process.exit(failed > 0 ? 1 : 0);