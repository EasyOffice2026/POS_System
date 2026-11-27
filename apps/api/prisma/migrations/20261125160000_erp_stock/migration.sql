-- Stock from the accounting system, and the cost each movement moved at
-- (docs/specs/029-erp-link.md).

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN "unit_cost" DECIMAL(12,3);

-- CreateTable
CREATE TABLE "external_stock_posts" (
    "key" TEXT NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "kind" "movement_kind" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_stock_posts_pkey" PRIMARY KEY ("key")
);
