/**
 * Helpers for the REST route handlers (src/app/api/v1/**, /api/hooks/**).
 * OWNED BY: Agent C.
 *
 * Every error response has the shape `{ "error": { "code", "message" } }`.
 */
import { ZodError, z } from "zod";
import type { Group } from "@/generated/prisma/client";
import { DomainError } from "@/lib/errors";
import { authenticateBearer } from "@/lib/integrations/tokens";
import "@/lib/integrations/listeners";
import type { ChoreView, CompletionWithMember } from "@/lib/services/chores";

/** An error that becomes a JSON error response. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly headers?: Record<string, string>,
  ) {
    super(message ?? code);
  }
}

const MESSAGES: Record<string, string> = {
  TOKEN_MISSING: "Send an API token as `Authorization: Bearer <token>`.",
  TOKEN_INVALID: "The API token is invalid or has been revoked.",
  TOKEN_GROUP_MISMATCH: "This API token belongs to a different group.",
  CHORE_NOT_FOUND: "No such chore in this group.",
  CHORE_ARCHIVED: "The chore is archived.",
  MEMBER_NOT_FOUND: "No member with that id or name.",
  MEMBER_AMBIGUOUS: "Several members have that name; use the member id.",
  MEMBER_ARCHIVED: "That member is archived.",
  COMPLETION_NOT_FOUND: "No such completion in this group.",
  COMPLETED_AT_OUT_OF_RANGE: "completedAt must be within the last 14 days.",
  HOOK_NOT_FOUND: "Unknown or revoked hook.",
  INVALID_JSON: "The request body is not valid JSON.",
  VALIDATION_FAILED: "The request body is invalid.",
  METHOD_NOT_ALLOWED: "Method not allowed.",
};

const STATUS: Record<DomainError["code"], number> = {
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
};

/** JSON response with no caching. */
export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

/** The standard error response. */
export function errorResponse(status: number, code: string, message?: string, headers?: Record<string, string>) {
  return json({ error: { code, message: message ?? MESSAGES[code] ?? code } }, { status, headers });
}

/** Run a handler, turning ApiError / DomainError / ZodError into JSON errors. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message === err.code ? undefined : err.message, err.headers);
    if (err instanceof DomainError) return errorResponse(STATUS[err.code], err.reason);
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      return errorResponse(400, "VALIDATION_FAILED", `${where}${issue?.message ?? "invalid"}`);
    }
    console.error("[api] unhandled error", err);
    return errorResponse(500, "INTERNAL_ERROR", "Internal server error.");
  }
}

/**
 * Authenticate the bearer token and check it belongs to the group in the
 * path. 401 for a missing/invalid token, 403 for another group's token.
 */
export async function requireApiGroup(request: Request, gid: string): Promise<Group> {
  const auth = await authenticateBearer(request.headers.get("authorization"));
  if (!auth.ok) throw new ApiError(401, auth.reason, undefined, { "WWW-Authenticate": 'Bearer realm="yakka"' });
  if (auth.group.id !== gid) throw new ApiError(403, "TOKEN_GROUP_MISMATCH");
  return auth.group;
}

/** Parse an optional JSON body: empty → {}, invalid → 400 INVALID_JSON, then validate with `schema`. */
export async function readJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  const text = await request.text();
  let value: unknown = {};
  if (text.trim()) {
    try {
      value = JSON.parse(text);
    } catch {
      throw new ApiError(400, "INVALID_JSON");
    }
  }
  return schema.parse(value);
}

/** Best-effort body read for inbound hooks: any body is accepted, JSON objects may carry `member`. */
export async function readLenientMember(request: Request): Promise<string | null> {
  const type = request.headers.get("content-type") ?? "";
  try {
    const text = (await request.text()).slice(0, 10_000);
    if (!text.trim()) return null;
    if (type.includes("application/x-www-form-urlencoded")) {
      return new URLSearchParams(text).get("member")?.trim() || null;
    }
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && "member" in value) {
      const m = (value as { member: unknown }).member;
      return typeof m === "string" && m.trim() ? m.trim().slice(0, 100) : null;
    }
  } catch {
    // Not JSON: ignore the body.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Serialisation (stable public JSON shapes; dates as ISO strings)
// ---------------------------------------------------------------------------

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Public JSON of a completion. */
export function serializeCompletion(c: CompletionWithMember) {
  return {
    id: c.id,
    choreId: c.choreId,
    source: c.source,
    completedAt: iso(c.completedAt),
    createdAt: iso(c.createdAt),
    undoneAt: iso(c.undoneAt),
    note: c.note,
    member: c.member ? { id: c.member.id, name: c.member.name } : null,
  };
}

/** Public JSON of a chore with its computed schedule. */
export function serializeChore(v: ChoreView) {
  return {
    id: v.id,
    title: v.title,
    description: v.description,
    icon: v.icon,
    rrule: v.rrule,
    startsAt: iso(v.startsAt),
    anchor: v.anchor,
    graceMinutes: v.graceMinutes,
    assigneeMode: v.assigneeMode,
    currentAssigneeId: v.currentAssigneeId,
    archived: Boolean(v.archivedAt),
    status: v.schedule.status,
    nextDueAt: iso(v.schedule.nextDueAt),
    overdueAt: iso(v.schedule.overdueAt),
    dueToday: v.schedule.dueToday,
    missedCount: v.schedule.missedCount,
    lastCompletion: v.schedule.lastCompletion ? serializeCompletion(v.schedule.lastCompletion) : null,
  };
}
