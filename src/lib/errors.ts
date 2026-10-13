/** Error codes thrown by the domain layer; the tRPC layer maps them to TRPCError codes. */
export type DomainErrorCode = "NOT_FOUND" | "BAD_REQUEST" | "FORBIDDEN" | "CONFLICT" | "TOO_MANY_REQUESTS";

/**
 * An expected, user-facing failure from src/lib/services/*. `reason` is a
 * stable machine-readable string (e.g. "UNDO_WINDOW_EXPIRED") that UI code
 * can switch on and translate.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    public readonly reason: string,
    message?: string,
    /** For TOO_MANY_REQUESTS: seconds until the client may try again (sent as `data.retryAfterSeconds`). */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message ?? reason);
    this.name = "DomainError";
  }
}

/** Shorthand for `new DomainError("NOT_FOUND", reason)`. */
export function notFound(reason: string): DomainError {
  return new DomainError("NOT_FOUND", reason);
}
