import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId, getSpacesForStudio, getChecklistForStudio } from "@/lib/studio";
import WizardDots from "./_components/WizardDots";
import Step1Profile from "./_components/Step1Profile";
import Step2Rules from "./_components/Step2Rules";
import Step3Pricing from "./_components/Step3Pricing";
import Step4Contract from "./_components/Step4Contract";
import Step5Checklist from "./_components/Step5Checklist";

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<{ step?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);

  const requested = parseInt((await searchParams).step ?? "1", 10) || 1;
  // Without a studio only step 1 exists; with one, all steps are reachable.
  const unlocked = studio ? 5 : 1;
  const step = Math.min(Math.max(requested, 1), unlocked);

  const spaces = studio ? await getSpacesForStudio(db, studio.id) : [];
  const checklist = studio ? await getChecklistForStudio(db, studio.id) : [];

  return (
    <main className="mx-auto max-w-[620px] px-4 pb-16 pt-8">
      <h1 className="mb-1 font-serif text-2xl">{studio?.onboardingCompletedAt ? "Settings & policies" : "Set up your studio"}</h1>
      <p className="mb-5 text-xs text-owner-muted">Step {step} of 5 — each step saves on its own.</p>
      <WizardDots current={step} unlocked={unlocked} />

      {step === 1 && (
        <Step1Profile
          initial={{
            name: studio?.name ?? "",
            address: studio?.address ?? "",
            equipmentList: studio?.equipmentList ?? "",
            spaces: spaces.map((s) => ({ name: s.name, maxOccupancy: s.maxOccupancy })),
          }}
        />
      )}
      {step === 2 && studio && (
        <Step2Rules
          initial={{
            alcoholPolicy: studio.alcoholPolicy ?? "byob_with_acknowledgment",
            vendorPolicy: studio.vendorPolicy ?? "pre_approval",
            noiseCurfew: studio.noiseCurfew ?? "",
            cleanupWindowMin: studio.cleanupWindowMin?.toString() ?? "",
          }}
        />
      )}
      {step === 3 && studio && (
        <Step3Pricing
          initial={{
            hourlyRate: studio.hourlyRateCents ? (studio.hourlyRateCents / 100).toString() : "",
            minHours: studio.minHours?.toString() ?? "",
            deposit: studio.depositCents ? (studio.depositCents / 100).toString() : "",
          }}
        />
      )}
      {step === 4 && studio && <Step4Contract studio={studio} spaces={spaces} />}
      {step === 5 && studio && (
        <Step5Checklist
          initial={checklist.map((c) => ({ name: c.name, hint: c.hint ?? "" }))}
          slug={studio.slug}
        />
      )}
    </main>
  );
}
