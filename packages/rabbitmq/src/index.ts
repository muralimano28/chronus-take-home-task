import * as amqp from "amqplib";
import type { ConfirmChannel, ChannelModel, ConsumeMessage, Options } from "amqplib";
import { config } from "dotenv";
import { resolve } from "path";
import { createLogger } from "@chronus/logger";

const logger = createLogger("rabbitmq");

config({ path: resolve(__dirname, "../../../.env") });

export interface RabbitMQConfig {
  url?: string;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
}

export interface QueueTopologyOptions {
  queueName: string;
  exchangeName?: string;
  routingKey?: string;
  dlxExchangeName?: string;
  dlxQueueName?: string;
  dlxRoutingKey?: string;
  maxRetries?: number;
  messageTtlMs?: number;
}

export const MENTORING_EVENT_TOPOLOGY = {
  EXCHANGE: "mentoring.events",
  NOTIFICATION_EMAIL_QUEUE: "notification.email.queue",
  ROUTING_KEY_BOOKINGS: "booking.*",
  ROUTING_KEY_ALL: "#",
} as const;

export interface ConsumeOptions extends Omit<Options.Consume, "noAck"> {
  prefetch?: number;
  /**
   * If true, messages are auto-acknowledged upon delivery.
   * If false (default), manual acknowledgment is required (and unhandled errors route to DLQ).
   */
  autoAck?: boolean;
  /**
   * Standard amqplib option alias for backwards compatibility.
   */
  noAck?: boolean;
}

interface RegisteredConsumer {
  queueName: string;
  onMessage: (data: any, rawMessage: ConsumeMessage) => Promise<void>;
  options?: ConsumeOptions;
}

export class RabbitMQClient {
  private url: string;
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private isConnecting: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectIntervalMs: number;
  private maxReconnectAttempts: number;
  private isClosedManually: boolean = false;
  private registeredConsumers: Map<string, RegisteredConsumer> = new Map();
  private registeredTopologies: Map<string, QueueTopologyOptions> = new Map();

  constructor(config?: RabbitMQConfig) {
    this.url = config?.url || process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
    this.reconnectIntervalMs = config?.reconnectIntervalMs || 1000;
    this.maxReconnectAttempts = config?.maxReconnectAttempts ?? 10;
  }

  /**
   * Initializes connection and channel with auto-reconnection listeners.
   */
  async connect(): Promise<ConfirmChannel> {
    if (this.channel) {
      return this.channel;
    }

    if (this.isConnecting) {
      // Wait for ongoing connection attempt to resolve
      return new Promise((resolve, reject) => {
        const interval = setInterval(() => {
          if (this.channel) {
            clearInterval(interval);
            resolve(this.channel);
          }
        }, 100);
        setTimeout(() => {
          clearInterval(interval);
          reject(new Error("Timeout waiting for RabbitMQ connection."));
        }, 10000);
      });
    }

    this.isConnecting = true;
    this.isClosedManually = false;

    try {
      this.connection = await amqp.connect(this.url);
      this.reconnectAttempts = 0;

      this.connection.on("error", (err) => {
        logger.error(`Connection error: ${err.message}`, { error: err });
      });

      this.connection.on("close", () => {
        if (!this.isClosedManually) {
          logger.warn("Connection closed. Attempting reconnect...");
          this.handleReconnect();
        }
      });

      this.channel = await this.connection.createConfirmChannel();
      this.channel.on("error", (err) => {
        logger.error(`Channel error: ${err.message}`, { error: err });
      });

      this.channel.on("close", () => {
        this.channel = null;
      });

      this.isConnecting = false;

      // Re-assert previously registered topologies
      for (const topology of this.registeredTopologies.values()) {
        await this.setupTopologyOnChannel(this.channel, topology);
      }

      // Re-register all consumers onto the new channel
      for (const consumer of this.registeredConsumers.values()) {
        await this.setupConsumerOnChannel(this.channel, consumer);
      }

      return this.channel;
    } catch (err: any) {
      this.isConnecting = false;
      logger.error(`Initial connection failed: ${err.message}`, { error: err });
      this.handleReconnect();
      throw err;
    }
  }

  /**
   * Full jitter exponential backoff auto-reconnect strategy.
   */
  private handleReconnect(): void {
    if (this.isClosedManually) return;
    this.connection = null;
    this.channel = null;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`Max RabbitMQ reconnect attempts (${this.maxReconnectAttempts}) reached. Stopping reconnect loop.`);
      return;
    }

    this.reconnectAttempts++;
    // Full jitter exponential backoff: random between [0, min(30000, base * 2^(attempt - 1))]
    const maxBackoff = Math.min(30000, this.reconnectIntervalMs * Math.pow(2, this.reconnectAttempts - 1));
    const delay = Math.floor(Math.random() * maxBackoff);

    logger.info(`Retrying RabbitMQ connection in ${delay}ms (Attempt #${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    setTimeout(async () => {
      try {
        await this.connect();
        logger.info("Successfully reconnected to broker and re-registered consumers.");
      } catch {
        // Next attempt triggered by handleReconnect in catch
      }
    }, delay);
  }

  /**
   * Internal helper to assert topology on a specific channel.
   */
  private async setupTopologyOnChannel(ch: ConfirmChannel, options: QueueTopologyOptions): Promise<{ queue: string; dlq: string }> {
    const {
      queueName,
      exchangeName,
      routingKey = queueName,
      dlxExchangeName = `${queueName}.dlx`,
      dlxQueueName = `${queueName}.dlq`,
      dlxRoutingKey = `${queueName}.dead`,
      messageTtlMs,
    } = options;

    // 1. Assert Dead Letter Exchange and Queue
    await ch.assertExchange(dlxExchangeName, "direct", { durable: true });
    await ch.assertQueue(dlxQueueName, { durable: true });
    await ch.bindQueue(dlxQueueName, dlxExchangeName, dlxRoutingKey);

    // 2. Assert Primary Queue with dead-letter forwarding arguments
    const queueArgs: Record<string, any> = {
      "x-dead-letter-exchange": dlxExchangeName,
      "x-dead-letter-routing-key": dlxRoutingKey,
    };

    if (messageTtlMs) {
      queueArgs["x-message-ttl"] = messageTtlMs;
    }

    await ch.assertQueue(queueName, {
      durable: true,
      arguments: queueArgs,
    });

    // 3. If primary exchange provided, bind it
    if (exchangeName) {
      await ch.assertExchange(exchangeName, "topic", { durable: true });
      await ch.bindQueue(queueName, exchangeName, routingKey);
    }

    return { queue: queueName, dlq: dlxQueueName };
  }

  /**
   * Sets up a resilient queue topology with Dead Letter Exchange (DLX) & Dead Letter Queue (DLQ).
   */
  async assertTopology(options: QueueTopologyOptions): Promise<{ queue: string; dlq: string }> {
    this.registeredTopologies.set(options.queueName, options);
    const ch = await this.getChannel();
    return this.setupTopologyOnChannel(ch, options);
  }

  /**
   * Publishes a message to a queue or exchange with publisher confirms and persistent delivery.
   * Resolves only after RabbitMQ broker acknowledges message persistence (ACK), rejects if NACKed.
   */
  async publish(
    exchangeOrQueue: { exchange?: string; routingKey: string } | string,
    message: Record<string, any>,
    options?: Options.Publish
  ): Promise<boolean> {
    const ch = await this.getChannel();
    const payloadBuffer = Buffer.from(JSON.stringify(message));

    const publishOptions: Options.Publish = {
      persistent: true,
      timestamp: Date.now(),
      contentType: "application/json",
      ...options,
    };

    return new Promise<boolean>((resolve, reject) => {
      const confirmCallback = (err: any) => {
        if (err) {
          logger.error("RabbitMQ publisher confirmation failed (NACK or error):", { error: err });
          reject(err);
        } else {
          resolve(true);
        }
      };

      if (typeof exchangeOrQueue === "string") {
        // Direct send to queue with publisher confirm callback
        ch.sendToQueue(exchangeOrQueue, payloadBuffer, publishOptions, confirmCallback);
      } else {
        // Publish to exchange with routing key and publisher confirm callback
        ch.publish(
          exchangeOrQueue.exchange || "",
          exchangeOrQueue.routingKey,
          payloadBuffer,
          publishOptions,
          confirmCallback
        );
      }
    });
  }

  /**
   * Internal helper to register a consumer on a specific channel.
   */
  private async setupConsumerOnChannel(ch: ConfirmChannel, consumer: RegisteredConsumer): Promise<void> {
    const { queueName, onMessage, options } = consumer;
    const isAutoAck = options?.autoAck === true || options?.noAck === true;

    if (options?.prefetch) {
      await ch.prefetch(options.prefetch);
    }

    await ch.consume(
      queueName,
      async (msg) => {
        if (!msg) return;

        try {
          const content = JSON.parse(msg.content.toString("utf-8"));
          await onMessage(content, msg);

          if (!isAutoAck) {
            ch.ack(msg);
          }
        } catch (err) {
          logger.error(`Failed processing message on queue ${queueName}:`, { error: err });
          // Only nack with requeue=false if manual acknowledgment is enabled (routes to DLQ)
          if (!isAutoAck) {
            ch.nack(msg, false, false);
          }
        }
      },
      {
        ...options,
        noAck: isAutoAck,
      }
    );
  }

  /**
   * Consumes messages with error handling, automatic acknowledgements, and DLQ dead-lettering.
   * Consumer registrations are retained and automatically re-attached upon reconnects.
   */
  async consume<T = any>(
    queueName: string,
    onMessage: (data: T, rawMessage: ConsumeMessage) => Promise<void>,
    options?: ConsumeOptions
  ): Promise<void> {
    const consumer: RegisteredConsumer = { queueName, onMessage, options };
    this.registeredConsumers.set(queueName, consumer);

    const ch = await this.getChannel();
    await this.setupConsumerOnChannel(ch, consumer);
  }

  /**
   * Returns active channel, auto-connecting if necessary.
   */
  async getChannel(): Promise<ConfirmChannel> {
    if (!this.channel || !this.connection) {
      return this.connect();
    }
    return this.channel;
  }

  /**
   * Closes channel and connection gracefully.
   */
  async close(): Promise<void> {
    this.isClosedManually = true;
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } finally {
      this.channel = null;
      this.connection = null;
    }
  }
}

// Export singleton instance for global convenience
export const rabbitmq = new RabbitMQClient();
