import { env } from "./config/env";
import { prisma } from "@chronus/db";
import { rabbitmq, MENTORING_EVENT_TOPOLOGY } from "@chronus/rabbitmq";

const POLL_INTERVAL_MS = env.POLL_INTERVAL_MS;
const BATCH_SIZE = env.BATCH_SIZE;

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

  console.log(`[Outbox Worker] Connected to RabbitMQ.`);
  console.log(`[Outbox Worker] Topology asserted: Exchange '${MENTORING_EVENT_TOPOLOGY.EXCHANGE}' <-> Queue '${MENTORING_EVENT_TOPOLOGY.NOTIFICATION_EMAIL_QUEUE}' bound to '${MENTORING_EVENT_TOPOLOGY.ROUTING_KEY_BOOKINGS}'`);
}

/**
 * Reads pending OutboxEvent records from the database and publishes them to RabbitMQ.
 * Uses PostgreSQL's FOR UPDATE SKIP LOCKED to safely support multiple concurrent worker replicas.
 */
async function processOutboxBatch(): Promise<number> {
  // 1. Atomically claim oldest pending outbox events skipping any records locked by concurrent workers
  const pendingEvents = await prisma.$queryRaw<
    Array<{
      id: string;
      eventType: string;
      aggregateId: string;
      payload: any;
      status: string;
      createdAt: Date;
      publishedAt: Date | null;
    }>
  >`
    SELECT id, "eventType", "aggregateId", payload, status, "createdAt", "publishedAt"
    FROM "OutboxEvent"
    WHERE status = 'PENDING'
    ORDER BY "createdAt" ASC
    LIMIT ${BATCH_SIZE}
    FOR UPDATE SKIP LOCKED
  `;

  if (pendingEvents.length === 0) {
    return 0;
  }

  console.log(`[Outbox Worker] Claimed ${pendingEvents.length} pending event(s) to publish.`);

  for (const event of pendingEvents) {
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
          eventType: event.eventType,
          aggregateId: event.aggregateId,
          payload: event.payload,
          createdAt: event.createdAt,
        }
      );

      // 3. Mark event as PUBLISHED in the database
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      });

      console.log(`[Outbox Worker] Successfully published event ${event.id} (${event.eventType}) to routing key '${routingKey}'`);
    } catch (err) {
      console.error(`[Outbox Worker Error] Failed to publish event ${event.id}:`, err);
      // Leave status as PENDING so it will be retried in subsequent poll cycles
    }
  }

  return pendingEvents.length;
}

/**
 * Main polling loop for the outbox publisher worker.
 */
async function startOutboxWorker() {
  console.log("🚀 [Outbox Worker] Starting transactional outbox publisher service...");

  try {
    await initTopology();
  } catch (err) {
    console.error("[Outbox Worker Error] Failed initial connection to RabbitMQ. Retrying in background...", err);
  }

  let isRunning = true;

  const shutdown = async () => {
    console.log("\n🛑 [Outbox Worker] Gracefully shutting down...");
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
      // If there were events processed, immediately poll for the next batch; otherwise sleep
      if (processedCount === 0) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (err) {
      console.error("[Outbox Worker Loop Error]:", err);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

startOutboxWorker();
