# Product Requirements Document (PRD)
# ISP Management System — Omnichannel Dashboard

**Version:** 1.0.0  
**Date:** July 2026  
**Status:** Active Development  
**Owner:** He3x / ticketing-gekanet  

---

## 1. Product Vision

Build a **unified Omnichannel Dashboard** for Internet Service Providers (ISPs) that consolidates field operations, customer service, and network management into a single, real-time web application. The platform eliminates fragmented communication (WhatsApp groups, spreadsheets, phone calls) by providing a structured, role-aware workflow for every stakeholder — from the call center agent creating a ticket to the field technician closing it on-site.

**Core Promise:** *"One screen for every person in the ISP operations chain."*

---

## 2. Background & Problem Statement

Small-to-medium ISPs in Indonesia typically manage field operations through informal channels:

| Current Pain Point | Impact |
|----|---|
| Tickets created via WhatsApp and tracked in spreadsheets | No accountability, tickets get lost |
| No visibility into technician workload | Poor scheduling, SLA breaches |
| Manual copy-paste of customer info to WhatsApp groups | Slow notification, human error |
| No audit trail | Cannot resolve billing disputes or staff accountability |
| Network device management in separate tools | Context switching, operator fatigue |

---

## 3. User Personas

### 3.1 Admin / CS (Customer Service)
- **Role slug:** `admin`
- **Primary tasks:** Create tickets, assign technicians, manage user accounts, configure system settings.
- **Pain points:** Must simultaneously handle inbound calls, fill forms, and relay info to field staff via WhatsApp.
- **Key needs:** Fast ticket creation form, quick technician assignment, automated WhatsApp notification on submit.

### 3.2 NOC (Network Operations Center) / Supervisor
- **Role slug:** `supervisor`
- **Primary tasks:** Monitor all open and in-progress tickets in real time; view audit logs; no create/edit permissions.
- **Pain points:** No single view of all active issues; must ask around for status updates.
- **Key needs:** Read-only dashboard with status filters, SLA indicators, map view of active tickets.

### 3.3 Technician
- **Role slug:** `technician`
- **Primary tasks:** View assigned tickets and unassigned open tickets; update status; submit completion report and photo.
- **Pain points:** Receives work orders through WhatsApp; no structured way to submit reports.
- **Key needs:** Mobile-friendly view, location link, ability to attach report photo, mark ticket complete.

### 3.4 Vendor (External Contractor)
- **Role slug:** `vendor`
- **Primary tasks:** Same as Technician — handles assigned tickets from the ISP.
- **Pain points:** Visibility limited to own work; no access to internal customer data beyond what is needed.
- **Key needs:** Scoped ticket list (own + unassigned open), simple report form.

### 3.5 Superuser
- **Role slug:** `superuser`
- **Primary tasks:** Full system access including user management, settings, logs, and all tickets.
- **Pain points:** N/A — this is the system administrator persona.
- **Key needs:** All features, especially audit logs and settings.

---

## 4. Core Modules

### 4.1 Ticketing Module *(Phase 1 — Current)*

The primary module. Manages the full lifecycle of a field service ticket.

**Ticket Types:**
| Type | Use Case |
|---|---|
| `installation` | New customer ONT/ODP installation |
| `maintenance` | Network fault, slow speed, outage |
| `dismantle` | Customer churn / equipment removal |

**Ticket Statuses:**
| Status | Description |
|---|---|
| `open` | Created, awaiting assignment |
| `in-progress` | Technician acknowledged and en route |
| `completed` | Technician submitted closing report |
| `cancelled` | Ticket voided by admin |

**Key Features:**
- Multi-technician assignment (many-to-many via `ticket_technicians`)
- File attachment for evidence (customer complaint photo, signal report)
- Google Maps / shortened URL support for customer location
- Automatic WhatsApp notification to assigned technicians and group on create/close
- Completion report with photo attachment
- `billingEntered` flag for billing reconciliation
- Role-based ticket visibility (technicians see only their assigned + unassigned open tickets)

### 4.2 MikroTik Management Module *(Phase 2 — Planned)*

Integrate with MikroTik RouterOS API to provide:
- PPPoE session lookup by username
- Bandwidth monitoring (upload/download)
- Remote reboot / disable / enable of customer sessions
- Hotspot voucher management

### 4.3 OLT Management Module *(Phase 3 — Planned)*

Integrate with GPON OLT devices (ZTE/Huawei) to provide:
- ONT signal level (Rx power) monitoring
- OLT port status (up/down)
- Remote reset of ONT
- Alert when Rx power drops below threshold (e.g., < -27 dBm)

### 4.4 WhatsApp Integration *(Active)*

Real-time WhatsApp notifications via `whatsapp-web.js` (browser-based WA Web client):
- QR code pairing via `/api/whatsapp/qr`
- Send ticket notifications to individual technicians and group chats
- Configurable message templates per ticket type (with placeholders)
- Group chat selection from live list of joined groups

### 4.5 Audit Log *(Active)*

Append-only log of all significant actions:
- User login, ticket CRUD, WhatsApp send/fail, settings change
- Retained for last 500 entries (auto-trimmed)
- Visible to `admin`, `supervisor`, `superuser`

---

## 5. Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Users must authenticate before accessing any data | P0 |
| FR-02 | Role-based access control on every API route | P0 |
| FR-03 | Technicians can only see open-unassigned or own tickets | P0 |
| FR-04 | Ticket creation triggers WhatsApp notification | P1 |
| FR-05 | File upload for ticket attachments (max 10 MB) | P1 |
| FR-06 | Shortened location URLs resolved before storage | P1 |
| FR-07 | Technician can submit completion report with photo | P1 |
| FR-08 | Admin can manage users (CRUD) | P1 |
| FR-09 | Admin can configure message templates | P2 |
| FR-10 | System sends WhatsApp on ticket close | P2 |
| FR-11 | Audit log viewable by supervisor+ | P2 |
| FR-12 | Media files auto-deleted after configurable retention | P3 |

---

## 6. Non-Functional Requirements

### 6.1 Security
- Passwords stored as bcrypt hashes (plain-text only in legacy migration)
- JWT tokens signed with HS256, configurable expiry (default 8h)
- JWT secret minimum 64 characters, never committed to version control
- RBAC enforced at API layer via `requireAuth` + `requireRole` / `requireMinRole` middleware
- CORS restricted to known origins in production
- File uploads limited to 10 MB, stored outside web root

### 6.2 Performance
- API response time < 200 ms for ticket list (PostgreSQL indexed queries)
- Connection pooling: min 2, max 10 connections (configurable via env)
- Frontend served as static SPA in production (no SSR overhead)
- WhatsApp send operations are fire-and-forget (non-blocking to HTTP response)

### 6.3 Reliability
- PostgreSQL as primary datastore (ACID-compliant)
- WhatsApp client auto-reinitializes 10 seconds after disconnect
- Group list cached for 5 minutes to avoid repeated IDB reads

### 6.4 Scalability
- Connection pool configurable via `DB_POOL_MAX` environment variable
- Stateless API (JWT) — can run behind a load balancer
- File storage path configurable (future: S3-compatible object storage)

### 6.5 Usability
- Mobile-first UI for technician-facing views
- Tailwind CSS design system (Inter font, consistent spacing)
- Motion animations for status transitions
- Offline-graceful: technician can view ticket details without stable connection

---

## 7. Success Metrics

| Metric | Target |
|---|---|
| Mean time to ticket creation | < 2 minutes |
| WhatsApp notification delivery rate | > 95% |
| Technician report submission rate | > 90% of completed tickets |
| API uptime | > 99.5% |
| Zero tickets lost (vs. old spreadsheet) | 100% |
| Time to onboard new technician | < 5 minutes |

---

## 8. Out of Scope (v1.0)

- Customer self-service portal
- Mobile native app (iOS/Android)
- Billing system integration
- SLA timer / escalation engine
- Multi-tenant / multi-ISP support