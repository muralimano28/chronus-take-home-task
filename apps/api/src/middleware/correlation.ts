import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { runWithContext, logger, CORRELATION_ID_HEADER } from "@chronus/logger";

export { CORRELATION_ID_HEADER };

const isHealthCheck = (url: string) => url.includes("/health");

/**
 * Express middleware to propagate or generate x-correlation-id, initialize AsyncLocalStorage context,
 * and log inbound and outbound HTTP requests with status codes and duration.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const correlationId = (req.headers[CORRELATION_ID_HEADER] as string) || crypto.randomUUID();
  const requestUrl = req.originalUrl || req.url;
  const skipLogging = isHealthCheck(requestUrl);

  // Set response header for client traceability
  res.setHeader(CORRELATION_ID_HEADER, correlationId);

  const initialContext = {
    correlationId,
    method: req.method,
    url: requestUrl,
    ip: req.ip || req.socket.remoteAddress,
  };

  runWithContext(initialContext, () => {
    const startTime = process.hrtime.bigint();

    // Log request start for non-health endpoints to avoid log flooding
    if (!skipLogging) {
      logger.info(`Incoming ${req.method} ${requestUrl}`);
    }

    res.on("finish", () => {
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000; // nanosecond to millisecond conversion

      if (!skipLogging) {
        const logLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
        logger.log(logLevel, `Completed ${req.method} ${requestUrl} ${res.statusCode} in ${durationMs.toFixed(2)}ms`, {
          statusCode: res.statusCode,
          durationMs: Number(durationMs.toFixed(2)),
        });
      }
    });

    next();
  });
}
