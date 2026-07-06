import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  it("is a standalone installable manifest with icons", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.short_name).toBe("VenueDash");
    expect(m.theme_color).toBe("#0b0c0f");
    expect((m.icons ?? []).map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });
});
