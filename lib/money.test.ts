import { describe, it, expect } from "vitest";
import { parseDollarsToCents } from "@/lib/money";

describe("parseDollarsToCents", () => {
  it("parses plain dollars", () => {
    expect(parseDollarsToCents("165")).toBe(16500);
  });
  it("parses $ prefix and commas and whitespace", () => {
    expect(parseDollarsToCents(" $1,250 ")).toBe(125000);
  });
  it("parses decimals to exact cents", () => {
    expect(parseDollarsToCents("165.50")).toBe(16550);
    expect(parseDollarsToCents("0.99")).toBe(99);
  });
  it("rejects garbage, negatives, zero, and >2 decimals", () => {
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(parseDollarsToCents("0")).toBeNull();
    expect(parseDollarsToCents("1.234")).toBeNull();
    expect(parseDollarsToCents("")).toBeNull();
  });
});
