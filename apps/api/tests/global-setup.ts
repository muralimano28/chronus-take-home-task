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

  console.log("\n🔄 Synchronizing test database schema via migrations...");
  try {
    // Run prisma migrate deploy to apply all migrations including GiST exclusion constraints
    execSync("pnpm exec prisma migrate deploy", {
      cwd: path.resolve(__dirname, "../../../packages/db"),
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
      },
      stdio: "inherit",
    });
    console.log("✅ Test database schema is up-to-date with all migrations.\n");
  } catch (error) {
    console.error("❌ Failed to apply migrations to test database:", error);
    process.exit(1);
  }
}
