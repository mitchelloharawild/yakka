import { describe, expect, it } from "vitest";
import { resolveLocale } from "./config";

describe("resolveLocale", () => {
  it("prefers a valid cookie", () => {
    expect(resolveLocale("en", "fr-FR")).toBe("en");
  });
  it("falls back through Accept-Language", () => {
    expect(resolveLocale(undefined, "fr-FR,fr;q=0.9,en-AU;q=0.8")).toBe("en");
    expect(resolveLocale("xx", "de")).toBe("en");
    expect(resolveLocale(null, null)).toBe("en");
  });
});
