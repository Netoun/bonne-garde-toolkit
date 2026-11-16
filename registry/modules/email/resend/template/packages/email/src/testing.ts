import type { EmailMessage } from "./types";

/**
 * Every email the memory adapter was asked to send under `NODE_ENV=test`, in the order it was asked:
 * what `runtime.ts` writes to instead of the network. A test reads it to see what a flow delivered,
 * and clears it first so that it sees only its own.
 */
export const outbox: EmailMessage[] = [];

export function clearOutbox(): void {
  outbox.length = 0;
}
