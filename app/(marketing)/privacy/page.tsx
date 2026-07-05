import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — VenueDash",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-[680px] px-8 py-16">
      <Link href="/" className="font-mono text-[11px] text-[#5e6070] hover:text-owner-muted">
        ← VenueDash
      </Link>
      <h1 className="mb-2 mt-6 text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mb-1 font-mono text-[11px] text-[#5e6070]">Last updated: July 5, 2026</p>
      <p className="mb-10 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-[12.5px] leading-relaxed text-warning">
        Beta policy — under review by a Georgia attorney.
      </p>

      <div className="space-y-8 text-[14px] leading-[1.75] text-owner-muted [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-owner-text">
        <section>
          <h2>1. What we collect</h2>
          <p>
            <strong className="text-owner-text">Waitlist:</strong> your email address, when you
            join the waitlist. <strong className="text-owner-text">Studio owners:</strong> account
            details (name, email) and the studio, policy, and booking information you enter.{" "}
            <strong className="text-owner-text">Renters:</strong> contact and event details
            submitted with a booking request. <strong className="text-owner-text">Photos:</strong>{" "}
            condition photos captured during walkthroughs, with server timestamps and, where you
            permit it, location data.
          </p>
        </section>
        <section>
          <h2>2. How we use it</h2>
          <p>
            To run the product: creating contracts, storing condition documentation, tracking
            bookings, and sending transactional email about your bookings and the waitlist. We do
            not sell personal data, and we do not use it for third-party advertising.
          </p>
        </section>
        <section>
          <h2>3. Where it lives</h2>
          <p>
            VenueDash runs on established infrastructure providers: Vercel (hosting), Neon
            (database), Cloudflare R2 (photo and document storage), Clerk (owner sign-in), and
            Resend (email). Each processes data on our behalf under their own security terms.
          </p>
        </section>
        <section>
          <h2>4. Retention and deletion</h2>
          <p>
            Booking records and locked walkthrough photos are retained while the associated
            studio account is active, because they are the documentation the product exists to
            keep. To delete your waitlist entry or your account and its data, email{" "}
            <a href="mailto:tgaylord2024@gmail.com" className="text-owner-accent">tgaylord2024@gmail.com</a>.
          </p>
        </section>
        <section>
          <h2>5. Changes</h2>
          <p>
            We will post any updates here and change the date above; material changes will be
            emailed to account holders.
          </p>
        </section>
      </div>
    </main>
  );
}
