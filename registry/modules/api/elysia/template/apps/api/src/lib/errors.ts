import { status } from "elysia";
import { logger } from "./logger";

interface ErrorContext {
  code: string | number;
  error: unknown;
  request: Request;
}

/** HTTP status an Elysia error carries: the numeric `code` of a thrown `status(...)`, the `status` of Elysia's error classes, 500 otherwise. */
function httpStatus({ code, error }: Pick<ErrorContext, "code" | "error">): number {
  if (typeof code === "number") return code;
  if (typeof error === "object" && error !== null) {
    if ("status" in error && typeof error.status === "number") return error.status;
    if ("code" in error && typeof error.code === "number") return error.code;
  }
  return 500;
}

/**
 * Elysia `onError` handler of the app: an error below 500 (validation, not found, parse, a thrown
 * `status(4xx)`) is left to Elysia; anything else is logged once and answered with an opaque 500.
 */
export function handleError(context: ErrorContext) {
  if (httpStatus(context) < 500) return;
  const { method, url } = context.request;
  logger.error("Unhandled error", context.error, { method, path: new URL(url).pathname });
  return status(500, { error: "Internal Server Error" });
}
