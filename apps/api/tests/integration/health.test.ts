import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../../src/app";

describe("GET /api/v1/health", () => {
    it("returns healthy status", async () => {
        const response = await request(app)
            .get("/api/v1/health");

        expect(response.status).toBe(200);
    });
});