import { beforeEach, describe, expect, it, vi } from "vitest";

// importGroup() against a fake transaction client that records writes and
// hands out sequential ids, so we can check the remapping.
const mocks = vi.hoisted(() => ({ writes: [] as Array<{ model: string; data: unknown }>, taken: [] as string[] }));

vi.mock("@/lib/db", () => {
  let n = 0;
  const model = (name: string) => ({
    create: async ({ data }: { data: Record<string, unknown> }) => {
      mocks.writes.push({ model: name, data });
      return { ...data, id: data.id ?? `${name}-${++n}` };
    },
    createMany: async ({ data }: { data: unknown[] }) => {
      for (const d of data) mocks.writes.push({ model: name, data: d });
      return { count: data.length };
    },
    findMany: async () => mocks.taken.map((token) => ({ token })),
  });
  const tx = {
    group: model("group"),
    member: model("member"),
    chore: model("chore"),
    tag: model("tag"),
    completion: model("completion"),
    activity: model("activity"),
  };
  return { prisma: { $transaction: (fn: (t: unknown) => unknown) => fn(tx) } };
});

const { GROUP_EXPORT_FORMAT, importGroup, parseGroupExport, toGroupExport } = await import("./portability");

const t0 = new Date("2026-01-01T00:00:00Z");
const at = (h: number) => new Date(t0.getTime() + h * 3_600_000);

function rows() {
  const group = {
    id: "secretGroupId0000000001",
    name: "The Flat",
    timezone: "Australia/Melbourne",
    joinFromTag: false,
    undoSeconds: 15,
    debounceMinutes: 3,
    settingsPin: "scrypt$secret",
    createdAt: t0,
    updatedAt: t0,
    deletedAt: null,
  };
  const member = (id: string, name: string, h: number) => ({
    id,
    groupId: group.id,
    name,
    colour: "#e11d48",
    createdAt: at(h),
    updatedAt: at(h),
    archivedAt: null,
  });
  return {
    group,
    members: [member("m-a", "Alex", 0), member("m-b", "Sam", 1)],
    chores: [
      {
        id: "c-bins",
        groupId: group.id,
        title: "Bins",
        description: null,
        icon: "🗑️",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        startsAt: at(2),
        anchor: "ADAPTIVE" as const,
        assigneeMode: "ROUND_ROBIN" as const,
        assigneeId: "m-b",
        graceMinutes: 60,
        sortOrder: 0,
        createdAt: at(2),
        updatedAt: at(2),
        archivedAt: null,
      },
    ],
    tags: [
      {
        id: "t-1",
        token: "abcdefghjkmn",
        groupId: group.id,
        choreId: "c-bins",
        qr: true,
        nfc: true,
        label: "Kitchen",
        createdAt: at(3),
        lastUsedAt: at(5),
        revokedAt: null,
      },
    ],
    completions: [
      {
        id: "k-1",
        choreId: "c-bins",
        memberId: "m-a",
        source: "TAG" as const,
        tagId: "t-1",
        deviceId: "device-secret",
        note: null,
        completedAt: at(5),
        createdAt: at(5),
        undoneAt: null,
      },
      {
        id: "k-2",
        choreId: "c-bins",
        memberId: null,
        source: "WEBHOOK" as const,
        tagId: null,
        deviceId: null,
        note: "auto",
        completedAt: at(9),
        createdAt: at(9),
        undoneAt: at(10),
      },
    ],
  };
}

/** What the client sends: the export after a JSON round trip (dates become strings). */
const asFile = () => JSON.parse(JSON.stringify(toGroupExport(rows(), at(20))));

beforeEach(() => {
  mocks.writes.length = 0;
  mocks.taken = [];
});

describe("toGroupExport", () => {
  it("leaves out the group id, PIN hash and device ids", () => {
    const text = JSON.stringify(toGroupExport(rows()));
    expect(text).not.toContain("secretGroupId");
    expect(text).not.toContain("scrypt");
    expect(text).not.toContain("device-secret");
  });

  it("parses back after a JSON round trip", () => {
    const doc = parseGroupExport(asFile());
    expect(doc.format).toBe(GROUP_EXPORT_FORMAT);
    expect(doc.group).toMatchObject({ name: "The Flat", timezone: "Australia/Melbourne", joinFromTag: false, undoSeconds: 15 });
    expect(doc.members.map((m) => m.createdAt)).toEqual([at(0), at(1)]);
    expect(doc.chores[0]).toMatchObject({ anchor: "ADAPTIVE", assigneeMode: "ROUND_ROBIN", startsAt: at(2) });
    expect(doc.completions[1]).toMatchObject({ undoneAt: at(10), note: "auto" });
  });
});

describe("parseGroupExport", () => {
  it("rejects files from a newer version", () => {
    expect(() => parseGroupExport({ ...asFile(), version: 2 })).toThrow(
      expect.objectContaining({ reason: "IMPORT_VERSION_UNSUPPORTED" }),
    );
  });

  it("rejects non-export JSON", () => {
    expect(() => parseGroupExport({ version: 1, groups: [] })).toThrow(expect.objectContaining({ reason: "IMPORT_INVALID" }));
    expect(() => parseGroupExport(null)).toThrow(expect.objectContaining({ reason: "IMPORT_INVALID" }));
  });

  it("rejects dangling references, with the path in the message", () => {
    const file = asFile();
    file.completions[0].memberId = "nobody";
    expect(() => parseGroupExport(file)).toThrow(/completions\.0\.memberId: Unknown member/);
  });

  it("rejects duplicate ids and invalid rrules", () => {
    const dup = asFile();
    dup.members[1].id = "m-a";
    expect(() => parseGroupExport(dup)).toThrow(/members\.1\.id: Duplicate id/);
    const bad = asFile();
    bad.chores[0].rrule = "FREQ=SOMETIMES";
    expect(() => parseGroupExport(bad)).toThrow(expect.objectContaining({ reason: "IMPORT_INVALID" }));
  });
});

describe("importGroup", () => {
  const written = (model: string) => mocks.writes.filter((w) => w.model === model).map((w) => w.data as Record<string, unknown>);

  it("creates a new group and remaps every reference", async () => {
    const result = await importGroup(asFile(), { deviceId: "d1" });
    const [group] = written("group");
    expect(group.id).not.toBe(rows().group.id);
    expect(result.id).toBe(group.id);
    expect(group).not.toHaveProperty("settingsPin");

    const members = result.members.map((m) => m.id);
    const [chore] = written("chore");
    expect(chore.assigneeId).toBe(members[1]);
    expect(chore.groupId).toBe(group.id);

    const [tag] = written("tag");
    expect(tag).toMatchObject({ token: "abcdefghjkmn", choreId: "chore-3", groupId: group.id });
    expect(result.reissuedTags).toBe(0);

    const completions = written("completion");
    expect(completions).toHaveLength(2);
    expect(completions[0]).toMatchObject({ choreId: "chore-3", memberId: members[0], tagId: "tag-4", completedAt: at(5) });
    expect(completions[1]).toMatchObject({ memberId: null, tagId: null, undoneAt: at(10) });
    expect(completions[0]).not.toHaveProperty("deviceId");

    expect(written("activity")[0]).toMatchObject({ type: "group.imported", deviceId: "d1", groupId: group.id });
  });

  it("reissues tag tokens already taken on this instance", async () => {
    mocks.taken = ["abcdefghjkmn"];
    const result = await importGroup(asFile());
    expect(written("tag")[0].token).not.toBe("abcdefghjkmn");
    expect(result.reissuedTags).toBe(1);
  });
});
