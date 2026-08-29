import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
});

redis.on("error", (err) => {
  console.error("[Redis Error]:", err.message);
});

redis.on("connect", () => {
  console.log("[Redis]: Successfully connected to Redis server");
});

export { Redis };
export default redis;
