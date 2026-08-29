import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

import { createLogger } from "@chronus/logger";

const logger = createLogger("redis");
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
});

redis.on("error", (err) => {
  logger.error(`Redis connection error: ${err.message}`, { error: err });
});

redis.on("connect", () => {
  logger.info("Successfully connected to Redis server");
});

export { Redis };
export default redis;
