import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";

if (process.env.NODE_ENV !== "production" && !process.env.DATABASE_URL) {
  // Load workspace cwd .env if available
  // Generally .env will be present in the consuming app like api or worker.
  // This is just to run prisma commands in development
  dotenv.config();
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "[@chronus/db]: DATABASE_URL environment variable is missing. Please ensure your environment or .env file defines DATABASE_URL."
  );
}

// Create a new Driver Adapter instance for PrismaPostgres
const adapter = new PrismaPg({
  connectionString,
});

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
