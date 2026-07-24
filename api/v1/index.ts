/**
 * api/v1/index.ts
 * ===============
 * Mounts all v1 sub-routers under /api/v1.
 *
 * Import this file in server.ts:
 *   import apiV1 from "./api/v1/index.js";
 *   app.use("/api/v1", apiV1);
 */

import { Router, Request, Response } from "express";

import authRouter     from "./routes/auth.js";
import ticketsRouter  from "./routes/tickets.js";
import usersRouter    from "./routes/users.js";
import logsRouter     from "./routes/logs.js";
import settingsRouter from "./routes/settings.js";

const router = Router();

// ─── Health check ─────────────────────────────────────────────────────────────
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// ─── Sub-routers ──────────────────────────────────────────────────────────────
router.use("/auth",     authRouter);
router.use("/tickets",  ticketsRouter);
router.use("/users",    usersRouter);
router.use("/logs",     logsRouter);
router.use("/settings", settingsRouter);

// ─── 404 fallback for /api/v1/* ───────────────────────────────────────────────
router.use((_req: Request, res: Response) => {
  res.status(404).json({
    status: "error",
    message: "API endpoint not found. Check the URL and HTTP method.",
  });
});

export default router;