type Level = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: Level;
  time: string;
  msg: string;
  [key: string]: unknown;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { raw: String(err) };
}

function emit(level: Level, msg: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    time: new Date().toISOString(),
    msg,
    ...context,
  };
  const line = JSON.stringify(entry);
  console[level](line);
}

function createLogger() {
  return {
    debug(msg: string, context?: Record<string, unknown>): void {
      emit("debug", msg, context);
    },
    info(msg: string, context?: Record<string, unknown>): void {
      emit("info", msg, context);
    },
    warn(msg: string, context?: Record<string, unknown>): void {
      emit("warn", msg, context);
    },
    error(msg: string, err?: unknown, context?: Record<string, unknown>): void {
      emit("error", msg, {
        ...(err !== undefined ? { error: serializeError(err) } : {}),
        ...context,
      });
    },
  };
}

export { createLogger };
export const logger = createLogger();
