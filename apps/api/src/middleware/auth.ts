import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@chronus/db";
import { setContext } from "@chronus/logger";
import { logger } from "../logger";

import { env } from "../config/env";
 
const JWT_SECRET = env.JWT_SECRET;

export interface AuthPayload {
  membershipId: string;
  userId: string;
  organizationId: string;
  isMentor: boolean;
  timezone: string;
  name: string;
  email: string;
  organizationName: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthPayload;
}

/**
 * Middleware to require JWT authentication and active membership validation.
 * Extracts the token from HTTP-only cookies, validates it, checks active database membership,
 * and attaches the payload to req.user.
 */
export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.cookies.token;

  if (!token) {
    res.status(401).json({ error: "Authentication required. No session cookie found." });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Ensure the decoded token is an object and contains all necessary fields
    if (
      !decoded ||
      typeof decoded !== "object" ||
      !("membershipId" in decoded) ||
      !("userId" in decoded) ||
      !("organizationId" in decoded)
    ) {
      logger.error("Token payload is missing required fields", {
        event: "security.access_denied",
        reason: "invalid_payload_structure",
      });
      res.status(401).json({ error: "Invalid session structure. Please log in again." });
      return;
    }

    const payload = decoded as AuthPayload;

    // Verify requesting user's membership exists in DB and fetch authoritative state
    const membership = await prisma.organizationUser.findUnique({
      where: {
        organizationId_id: {
          organizationId: payload.organizationId,
          id: payload.membershipId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!membership) {
      logger.warn("Access denied: membership invalid or deactivated", {
        event: "security.access_denied",
        reason: "membership_not_found",
        claimedOrganizationId: payload.organizationId,
        claimedMembershipId: payload.membershipId,
      });
      res.status(403).json({ error: "Access denied. Your membership is invalid or has been deactivated." });
      return;
    }

    // Populate req.user strictly from the authoritative database record to eliminate privilege escalation
    // and stale claim risks (e.g. isMentor, timezone, email changes).
    req.user = {
      membershipId: membership.id,
      userId: membership.userId,
      organizationId: membership.organizationId,
      isMentor: membership.isMentor,
      timezone: membership.timezone,
      name: membership.user.name,
      email: membership.user.email,
      organizationName: membership.organization.name,
    };

    // Immediately populate AsyncLocalStorage context so all downstream logs include user and tenant metadata
    setContext({
      organizationId: membership.organizationId,
      userId: membership.userId,
      membershipId: membership.id,
    });

    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Token verification failed:", {
      event: "security.access_denied",
      reason: "jwt_verification_failed",
      error: message,
    });
    res.status(401).json({ error: "Invalid or expired session. Please log in again." });
  }
}
