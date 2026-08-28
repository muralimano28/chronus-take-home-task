import { Router } from "express";
import { prisma } from "@chronus/db";
import { env } from "../config/env";

const router = Router();

/**
 * GET /health
 * Diagnostic health check endpoint to check API status and database connectivity.
 */
router.get("/", async (req, res) => {
  const databaseUrl = env.DATABASE_URL;
  let dbStatus = "unknown";

  if (databaseUrl) {
    try {
      await prisma.user.count();
      dbStatus = "connected";
    } catch (e) {
      console.error("Database check failed in health endpoint:", e);
      dbStatus = "error";
    }
  } else {
    dbStatus = "not_configured";
  }

  res.status(dbStatus === "error" ? 500 : 200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    databaseConfigured: !!databaseUrl,
    databaseStatus: dbStatus,
  });
});

export default router;
