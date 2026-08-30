import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3010),
  JWT_SECRET: z.string().min(1, "JWT_SECRET must not be empty"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL must not be empty"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  MENTORS_CACHE_TTL_SECONDS: z.coerce.number().default(24 * 60 * 60), // 24 hours default
  SLOTS_CACHE_TTL_SECONDS: z.coerce.number().default(15 * 60), // 15 minutes default
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("❌ Fatal Error: Invalid environment variables:");
  console.error(z.treeifyError(parsedEnv.error));
  process.exit(1);
}

export const env = parsedEnv.data;
