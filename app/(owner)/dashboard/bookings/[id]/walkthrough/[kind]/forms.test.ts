import { describe, it, expect } from "vitest";
import { REMINDER_WINDOW_HOURS, coerceKind } from "./forms";

describe("walkthrough forms", () => {
  it("exposes the reminder window and coerces kind", () => {
    expect(REMINDER_WINDOW_HOURS).toBe(3);
    expect(coerceKind("pre")).toBe("pre");
    expect(coerceKind("nope")).toBeNull();
  });
});
