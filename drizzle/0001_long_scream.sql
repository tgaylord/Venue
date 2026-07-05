ALTER TABLE "walkthrough_photos" DROP CONSTRAINT "walkthrough_photos_checklist_item_id_checklist_items_id_fk";
--> statement-breakpoint
ALTER TABLE "walkthrough_photos" ADD CONSTRAINT "walkthrough_photos_checklist_item_id_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."checklist_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_blocks_studio_id_idx" ON "availability_blocks" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "booking_events_booking_id_idx" ON "booking_events" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "bookings_studio_id_idx" ON "bookings" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "bookings_state_idx" ON "bookings" USING btree ("state");--> statement-breakpoint
CREATE INDEX "checklist_items_studio_id_idx" ON "checklist_items" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "contracts_booking_id_idx" ON "contracts" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "spaces_studio_id_idx" ON "spaces" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "walkthrough_photos_walkthrough_id_idx" ON "walkthrough_photos" USING btree ("walkthrough_id");--> statement-breakpoint
CREATE INDEX "walkthroughs_booking_id_idx" ON "walkthroughs" USING btree ("booking_id");--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_time_range" CHECK ("ends_at" > "starts_at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_time_range" CHECK ("ends_at" > "starts_at");