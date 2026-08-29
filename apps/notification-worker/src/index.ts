import { env } from "./config/env";
import { rabbitmq, MENTORING_EVENT_TOPOLOGY } from "@chronus/rabbitmq";
import { emailService, BookingEventPayload } from "./services/email.service";
import { createLogger, runWithContext } from "@chronus/logger";

const logger = createLogger("notification-worker");

/**
 * Main consumer loop for the notification worker.
 */
async function startNotificationWorker() {
  logger.info("Starting email notification consumer service...");

  // 1. Ensure RabbitMQ topology is asserted
  try {
    await rabbitmq.assertTopology({
      queueName: MENTORING_EVENT_TOPOLOGY.NOTIFICATION_EMAIL_QUEUE,
      exchangeName: MENTORING_EVENT_TOPOLOGY.EXCHANGE,
      routingKey: MENTORING_EVENT_TOPOLOGY.ROUTING_KEY_BOOKINGS,
    });
    logger.info(`Connected to RabbitMQ. Listening on queue '${MENTORING_EVENT_TOPOLOGY.NOTIFICATION_EMAIL_QUEUE}'`);
  } catch (err) {
    logger.error("Initial topology setup failed. Will auto-retry on connect:", { error: err });
  }

  // 2. Register graceful shutdown
  let isRunning = true;
  const shutdown = async () => {
    logger.info("Gracefully shutting down...");
    isRunning = false;
    await rabbitmq.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // 3. Start consuming messages with prefetch, manual acks, and automatic DLQ dead-lettering on uncaught errors
  await rabbitmq.consume<BookingEventPayload>(
    MENTORING_EVENT_TOPOLOGY.NOTIFICATION_EMAIL_QUEUE,
    async (event, rawMessage) => {
      const correlationId = (event as any).correlationId || event.id;

      await runWithContext({ correlationId, eventType: event.eventType, aggregateId: event.aggregateId }, async () => {
        logger.info(`Processing event: ${event.eventType} (ID: ${event.id})`);

        // Dispatch localized emails to member and mentor using self-contained payload
        await emailService.handleBookingNotification(event);

        logger.info(`Successfully processed and notified for event: ${event.id}`);
      });
    },
    {
      prefetch: env.PREFETCH_COUNT,
      autoAck: false, // Guarantees message acknowledgment only after successful email dispatch
    }
  );
}

startNotificationWorker();
