# UI/UX & Frontend Design System
# ISP Management System — Omnichannel Dashboard

**Version:** 1.0.0  
**Date:** July 2026  
**Frontend Stack:** React 19 + Vite 6 + Tailwind CSS v4  

---

## 1. Layout Strategy — App Shell

The application uses a classic **App Shell** pattern: a persistent outer shell (sidebar + top navbar) that renders once, with the main content area swapping out via React Router as the user navigates. This gives instant perceived navigation since the shell never unmounts.

```
┌──────────────────────────────────────────────────────────────┐
│                        TOP NAVBAR                            │
│  [Logo / App Name]          [Role Badge]  [User] [Logout]   │
├────────────────┬─────────────────────────────────────────────┤
│                │                                             │
│   SIDEBAR      │           MAIN CONTENT AREA                │
│                │                                             │
│  > Dashboard   │   <Route renders here>                     │
│  > Tickets     │                                             │
│  > Users       │   e.g. Ticket List, Ticket Detail,         │
│  > Logs        │        User Management, Settings           │
│  > Settings    │                                             │
│                │                                             │
│  [WA Status]   │                                             │
│                │                                             │
└────────────────┴─────────────────────────────────────────────┘
```

### 1.1 Sidebar

- **Width:** Fixed `w-64` (256px) on desktop; collapses to icon-only (`w-16`) or off-canvas drawer on mobile.
- **Navigation items:** Icon + label pairs using `lucide-react` icons.
- **Active state:** Highlighted with `bg-blue-600 text-white` on the active route link.
- **Role-conditional items:** Menu items hidden for roles that lack access (e.g. Users and Settings hidden for `technician` and `vendor`).
- **WhatsApp status indicator:** A small badge at the bottom showing WA connection state (`connected` / `disconnected` / `qr`).

### 1.2 Top Navbar

- **Height:** Fixed `h-16` (64px).
- **Left:** Application name / logo.
- **Right:** User display name, role badge (color-coded by role), logout button.
- **Mobile:** Hamburger icon to toggle the sidebar drawer.

### 1.3 Main Content Area

- **Padding:** `p-6` (24px) on all sides.
- **Max width:** Unconstrained — fills remaining width after sidebar.
- **Scroll:** Vertical scroll within this area; sidebar and navbar are sticky.

---

## 2. Page Layouts

### 2.1 Ticket List Page

```
┌──────────────────────────────────────────────────┐
│  [Page Title]                 [+ New Ticket Btn] │
├──────────────────────────────────────────────────┤
│  [Filter: Status] [Filter: Type] [Search Input]  │
├──────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │ Ticket   │ │ Ticket   │ │ Ticket   │  ...    │
│  │ Card     │ │ Card     │ │ Card     │         │
│  └──────────┘ └──────────┘ └──────────┘         │
│  (or table view on wide screens)                 │
└──────────────────────────────────────────────────┘
```

- Status badge per card (color-coded).
- Clicking a card opens the **Ticket Detail Modal** or navigates to detail page.

### 2.2 Ticket Detail / Form

- Two-column layout on desktop (ticket info left, assigned technicians right).
- Single-column stacked on mobile.
- File attachment preview (image thumbnail or file icon + name).
- Google Maps embed or link button for `location_url`.

### 2.3 Dashboard / Overview (planned)

- Stats cards row: Open / In-Progress / Completed / Cancelled counts.
- Recent tickets table.
- WhatsApp connection status widget.

---

## 3. Design System

### 3.1 Color Palette

The design uses Tailwind CSS v4's default color palette with the following semantic mappings:

| Token | Tailwind Class | Hex (approx) | Usage |
|---|---|---|---|
| **Primary** | `blue-600` | `#2563EB` | CTA buttons, active nav, links |
| **Primary Hover** | `blue-700` | `#1D4ED8` | Button hover state |
| **Primary Light** | `blue-50` | `#EFF6FF` | Selected row backgrounds |
| **Success** | `green-500` | `#22C55E` | `completed` status badge |
| **Warning** | `yellow-500` | `#EAB308` | `in-progress` status badge |
| **Danger** | `red-500` | `#EF4444` | `cancelled` status, delete buttons |
| **Neutral** | `gray-500` | `#6B7280` | `open` status badge, secondary text |
| **Surface** | `white` | `#FFFFFF` | Card and modal backgrounds |
| **Background** | `gray-100` | `#F3F4F6` | Page background |
| **Border** | `gray-200` | `#E5E7EB` | Card borders, dividers |
| **Text Primary** | `gray-900` | `#111827` | Headings, main content |
| **Text Secondary** | `gray-500` | `#6B7280` | Labels, metadata |

### 3.2 Status Badge Colors

| Status | Badge Classes |
|---|---|
| `open` | `bg-gray-100 text-gray-700` |
| `in-progress` | `bg-yellow-100 text-yellow-800` |
| `completed` | `bg-green-100 text-green-800` |
| `cancelled` | `bg-red-100 text-red-800` |

### 3.3 Role Badge Colors

| Role | Badge Classes |
|---|---|
| `superuser` | `bg-purple-100 text-purple-800` |
| `admin` | `bg-blue-100 text-blue-800` |
| `supervisor` | `bg-indigo-100 text-indigo-800` |
| `technician` | `bg-teal-100 text-teal-800` |
| `vendor` | `bg-orange-100 text-orange-800` |

### 3.4 Typography

| Element | Classes | Notes |
|---|---|---|
| Font family | `font-sans` → Inter | Configured in `tailwind.config.js` |
| Page heading (H1) | `text-2xl font-bold text-gray-900` | Section titles |
| Section heading (H2) | `text-lg font-semibold text-gray-800` | Card headers |
| Body text | `text-sm text-gray-700` | Default content |
| Label / metadata | `text-xs text-gray-500` | Timestamps, secondary info |
| Monospace | `font-mono text-xs` | IDs, phone numbers |

### 3.5 Spacing Scale

Adheres to Tailwind's default 4px base unit:

| Token | Value | Common use |
|---|---|---|
| `p-2` | 8px | Small buttons, badges |
| `p-4` | 16px | Card internal padding |
| `p-6` | 24px | Page content padding |
| `gap-4` | 16px | Grid/flex gaps |
| `gap-6` | 24px | Section gaps |
| `rounded-lg` | 8px | Cards, modals |
| `rounded-full` | 9999px | Badges, avatars |

### 3.6 Component Patterns

**Primary Button:**
```jsx
<button className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
  Create Ticket
</button>
```

**Secondary Button:**
```jsx
<button className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors">
  Cancel
</button>
```

**Danger Button:**
```jsx
<button className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors">
  Delete
</button>
```

**Card:**
```jsx
<div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
  {/* content */}
</div>
```

**Form Input:**
```jsx
<input className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
```

**Status Badge:**
```jsx
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
  Completed
</span>
```

---

## 4. Animation Strategy

Uses the **motion** library (Framer Motion v12) for micro-interactions:

| Interaction | Animation |
|---|---|
| Page / route transition | `fadeIn` + `slideUp` (y: 10 → 0, opacity: 0 → 1) |
| Modal appear | `scale: 0.95 → 1` + `opacity: 0 → 1` |
| Ticket status change | Color transition via `animate={{ backgroundColor }}` |
| Sidebar collapse | `width` spring animation |
| Toast notifications | Slide in from top-right |

**Standard entry animation:**
```jsx
import { motion } from "motion/react";

<motion.div
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.2 }}
>
  {/* content */}
</motion.div>
```

---

## 5. State Management Strategy

The project uses **React built-in state primitives** — no external state manager (Redux, Zustand) in v1.

### 5.1 Authentication Context

A top-level `AuthContext` provides the authenticated user globally:

```typescript
// src/context/AuthContext.tsx
interface AuthContextValue {
  user: User | null;          // null = not logged in
  token: string | null;       // JWT string
  login: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
}
```

- Token is persisted to `localStorage` on login and read on app init.
- `logout()` clears `localStorage` and resets context state.
- All child components access via `useAuth()` custom hook.

### 5.2 Axios Instance & Interceptors

A single configured Axios instance (`src/lib/api.ts`) is used for all API calls:

```typescript
// src/lib/api.ts
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api/v1",
  timeout: 15000,
});

// Request interceptor: auto-attach JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor: handle 401 globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;
```

### 5.3 Server State (Data Fetching)

Each page/component manages its own data fetching with `useState` + `useEffect`:

```typescript
const [tickets, setTickets] = useState<Ticket[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  api.get("/tickets")
    .then(res => setTickets(res.data.data))
    .catch(err => setError(err.response?.data?.message ?? "Failed to load"))
    .finally(() => setLoading(false));
}, []);
```

> **Future:** If data fetching complexity grows, migrate to **TanStack Query (React Query)** for caching, background refetch, and optimistic updates.

### 5.4 Local UI State

Form state is managed with controlled inputs and `useState`. No form library in v1.

---

## 6. Routing Strategy

Uses **React Router v6** (or v7) with a Protected Route pattern.

### 6.1 Route Tree

```
/                   → redirect to /login or /dashboard
/login              → LoginPage (public)
/dashboard          → DashboardPage (protected)
/tickets            → TicketListPage (protected)
/tickets/new        → CreateTicketPage (protected, admin+)
/tickets/:id        → TicketDetailPage (protected)
/users              → UserListPage (protected, admin+)
/logs               → LogsPage (protected, supervisor+)
/settings           → SettingsPage (protected, admin+)
*                   → 404 NotFoundPage
```

### 6.2 Protected Route Component

```typescript
// src/components/ProtectedRoute.tsx
function ProtectedRoute({ children, allowedRoles }: Props) {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (allowedRoles && !allowedRoles.includes(user!.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
```

Usage:
```tsx
<Route path="/users" element={
  <ProtectedRoute allowedRoles={["admin", "superuser"]}>
    <UserListPage />
  </ProtectedRoute>
} />
```

---

## 7. File & Folder Structure (Frontend)

```
src/
├── main.tsx                 # App entry point, React.StrictMode
├── App.tsx                  # Root component: Router + AuthProvider
├── index.css                # Tailwind base + custom global styles
├── types.ts                 # Shared TypeScript interfaces & types
│
├── context/
│   └── AuthContext.tsx      # JWT auth context + useAuth hook
│
├── lib/
│   ├── api.ts               # Axios instance with interceptors
│   └── utils.ts             # Shared utility functions (formatDate, etc.)
│
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx     # Sidebar + Navbar wrapper
│   │   ├── Sidebar.tsx      # Navigation sidebar
│   │   └── Navbar.tsx       # Top navigation bar
│   │
│   ├── ui/
│   │   ├── Badge.tsx        # Status/role badge component
│   │   ├── Button.tsx       # Button variants
│   │   ├── Card.tsx         # Card container
│   │   ├── Input.tsx        # Controlled input with label
│   │   ├── Modal.tsx        # Dialog/modal overlay
│   │   ├── Spinner.tsx      # Loading spinner
│   │   └── Toast.tsx        # Toast notification
│   │
│   └── tickets/
│       ├── TicketCard.tsx   # Single ticket card
│       ├── TicketForm.tsx   # Create/edit ticket form
│       └── TicketDetail.tsx # Full ticket detail view
│
└── pages/
    ├── LoginPage.tsx
    ├── DashboardPage.tsx
    ├── TicketsPage.tsx
    ├── UsersPage.tsx
    ├── LogsPage.tsx
    └── SettingsPage.tsx
```

---

## 8. Responsive Design

| Breakpoint | Tailwind Prefix | Target |
|---|---|---|
| Mobile | (default) | `< 640px` — technician phone usage |
| Tablet | `sm:` | `640px+` |
| Desktop | `md:` / `lg:` | `768px+` — admin/NOC workstation |

**Mobile-first rules:**
- Sidebar collapses to off-canvas on `< md`.
- Ticket cards stack vertically on mobile; grid on `md:`.
- Forms use full-width inputs on mobile, split columns on `md:`.
- Touch targets minimum `44px × 44px` (Tailwind: `h-11` or `p-3`).