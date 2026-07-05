CREATE TYPE "public"."actor_type" AS ENUM('owner', 'renter', 'system');--> statement-breakpoint
CREATE TYPE "public"."availability_source" AS ENUM('booking', 'manual', 'buffer');--> statement-breakpoint
CREATE TYPE "public"."booking_state" AS ENUM('pending', 'declined', 'awaiting_contract', 'awaiting_signature', 'confirmed', 'event_day', 'post_event', 'closed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('sent', 'signed', 'voided');--> statement-breakpoint
CREATE TYPE "public"."contract_template" AS ENUM('standard');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('uncollected', 'collected', 'returned');--> statement-breakpoint
CREATE TYPE "public"."walkthrough_kind" AS ENUM('pre', 'post');--> statement-breakpoint
CREATE TABLE "availability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source" "availability_source" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"from_state" "booking_state" NOT NULL,
	"to_state" "booking_state" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"state" "booking_state" DEFAULT 'pending' NOT NULL,
	"renter_name" text NOT NULL,
	"renter_email" text NOT NULL,
	"renter_phone" text,
	"event_type" text,
	"headcount" integer,
	"byob" boolean DEFAULT false NOT NULL,
	"outside_vendors" boolean DEFAULT false NOT NULL,
	"notes" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"deposit_cents" integer,
	"rate_snapshot" jsonb,
	"deposit_protected" boolean DEFAULT true NOT NULL,
	"deposit_status" "deposit_status" DEFAULT 'uncollected' NOT NULL,
	"deposit_status_at" timestamp with time zone,
	"contract_signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"hint" text
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"template" "contract_template" DEFAULT 'standard' NOT NULL,
	"status" "contract_status" DEFAULT 'sent' NOT NULL,
	"signed_pdf_r2_key" text,
	"sent_at" timestamp with time zone,
	"signed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "renter_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "renter_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"max_occupancy" integer
);
--> statement-breakpoint
CREATE TABLE "studios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"address" text,
	"description" text,
	"equipment_list" text,
	"hourly_rate_cents" integer,
	"min_hours" integer,
	"deposit_cents" integer,
	"coi_required" boolean DEFAULT false NOT NULL,
	"alcohol_policy" text,
	"vendor_policy" text,
	"noise_curfew" text,
	"cleanup_window_min" integer,
	"cancellation_ladder" jsonb,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studios_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "studios_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "walkthrough_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"walkthrough_id" uuid NOT NULL,
	"checklist_item_id" uuid,
	"r2_key" text NOT NULL,
	"server_captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"bytes" integer,
	"content_type" text,
	"sha256" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "walkthroughs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "walkthrough_kind" NOT NULL,
	"started_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_tokens" ADD CONSTRAINT "renter_tokens_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walkthrough_photos" ADD CONSTRAINT "walkthrough_photos_walkthrough_id_walkthroughs_id_fk" FOREIGN KEY ("walkthrough_id") REFERENCES "public"."walkthroughs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walkthrough_photos" ADD CONSTRAINT "walkthrough_photos_checklist_item_id_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."checklist_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walkthroughs" ADD CONSTRAINT "walkthroughs_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "renter_tokens_booking_purpose_idx" ON "renter_tokens" USING btree ("booking_id","purpose");