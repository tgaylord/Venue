"use server";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import {
  createStudio, updateProfile, updateHouseRules, updatePricing,
  replaceChecklistItems, completeOnboarding, getStudioByClerkUserId,
} from "@/lib/studio";
import { parseProfileForm, parseRulesForm, parsePricingForm, parseChecklistForm } from "./forms";

export type WizardFormState = { status: "idle" | "error"; fieldErrors: Record<string, string> };
export const WIZARD_IDLE: WizardFormState = { status: "idle", fieldErrors: {} };

async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return userId;
}

export async function saveProfile(_prev: WizardFormState, fd: FormData): Promise<WizardFormState> {
  const userId = await requireUserId();
  const parsed = parseProfileForm(fd);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.fieldErrors };

  const db = getDb();
  const existing = await getStudioByClerkUserId(db, userId);
  if (existing) {
    await updateProfile(db, existing.id, parsed.data);
  } else {
    await createStudio(db, { clerkUserId: userId, ...parsed.data });
  }
  redirect("/settings?step=2");
}

export async function saveRules(_prev: WizardFormState, fd: FormData): Promise<WizardFormState> {
  const userId = await requireUserId();
  const parsed = parseRulesForm(fd);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.fieldErrors };

  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings?step=1");
  await updateHouseRules(db, studio.id, parsed.data);
  redirect("/settings?step=3");
}

export async function savePricing(_prev: WizardFormState, fd: FormData): Promise<WizardFormState> {
  const userId = await requireUserId();
  const parsed = parsePricingForm(fd);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.fieldErrors };

  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings?step=1");
  await updatePricing(db, studio.id, parsed.data);
  redirect("/settings?step=4");
}

export async function saveChecklist(_prev: WizardFormState, fd: FormData): Promise<WizardFormState> {
  const userId = await requireUserId();
  const parsed = parseChecklistForm(fd);
  if (!parsed.ok) return { status: "error", fieldErrors: parsed.fieldErrors };

  const db = getDb();
  const studio = await getStudioByClerkUserId(db, userId);
  if (!studio) redirect("/settings?step=1");
  await replaceChecklistItems(db, studio.id, parsed.data.items);
  await completeOnboarding(db, studio.id);
  redirect("/dashboard");
}
