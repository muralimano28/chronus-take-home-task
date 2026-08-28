import dotenv from "dotenv";
import path from "path";
import { beforeEach } from "vitest";
import { cleanDatabase } from "./helpers/database";

dotenv.config({
    path: path.resolve(__dirname, "../.env.test"),
});

beforeEach(async () => {
    await cleanDatabase();
});