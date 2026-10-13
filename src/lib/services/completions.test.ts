import { beforeEach, describe, expect, it, vi } from "vitest";

// undoCompletion() against a fake Prisma client: we only need to see which
// writes happen, not a real database.
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  emitEvent: vi.fn(),
  logActivity: vi.fn(),
  getChoreView: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const completion = {
    findFirst: mocks.findFirst,
    findUniqueOrThrow: mocks.findUniqueOrThrow,
    updateMany: mocks.updateMany,
    update: mocks.update,
  };
  return { prisma: { completion, $transaction: (fn: (tx: unknown) => unknown) => fn({ completion }) } };
});
vi.mock("@/lib/events", () => ({ emitEvent: mocks.emitEvent }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/services/chores", () => ({ getChoreView: mocks.getChoreView }));

const { undoCompletion } = await import("./completions");

const now = new Date("2026-10-09T10:00:00Z");
const group = { id: "g1", name: "Home", timezone: "UTC", undoSeconds: 10, deletedAt: null };
const chore = { id: "c1", title: "Bins", icon: null, group };
const row = { id: "k1", choreId: "c1", completedAt: now, createdAt: now, undoneAt: null, member: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue({ ...row, chore });
  mocks.update.mockResolvedValue({ ...row, undoneAt: now });
  mocks.findUniqueOrThrow.mockResolvedValue({ ...row, undoneAt: now });
  mocks.getChoreView.mockResolvedValue({ id: "c1", schedule: { nextDueAt: null } });
});

describe("undoCompletion", () => {
  it("emits chore.undone and logs once when it wins the update", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const res = await undoCompletion({ completionId: "k1", groupId: "g1", enforceWindow: false, now });
    expect(res.alreadyUndone).toBe(false);
    expect(mocks.emitEvent).toHaveBeenCalledTimes(1);
    expect(mocks.logActivity).toHaveBeenCalledTimes(1);
  });

  it("does not emit or log when a concurrent undo got there first", async () => {
    // Both requests read undoneAt = null; the other one's conditional update won.
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const res = await undoCompletion({ completionId: "k1", groupId: "g1", enforceWindow: false, now });
    expect(res.alreadyUndone).toBe(true);
    expect(mocks.emitEvent).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
