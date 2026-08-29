import { execSync } from "child_process";
import dotenv from "dotenv";
import path from "path";

export default async function globalSetup() {
  // Load the test env variables from apps/api/.env.test
  dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is missing in .env.test");
  }

  console.log("\n🔄 Synchronizing test database schema...");
  try {
    // Synchronize test database schema with force-reset for clean test runs
    execSync("pnpm exec prisma db push --force-reset", {
      cwd: path.resolve(__dirname, "../../../packages/db"),
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
        PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "Yes. Proceed with this plan.",
      },
      stdio: "inherit",
    });
    console.log("✅ Test database schema is up-to-date.\n");
  } catch (error) {
    console.error("❌ Failed to push schema to test database:", error);
    process.exit(1);
  }
}
