import { ElysiaCustomStatusResponse, status } from "elysia";
import { logger } from "./logger";

interface ErrorContext {
  error: unknown;
  request: Request;
}

/**
 * HTTP status of an error, read from the error itself: the `code` of a thrown `status(...)`, the
 * `status` of Elysia's error classes, 500 otherwise. Never from the context `code`: Elysia copies
 * a numeric `error.code` (a driver's errno, a `DOMException`) there.
 */
function httpStatus(error: unknown): number {
  if (error instanceof ElysiaCustomStatusResponse) return error.code;
  if (typeof error === "object" && error !== null && "status" in error) {
    if (typeof error.status === "number") return error.status;
  }
  return 500;
}

/**
 * Elysia `onError` handler of the app: an error below 500 (validation, not found, parse, a thrown
 * `status(4xx)`) is left to Elysia; anything else is logged once and answered with an opaque 500.
 */
export function handleError(context: ErrorContext) {
  if (httpStatus(context.error) < 500) return;
  const { method, url } = context.request;
  logger.error("Unhandled error", context.error, { method, path: new URL(url).pathname });
  return status(500, { error: "Internal Server Error" });
}
