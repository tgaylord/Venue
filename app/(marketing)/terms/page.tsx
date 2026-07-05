import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — VenueDash",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-[680px] px-8 py-16">
      <Link href="/" className="font-mono text-[11px] text-[#5e6070] hover:text-owner-muted">
        ← VenueDash
      </Link>
      <h1 className="mb-2 mt-6 text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mb-1 font-mono text-[11px] text-[#5e6070]">Last updated: July 5, 2026</p>
      <p className="mb-10 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-[12.5px] leading-relaxed text-warning">
        Beta terms — under review by a Georgia attorney. They govern the free beta and will be
        finalized before paid service begins.
      </p>

      <div className="space-y-8 text-[14px] leading-[1.75] text-owner-muted [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-owner-text">
        <section>
          <h2>1. What VenueDash is</h2>
          <p>
            VenueDash is software for studio owners who rent their spaces for private events. It
            generates rental contract documents from templates, stores timestamped condition
            photos, and tracks the status of bookings. VenueDash is currently offered as a free
            beta; features may change or be withdrawn while in beta.
          </p>
        </section>
        <section>
          <h2>2. Not a law firm; no legal advice</h2>
          <p>
            VenueDash is not a law firm and does not provide legal advice. Contract templates are
            general-purpose documents provided as-is. You are responsible for having your own
            attorney review any contract before you rely on it. Using VenueDash does not create an
            attorney-client relationship.
          </p>
        </section>
        <section>
          <h2>3. VenueDash never handles your money</h2>
          <p>
            VenueDash does not process payments, hold deposits, or move funds of any kind. Rent
            and damage deposits are collected, held, and refunded directly by you, outside the
            platform. Deposit information shown in VenueDash is a record you maintain, not a
            payment instrument. Any dispute about money is between you and your renter.
          </p>
        </section>
        <section>
          <h2>4. Photos and documents</h2>
          <p>
            Condition photos you capture are stored with a server-assigned timestamp and, where
            permitted, location data, and are locked against edits once a walkthrough is
            completed. VenueDash provides timestamped documentation; it does not guarantee that
            any record will be sufficient or admissible for a particular legal purpose.
          </p>
        </section>
        <section>
          <h2>5. Your account and acceptable use</h2>
          <p>
            You are responsible for activity under your account and for the accuracy of the
            information you enter. You may not use VenueDash for unlawful activity, to store
            unlawful content, or to misrepresent the condition of a space.
          </p>
        </section>
        <section>
          <h2>6. Warranty disclaimer and limitation of liability</h2>
          <p>
            VenueDash is provided &quot;as is&quot; and &quot;as available,&quot; without
            warranties of any kind, express or implied. To the maximum extent permitted by law,
            VenueDash&apos;s total liability arising out of the service will not exceed the
            amounts you paid for the service in the twelve months before the claim (during the
            free beta, $0).
          </p>
        </section>
        <section>
          <h2>7. Termination</h2>
          <p>
            You may stop using VenueDash at any time and request deletion of your data. We may
            suspend or terminate beta accounts that violate these terms, with notice where
            practical.
          </p>
        </section>
        <section>
          <h2>8. Governing law</h2>
          <p>These terms are governed by the laws of the State of Georgia, USA.</p>
        </section>
        <section>
          <h2>9. Changes</h2>
          <p>
            We may update these terms as the beta evolves. We will post the updated terms here
            and change the date above; material changes will be emailed to account holders.
          </p>
        </section>
        <section>
          <h2>10. Contact</h2>
          <p>
            Questions about these terms: <a href="mailto:tgaylord2024@gmail.com" className="text-owner-accent">tgaylord2024@gmail.com</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
