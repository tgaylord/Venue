import { asc, eq, like } from "drizzle-orm";
import { studios, spaces, checklistItems } from "@/db/schema";
import type { Db } from "@/lib/domain/transitions";

export type Studio = typeof studios.$inferSelect;
export type Space = typeof spaces.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type SpaceInput = { name: string; maxOccupancy: number | null };

export const STANDARD_LADDER = { full: 30, half: 14, none: 0 } as const;

export const DEFAULT_CHECKLIST: readonly { name: string; hint: string }[] = [
  { name: "Cyc wall", hint: "Full-width shot, both corners" },
  { name: "Floors", hint: "Any existing scuffs or marks" },
  { name: "Lighting equipment", hint: "Stands, softboxes, cables" },
  { name: "Furniture & props", hint: "Couch, tables, decor wall" },
  { name: "Bathroom", hint: "Fixtures and counter" },
  { name: "Entryway & door", hint: "Locks, handles, signage" },
];

export function slugify(name: string): string {
  const s = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  return s || "studio";
}

async function uniqueSlug(db: Db, base: string): Promise<string> {
  const taken = new Set(
    (await db.select({ slug: studios.slug }).from(studios).where(like(studios.slug, `${base}%`)))
      .map((r) => r.slug)
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function getStudioByClerkUserId(db: Db, clerkUserId: string): Promise<Studio | undefined> {
  const [row] = await db.select().from(studios).where(eq(studios.clerkUserId, clerkUserId));
  return row;
}

export async function getSpacesForStudio(db: Db, studioId: string): Promise<Space[]> {
  return db.select().from(spaces).where(eq(spaces.studioId, studioId));
}

export async function getChecklistForStudio(db: Db, studioId: string): Promise<ChecklistItem[]> {
  return db.select().from(checklistItems)
    .where(eq(checklistItems.studioId, studioId))
    .orderBy(asc(checklistItems.position));
}

/** Step 1 first save: studio + slug + standard ladder + default checklist + spaces, atomically. */
export async function createStudio(
  db: Db,
  input: { clerkUserId: string; name: string; address: string | null; equipmentList: string | null; spaces: SpaceInput[] }
): Promise<Studio> {
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx as unknown as Db, slugify(input.name));
    const [studio] = await tx.insert(studios).values({
      clerkUserId: input.clerkUserId,
      name: input.name,
      slug,
      address: input.address,
      equipmentList: input.equipmentList,
      cancellationLadder: STANDARD_LADDER,
    }).returning();

    if (input.spaces.length > 0) {
      await tx.insert(spaces).values(input.spaces.map((s) => ({ ...s, studioId: studio.id })));
    }
    await tx.insert(checklistItems).values(
      DEFAULT_CHECKLIST.map((c, i) => ({ studioId: studio.id, position: i + 1, name: c.name, hint: c.hint }))
    );
    return studio;
  });
}
