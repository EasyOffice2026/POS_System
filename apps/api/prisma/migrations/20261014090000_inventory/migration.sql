-- CreateEnum
CREATE TYPE "stock_unit" AS ENUM ('g', 'kg', 'ml', 'l', 'piece');

-- CreateEnum
CREATE TYPE "movement_kind" AS ENUM ('received', 'adjustment', 'waste', 'sold', 'transfer_in', 'transfer_out', 'count');

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "search_text" TEXT NOT NULL,
    "unit" "stock_unit" NOT NULL,
    "cost_per_unit" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "low_level" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_stock" (
    "branch_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "quantity" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "low_level" DECIMAL(15,3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_stock_pkey" PRIMARY KEY ("branch_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "kind" "movement_kind" NOT NULL,
    "quantity" DECIMAL(15,3) NOT NULL,
    "quantity_after" DECIMAL(15,3) NOT NULL,
    "note" TEXT,
    "reference_id" UUID,
    "by_id" UUID,
    "by_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingredients_brand_id_is_active_idx" ON "ingredients"("brand_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_id_brand_id_key" ON "ingredients"("id", "brand_id");

-- CreateIndex
CREATE INDEX "stock_movements_branch_id_ingredient_id_created_at_idx" ON "stock_movements"("branch_id", "ingredient_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_branch_id_created_at_idx" ON "stock_movements"("branch_id", "created_at");

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_stock_branch_id_brand_id_fkey" FOREIGN KEY ("branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_stock_ingredient_id_brand_id_fkey" FOREIGN KEY ("ingredient_id", "brand_id") REFERENCES "ingredients"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_brand_id_fkey" FOREIGN KEY ("branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ingredient_id_brand_id_fkey" FOREIGN KEY ("ingredient_id", "brand_id") REFERENCES "ingredients"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the database keeps as well (docs/specs/012-ingredients-and-stock.md): stock is never below
-- zero, and a low level is 0 or more.
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_stock_quantity_check" CHECK ("quantity" >= 0);
ALTER TABLE "branch_stock" ADD CONSTRAINT "branch_stock_low_level_check" CHECK ("low_level" IS NULL OR "low_level" >= 0);
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_levels_check" CHECK ("cost_per_unit" >= 0 AND "low_level" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_after_check" CHECK ("quantity_after" >= 0);
