import { env } from "./config/env";
import { prisma } from "@chronus/db";
import { rabbitmq, MENTORING_EVENT_TOPOLOGY } from "@chronus/rabbitmq";
import { createLogger, runWithContext } from "@chronus/logger";

import { claimOutboxBatch } from "./claim";

const logger = createLogger("event-publisher-worker");
const POLL_INTERVAL_MS = env.POLL_INTERVAL_MS;
const BATCH_SIZE = env.BATCH_SIZE;
const VISIBILITY_TIMEOUT_SECONDS = env.VISIBILITY_TIMEOUT_SECONDS;
const MAX_RETRIES = env.MAX_RETRIES;

/**
 * Initializes and asserts durable RabbitMQ exchange, queues, and bindings upfront
 * to guarantee no messages are lost even if consumers are offline.
 */
async function initTopology() {
  await rabbitmq.assertTopology({
    queueName: MENTORING_EVENT_TOPOLOGY.NOTIFICATION_EMAIL_QUEUE,
    exchangeName: MENTORING_EVENT_TOPOLOGY.EXCHANGE,
    routingKey: MENTORING_EVENT_TOPOLOGY.ROUTING_KEY_BOOKINGS,
  });

  logger.info("Connected to RabbitMQ with durable topology asserted.");
}

/**
 * Reads and atomically claims pending/timed-out OutboxEvent records via claimOutboxBatch.
 * Processes each event, dispatches to RabbitMQ, and transitions the state to PUBLISHED or PENDING/FAILED.
 */
async function processOutboxBatch(): Promise<number> {
  // 1. Atomically claim and transition events to 'PROCESSING' with a visibility lease
  const claimedEvents = await claimOutboxBatch(BATCH_SIZE, VISIBILITY_TIMEOUT_SECONDS);

  if (claimedEvents.length === 0) {
    return 0;
  }

  logger.info(`Claimed ${claimedEvents.length} outbox event(s) with ${VISIBILITY_TIMEOUT_SECONDS}s visibility lease.`);

  for (const event of claimedEvents) {
    const correlationId = event.correlationId;

    await runWithContext({ correlationId, eventType: event.eventType, aggregateId: event.aggregateId }, async () => {
      try {
        // Form routing key based on eventType (e.g. "BOOKING_CREATED" -> "booking.created")
        const routingKey = event.eventType.toLowerCase().replace(/_/g, ".");

        // 2. Publish to RabbitMQ topic exchange
        await rabbitmq.publish(
          {
            exchange: MENTORING_EVENT_TOPOLOGY.EXCHANGE,
            routingKey,
          },
          {
            id: event.id,
            correlationId,
            eventType: event.eventType,
            aggregateId: event.aggregateId,
            payload: event.payload,
            createdAt: event.createdAt,
          }
        );

        // 3. Mark event as PUBLISHED in the database and release lease
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
            lockedAt: null,
          },
        });

        logger.info(`Published event ${event.id} (${event.eventType}) to routing key '${routingKey}'`, {
          event: "outbox.event_published",
          outboxEventId: event.id,
          routingKey,
        });
      } catch (err) {
        const hasExceededRetries = event.retryCount >= MAX_RETRIES;
        logger.error(`Failed to publish event ${event.id}:`, {
          event: "outbox.publish_failed",
          outboxEventId: event.id,
          retryCount: event.retryCount,
          hasExceededRetries,
          error: err,
        });

        // Reset to PENDING for immediate retry (or FAILED if retry limit reached)
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: hasExceededRetries ? "FAILED" : "PENDING",
            lockedAt: null,
          },
        });

        if (hasExceededRetries) {
          logger.error(`Event ${event.id} marked as FAILED after ${event.retryCount} attempts.`, {
            event: "outbox.publish_failed",
            outboxEventId: event.id,
            finalStatus: "FAILED",
          });
        }
      }
    });
  }

  return claimedEvents.length;
}

/**
 * Main polling loop for the outbox publisher worker.
 */
async function startOutboxWorker() {
  logger.info("Starting transactional outbox publisher service...");

  try {
    await initTopology();
  } catch (err) {
    logger.error("Failed initial connection to RabbitMQ. Retrying in background...", { error: err });
  }

  let isRunning = true;
  let consecutiveErrors = 0;

  const shutdown = async () => {
    logger.info("Gracefully shutting down...");
    isRunning = false;
    await rabbitmq.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (isRunning) {
    try {
      const processedCount = await processOutboxBatch();
      consecutiveErrors = 0; // Reset error counter on healthy processing batch
      // If there were events processed, immediately poll for the next batch; otherwise sleep base interval
      if (processedCount === 0) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (err) {
      consecutiveErrors++;
      // Full jitter exponential backoff: min(30000, base * 2^(errors - 1))
      const maxBackoff = Math.min(30000, POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors - 1));
      const delay = Math.floor(Math.random() * maxBackoff);

      logger.error(`Outbox worker loop error (failure #${consecutiveErrors}). Backing off for ${delay}ms:`, { error: err });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

startOutboxWorker();
