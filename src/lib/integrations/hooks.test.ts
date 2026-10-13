import { describe, expect, it, vi } from "vitest";

const SECRET = "AbCdEfGhIjKlMnOpQrStUv12";
vi.mock("@/lib/db", () => ({
  prisma: {
    inboundHook: {
      findMany: vi.fn(async () => [
        { id: "h1", groupId: "g", choreId: "c", name: null, secret: SECRET, revokedAt: null, chore: {}, defaultMember: null },
      ]),
      findFirst: vi.fn(async () => ({ id: "h1", secret: SECRET })),
    },
  },
}));

const { listInboundHooks, revealInboundHook } = await import("./hooks");

describe("inbound hooks", () => {
  it("lists hooks without the secret, with a masked URL", async () => {
    const [hook] = await listInboundHooks("g");
    expect(JSON.stringify(hook)).not.toContain(SECRET);
    expect(hook).not.toHaveProperty("secret");
    expect(hook).not.toHaveProperty("url");
    expect(hook.maskedUrl).toMatch(/\/api\/hooks\/AbCd•+$/);
  });
  it("reveals the full URL", async () => {
    expect((await revealInboundHook("g", "h1")).url).toMatch(new RegExp(`/api/hooks/${SECRET}$`));
  });
});
