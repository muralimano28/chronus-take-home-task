import winston from "winston";
import { getContext } from "./context";

export * from "./context";

const isProduction = process.env.NODE_ENV === "production";
const logLevel = process.env.LOG_LEVEL || (isProduction ? "info" : "debug");

/**
 * Custom Winston format that automatically pulls active correlation context from AsyncLocalStorage.
 */
const appendContextFormat = winston.format((info) => {
  const context = getContext();
  if (context) {
    // Merge context fields in-place while preserving Winston internal Symbol properties and explicit metadata
    Object.assign(info, { ...context, ...info });
  }
  return info;
});

// ANSI color codes for clean terminal highlighting in development
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

const levelColorMap: Record<string, string> = {
  error: colors.red,
  warn: colors.yellow,
  info: colors.green,
  http: colors.magenta,
  debug: colors.blue,
};

/**
 * Creates a Winston logger instance configured for the specified service name.
 */
export function createLogger(serviceName: string = "chronus-service") {
  return winston.createLogger({
    level: logLevel,
    defaultMeta: { service: serviceName },
    format: winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
      winston.format.errors({ stack: true }),
      appendContextFormat(),
      isProduction
        ? winston.format.json()
        : winston.format.printf((info) => {
            const { timestamp, level, message, service, correlationId, ...rest } = info;
            const lvlColor = levelColorMap[level] || colors.cyan;
            const formattedLevel = `${lvlColor}${colors.bold}${level.toUpperCase().padEnd(5)}${colors.reset}`;
            const formattedTime = `${colors.gray}${timestamp}${colors.reset}`;
            const srv = service ? `${colors.magenta}[${service}]${colors.reset} ` : "";
            const cid = correlationId ? `${colors.cyan}[cid:${correlationId}]${colors.reset} ` : "";
            const extra = Object.keys(rest).length ? ` ${colors.dim}${JSON.stringify(rest)}${colors.reset}` : "";
            const stack = info.stack ? `\n${colors.red}${info.stack}${colors.reset}` : "";

            return `${formattedTime} ${formattedLevel} ${srv}${cid}${message}${extra}${stack}`;
          })
    ),
    transports: [
      new winston.transports.Console()
    ],
  });
}

/**
 * Default shared singleton logger
 */
export const logger = createLogger(process.env.SERVICE_NAME || "chronus-app");
export default logger;
