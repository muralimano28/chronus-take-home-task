import jwt from "jsonwebtoken";

import { env } from "../../src/config/env";

interface CreateTestTokenOptions {
    userId: string;
    organizationId: string;
    membershipId: string;
    isMentor: boolean;
    timezone: string;
    name: string;
    email: string;
    organizationName: string;
}

export function createTestToken(
    payload: CreateTestTokenOptions,
): string {
    return jwt.sign(payload, env.JWT_SECRET);
}