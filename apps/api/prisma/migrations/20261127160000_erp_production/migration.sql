-- Central kitchen production and invoice revaluation posted by the accounting system
-- (docs/specs/029-erp-link.md).

-- AlterEnum
ALTER TYPE "movement_kind" ADD VALUE 'used_in_production';
ALTER TYPE "movement_kind" ADD VALUE 'produced';
ALTER TYPE "movement_kind" ADD VALUE 'revalued';

-- AlterTable
ALTER TABLE "external_stock_posts" ADD COLUMN "result" JSONB;
