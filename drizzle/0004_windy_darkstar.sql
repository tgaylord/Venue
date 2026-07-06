ALTER TABLE "bookings" ADD COLUMN "pre_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "walkthrough_photos_item_unique" ON "walkthrough_photos" USING btree ("walkthrough_id","checklist_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "walkthroughs_booking_kind_unique" ON "walkthroughs" USING btree ("booking_id","kind");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_locked_walkthrough() RETURNS trigger AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'walkthrough % is locked and cannot be modified', OLD.id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER walkthroughs_immutable_when_locked
  BEFORE UPDATE OR DELETE ON walkthroughs
  FOR EACH ROW EXECUTE FUNCTION forbid_locked_walkthrough();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_locked_walkthrough_photo() RETURNS trigger AS $$
DECLARE locked timestamptz;
BEGIN
  SELECT w.locked_at INTO locked FROM walkthroughs w
    WHERE w.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.walkthrough_id ELSE NEW.walkthrough_id END;
  IF locked IS NOT NULL THEN
    RAISE EXCEPTION 'walkthrough photo belongs to a locked walkthrough and cannot be modified';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER walkthrough_photos_immutable_when_locked
  BEFORE UPDATE OR DELETE ON walkthrough_photos
  FOR EACH ROW EXECUTE FUNCTION forbid_locked_walkthrough_photo();