import { describe, expect, it } from "vitest";
import { parseJoinLink } from "./join-link";

const GID = "AbC123dEf456GhI789jKl0";
const TOKEN = "k7m2p9qrstwx";

describe("parseJoinLink", () => {
  it("accepts full group URLs from any host, keeping path, query and hash", () => {
    expect(parseJoinLink(`https://yakka.example/groups/${GID}`)).toEqual({
      path: `/groups/${GID}`,
      kind: "group",
      host: "yakka.example",
      transfer: false,
    });
    expect(parseJoinLink(`http://localhost:3000/groups/${GID}/settings?tab=x#top`)).toMatchObject({
      path: `/groups/${GID}/settings?tab=x#top`,
      host: "localhost:3000",
    });
  });

  it("recognises device-transfer links", () => {
    expect(parseJoinLink(`https://yakka.example/groups/${GID}?as=mem_42`)).toEqual({
      path: `/groups/${GID}?as=mem_42`,
      kind: "group",
      host: "yakka.example",
      transfer: true,
    });
  });

  it("accepts tag URLs", () => {
    expect(parseJoinLink(`https://yakka.example/t/${TOKEN}`)).toEqual({
      path: `/t/${TOKEN}`,
      kind: "tag",
      host: "yakka.example",
      transfer: false,
    });
  });

  it("accepts relative paths and bare group ids", () => {
    expect(parseJoinLink(`/groups/${GID}`)).toMatchObject({ path: `/groups/${GID}`, host: null });
    expect(parseJoinLink(`/t/${TOKEN}`)).toMatchObject({ path: `/t/${TOKEN}`, kind: "tag", host: null });
    expect(parseJoinLink(`  ${GID}\n`)).toMatchObject({ path: `/groups/${GID}`, host: null });
  });

  it("pulls the first link out of surrounding text", () => {
    expect(parseJoinLink(`Join our chores: https://yakka.example/groups/${GID}. See you!`)).toMatchObject({
      path: `/groups/${GID}`,
    });
    expect(parseJoinLink(`(link: yakka.example/groups/${GID})`)).toMatchObject({
      path: `/groups/${GID}`,
      host: "yakka.example",
    });
    expect(parseJoinLink(`tap /t/${TOKEN} to tick it off`)).toMatchObject({ path: `/t/${TOKEN}` });
  });

  it("rejects anything else", () => {
    expect(parseJoinLink("")).toBeNull();
    expect(parseJoinLink("   ")).toBeNull();
    expect(parseJoinLink("hello there")).toBeNull();
    expect(parseJoinLink("https://yakka.example/")).toBeNull();
    expect(parseJoinLink("https://yakka.example/groups/short")).toBeNull();
    expect(parseJoinLink("https://yakka.example/docs/self-hosting")).toBeNull();
    expect(parseJoinLink(`https://yakka.example/t/${TOKEN}/extra`)).toBeNull();
    expect(parseJoinLink(`javascript:alert(1)//groups/${GID}`)).toBeNull();
  });

  it("never produces a protocol-relative path", () => {
    expect(parseJoinLink(`https://yakka.example//groups/${GID}`)?.path).toBe(`/groups/${GID}`);
  });
});
