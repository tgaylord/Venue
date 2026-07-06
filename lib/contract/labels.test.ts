import { describe, it, expect } from "vitest";
import { alcoholClause, vendorClause, ALCOHOL_CLAUSES } from "./labels";

describe("alcoholClause", () => {
  it("maps each known enum to its fixed clause", () => {
    expect(alcoholClause("prohibited").clause).toMatch(/no alcohol/i);
    expect(alcoholClause("byob_with_acknowledgment").clause).toMatch(/BYOB/i);
    expect(alcoholClause("licensed_bartender_only").clause).toMatch(/licensed/i);
  });
  it("every known clause carries a dram-shop acknowledgment (not a waiver)", () => {
    for (const v of Object.values(ALCOHOL_CLAUSES)) {
      expect(v.clause).toMatch(/§\s*51-1-40|dram/i);
      expect(v.clause).not.toMatch(/waive|waiver/i);
    }
  });
  it("falls back safely for null/unknown", () => {
    expect(alcoholClause(null).clause).toMatch(/alcohol/i);
    expect(alcoholClause("nonsense").clause).toMatch(/alcohol/i);
  });
});

describe("vendorClause", () => {
  it("maps known enums and falls back", () => {
    expect(vendorClause("in_house_only").clause).toMatch(/in-house/i);
    expect(vendorClause("open").clause).toMatch(/vendor/i);
    expect(vendorClause(null).clause).toMatch(/vendor/i);
  });
});
