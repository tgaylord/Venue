import {
  pgTable, pgEnum, text, uuid, integer, boolean, timestamp, jsonb,
  doublePrecision, uniqueIndex, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Enums ────────────────────────────────────────────────────────────────
export const bookingStateEnum = pgEnum("booking_state", [
  "pending", "declined", "awaiting_contract", "awaiting_signature",
  "confirmed", "event_day", "post_event", "closed", "canceled",
]);
export const actorTypeEnum = pgEnum("actor_type", ["owner", "renter", "system"]);
export const depositStatusEnum = pgEnum("deposit_status", ["uncollected", "collected", "returned"]);
export const availabilitySourceEnum = pgEnum("availability_source", ["booking", "manual", "buffer"]);
export const walkthroughKindEnum = pgEnum("walkthrough_kind", ["pre", "post"]);
export const contractTemplateEnum = pgEnum("contract_template", ["standard"]);
export const contractStatusEnum = pgEnum("contract_status", ["sent", "signed", "voided"]);

// ── Studio & configuration ───────────────────────────────────────────────
export const studios = pgTable("studios", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  address: text("address"),
  description: text("description"),
  equipmentList: text("equipment_list"),
  hourlyRateCents: integer("hourly_rate_cents"),
  minHours: integer("min_hours"),
  depositCents: integer("deposit_cents"),
  coiRequired: boolean("coi_required").notNull().default(false),
  alcoholPolicy: text("alcohol_policy"),
  vendorPolicy: text("vendor_policy"),
  noiseCurfew: text("noise_curfew"),
  cleanupWindowMin: integer("cleanup_window_min"),
  cancellationLadder: jsonb("cancellation_ladder"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    maxOccupancy: integer("max_occupancy"),
  },
  (t) => [index("spaces_studio_id_idx").on(t.studioId)]
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    hint: text("hint"),
  },
  (t) => [index("checklist_items_studio_id_idx").on(t.studioId)]
);

export const availabilityBlocks = pgTable(
  "availability_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    source: availabilitySourceEnum("source").notNull(),
  },
  (t) => [
    index("availability_blocks_studio_id_idx").on(t.studioId),
    check("availability_blocks_time_range", sql`"ends_at" > "starts_at"`),
  ]
);

// ── Bookings & audit ─────────────────────────────────────────────────────
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
    state: bookingStateEnum("state").notNull().default("pending"),
    renterName: text("renter_name").notNull(),
    renterEmail: text("renter_email").notNull(),
    renterPhone: text("renter_phone"),
    eventType: text("event_type"),
    headcount: integer("headcount"),
    byob: boolean("byob").notNull().default(false),
    outsideVendors: boolean("outside_vendors").notNull().default(false),
    notes: text("notes"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // Snapshots (copied from studio at request time; never re-joined for terms)
    depositCents: integer("deposit_cents"),
    rateSnapshot: jsonb("rate_snapshot"),
    depositProtected: boolean("deposit_protected").notNull().default(true),
    // v0.5 manual toggles
    depositStatus: depositStatusEnum("deposit_status").notNull().default("uncollected"),
    depositStatusAt: timestamp("deposit_status_at", { withTimezone: true }),
    contractSignedAt: timestamp("contract_signed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bookings_studio_id_idx").on(t.studioId),
    index("bookings_state_idx").on(t.state),
    check("bookings_time_range", sql`"ends_at" > "starts_at"`),
  ]
);

export const bookingEvents = pgTable(
  "booking_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    fromState: bookingStateEnum("from_state").notNull(),
    toState: bookingStateEnum("to_state").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("booking_events_booking_id_idx").on(t.bookingId)]
);

// ── Walkthroughs & photos ────────────────────────────────────────────────
export const walkthroughs = pgTable(
  "walkthroughs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    kind: walkthroughKindEnum("kind").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (t) => [index("walkthroughs_booking_id_idx").on(t.bookingId)]
);

export const walkthroughPhotos = pgTable(
  "walkthrough_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walkthroughId: uuid("walkthrough_id").notNull().references(() => walkthroughs.id, { onDelete: "cascade" }),
    checklistItemId: uuid("checklist_item_id").references(() => checklistItems.id, { onDelete: "set null" }),
    r2Key: text("r2_key").notNull(),
    serverCapturedAt: timestamp("server_captured_at", { withTimezone: true }).notNull().defaultNow(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    bytes: integer("bytes"),
    contentType: text("content_type"),
    sha256: text("sha256").notNull(),
  },
  (t) => [index("walkthrough_photos_walkthrough_id_idx").on(t.walkthroughId)]
);

// ── Contracts (manual signing in v0.5 — no envelope_id) ──────────────────
export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    template: contractTemplateEnum("template").notNull().default("standard"),
    status: contractStatusEnum("status").notNull().default("sent"),
    signedPdfR2Key: text("signed_pdf_r2_key"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
  },
  (t) => [index("contracts_booking_id_idx").on(t.bookingId)]
);

// ── Renter tokens (hashed at rest; one active per booking+purpose) ───────
export const renterTokens = pgTable(
  "renter_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("renter_tokens_booking_purpose_idx").on(t.bookingId, t.purpose)]
);

// ── Rate limiting (fixed-window, DB-backed; keyed e.g. "book:<ip>") ───────
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
});

export type Booking = typeof bookings.$inferSelect;
export type BookingEvent = typeof bookingEvents.$inferSelect;
