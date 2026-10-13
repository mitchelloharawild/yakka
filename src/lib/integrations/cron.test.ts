import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  groups: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    systemState: { findUnique: mocks.findUnique, upsert: mocks.upsert },
    group: { findMany: mocks.groups, deleteMany: vi.fn(async () => ({ count: 0 })) },
    webhookDelivery: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    choreNotice: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  },
}));

const { LAST_TICK_KEY, lookbackSince, MAX_LOOKBACK_MS, MIN_LOOKBACK_MS, runCronTick } = await import("./cron");

const now = new Date("2026-10-13T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 60 * 60_000;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.groups.mockResolvedValue([]);
  mocks.upsert.mockResolvedValue({});
});

describe("lookbackSince", () => {
  it("starts at the previous tick, clamped to [15 min, 24 h]", () => {
    expect(lookbackSince(now, ago(2 * HOUR))).toEqual(ago(2 * HOUR));
    expect(lookbackSince(now, ago(60_000))).toEqual(ago(MIN_LOOKBACK_MS));
    expect(lookbackSince(now, ago(3 * 24 * HOUR))).toEqual(ago(MAX_LOOKBACK_MS));
    expect(lookbackSince(now, null)).toEqual(ago(MIN_LOOKBACK_MS));
  });
});

describe("runCronTick", () => {
  it("looks back to the last tick stored in the database (cold start), then stores this one", async () => {
    // An external scheduler that runs every 6 hours: a fresh process must not only look back 15 min.
    mocks.findUnique.mockResolvedValue({ key: LAST_TICK_KEY, value: ago(6 * HOUR).toISOString() });
    const res = await runCronTick({ now });
    expect(res.since).toBe(ago(6 * HOUR).toISOString());
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: LAST_TICK_KEY }, update: { value: now.toISOString() } }),
    );
  });

  it("first run ever looks back only the minimum window", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await runCronTick({ now });
    expect(res.since).toBe(ago(MIN_LOOKBACK_MS).toISOString());
  });

  it("doesn't move the window forward when detection fails", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.groups.mockRejectedValue(new Error("db down"));
    await expect(runCronTick({ now })).rejects.toThrow("db down");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
