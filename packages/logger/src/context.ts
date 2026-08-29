import { AsyncLocalStorage } from "async_hooks";

export const CORRELATION_ID_HEADER = "x-correlation-id";

export interface LogContext {
  correlationId?: string;
  organizationId?: string;
  userId?: string;
  membershipId?: string;
  action?: string;
  [key: string]: any;
}

const asyncLocalStorage = new AsyncLocalStorage<LogContext>();

/**
 * Runs a function within an explicit logging context.
 */
export function runWithContext<T>(context: LogContext, fn: () => T): T {
  const current = asyncLocalStorage.getStore() || {};
  return asyncLocalStorage.run({ ...current, ...context }, fn);
}

/**
 * Retrieves the current active log context from AsyncLocalStorage.
 */
export function getContext(): LogContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Updates or merges key-value pairs into the current active context.
 */
export function setContext(updates: Partial<LogContext>): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    Object.assign(store, updates);
  }
}
