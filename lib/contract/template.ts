import { alcoholClause, vendorClause } from "./labels";
import type { ContractDoc, ContractInput, ContractSection } from "./types";

const DISCLAIMER =
  "VenueDash is not a law firm and does not provide legal advice. This is a template pending review by a licensed Georgia attorney before launch; have your own attorney review anything you sign.";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildStandardContract(input: ContractInput): ContractDoc {
  const rate =
    input.hourlyRateCents != null ? `${money(input.hourlyRateCents)} per hour` : "as agreed between the parties";
  const minimum = input.minHours != null ? `, with a ${input.minHours}-hour minimum` : "";
  const deposit = input.depositCents != null ? money(input.depositCents) : "the amount agreed between the parties";
  const alcohol = alcoholClause(input.alcoholPolicy);
  const vendor = vendorClause(input.vendorPolicy);
  const ladder = input.cancellationLadder;

  const sections: ContractSection[] = [
    {
      heading: "1. Parties & Premises",
      body: [
        `This Event Rental Agreement is entered into between ${input.studioName} ("Studio")${
          input.studioAddress ? ` located at ${input.studioAddress}` : ""
        } and ${input.renterName} ("Renter", ${input.renterEmail}${
          input.renterPhone ? `, ${input.renterPhone}` : ""
        }).`,
      ],
    },
    {
      heading: "2. Event & Term",
      plainEnglish: "The space is reserved for your event window plus any cleanup time.",
      body: [
        `The Studio is rented for ${input.eventType ?? "the Renter's event"} on ${input.when}.`,
        input.cleanupWindowMin != null
          ? `A cleanup window of ${input.cleanupWindowMin} minutes is included at the end of the rental period.`
          : "The Renter shall leave the premises clean and undamaged at the end of the rental period.",
      ],
    },
    {
      heading: "3. Fees",
      plainEnglish: "What you pay to rent the space.",
      body: [`The rental fee is ${rate}${minimum}. Fees are collected by the Studio directly.`],
    },
    {
      heading: "4. Damage Deposit",
      plainEnglish: "A refundable deposit the studio holds against damage — VenueDash never touches this money.",
      body: [
        `A refundable damage deposit of ${deposit} applies to this rental. The deposit is collected and refunded by the studio directly; VenueDash does not hold, charge, or refund deposit funds.`,
        "The Studio may retain all or part of the deposit for damage to the premises, equipment, or furnishings beyond ordinary wear, documented at the pre- and post-event walkthroughs.",
      ],
    },
    {
      heading: "5. Occupancy",
      plainEnglish: input.maxOccupancy != null ? `No more than ${input.maxOccupancy} people.` : "Stay within a safe headcount.",
      body: [
        input.maxOccupancy != null
          ? `Attendance shall not exceed the maximum occupancy of ${input.maxOccupancy} persons.`
          : "Attendance shall not exceed a safe and lawful occupancy for the premises.",
      ],
    },
    {
      heading: "6. Alcohol",
      plainEnglish: alcohol.plainEnglish,
      body: [alcohol.clause],
    },
    {
      heading: "7. Outside Vendors",
      plainEnglish: vendor.plainEnglish,
      body: [vendor.clause],
    },
    {
      heading: "8. Noise & Conduct",
      plainEnglish: "Keep noise reasonable and follow Atlanta's noise ordinance.",
      body: [
        `${
          input.noiseCurfew ? `Amplified sound shall end by ${input.noiseCurfew}. ` : ""
        }The Renter shall comply with the City of Atlanta noise ordinance, Atlanta Code § 74-133, and all applicable laws.`,
      ],
    },
    {
      heading: "9. Equipment",
      plainEnglish: "Don't move or use the studio's gear unless it's part of your rental.",
      body: [
        `The Renter shall not move, alter, or operate Studio equipment${
          input.equipmentList ? ` (including ${input.equipmentList})` : ""
        } except as expressly included in the rental.`,
      ],
    },
    {
      heading: "10. Cancellation",
      plainEnglish: ladder
        ? `Full refund ${ladder.full}+ days out, half by ${ladder.half} days, none after.`
        : "Cancellation terms as agreed between the parties.",
      body: [
        ladder
          ? `Cancellation ${ladder.full} or more days before the event: full refund of fees paid. Cancellation ${ladder.half} to ${ladder.full} days before: 50% refund. Fewer than ${ladder.none === 0 ? ladder.half : ladder.none} days: no refund.`
          : "Cancellation and refund terms are as agreed between the parties.",
      ],
    },
    {
      heading: "11. Liability & Indemnification",
      plainEnglish: "You're responsible for your guests and for damage they cause.",
      body: [
        "The Renter assumes responsibility for the conduct of all guests and shall indemnify and hold the Studio harmless from claims, damages, or costs arising from the Renter's use of the premises, to the fullest extent permitted by law.",
      ],
    },
    {
      heading: "12. Governing Law",
      body: ["This agreement is governed by the laws of the State of Georgia."],
    },
    {
      heading: "13. Signatures",
      plainEnglish: "You'll receive a separate request to sign electronically.",
      body: [
        "By signing, the parties agree to the terms above. Signatures are collected through a separate signing request.",
        "Studio: ______________________   Date: __________",
        "Renter: ______________________   Date: __________",
      ],
    },
  ];

  return { title: "Standard Event Rental Agreement", disclaimer: DISCLAIMER, sections };
}
