export type AlcoholPolicy = "prohibited" | "byob_with_acknowledgment" | "licensed_bartender_only";
export type VendorPolicy = "in_house_only" | "approved_vendors" | "open";

export type CancellationLadder = { full: number; half: number; none: number };

export type ContractInput = {
  studioName: string;
  studioAddress: string | null;
  renterName: string;
  renterEmail: string;
  renterPhone: string | null;
  eventType: string | null;
  when: string;
  headcount: number | null;
  hourlyRateCents: number | null;
  minHours: number | null;
  depositCents: number | null;
  maxOccupancy: number | null;
  alcoholPolicy: string | null;
  vendorPolicy: string | null;
  noiseCurfew: string | null;
  cleanupWindowMin: number | null;
  cancellationLadder: CancellationLadder | null;
  equipmentList: string | null;
  byob: boolean;
  outsideVendors: boolean;
};

export type ContractSection = { heading: string; body: string[]; plainEnglish?: string };
export type ContractDoc = { title: string; disclaimer: string; sections: ContractSection[] };
