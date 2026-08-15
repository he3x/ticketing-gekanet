-- =============================================================================
--  ISP Ticketing System — PostgreSQL Initial Setup
--  Gekanet Ticketing v1.0
-- =============================================================================
--  URUTAN EKSEKUSI (jalankan sebagai superuser postgres):
--
--    Opsi A — file tunggal (psql):
--      psql -U postgres -f setup-postgres.sql
--
--    Opsi B — bertahap di psql prompt, ikuti komentar STEP 1 – 12.
--
--  Persyaratan:
--    - PostgreSQL 13 atau lebih baru
--    - Jalankan sebagai superuser (postgres) untuk STEP 1 dan STEP 2
--    - Lanjutkan sebagai gekanet (atau postgres) untuk STEP 3 ke bawah
-- =============================================================================


-- =============================================================================
-- STEP 1 — BUAT APPLICATION ROLE / USER
--           Ganti password 'gekanet_pass' dengan nilai yang kuat.
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gekanet'
    ) THEN
        CREATE ROLE gekanet
            LOGIN
            PASSWORD 'gekanet_pass'   -- ← GANTI!
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE;
        RAISE NOTICE 'Role "gekanet" berhasil dibuat.';
    ELSE
        RAISE NOTICE 'Role "gekanet" sudah ada, skip.';
    END IF;
END
$$;


-- =============================================================================
-- STEP 2 — BUAT DATABASE
--           CREATE DATABASE tidak boleh dalam transaksi — jalankan sendiri
--           dari psql prompt. Atau pakai perintah shell:
--             createdb -U postgres -O gekanet ticketing_gekanet
-- =============================================================================

CREATE DATABASE ticketing_gekanet
    WITH
        OWNER            = gekanet
        ENCODING         = 'UTF8'
        LC_COLLATE       = 'en_US.UTF-8'    -- ganti 'C' jika locale belum ada
        LC_CTYPE         = 'en_US.UTF-8'    -- ganti 'C' jika locale belum ada
        TEMPLATE         = template0
        CONNECTION LIMIT = 100;

COMMENT ON DATABASE ticketing_gekanet IS 'ISP Ticketing System — Gekanet';

-- Setelah database dibuat, sambungkan ke sana:
--   psql prompt : \c ticketing_gekanet
--   atau jalankan sisa file ini dengan:
--     psql -U postgres -d ticketing_gekanet -f setup-postgres.sql
--     (mulai dari STEP 3)


-- =============================================================================
-- STEP 3 — EKSTENSI (opsional, direkomendasikan)
-- =============================================================================

-- pgcrypto: gen_random_uuid() dan hash password bcrypt di masa depan
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =============================================================================
-- STEP 4 — TRIGGER FUNCTION: auto-update kolom updated_at
--           Dipakai oleh tabel users, tickets, dan settings.
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at()
    IS 'Trigger: otomatis memperbarui updated_at setiap baris diupdate.';


-- =============================================================================
-- STEP 5 — TABEL ROLES
--           Master data RBAC. Tidak perlu updated_at.
-- =============================================================================

CREATE TABLE roles (
    id          SERIAL          NOT NULL,
    name        VARCHAR(50)     NOT NULL UNIQUE,
    description VARCHAR(255)    NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id)
);

COMMENT ON TABLE  roles             IS 'Daftar role RBAC — master data.';
COMMENT ON COLUMN roles.name        IS 'admin | technician | vendor | supervisor | superuser';
COMMENT ON COLUMN roles.description IS 'Deskripsi singkat wewenang role.';

-- Seed 5 role bawaan
INSERT INTO roles (name, description) VALUES
    ('admin',      'Admin / CS – mengelola tiket dan pengguna'),
    ('technician', 'Teknisi lapangan – menangani tiket yang ditugaskan'),
    ('vendor',     'Vendor / kontraktor eksternal – menangani tiket yang ditugaskan'),
    ('supervisor', 'Supervisor / NOC – memantau semua aktivitas'),
    ('superuser',  'Super-user – akses penuh seluruh sistem');



-- =============================================================================
-- STEP 6 — TABEL USERS
-- =============================================================================

CREATE TABLE users (
    id              BIGSERIAL    NOT NULL,
    username        VARCHAR(100) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,        -- bcrypt hash di produksi
    role_id         INTEGER      NOT NULL,
    name            VARCHAR(255) NOT NULL,
    phone           VARCHAR(50)  NULL DEFAULT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id),
    CONSTRAINT fk_users_role
        FOREIGN KEY (role_id) REFERENCES roles (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT   -- tidak boleh hapus role yang masih dipakai user
);

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_users_role_id  ON users (role_id);
CREATE INDEX idx_users_username ON users (username);

COMMENT ON TABLE  users               IS 'Semua pengguna sistem.';
COMMENT ON COLUMN users.id            IS 'Auto-increment; migrasi dari db.json mungkin berisi timestamp besar.';
COMMENT ON COLUMN users.password_hash IS 'Gunakan bcrypt hash di produksi, bukan plain-text.';
COMMENT ON COLUMN users.role_id       IS 'FK ke roles.id — menentukan hak akses RBAC.';
COMMENT ON COLUMN users.phone         IS 'Nomor HP untuk notifikasi WhatsApp.';


-- =============================================================================
-- STEP 7 — SEQUENCE tickets_external_id_seq
--           HARUS dibuat SEBELUM tabel tickets, karena kolom external_id
--           memakai DEFAULT nextval('tickets_external_id_seq').
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS tickets_external_id_seq
    AS INTEGER
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



-- =============================================================================
-- STEP 8 — TABEL TICKETS
--           Tiket layanan inti: pemasangan, maintenance, dismantle.
-- =============================================================================

CREATE TABLE tickets (
    id                  BIGSERIAL       NOT NULL,
    external_id         INTEGER         NOT NULL DEFAULT nextval('tickets_external_id_seq'),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ     NULL DEFAULT NULL,

    type    VARCHAR(20) NOT NULL DEFAULT 'maintenance'
                CHECK (type   IN ('installation', 'maintenance', 'dismantle')),
    status  VARCHAR(20) NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in-progress', 'completed', 'cancelled')),

    customer_name       VARCHAR(255)    NOT NULL DEFAULT '',
    address             TEXT            NOT NULL DEFAULT '',
    location_url        TEXT            NULL DEFAULT NULL,    -- Google Maps link
    phone               VARCHAR(50)     NOT NULL DEFAULT '',

    issue               TEXT            NULL DEFAULT NULL,    -- kendala (maintenance/dismantle)
    package_name        VARCHAR(255)    NULL DEFAULT NULL,    -- paket internet (installation)
    notes               TEXT            NULL DEFAULT NULL,    -- catatan admin

    report              TEXT            NULL DEFAULT NULL,    -- laporan penutup teknisi
    technician_notes    TEXT            NULL DEFAULT NULL,    -- catatan internal teknisi
    billing_entered     BOOLEAN         NOT NULL DEFAULT FALSE,

    created_by          VARCHAR(255)    NOT NULL DEFAULT 'system',

    PRIMARY KEY (id)
);

-- Pasang ownership sequence ke kolom
ALTER SEQUENCE tickets_external_id_seq OWNED BY tickets.external_id;

-- Trigger updated_at
CREATE TRIGGER trg_tickets_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Index performa
CREATE INDEX idx_tickets_status      ON tickets (status);
CREATE INDEX idx_tickets_type        ON tickets (type);
CREATE INDEX idx_tickets_created_at  ON tickets (created_at DESC);
CREATE INDEX idx_tickets_external_id ON tickets (external_id);
CREATE INDEX idx_tickets_created_by  ON tickets (created_by);

COMMENT ON TABLE  tickets              IS 'Tiket layanan: installation, maintenance, dismantle.';
COMMENT ON COLUMN tickets.id           IS 'Primary key BIGINT auto-increment.';
COMMENT ON COLUMN tickets.external_id  IS 'Nomor urut tampilan (#1, #2, …) — dipakai di pesan WA dan URL.';
COMMENT ON COLUMN tickets.type         IS 'installation | maintenance | dismantle';
COMMENT ON COLUMN tickets.status       IS 'open | in-progress | completed | cancelled';
COMMENT ON COLUMN tickets.package_name IS 'Nama paket internet (khusus installation).';
COMMENT ON COLUMN tickets.issue        IS 'Deskripsi kendala (maintenance / dismantle).';
COMMENT ON COLUMN tickets.location_url IS 'Link Google Maps lokasi pelanggan.';
COMMENT ON COLUMN tickets.billing_entered IS 'TRUE jika billing sudah diinput.';
COMMENT ON COLUMN tickets.created_by   IS 'Username pengguna yang membuat tiket.';



-- =============================================================================
-- STEP 9 — TABEL TICKET_TECHNICIANS  (Junction / Bridge)
--           Relasi many-to-many: satu tiket, banyak teknisi/vendor.
-- =============================================================================

CREATE TABLE ticket_technicians (
    ticket_id   BIGINT      NOT NULL,
    user_id     BIGINT      NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (ticket_id, user_id),

    CONSTRAINT fk_tt_ticket
        FOREIGN KEY (ticket_id) REFERENCES tickets (id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_tt_user
        FOREIGN KEY (user_id)   REFERENCES users (id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX idx_tt_ticket_id ON ticket_technicians (ticket_id);
CREATE INDEX idx_tt_user_id   ON ticket_technicians (user_id);

COMMENT ON TABLE  ticket_technicians             IS 'Penugasan teknisi/vendor ke tiket (many-to-many).';
COMMENT ON COLUMN ticket_technicians.ticket_id   IS 'FK ke tickets.id.';
COMMENT ON COLUMN ticket_technicians.user_id     IS 'FK ke users.id (teknisi atau vendor).';
COMMENT ON COLUMN ticket_technicians.assigned_at IS 'Waktu penugasan.';


-- =============================================================================
-- STEP 10 — TABEL TICKET_ATTACHMENTS
--            File lampiran tiket: foto bukti, laporan, dll.
-- =============================================================================

CREATE TABLE ticket_attachments (
    id              BIGSERIAL    NOT NULL,
    ticket_id       BIGINT       NOT NULL,
    url             VARCHAR(500) NOT NULL,
    original_name   VARCHAR(255) NOT NULL DEFAULT '',
    mime_type       VARCHAR(100) NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    PRIMARY KEY (id),
    CONSTRAINT fk_ta_ticket
        FOREIGN KEY (ticket_id) REFERENCES tickets (id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX idx_ta_ticket_id ON ticket_attachments (ticket_id);

COMMENT ON TABLE  ticket_attachments           IS 'Lampiran file untuk tiket.';
COMMENT ON COLUMN ticket_attachments.url       IS 'Path relatif atau URL file di server.';
COMMENT ON COLUMN ticket_attachments.mime_type IS 'MIME type: image/jpeg, application/pdf, dll.';



-- =============================================================================
-- STEP 11 — TABEL SETTINGS
--            Key-value store konfigurasi: template WA, grup WA, retensi media.
-- =============================================================================

CREATE TABLE settings (
    key         VARCHAR(100) NOT NULL,
    value       TEXT         NOT NULL DEFAULT '',
    description TEXT         NULL DEFAULT NULL,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (key)
);

CREATE TRIGGER trg_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  settings             IS 'Key-value store konfigurasi aplikasi.';
COMMENT ON COLUMN settings.key         IS 'Nama konfigurasi unik.';
COMMENT ON COLUMN settings.value       IS 'Nilai konfigurasi (TEXT).';
COMMENT ON COLUMN settings.description IS 'Penjelasan kegunaan setting.';

-- Seed nilai default
-- Placeholder yang didukung di template: {id} {customerName} {address}
-- {detail} {technician} {location} {link} {report}
INSERT INTO settings (key, value, description) VALUES
    ('whatsapp_group',
     '',
     'Nomor/link grup WhatsApp tujuan notifikasi'),

    ('template_installation',
     E'Tiket Pemasangan Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nPaket: {detail}\nTeknisi: {technician}{location}{link}',
     'Template pesan WA untuk tiket installation'),

    ('template_maintenance',
     E'Tiket Maintenance Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nKendala: {detail}\nTeknisi: {technician}{location}{link}',
     'Template pesan WA untuk tiket maintenance'),

    ('template_dismantle',
     E'Tiket Dismantle Baru!\nID: {id}\nPelanggan: {customerName}\nAlamat: {address}\nAlasan: {detail}\nTeknisi: {technician}{location}{link}',
     'Template pesan WA untuk tiket dismantle'),

    ('template_closed',
     E'Tiket {id} Selesai!\nPelanggan: {customerName}\nStatus: Selesai\nTeknisi: {technician}\nLaporan: {report}{location}{link}',
     'Template pesan WA untuk tiket yang diselesaikan'),

    ('media_retention_days',
     '60',
     'Jumlah hari penyimpanan file media sebelum dihapus otomatis');


-- =============================================================================
-- STEP 12 — TABEL LOGS
--            Log audit aktivitas. Append-only; aplikasi trim ke 500 baris.
-- =============================================================================

CREATE TABLE logs (
    id        BIGSERIAL    NOT NULL,
    timestamp TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    action    VARCHAR(100) NOT NULL,
    actor     VARCHAR(255) NOT NULL DEFAULT 'System',
    details   TEXT         NOT NULL DEFAULT '',
    PRIMARY KEY (id)
);

CREATE INDEX idx_logs_timestamp ON logs (timestamp DESC);
CREATE INDEX idx_logs_action    ON logs (action);

COMMENT ON TABLE  logs        IS 'Log audit aktivitas sistem (append-only).';
COMMENT ON COLUMN logs.action IS 'Kode aksi: CREATE_TICKET, CLOSE_TICKET, LOGIN, dll.';
COMMENT ON COLUMN logs.actor  IS 'Username pelaku, atau "System" untuk aksi otomatis.';
COMMENT ON COLUMN logs.details IS 'Detail bebas, biasanya JSON atau deskripsi singkat.';



-- =============================================================================
-- STEP 13 — GRANT HAK AKSES KE APPLICATION USER
-- =============================================================================

GRANT USAGE ON SCHEMA public TO gekanet;

-- Semua tabel dan sequence yang sudah ada
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO gekanet;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO gekanet;

-- Tabel/sequence yang dibuat di masa depan
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gekanet;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO gekanet;


-- =============================================================================
-- DIAGRAM RELASI (ERD)
-- =============================================================================
--
--  roles (id PK)
--    │
--    │  1 role → N users
--    ▼
--  users (id PK, role_id FK→roles.id)
--    │
--    │  N users ↔ N tickets  [many-to-many via junction]
--    │
--    ▼
--  ticket_technicians (ticket_id FK, user_id FK) ── PK composite
--    │
--    ▼
--  tickets (id PK, external_id SERIAL)
--    │
--    │  1 ticket → N attachments
--    ▼
--  ticket_attachments (id PK, ticket_id FK→tickets.id)
--
--  settings (key PK)  ← berdiri sendiri, tanpa FK
--  logs     (id PK)   ← berdiri sendiri, tanpa FK
--
-- =============================================================================
-- FOREIGN KEY SUMMARY
-- =============================================================================
--
--  CONSTRAINT            | DARI                          | KE            | ON DELETE   | ON UPDATE
--  ----------------------|-------------------------------|---------------|-------------|----------
--  fk_users_role         | users.role_id                 | roles.id      | RESTRICT    | CASCADE
--  fk_tt_ticket          | ticket_technicians.ticket_id  | tickets.id    | CASCADE     | CASCADE
--  fk_tt_user            | ticket_technicians.user_id    | users.id      | CASCADE     | CASCADE
--  fk_ta_ticket          | ticket_attachments.ticket_id  | tickets.id    | CASCADE     | CASCADE
--
-- =============================================================================
-- LANGKAH SETELAH SETUP
-- =============================================================================
--  1. Salin .env.example → .env, isi konfigurasi:
--       DB_DRIVER=pg
--       DB_HOST=127.0.0.1
--       DB_PORT=5432
--       DB_USER=gekanet
--       DB_PASSWORD=gekanet_pass
--       DB_NAME=ticketing_gekanet
--
--  2. Jika migrasi dari db.json yang sudah ada:
--       node migrate-data.js
--     Lalu jalankan migration files:
--       psql -U gekanet -d ticketing_gekanet -f migrations/001_fix_logs_id_and_settings_table.sql
--       psql -U gekanet -d ticketing_gekanet -f migrations/002_fix_tickets_columns.sql
--
--  3. Jalankan aplikasi:
--       npm run dev
-- =============================================================================

