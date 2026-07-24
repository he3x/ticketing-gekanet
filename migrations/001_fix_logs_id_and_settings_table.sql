-- =============================================================================
-- Migration 001 — Fix logs.id auto-increment + rebuild settings as key-value
-- Run this ONCE against your existing PostgreSQL database.
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1a. Fix users.id: attach an auto-increment sequence
--     After JSON migration, users.id held Date.now() timestamps (large BIGINTs).
--     New users created via the API must also get auto-generated IDs.
-- -----------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS users_id_seq AS BIGINT;

SELECT setval(
    'users_id_seq',
    COALESCE((SELECT MAX(id) FROM users), 0) + 1,
    false
);

ALTER TABLE users
    ALTER COLUMN id SET DEFAULT nextval('users_id_seq');

ALTER SEQUENCE users_id_seq OWNED BY users.id;

-- -----------------------------------------------------------------------------
-- 1b. Fix tickets.id: attach an auto-increment sequence
-- -----------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS tickets_id_seq AS BIGINT;

SELECT setval(
    'tickets_id_seq',
    COALESCE((SELECT MAX(id) FROM tickets), 0) + 1,
    false
);

ALTER TABLE tickets
    ALTER COLUMN id SET DEFAULT nextval('tickets_id_seq');

ALTER SEQUENCE tickets_id_seq OWNED BY tickets.id;

-- -----------------------------------------------------------------------------
-- 1c. Fix logs.id: attach an auto-increment sequence
--     The column stays BIGINT; we just create a sequence and set it as default.
-- -----------------------------------------------------------------------------

-- Create the sequence (skip if already exists)
CREATE SEQUENCE IF NOT EXISTS logs_id_seq AS BIGINT;

-- Set the sequence's next value to MAX(id)+1 so it never collides with
-- records inserted during migration (which used Date.now() as id)
SELECT setval(
    'logs_id_seq',
    COALESCE((SELECT MAX(id) FROM logs), 0) + 1,
    false   -- false = next call returns this value (not value+1)
);

-- Attach the sequence as the default for logs.id
ALTER TABLE logs
    ALTER COLUMN id SET DEFAULT nextval('logs_id_seq');

-- Make the sequence owned by logs.id so it's dropped with the table
ALTER SEQUENCE logs_id_seq OWNED BY logs.id;

-- -----------------------------------------------------------------------------
-- 2. Rebuild settings as a key-value store
--    The original schema used a single fixed row (id = 1).
--    The application routes expect key / value / description / updated_at.
-- -----------------------------------------------------------------------------

-- Rename the old table so we don't lose data while rebuilding
ALTER TABLE IF EXISTS settings RENAME TO settings_old;

-- Create the new key-value settings table
CREATE TABLE IF NOT EXISTS settings (
    key         VARCHAR(100)    NOT NULL,
    value       TEXT            NOT NULL DEFAULT '',
    description TEXT            NULL DEFAULT NULL,
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (key)
);

-- Trigger: keep updated_at current (re-create if it doesn't exist yet)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_settings_updated_at'
          AND tgrelid = 'settings'::regclass
    ) THEN
        CREATE TRIGGER trg_settings_updated_at
            BEFORE UPDATE ON settings
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END
$$;

-- Migrate data from the old single-row table (if it exists and has a row)
INSERT INTO settings (key, value, description)
SELECT 'whatsapp_group',        COALESCE(whatsapp_group, ''),          'WhatsApp group link or number for notifications'
FROM   settings_old WHERE id = 1
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
SELECT 'template_installation', COALESCE(template_installation, ''),   'WA message template for installation tickets'
FROM   settings_old WHERE id = 1
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
SELECT 'template_maintenance',  COALESCE(template_maintenance, ''),    'WA message template for maintenance tickets'
FROM   settings_old WHERE id = 1
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
SELECT 'template_dismantle',    COALESCE(template_dismantle, ''),      'WA message template for dismantle tickets'
FROM   settings_old WHERE id = 1
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
SELECT 'template_closed',       COALESCE(template_closed, ''),         'WA message template for closed tickets'
FROM   settings_old WHERE id = 1
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
SELECT 'media_retention_days',  media_retention_days::TEXT,            'Number of days to retain uploaded media files'
FROM   settings_old WHERE id = 1
ON CONFLICT (key) DO NOTHING;

-- Seed defaults for any keys that weren't migrated from the old table
INSERT INTO settings (key, value, description) VALUES
    ('whatsapp_group',        '',   'WhatsApp group link or number for notifications'),
    ('template_installation', '',   'WA message template for installation tickets'),
    ('template_maintenance',  '',   'WA message template for maintenance tickets'),
    ('template_dismantle',    '',   'WA message template for dismantle tickets'),
    ('template_closed',       '',   'WA message template for closed tickets'),
    ('media_retention_days',  '60', 'Number of days to retain uploaded media files')
ON CONFLICT (key) DO NOTHING;

-- Drop the old table once migration is confirmed (uncomment after verifying)
-- DROP TABLE IF EXISTS settings_old;

-- =============================================================================
-- Verification queries — run these after applying the migration:
-- =============================================================================
-- -- Check all three sequences are attached:
-- SELECT table_name, column_name, column_default
-- FROM   information_schema.columns
-- WHERE  table_name IN ('users', 'tickets', 'logs') AND column_name = 'id'
-- ORDER  BY table_name;
--   → column_default should be "nextval('..._id_seq'::regclass)" for all three

-- -- Check settings has 6 rows:
-- SELECT * FROM settings ORDER BY key;

-- -- Smoke-test all three auto-increments:
-- INSERT INTO logs    (action, actor, details)                            VALUES ('TEST', 'migration', 'log ok');
-- INSERT INTO users   (username, password_hash, name, role_id)           VALUES ('__test__', 'x', 'Test', 1);
-- INSERT INTO tickets (customer_name, address, phone)                    VALUES ('Test', 'Test addr', '0');
-- SELECT 'logs'    AS tbl, id FROM logs    ORDER BY id DESC LIMIT 1;
-- SELECT 'users'   AS tbl, id FROM users   ORDER BY id DESC LIMIT 1;
-- SELECT 'tickets' AS tbl, id FROM tickets ORDER BY id DESC LIMIT 1;
-- -- Clean up smoke-test rows:
-- DELETE FROM logs    WHERE action = 'TEST' AND actor = 'migration';
-- DELETE FROM users   WHERE username = '__test__';
-- DELETE FROM tickets WHERE customer_name = 'Test' AND address = 'Test addr';
