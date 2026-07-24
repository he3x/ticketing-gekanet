-- =============================================================================
-- ISP Ticketing System - SQL Database Schema
-- Compatible with: PostgreSQL 13+
-- Generated from: db.json (JSON flat-file database)
-- =============================================================================

-- Drop tables in reverse FK dependency order (safe re-run)
DROP TABLE IF EXISTS ticket_technicians;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS logs;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;

-- Drop helper trigger function if it exists
DROP FUNCTION IF EXISTS set_updated_at();

-- =============================================================================
-- TRIGGER FUNCTION: auto-update updated_at column
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. ROLES TABLE  (RBAC)
--    Stores all supported roles for the ISP system.
-- =============================================================================
CREATE TABLE roles (
    id          SERIAL          NOT NULL,
    name        VARCHAR(50)     NOT NULL UNIQUE,
    description VARCHAR(255)    NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id)
);

-- Seed initial roles
INSERT INTO roles (name, description) VALUES
    ('admin',       'Admin / CS – manages tickets and users'),
    ('technician',  'Field technician – handles assigned tickets'),
    ('vendor',      'Vendor / external contractor – handles assigned tickets'),
    ('supervisor',  'Supervisor / NOC – monitors all activity'),
    ('superuser',   'Super-user – full system access');

-- =============================================================================
-- 2. USERS TABLE
--    Stores all system users with an FK to roles for RBAC.
-- =============================================================================
CREATE TABLE users (
    id              BIGSERIAL       NOT NULL,   -- auto-increment; migrated IDs set sequence after load
    username        VARCHAR(100)    NOT NULL UNIQUE,
    password_hash   VARCHAR(255)    NOT NULL,   -- store bcrypt hash in production
    role_id         INTEGER         NOT NULL,
    name            VARCHAR(255)    NOT NULL,
    phone           VARCHAR(50)     NULL DEFAULT NULL,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id) ON UPDATE CASCADE
);

-- Trigger: keep updated_at current
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Index for fast role lookups
CREATE INDEX idx_users_role_id  ON users (role_id);
CREATE INDEX idx_users_username ON users (username);

-- =============================================================================
-- 3. TICKETS TABLE
--    Core ticket records.  The many-to-many relationship with technicians
--    is handled by the ticket_technicians junction table below.
-- =============================================================================
CREATE TABLE tickets (
    id                      BIGSERIAL       NOT NULL,   -- auto-increment; migrated IDs set sequence after load
    external_id             SERIAL          NOT NULL,   -- human-readable ticket number (#1, #2, ...)
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ     NULL DEFAULT NULL,

    -- Classification (CHECK replaces MySQL ENUM)
    type    VARCHAR(20)  NOT NULL DEFAULT 'maintenance'
                CHECK (type   IN ('installation', 'maintenance', 'dismantle')),
    status  VARCHAR(20)  NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in-progress', 'completed', 'cancelled')),

    -- Customer info
    customer_name           VARCHAR(255)    NOT NULL DEFAULT '',
    address                 TEXT            NOT NULL DEFAULT '',
    location_url            TEXT            NULL DEFAULT NULL,
    phone                   VARCHAR(50)     NOT NULL DEFAULT '',

    -- Ticket details
    issue                   TEXT            NULL DEFAULT NULL,  -- for maintenance / dismantle
    package_name            VARCHAR(255)    NULL DEFAULT NULL,  -- for installation (was: package)
    notes                   TEXT            NULL DEFAULT NULL,  -- admin notes

    -- Completion
    report                  TEXT            NULL DEFAULT NULL,  -- technician's closing report
    technician_notes        TEXT            NULL DEFAULT NULL,  -- technician internal notes
    billing_entered         BOOLEAN         NOT NULL DEFAULT FALSE,

    -- Ownership
    created_by              VARCHAR(255)    NOT NULL DEFAULT 'system',

    PRIMARY KEY (id)
);

-- Trigger: keep updated_at current
CREATE TRIGGER trg_tickets_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_tickets_status      ON tickets (status);
CREATE INDEX idx_tickets_type        ON tickets (type);
CREATE INDEX idx_tickets_created_at  ON tickets (created_at);
CREATE INDEX idx_tickets_external_id ON tickets (external_id);

-- =============================================================================
-- 4. TICKET_TECHNICIANS  (Junction / Bridge table)
--    Resolves the many-to-many relationship between tickets and assigned users.
--    A ticket can have multiple assigned technicians / vendors.
-- =============================================================================
CREATE TABLE ticket_technicians (
    ticket_id   BIGINT      NOT NULL,
    user_id     BIGINT      NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticket_id, user_id),
    CONSTRAINT fk_tt_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tt_user   FOREIGN KEY (user_id)   REFERENCES users   (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX idx_tt_user_id   ON ticket_technicians (user_id);
CREATE INDEX idx_tt_ticket_id ON ticket_technicians (ticket_id);

-- =============================================================================
-- 4b. TICKET_ATTACHMENTS
--     Stores file attachments for tickets (evidence photos, reports, etc.)
--     One ticket can have many attachments.
-- =============================================================================
CREATE TABLE ticket_attachments (
    id              BIGSERIAL       NOT NULL,
    ticket_id       BIGINT          NOT NULL,
    url             VARCHAR(500)    NOT NULL,
    original_name   VARCHAR(255)    NOT NULL DEFAULT '',
    mime_type       VARCHAR(100)    NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id),
    CONSTRAINT fk_ta_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX idx_ta_ticket_id ON ticket_attachments (ticket_id);

-- =============================================================================
-- 5. SETTINGS TABLE
--    Key-value store for application-wide configuration.
--    Routes: GET /settings, GET /settings/:key, PATCH /settings/:key,
--            POST /settings, DELETE /settings/:key
-- =============================================================================
CREATE TABLE settings (
    key         VARCHAR(100)    NOT NULL,
    value       TEXT            NOT NULL DEFAULT '',
    description TEXT            NULL DEFAULT NULL,
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (key)
);

-- Trigger: keep updated_at current
CREATE TRIGGER trg_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed default settings
INSERT INTO settings (key, value, description) VALUES
    ('whatsapp_group',        '',   'WhatsApp group link or number for notifications'),
    ('template_installation', '',   'WA message template for installation tickets'),
    ('template_maintenance',  '',   'WA message template for maintenance tickets'),
    ('template_dismantle',    '',   'WA message template for dismantle tickets'),
    ('template_closed',       '',   'WA message template for closed tickets'),
    ('media_retention_days',  '60', 'Number of days to retain uploaded media files');

-- =============================================================================
-- 6. LOGS TABLE
--    Audit/activity log.  Kept append-only; application trims to last 500 rows.
-- =============================================================================
CREATE TABLE logs (
    id          BIGSERIAL       NOT NULL,   -- auto-increment; do NOT supply id in INSERT
    timestamp   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    action      VARCHAR(100)    NOT NULL,
    actor       VARCHAR(255)    NOT NULL DEFAULT 'System',
    details     TEXT            NOT NULL DEFAULT '',
    PRIMARY KEY (id)
);

CREATE INDEX idx_logs_timestamp ON logs (timestamp DESC);
CREATE INDEX idx_logs_action    ON logs (action);

-- =============================================================================
-- RBAC PERMISSION REFERENCE  (documentation only – enforced in application)
-- =============================================================================
-- Role         | View Tickets | Create Tickets | Edit Tickets | Close Tickets | Manage Users | Settings
-- -------------|--------------|----------------|--------------|---------------|--------------|----------
-- superuser    |     ALL      |      YES       |     YES      |      YES      |     YES      |   YES
-- admin        |     ALL      |      YES       |     YES      |      YES      |     YES      |   YES
-- supervisor   |     ALL      |      NO        |     NO       |      NO       |     NO       |   NO
-- technician   | Assigned+Open|      NO        |  Own tickets |   Own tickets |     NO       |   NO
-- vendor       | Assigned+Open|      NO        |  Own tickets |   Own tickets |     NO       |   NO
-- =============================================================================