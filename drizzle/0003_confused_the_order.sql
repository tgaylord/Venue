DROP INDEX "contracts_booking_id_idx";--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "pdf_r2_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_booking_id_unique" ON "contracts" USING btree ("booking_id");