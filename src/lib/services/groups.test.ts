import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

const { assertSettingsPin } = await import("./groups");
const { hashPin } = await import("@/lib/ids");
const { pinLimiter } = await import("@/lib/pin-limiter");

describe("assertSettingsPin", () => {
  beforeEach(() => pinLimiter.reset());

  it("refuses further attempts with PIN_LOCKED after 5 wrong PINs, even the right one", async () => {
    const group = { id: "g1", settingsPin: await hashPin("4321") };
    for (let i = 0; i < 5; i++) {
      await expect(assertSettingsPin(group, "0000", { client: "1.2.3.4" })).rejects.toMatchObject({ reason: "PIN_INVALID" });
    }
    await expect(assertSettingsPin(group, "4321", { client: "1.2.3.4" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      reason: "PIN_LOCKED",
      retryAfterSeconds: 30,
    });
    // Another client can still use the right PIN.
    await expect(assertSettingsPin(group, "4321", { client: "5.6.7.8" })).resolves.toBeUndefined();
  });

  it("is a no-op without a PIN", async () => {
    await expect(assertSettingsPin({ id: "g2", settingsPin: null }, undefined)).resolves.toBeUndefined();
  });
});
