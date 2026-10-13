-- The kitchen station a ticket is for, and the one a category's dishes go to
-- (docs/specs/009-settings.md, rule 6). The stations themselves are in the brand's settings.
ALTER TABLE "kitchen_tickets" ADD COLUMN "station_id" UUID;
ALTER TABLE "menu_categories" ADD COLUMN "station_id" UUID;

-- The way an order was paid is now a key from the brand's settings ("cash", "knet", ...), not a
-- fixed list, and keeps its name as it was at the time (rule 2). Payments made so far keep their
-- method; the ones by card get the name "Card".
ALTER TABLE "payments" DROP CONSTRAINT "payments_method_check";
ALTER TABLE "payments" ALTER COLUMN "method" TYPE TEXT USING "method"::text;
ALTER TABLE "payments" ADD COLUMN "method_name" JSONB NOT NULL DEFAULT '{}';
UPDATE "payments" SET "method_name" = CASE "method"
  WHEN 'cash' THEN '{"en":"Cash","ar":"نقدًا"}'::jsonb
  ELSE '{"en":"Card","ar":"بطاقة"}'::jsonb
END;
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_check"
  CHECK (("method" = 'cash' AND "tendered" IS NOT NULL AND "tendered" >= "amount"
          AND "change" = "tendered" - "amount" AND "reference" IS NULL)
      OR ("method" <> 'cash' AND "tendered" IS NULL AND "change" = 0));
DROP TYPE "payment_method";

-- New branches are in Kuwait unless said otherwise (rule 1).
ALTER TABLE "branches" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Kuwait';
