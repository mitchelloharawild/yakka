import { describe, expect, it } from "vitest";
import { currentAssigneeId, rotationOrder } from "./assignee";

const d = (n: number) => new Date(Date.UTC(2026, 0, n));
const alice = { id: "a", createdAt: d(1), archivedAt: null };
const bob = { id: "b", createdAt: d(2), archivedAt: null };
const carol = { id: "c", createdAt: d(3), archivedAt: null };
const dave = { id: "d", createdAt: d(4), archivedAt: d(5) };
const members = [carol, dave, alice, bob];

describe("rotationOrder", () => {
  it("drops archived members and orders by createdAt", () => {
    expect(rotationOrder(members).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("currentAssigneeId", () => {
  it("ANYONE is null", () => {
    expect(currentAssigneeId({ chore: { assigneeMode: "ANYONE", assigneeId: "a" }, members, lastCompletedBy: "a" })).toBeNull();
  });

  it("FIXED returns the assignee unless archived", () => {
    expect(currentAssigneeId({ chore: { assigneeMode: "FIXED", assigneeId: "b" }, members, lastCompletedBy: null })).toBe("b");
    expect(currentAssigneeId({ chore: { assigneeMode: "FIXED", assigneeId: "d" }, members, lastCompletedBy: null })).toBeNull();
    expect(currentAssigneeId({ chore: { assigneeMode: "FIXED", assigneeId: null }, members, lastCompletedBy: null })).toBeNull();
  });

  it("ROUND_ROBIN starts with assigneeId or the first member", () => {
    expect(currentAssigneeId({ chore: { assigneeMode: "ROUND_ROBIN", assigneeId: null }, members, lastCompletedBy: null })).toBe("a");
    expect(currentAssigneeId({ chore: { assigneeMode: "ROUND_ROBIN", assigneeId: "c" }, members, lastCompletedBy: null })).toBe("c");
    expect(currentAssigneeId({ chore: { assigneeMode: "ROUND_ROBIN", assigneeId: "d" }, members, lastCompletedBy: null })).toBe("a");
  });

  it("ROUND_ROBIN advances past the last completer and wraps", () => {
    const chore = { assigneeMode: "ROUND_ROBIN" as const, assigneeId: null };
    expect(currentAssigneeId({ chore, members, lastCompletedBy: "a" })).toBe("b");
    expect(currentAssigneeId({ chore, members, lastCompletedBy: "b" })).toBe("c");
    expect(currentAssigneeId({ chore, members, lastCompletedBy: "c" })).toBe("a");
  });

  it("ROUND_ROBIN falls back when the last completer is not in rotation", () => {
    const chore = { assigneeMode: "ROUND_ROBIN" as const, assigneeId: "b" };
    expect(currentAssigneeId({ chore, members, lastCompletedBy: "d" })).toBe("b");
    expect(currentAssigneeId({ chore, members, lastCompletedBy: null })).toBe("b");
  });

  it("ROUND_ROBIN with no active members is null", () => {
    expect(currentAssigneeId({ chore: { assigneeMode: "ROUND_ROBIN", assigneeId: null }, members: [dave], lastCompletedBy: null })).toBeNull();
  });
});
