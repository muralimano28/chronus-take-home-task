import { Router } from "express";
import { prisma } from "@chronus/db";
import { redis } from "@chronus/redis";
import { logger } from "../logger";
import { env } from "../config/env";

const router = Router();

/**
 * GET /health
 * Diagnostic health check endpoint to verify API, database, and Redis connectivity.
 */
router.get("/", async (req, res) => {
  const databaseUrl = env.DATABASE_URL;
  let dbStatus = "unknown";
  let redisStatus = "unknown";

  // 1. Check Database connectivity
  if (databaseUrl) {
    try {
      await prisma.user.count();
      dbStatus = "connected";
    } catch (e) {
      logger.error("Database check failed in health endpoint:", { error: e });
      dbStatus = "error";
    }
  } else {
    dbStatus = "not_configured";
  }

  // 2. Check Redis connectivity
  try {
    const pingRes = await redis.ping();
    redisStatus = pingRes === "PONG" ? "connected" : "error";
  } catch (e) {
    logger.error("Redis check failed in health endpoint:", { error: e });
    redisStatus = "error";
  }

  const isHealthy = dbStatus === "connected" && redisStatus === "connected";
  const overallStatus = isHealthy ? "ok" : "error";
  const httpStatus = isHealthy ? 200 : 503;

  res.status(httpStatus).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    databaseConfigured: !!databaseUrl,
    databaseStatus: dbStatus,
    redisStatus,
  });
});

export default router;
