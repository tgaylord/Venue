import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import { getStudioByClerkUserId, getSpacesForStudio, getChecklistForStudio } from "@/lib/studio";
import WizardDots from "./_components/WizardDots";
import Step1Profile from "./_components/Step1Profile";

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
  void checklist; // consumed by Step5 in the next task

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
      {step > 1 && (
        <p className="text-sm text-owner-muted">Step {step} arrives in the next task.</p>
      )}
    </main>
  );
}
