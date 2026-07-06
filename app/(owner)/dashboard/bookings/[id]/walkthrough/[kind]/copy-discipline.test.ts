import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Phase 7 spec §6 copy discipline: the walkthrough surface must say "timestamped
// documentation," never lean on legal/evidentiary language VenueDash doesn't back
// (no held deposits, no auto-refunds, no acknowledgment flow, no damage-claim flow).
const FORBIDDEN: RegExp[] = [
  /immutable evidence/i,
  /\bproof\b/i,
  /legal backbone/i,
  /hold up as evidence/i,
  /\bevidence\b/i,
  /acknowledg/i,
  /damage claim/i,
  /auto-refund/i,
  /held deposit/i,
];

const ROOT = path.resolve(__dirname, "../../../../../../..");

const FILES = [
  "app/(owner)/dashboard/bookings/[id]/walkthrough/[kind]/_components/CaptureFlow.tsx",
  "app/(owner)/dashboard/bookings/[id]/page.tsx",
  "app/(owner)/dashboard/bookings/[id]/_components/WalkthroughRecord.tsx",
  "emails/WalkthroughReminder.tsx",
];

describe("Phase 7 copy discipline", () => {
  for (const relPath of FILES) {
    it(`${relPath} contains no forbidden phrases`, () => {
      const text = readFileSync(path.join(ROOT, relPath), "utf8");
      for (const re of FORBIDDEN) {
        expect(text, `${relPath} matched forbidden pattern ${re}`).not.toMatch(re);
      }
    });
  }
});
