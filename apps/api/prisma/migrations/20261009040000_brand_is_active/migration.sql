-- A brand can be made inactive instead of deleted. Every existing brand stays active.
ALTER TABLE "brands" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
