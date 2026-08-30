import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

import { createLogger } from "@chronus/logger";

const logger = createLogger("redis");
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy(times) {
    // Stop reconnecting after 10 failed attempts to prevent infinite reconnection loops
    if (times > 10) {
      logger.error(`Redis reconnection exhausted after ${times} attempts`);
      return null;
    }
    // Full jitter exponential backoff for driver reconnects: min(2000, rand(0, 50 * 2^(times-1)))
    const base = 50;
    const maxBackoff = Math.min(2000, base * Math.pow(2, times - 1));
    const delay = Math.floor(Math.random() * maxBackoff);
    return delay;
  },
});

redis.on("error", (err) => {
  logger.error(`Redis connection error: ${err.message}`, { error: err });
});

redis.on("connect", () => {
  logger.info("Successfully connected to Redis server");
});

export { Redis };
export default redis;
