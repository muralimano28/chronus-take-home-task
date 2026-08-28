import { Router } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@chronus/db";

import { isValidUuid } from "../utils/validation";

import { env } from "../config/env";
 
const router = Router();
const JWT_SECRET = env.JWT_SECRET;

/**
 * POST /auth/login
 * Authenticates a user based on userId and organizationId.
 * Sets an httpOnly, sameSite JWT token in cookies upon successful validation.
 */
router.post("/login", async (req, res) => {
  const { userId, organizationId } = req.body;

  // Validate inputs
  if (!isValidUuid(userId)) {
    res.status(400).json({ error: "Invalid or missing userId format. Expected a valid UUID." });
    return;
  }
  if (!isValidUuid(organizationId)) {
    res.status(400).json({ error: "Invalid or missing organizationId format. Expected a valid UUID." });
    return;
  }

  try {
    // Check if membership exists in OrganizationUser
    const membership = await prisma.organizationUser.findFirst({
      where: {
        userId,
        organizationId,
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        organization: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!membership) {
      res.status(401).json({ error: "Invalid membership. User does not belong to this organization." });
      return;
    }

    // Generate JWT Token with membership claims
    const token = jwt.sign(
      {
        membershipId: membership.id,
        userId: membership.userId,
        organizationId: membership.organizationId,
        isMentor: membership.isMentor,
        timezone: membership.timezone,
        name: membership.user.name,
        email: membership.user.email,
        organizationName: membership.organization.name,
      },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    // Set cookie with security best practices
    res.cookie("token", token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    });

    res.status(200).json({
      message: "Login successful",
      user: {
        membershipId: membership.id,
        userId: membership.userId,
        organizationId: membership.organizationId,
        name: membership.user.name,
        email: membership.user.email,
        timezone: membership.timezone,
        isMentor: membership.isMentor,
        organizationName: membership.organization.name,
      },
    });
  } catch (error) {
    console.error("[Auth Error] Login failure:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * POST /auth/logout
 * Clears the authentication token cookie.
 */
router.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
  });
  res.status(200).json({ message: "Logout successful" });
});

export default router;
