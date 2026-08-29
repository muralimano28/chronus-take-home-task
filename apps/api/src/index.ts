import { env } from "./config/env";
import app from "./app";
import { logger } from "@chronus/logger";

app.listen(env.PORT, () => {
  logger.info(`API Server is running on port ${env.PORT}`);
});
