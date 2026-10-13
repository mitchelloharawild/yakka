import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    webhookDelivery: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    webhook: { update: mocks.update },
    $transaction: vi.fn(async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : undefined)),
  },
}));

const { processDueDeliveries, redactTestResult, sendSigned } = await import("./webhooks");
const { CLAIM_LEASE_MS } = await import("./backoff");
const { DESTINATION_NOT_ALLOWED } = await import("./url-safety");

let server: Server;
let port: number;
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    req.resume();
    res.statusCode = req.headers["x-yakka-event"] === "teapot" ? 418 : 204;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  hits = 0;
  vi.clearAllMocks();
});

const body = (url: string, event = "ping") => ({ url, secret: "whsec_x", event, deliveryId: "d1", rawBody: "{}" });

describe("sendSigned", () => {
  it("delivers to a private address when private networks are allowed", async () => {
    const res = await sendSigned(body(`http://127.0.0.1:${port}/hook`), { allowPrivate: true });
    expect(res).toMatchObject({ ok: true, status: 204 });
    expect(hits).toBe(1);
  });

  it("refuses IP literals in private ranges, including IPv4-mapped IPv6", async () => {
    for (const host of ["127.0.0.1", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "localhost"]) {
      const res = await sendSigned(body(`http://${host}:${port}/hook`), { allowPrivate: false });
      expect(res, host).toMatchObject({ ok: false, status: null, error: DESTINATION_NOT_ALLOWED });
    }
    expect(hits).toBe(0);
  });

  it("checks the address it actually connects to (DNS rebinding)", async () => {
    // Resolution happens once, inside the socket's lookup, and that answer is
    // both checked and connected to: there is no earlier "check" lookup an
    // attacker's DNS could answer differently.
    const resolver = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
    const res = await sendSigned(body(`http://rebind.example:${port}/hook`), { allowPrivate: false, resolver });
    expect(res).toMatchObject({ ok: false, error: DESTINATION_NOT_ALLOWED });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(hits).toBe(0);
  });

  it("connects to the resolved (allowed) address", async () => {
    const resolver = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
    const res = await sendSigned(body(`http://my-ha.lan:${port}/hook`, "teapot"), { allowPrivate: true, resolver });
    expect(res).toMatchObject({ ok: false, status: 418, error: "HTTP 418" });
    expect(resolver).toHaveBeenCalledWith("my-ha.lan");
    expect(hits).toBe(1);
  });

  it("refuses a host if any resolved address is private", async () => {
    const resolver = vi.fn(async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "::ffff:7f00:1", family: 6 },
    ]);
    const res = await sendSigned(body(`http://mixed.example:${port}/`), { allowPrivate: false, resolver });
    expect(res.error).toBe(DESTINATION_NOT_ALLOWED);
  });
});

describe("redactTestResult", () => {
  it("hides status codes and error details", () => {
    expect(redactTestResult({ ok: false, status: 418, error: "HTTP 418", durationMs: 12 })).toEqual({
      ok: false,
      status: null,
      error: "Delivery failed",
      durationMs: 0,
    });
    expect(redactTestResult({ ok: false, status: null, error: "connect ECONNREFUSED 10.0.0.5:22", durationMs: 3 }).error).toBe(
      "Delivery failed",
    );
    expect(redactTestResult({ ok: true, status: 204, error: null, durationMs: 40 })).toMatchObject({ ok: true, status: null });
  });
});

describe("processDueDeliveries", () => {
  it("starts each claim's lease at claim time, not at the start of the run", async () => {
    const runStart = new Date("2026-10-09T10:00:00Z");
    // The third row is claimed 5 minutes into the sweep (slow receivers before it).
    const claimTimes = [runStart, new Date(runStart.getTime() + 60_000), new Date(runStart.getTime() + 5 * 60_000)];
    let tick = 0;
    const clock = () => claimTimes[Math.min(tick++, claimTimes.length - 1)];
    mocks.findMany.mockResolvedValue([
      { id: "a", nextAttemptAt: runStart },
      { id: "b", nextAttemptAt: runStart },
      { id: "c", nextAttemptAt: runStart },
    ]);
    mocks.updateMany.mockResolvedValue({ count: 0 }); // lost every claim: we only inspect the lease
    await processDueDeliveries({ now: runStart, concurrency: 1, clock });
    const leases = mocks.updateMany.mock.calls.map(([arg]) => (arg as { data: { nextAttemptAt: Date } }).data.nextAttemptAt);
    expect(leases.map((d) => d.getTime() - CLAIM_LEASE_MS)).toEqual(claimTimes.map((d) => d.getTime()));
  });
});
