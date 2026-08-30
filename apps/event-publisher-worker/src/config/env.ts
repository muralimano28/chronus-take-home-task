import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  RABBITMQ_URL: z.string().default("amqp://guest:guest@localhost:5672"),
  POLL_INTERVAL_MS: z.coerce.number().default(2000),
  BATCH_SIZE: z.coerce.number().default(50),
  VISIBILITY_TIMEOUT_SECONDS: z.coerce.number().default(60),
  MAX_RETRIES: z.coerce.number().default(5),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("❌ Fatal Error: Invalid environment variables in event-publisher-worker:");
  console.error(z.treeifyError(parsedEnv.error));
  process.exit(1);
}

export const env = parsedEnv.data;
