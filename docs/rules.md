# Coding Standards & AI Guidelines
# ISP Management System — ticketing-gekanet

**Version:** 1.0.0  
**Date:** July 2026  
**Applies to:** All contributors and AI agents working on this codebase  

---

> ## ⚠️ AI AGENT DIRECTIVE
>
> **Always read this `rules.md` file BEFORE generating any new code for this project.**  
> This document defines the non-negotiable standards for this codebase. Any code that violates
> these rules will be rejected and must be regenerated. When in doubt, read the existing code
> first to match its conventions exactly.

---

## 1. TypeScript Rules

### 1.1 Strict Mode — Non-Negotiable

TypeScript strict mode is **always on**. The `tsconfig.json` enables:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true
  }
}
```

**Forbidden patterns:**
```typescript
// ❌ NEVER use `any`
function process(data: any) { ... }

// ❌ NEVER use non-null assertion without a comment justifying it
const el = document.getElementById("app")!;

// ❌ NEVER cast with `as` to silence an error without a comment
const user = response.data as User;

// ✅ Correct: use proper type guards
if (response.data && typeof response.data.id === "string") {
  const user: User = response.data;
}

// ✅ Acceptable non-null with justification comment
// The element always exists because it is in index.html
const el = document.getElementById("app")!;
```

### 1.2 Type Definitions

- All shared types live in `src/types.ts` (frontend) or `api/v1/middleware/auth.ts` (backend types).
- Never define types inline in JSX — extract to an interface.
- Use `interface` for object shapes, `type` for unions and aliases.

```typescript
// ✅ Correct
interface TicketCardProps {
  ticket: Ticket;
  onSelect: (id: string) => void;
}

// ✅ Correct
type SortDirection = "asc" | "desc";

// ❌ Avoid: inline type in component signature
function TicketCard({ ticket, onSelect }: { ticket: Ticket; onSelect: (id: string) => void }) { ... }
```

### 1.3 Error Handling

Always use typed error handling in `catch` blocks:

```typescript
// ✅ Correct — TypeScript catch (err: unknown)
try {
  await api.post("/tickets", payload);
} catch (err: unknown) {
  if (err instanceof Error) {
    setError(err.message);
  } else {
    setError("An unknown error occurred");
  }
}

// ❌ NEVER use `catch (err: any)`
```

---

## 2. Naming Conventions

| Item | Convention | Example |
|---|---|---|
| React components | PascalCase | `TicketCard`, `UserListPage` |
| Component files | PascalCase `.tsx` | `TicketCard.tsx` |
| Hooks | camelCase, prefix `use` | `useAuth`, `useTickets` |
| Variables & functions | camelCase | `ticketList`, `handleSubmit` |
| Constants | UPPER_SNAKE_CASE | `JWT_SECRET`, `MAX_FILE_SIZE` |
| TypeScript interfaces | PascalCase, no `I` prefix | `User`, `Ticket`, `AppSettings` |
| TypeScript types | PascalCase | `TicketStatus`, `UserRole` |
| Database columns | snake_case | `customer_name`, `created_at` |
| API route parameters | camelCase in JS, snake_case in SQL | `req.params.id` → `ticket_id` |
| CSS classes | Tailwind utilities only — no custom class names except `index.css` globals |
| Environment variables | UPPER_SNAKE_CASE with prefix | `DB_HOST`, `JWT_SECRET` |

---

## 3. Folder & File Structure

### 3.1 Backend (Node.js / Express)

```
/
├── server.ts                    # Express entry point
├── database.js                  # pg Pool singleton (CommonJS-compatible)
├── schema.sql                   # PostgreSQL DDL
├── migrate-data.js              # One-time JSON → PostgreSQL migration
├── .env                         # Local secrets (never commit)
├── .env.example                 # Template for env vars (safe to commit)
│
└── api/
    └── v1/
        ├── index.ts             # Mounts all sub-routers at /api/v1
        ├── middleware/
        │   └── auth.ts          # requireAuth, requireRole, requireMinRole
        └── routes/
            ├── auth.ts          # POST /login, GET /me
            ├── tickets.ts       # CRUD + file upload
            ├── users.ts         # CRUD
            ├── logs.ts          # GET (read-only)
            └── settings.ts      # GET + PUT (upsert)
```

**Rules:**
- One router per resource file. Never mix resources in one route file.
- All route handlers must be `async` functions wrapped in try/catch.
- All DB queries go through the `database.js` pool — never open direct connections.
- Never `console.log` sensitive data (passwords, tokens, full user objects).

### 3.2 Frontend (React)

```
src/
├── main.tsx
├── App.tsx
├── index.css
├── types.ts                     # ALL shared TS interfaces/types
├── context/                     # React contexts
├── lib/                         # Non-component utilities
├── components/
│   ├── layout/                  # AppShell, Sidebar, Navbar
│   ├── ui/                      # Generic reusable components
│   └── [feature]/               # Feature-specific components (tickets/, users/)
└── pages/                       # One file per route
```

**Rules:**
- Pages are thin wrappers — data fetching and business logic go in custom hooks or components.
- Every `page` imports from `components/`, never the reverse.
- `src/lib/api.ts` is the **only** place where Axios is configured — all other files import from it.
- Never hardcode `/api/v1` in component files — always use the configured `api` instance.

---

## 4. API Design Rules

### 4.1 Response Envelope

Every API response **must** follow this exact structure:

```json
// Success
{ "status": "ok", "data": { } }
{ "status": "ok", "data": [ ] }

// Error
{ "status": "error", "message": "Human-readable explanation." }
```

Never return a raw object or array at the top level. Never return `success: true/false`.

### 4.2 HTTP Status Codes

| Scenario | Code |
|---|---|
| GET success | `200` |
| POST (create) success | `201` |
| No content | `204` |
| Bad request / validation | `400` |
| Unauthorized (no/bad token) | `401` |
| Forbidden (wrong role) | `403` |
| Not found | `404` |
| Server error | `500` |

### 4.3 Route Protection

Every protected route must have **both** middleware in order:

```typescript
// ✅ Correct order
router.get("/", requireAuth, requireRole(["admin"]), handler);

// ❌ Wrong — role check without auth check
router.get("/", requireRole(["admin"]), handler);
```

### 4.4 Input Validation

- Validate all user-supplied input before touching the database.
- Return `400` with a descriptive message for missing/invalid fields.
- Never pass `req.body` directly to a SQL query — always extract and validate named fields.

```typescript
// ✅ Correct
const { username, password } = req.body as { username?: string; password?: string };
if (!username || !password) {
  return res.status(400).json({ status: "error", message: "username and password are required." });
}

// ❌ Never
db.query("INSERT INTO users VALUES ($1)", [req.body]);
```

---

## 5. Database Rules

- **Never** write raw string concatenation in SQL queries. Always use parameterised queries (`$1`, `$2`).
- **Never** `SELECT *` in production code — always name the columns you need.
- All new tables must include `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- All mutable tables must include `updated_at` and use the `set_updated_at()` trigger.
- Foreign keys must always specify `ON DELETE` behaviour explicitly.
- New migrations must be additive (never drop/rename columns without a migration plan).

```typescript
// ✅ Correct
const result = await pool.query(
  `SELECT id, username, name, role_id FROM users WHERE username = $1`,
  [username]
);

// ❌ Never
const result = await pool.query(`SELECT * FROM users WHERE username = '${username}'`);
```

---

## 6. Security Rules

1. **Secrets:** Never commit `.env`. Use `.env.example` for templates.
2. **JWT:** `JWT_SECRET` must be a minimum of 32 random characters. In production, use 64+.
3. **Passwords:** Never store or log plain-text passwords. Use bcrypt with `saltRounds >= 10`.
4. **File uploads:** Always validate MIME type and file size. Reject non-image/non-PDF files.
5. **CORS:** In production, restrict `cors()` to specific origins only — never `origin: "*"`.
6. **Error messages:** Never expose stack traces or SQL errors in API responses. Log internally, return generic message.
7. **Rate limiting:** Add `express-rate-limit` to `/api/v1/auth/login` before production deployment.

---

## 7. Git Workflow

### 7.1 Branch Strategy

```
main          ← production-ready code only
└── staging   ← integration branch; merged to main after QA
    └── feat/ticket-detail-modal    ← feature branches
    └── fix/login-redirect-bug
    └── chore/update-dependencies
```

### 7.2 Branch Naming

| Type | Format | Example |
|---|---|---|
| Feature | `feat/<short-description>` | `feat/ticket-detail-modal` |
| Bug fix | `fix/<short-description>` | `fix/login-redirect-bug` |
| Refactor | `refactor/<description>` | `refactor/auth-middleware` |
| Chore | `chore/<description>` | `chore/update-pg-driver` |
| Documentation | `docs/<description>` | `docs/add-api-reference` |

### 7.3 Commit Message Format

Follow **Conventional Commits**:

```
<type>(<scope>): <short summary in present tense>

[optional body]
[optional footer]
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `style`

**Examples:**
```
feat(tickets): add multi-technician assignment endpoint
fix(auth): handle expired JWT in response interceptor
docs(schema): add JSONB planned usage section
chore(deps): upgrade pg to 8.22.0
```

**Rules:**
- Summary line max 72 characters.
- Use present tense: "add feature" not "added feature".
- Reference issue numbers in footer: `Closes #42`.

### 7.4 Pull Request Rules

- Every PR must target `staging`, never `main` directly.
- PR description must include: **What changed**, **Why**, **How to test**.
- No PR is merged with failing TypeScript compilation (`npm run lint` must pass).
- Minimum 1 reviewer approval required before merge.

---

## 8. Deployment Strategy

### 8.1 Environment Tiers

| Tier | Branch | Purpose |
|---|---|---|
| **Development** | any feature branch | Local dev with `npm run dev` (tsx + Vite HMR) |
| **Staging** | `staging` | Integration testing; mirrors production config |
| **Production** | `main` | Live system; zero-downtime deploys |

### 8.2 Production Build Process

```bash
# 1. Build the React SPA
npm run build        # outputs to /dist

# 2. Start the Node.js server (serves /dist as static + API)
node server.js       # or use pm2

# 3. Reverse proxy (Nginx) forwards:
#    /api/* → Node.js :3001
#    /*     → /dist/index.html (SPA fallback)
```

### 8.3 Environment Variables Checklist (Production)

Before deploying to production, verify all of the following are set:

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` — 64+ random characters (use `openssl rand -hex 32`)
- [ ] `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — production database
- [ ] `DB_POOL_MAX` — tuned for server capacity (typically 10–20)
- [ ] CORS origins are restricted in `server.ts`
- [ ] `.env` is listed in `.gitignore` ✅ (already done)

---

## 9. Code Review Checklist

Before submitting any PR, verify:

**TypeScript:**
- [ ] `npm run lint` passes (no TypeScript errors)
- [ ] No `any` types introduced
- [ ] All new interfaces/types added to the correct types file

**Backend:**
- [ ] All routes protected with `requireAuth` + appropriate role middleware
- [ ] All SQL queries use parameterised values
- [ ] Input validated before DB interaction
- [ ] Errors caught and returned as `{ status: "error", message: "..." }`

**Frontend:**
- [ ] No hardcoded API URLs — using the `api` instance from `src/lib/api.ts`
- [ ] Loading and error states handled for all data-fetching operations
- [ ] Role-based UI visibility respected (hide buttons/nav for unauthorized roles)
- [ ] Tailwind only — no inline `style={{}}` except for dynamic values unavailable in Tailwind

**General:**
- [ ] No `console.log` left in production code (use a logger or remove)
- [ ] No secrets or credentials in committed code
- [ ] New env vars added to `.env.example`

---

## 10. AI Agent Guidelines

When an AI agent (Cline, Copilot, Cursor, etc.) generates code for this project, it **must**:

1. **Read `docs/rules.md` first** — this is mandatory before generating any code.
2. **Read the relevant existing source files** before creating or modifying anything.
3. **Match existing code style exactly** — indentation, quote style, import order, comment style.
4. **Use the existing `api` Axios instance** (`src/lib/api.ts`) — never create a new one.
5. **Use the existing `pool`** from `database.js` — never open a separate DB connection.
6. **Follow the response envelope** `{ status, data | message }` — no exceptions.
7. **Never modify `schema.sql`** without also creating a migration plan documented in `docs/`.
8. **Never delete existing tests** or weaken TypeScript strictness to make code compile.
9. **Consult `docs/Architecture.md`** for system boundaries before adding new external dependencies.
10. **Consult `docs/schema.md`** before writing any SQL to understand table relationships.

**When generating a new feature:**
```
1. Read docs/rules.md          ← start here
2. Read docs/Architecture.md   ← understand system boundaries
3. Read docs/schema.md         ← understand data model
4. Read src/types.ts           ← understand existing types
5. Read the relevant route file ← match existing patterns
6. Generate code
7. Verify TypeScript compiles: npm run lint