import { describe, expect, it } from "vitest";
import { prisma } from "@chronus/db";

describe("Test database", () => {
    it("connects to chronus_test_db", async () => {
        const result = await prisma.$queryRaw<
            { current_database: string }[]
        >`SELECT current_database()`;

        expect(result[0].current_database).toBe("chronus_test_db");
    });
});