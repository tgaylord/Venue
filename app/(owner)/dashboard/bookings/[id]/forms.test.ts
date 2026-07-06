import { describe, it, expect } from "vitest";
import { parseDepositStatus, DEPOSIT_STATUSES } from "./forms";

function fd(status: string): FormData {
  const f = new FormData();
  f.set("status", status);
  return f;
}

describe("parseDepositStatus", () => {
  it("accepts each known status", () => {
    for (const s of DEPOSIT_STATUSES) {
      expect(parseDepositStatus(fd(s))).toEqual({ ok: true, status: s });
    }
  });
  it("rejects an unknown status", () => {
    expect(parseDepositStatus(fd("refunded")).ok).toBe(false);
  });
  it("rejects a missing status", () => {
    expect(parseDepositStatus(new FormData()).ok).toBe(false);
  });
});
