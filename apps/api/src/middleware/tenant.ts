import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth";
import { isValidUuid } from "../utils/validation";

/**
 * Middleware to enforce strict tenant isolation boundaries.
 * If the route defines an `orgId` path parameter, it:
 * 1. Validates the UUID format of `orgId`.
 * 2. Asserts that `orgId` matches the `organizationId` claims in the user's JWT.
 * 
 * Must be mounted AFTER `requireAuth` middleware.
 */
export function validateTenantAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const { orgId } = req.params;

  // We expect requireAuth to have run and populated req.user
  if (!req.user || !req.user.organizationId) {
    res.status(401).json({ error: "Authentication required. Missing user tenant context." });
    return;
  }

  const { organizationId } = req.user;

  if (orgId) {
    if (!isValidUuid(orgId)) {
      res.status(400).json({ error: "Invalid organization ID format. Expected a valid UUID." });
      return;
    }

    if (orgId !== organizationId) {
      res.status(403).json({ error: "Access denied. Tenant mismatch between token and request." });
      return;
    }
  }

  next();
}
