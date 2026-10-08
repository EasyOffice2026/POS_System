-- DropForeignKey
ALTER TABLE "user_branches" DROP CONSTRAINT "user_branches_branch_id_fkey";

-- AlterTable
-- Add the column empty, copy each row's brand from its branch, and only then require it.
ALTER TABLE "user_branches" ADD COLUMN     "brand_id" UUID;

UPDATE "user_branches"
SET "brand_id" = "branches"."brand_id"
FROM "branches"
WHERE "branches"."id" = "user_branches"."branch_id";

ALTER TABLE "user_branches" ALTER COLUMN "brand_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "branches_id_brand_id_key" ON "branches"("id", "brand_id");

-- CreateIndex
CREATE INDEX "user_branches_brand_id_idx" ON "user_branches"("brand_id");

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branch_id_brand_id_fkey" FOREIGN KEY ("branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;
