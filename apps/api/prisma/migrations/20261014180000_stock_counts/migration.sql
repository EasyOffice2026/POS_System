-- CreateEnum
CREATE TYPE "count_status" AS ENUM ('open', 'finished', 'cancelled');

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "count_status" NOT NULL DEFAULT 'open',
    "open_key" UUID,
    "note" TEXT,
    "started_by_id" UUID,
    "started_by_name" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_by_id" UUID,
    "finished_by_name" TEXT,
    "finished_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancelled_by_name" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "expected" DECIMAL(15,3) NOT NULL,
    "counted" DECIMAL(15,3),
    "unit_cost" DECIMAL(12,3),

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_open_key_key" ON "stock_counts"("open_key");

-- CreateIndex
CREATE INDEX "stock_counts_branch_id_started_at_idx" ON "stock_counts"("branch_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_id_brand_id_key" ON "stock_counts"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_count_id_ingredient_id_key" ON "stock_count_lines"("count_id", "ingredient_id");

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branch_id_brand_id_fkey" FOREIGN KEY ("branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_brand_id_fkey" FOREIGN KEY ("count_id", "brand_id") REFERENCES "stock_counts"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_ingredient_id_brand_id_fkey" FOREIGN KEY ("ingredient_id", "brand_id") REFERENCES "ingredients"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the database keeps as well (docs/specs/015-stock-counts.md): only an open count holds
-- the open key of its branch, and a counted quantity is never below zero.
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_open_key_check" CHECK (("status" = 'open') = ("open_key" IS NOT NULL) AND ("open_key" IS NULL OR "open_key" = "branch_id"));
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_counted_check" CHECK ("counted" IS NULL OR "counted" >= 0);
