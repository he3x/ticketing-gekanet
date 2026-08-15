-- =============================================================================
--  ISP Ticketing System — Verifikasi Schema PostgreSQL
--  Jalankan setelah setup-postgres.sql selesai dieksekusi.
--  psql -U gekanet -d ticketing_gekanet -f verify-schema.sql
-- =============================================================================

-- 1. Daftar semua tabel
\echo '=== DAFTAR TABEL ==='
SELECT table_name,
       pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS ukuran
FROM   information_schema.tables
WHERE  table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER  BY table_name;
-- Yang diharapkan (6 tabel):
--   logs, roles, settings, ticket_attachments, ticket_technicians, tickets

-- 2. Kolom tabel tickets
\echo ''
\echo '=== KOLOM: tickets ==='
SELECT ordinal_position AS "#", column_name, data_type,
       is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public' AND table_name = 'tickets'
ORDER  BY ordinal_position;
-- Yang diharapkan: id, external_id, created_at, updated_at, completed_at,
--   type, status, customer_name, address, location_url, phone,
--   issue, package_name, notes, report, technician_notes,
--   billing_entered, created_by

-- 3. Foreign Keys
\echo ''
\echo '=== FOREIGN KEYS ==='
SELECT tc.constraint_name, tc.table_name AS dari_tabel,
       kcu.column_name AS dari_kolom, ccu.table_name AS ke_tabel,
       ccu.column_name AS ke_kolom, rc.delete_rule AS on_delete,
       rc.update_rule AS on_update
FROM   information_schema.table_constraints tc
JOIN   information_schema.key_column_usage  kcu
       ON  tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN   information_schema.constraint_column_usage ccu
       ON  ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
JOIN   information_schema.referential_constraints rc
       ON  rc.constraint_name = tc.constraint_name
WHERE  tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
ORDER  BY tc.table_name, tc.constraint_name;

-- 4. Sequences
\echo ''
\echo '=== SEQUENCES ==='
SELECT sequence_name, data_type, start_value, last_value
FROM   information_schema.sequences
WHERE  sequence_schema = 'public'
ORDER  BY sequence_name;


-- 5. Triggers
\echo ''
\echo '=== TRIGGERS ==='
SELECT trigger_name, event_object_table AS tabel,
       event_manipulation AS event, action_timing AS timing
FROM   information_schema.triggers
WHERE  trigger_schema = 'public'
ORDER  BY event_object_table, trigger_name;
-- Yang diharapkan:
--   trg_settings_updated_at → settings | UPDATE | BEFORE
--   trg_tickets_updated_at  → tickets  | UPDATE | BEFORE
--   trg_users_updated_at    → users    | UPDATE | BEFORE

-- 6. Seed roles
\echo ''
\echo '=== SEED ROLES ==='
SELECT id, name, description FROM roles ORDER BY id;

-- 7. Seed settings
\echo ''
\echo '=== SEED SETTINGS ==='
SELECT key, LEFT(value, 50) AS value_preview, description FROM settings ORDER BY key;

-- 8. Smoke test insert tiket
\echo ''
\echo '=== SMOKE TEST: INSERT TIKET ==='
INSERT INTO tickets (type, customer_name, address, phone, created_by)
VALUES ('maintenance', 'Test Pelanggan', 'Jl. Smoke Test No. 1', '08123456789', '__smoke__');

SELECT id, external_id, customer_name, type, status, created_by
FROM   tickets WHERE created_by = '__smoke__' ORDER BY id DESC LIMIT 1;
-- external_id harus = 1 (fresh DB), id harus kecil (bukan timestamp)

DELETE FROM tickets WHERE created_by = '__smoke__';
\echo 'Smoke test selesai — data test dihapus.'

-- 9. Hak akses gekanet
\echo ''
\echo '=== HAK AKSES: gekanet ==='
SELECT table_name,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM   information_schema.role_table_grants
WHERE  grantee = 'gekanet' AND table_schema = 'public'
GROUP  BY table_name ORDER BY table_name;
-- Setiap tabel: DELETE, INSERT, SELECT, UPDATE
