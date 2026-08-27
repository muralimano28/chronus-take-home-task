import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@chronus/db";

const JWT_SECRET = process.env.JWT_SECRET!;

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
      console.error("[Auth Middleware Error] Token payload is missing required fields.");
      res.status(401).json({ error: "Invalid session structure. Please log in again." });
      return;
    }

    const payload = decoded as AuthPayload;

    // Verify requesting user's membership exists in DB
    const membership = await prisma.organizationUser.findUnique({
      where: {
        organizationId_id: {
          organizationId: payload.organizationId,
          id: payload.membershipId,
        },
      },
      select: { id: true },
    });

    if (!membership) {
      res.status(403).json({ error: "Access denied. Your membership is invalid or has been deactivated." });
      return;
    }

    req.user = payload;
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Auth Middleware Error] Token verification failed:", message);
    res.status(401).json({ error: "Invalid or expired session. Please log in again." });
  }
}
