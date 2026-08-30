import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../../src/app";

describe("GET /api/v1/health", () => {
    it("returns healthy status with database and redis connected", async () => {
        const response = await request(app)
            .get("/api/v1/health");

        expect(response.status).toBe(200);
        expect(response.body.status).toBe("ok");
        expect(response.body.databaseStatus).toBe("connected");
        expect(response.body.redisStatus).toBe("connected");
    });
});