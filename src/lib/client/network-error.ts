import { TRPCClientError } from "@trpc/client";

/**
 * True when a request failed to reach the server at all (offline, DNS,
 * connection refused), as opposed to the server answering with an error.
 * Those are the failures worth queueing for an offline replay.
 */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return err instanceof TRPCClientError ? !err.data && !err.shape : err instanceof TypeError;
}
