if (!process.env.DATABASE_URL) {
  require("dotenv").config();
}

import { PrismaClient } from "./generated/prisma/client";

//Prisma Driver Adapter for Postgres
import { PrismaPg } from "@prisma/adapter-pg";

// Create a new Driver Adapter instance for PrismaPostgres
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
