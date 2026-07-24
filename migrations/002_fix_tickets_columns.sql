-- =============================================================================
-- Migration 002 — Fix tickets table columns + add ticket_attachments table
-- Run this ONCE against your existing PostgreSQL database.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Rename tickets.package → tickets.package_name
--    (route code uses package_name everywhere)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tickets' AND column_name = 'package'
    ) THEN
        ALTER TABLE tickets RENAME COLUMN package TO package_name;
        RAISE NOTICE 'Renamed tickets.package → tickets.package_name';
    ELSE
        RAISE NOTICE 'tickets.package_name already exists, skipping rename';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. Add tickets.external_id (human-readable sequential ticket number)
--    Routes display it as "#1", "#2", etc.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tickets' AND column_name = 'external_id'
    ) THEN
        -- Create sequence starting at 1
        CREATE SEQUENCE IF NOT EXISTS tickets_external_id_seq AS INTEGER;

        -- Set sequence to current ticket count so first new ticket gets count+1
        PERFORM setval(
            'tickets_external_id_seq',
            COALESCE((SELECT COUNT(*) FROM tickets), 0),
            true   -- true = next call returns value+1
        );

        -- Add column with sequence default
        ALTER TABLE tickets
            ADD COLUMN external_id INTEGER NOT NULL DEFAULT nextval('tickets_external_id_seq');

        ALTER SEQUENCE tickets_external_id_seq OWNED BY tickets.external_id;

        -- Back-fill existing rows with sequential numbers
        WITH numbered AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
            FROM tickets
        )
        UPDATE tickets t
        SET external_id = n.rn
        FROM numbered n
        WHERE t.id = n.id;

        -- Reset sequence to MAX so next insert continues from there
        PERFORM setval(
            'tickets_external_id_seq',
            COALESCE((SELECT MAX(external_id) FROM tickets), 0),
            true
        );

        CREATE INDEX IF NOT EXISTS idx_tickets_external_id ON tickets (external_id);
        RAISE NOTICE 'Added tickets.external_id';
    ELSE
        RAISE NOTICE 'tickets.external_id already exists, skipping';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 3. Add tickets.created_by (username of the user who created the ticket)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tickets' AND column_name = 'created_by'
    ) THEN
        ALTER TABLE tickets
            ADD COLUMN created_by VARCHAR(255) NOT NULL DEFAULT 'system';
        RAISE NOTICE 'Added tickets.created_by';
    ELSE
        RAISE NOTICE 'tickets.created_by already exists, skipping';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 4. Drop inline attachment columns (replaced by ticket_attachments table)
--    These were in the original schema but the route now uses a join table.
--    Only drops them if they still exist; safe to run multiple times.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tickets' AND column_name = 'attachment_url'
    ) THEN
        ALTER TABLE tickets
            DROP COLUMN IF EXISTS attachment_url,
            DROP COLUMN IF EXISTS attachment_name,
            DROP COLUMN IF EXISTS report_attachment_url,
            DROP COLUMN IF EXISTS report_attachment_name;
        RAISE NOTICE 'Dropped inline attachment columns from tickets';
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 5. Create ticket_attachments table
--    Used by GET /tickets/:id to return attached files.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_attachments (
    id              BIGSERIAL       NOT NULL,
    ticket_id       BIGINT          NOT NULL,
    url             VARCHAR(500)    NOT NULL,
    original_name   VARCHAR(255)    NOT NULL DEFAULT '',
    mime_type       VARCHAR(100)    NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    CONSTRAINT fk_ta_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ta_ticket_id ON ticket_attachments (ticket_id);

-- =============================================================================
-- Verification queries
-- =============================================================================
-- SELECT column_name, data_type, column_default
-- FROM   information_schema.columns
-- WHERE  table_name = 'tickets'
-- ORDER  BY ordinal_position;
--   → should show: id, external_id, created_at, updated_at, completed_at,
--                  type, status, customer_name, address, location_url, phone,
--                  issue, package_name, notes, report, technician_notes,
--                  billing_entered, created_by

-- SELECT * FROM ticket_attachments LIMIT 1;
--   → should return no rows (empty table, no error)

-- INSERT INTO tickets (type, customer_name, address, phone, created_by)
-- VALUES ('maintenance', 'Test Customer', '123 Test St', '08123', 'migration');
-- SELECT id, external_id, customer_name, created_by FROM tickets ORDER BY id DESC LIMIT 1;
--   → should succeed with auto-generated id, external_id, and created_by = 'migration'
-- DELETE FROM tickets WHERE customer_name = 'Test Customer' AND created_by = 'migration';