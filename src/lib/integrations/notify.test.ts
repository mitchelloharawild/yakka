import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { sendExternalNotice } from "./notify";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvCache();
});

describe("sendExternalNotice", () => {
  it("does nothing unless NTFY_URL / APPRISE_URL is set", async () => {
    vi.stubEnv("NTFY_URL", "");
    vi.stubEnv("APPRISE_URL", "");
    resetEnvCache();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await sendExternalNotice({ title: "Bins", body: "Overdue", url: "/groups/x" })).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it("puts the group name in the title for both sinks", async () => {
    vi.stubEnv("NTFY_URL", "https://ntfy.example/chores");
    vi.stubEnv("APPRISE_URL", "http://apprise:8000/notify/yakka");
    resetEnvCache();
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await sendExternalNotice({ title: "Bins", body: "Overdue", url: "/groups/x", groupName: "Flat 4" });
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    const ntfy = calls.find(([u]) => u.startsWith("https://ntfy"))!;
    expect((ntfy[1].headers as Record<string, string>).Title).toBe("Flat 4: Bins");
    const apprise = calls.find(([u]) => u.startsWith("http://apprise"))!;
    expect(JSON.parse(apprise[1].body as string).title).toBe("Flat 4: Bins");
  });
});
