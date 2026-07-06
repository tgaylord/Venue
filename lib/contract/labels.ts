import type { AlcoholPolicy, VendorPolicy } from "./types";

const DRAM_SHOP =
  " The renter and their guests acknowledge sole responsibility for the conduct and sobriety of all attendees, consistent with the duties Georgia law (O.C.G.A. § 51-1-40) places on any person who furnishes alcohol.";

export const ALCOHOL_CLAUSES: Record<AlcoholPolicy, { clause: string; plainEnglish: string }> = {
  prohibited: {
    clause: "No alcohol may be served or consumed on the premises during the rental period." + DRAM_SHOP,
    plainEnglish: "No alcohol at this event.",
  },
  byob_with_acknowledgment: {
    clause:
      "Alcohol is permitted on a bring-your-own-beverage (BYOB) basis. The renter is solely responsible for lawful, responsible service to guests of legal drinking age." +
      DRAM_SHOP,
    plainEnglish: "Guests may bring their own alcohol; you're responsible for how it's served.",
  },
  licensed_bartender_only: {
    clause:
      "Alcohol may be served only by a licensed and insured bartender arranged by the renter." +
      DRAM_SHOP,
    plainEnglish: "Alcohol only through a licensed bartender you arrange.",
  },
};

const ALCOHOL_FALLBACK = {
  clause: "The studio's stated alcohol policy applies for the rental period." + DRAM_SHOP,
  plainEnglish: "Follow the studio's alcohol policy.",
};

export const VENDOR_CLAUSES: Record<VendorPolicy, { clause: string; plainEnglish: string }> = {
  in_house_only: {
    clause: "Only the studio's in-house vendors and equipment may be used; outside vendors are not permitted.",
    plainEnglish: "In-house vendors only.",
  },
  approved_vendors: {
    clause: "Outside vendors are permitted only with the studio's prior written approval.",
    plainEnglish: "Outside vendors allowed with the studio's approval.",
  },
  open: {
    clause: "The renter may engage outside vendors of their choosing, who must comply with all house rules.",
    plainEnglish: "Bring any vendors you like; they follow house rules.",
  },
};

const VENDOR_FALLBACK = {
  clause: "The studio's stated vendor policy applies.",
  plainEnglish: "Follow the studio's vendor policy.",
};

export function alcoholClause(policy: string | null): { clause: string; plainEnglish: string } {
  return (policy && ALCOHOL_CLAUSES[policy as AlcoholPolicy]) || ALCOHOL_FALLBACK;
}
export function vendorClause(policy: string | null): { clause: string; plainEnglish: string } {
  return (policy && VENDOR_CLAUSES[policy as VendorPolicy]) || VENDOR_FALLBACK;
}
