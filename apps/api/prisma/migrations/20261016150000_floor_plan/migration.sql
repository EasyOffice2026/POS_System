-- CreateEnum
CREATE TYPE "table_shape" AS ENUM ('square', 'round');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "bill_printed_at" TIMESTAMPTZ(3),
ADD COLUMN     "table_id" UUID,
ADD COLUMN     "table_open_key" UUID;

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "shape" "table_shape" NOT NULL DEFAULT 'square',
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 1,
    "height" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dining_tables_brand_id_idx" ON "dining_tables"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_branch_id_name_key_key" ON "dining_tables"("branch_id", "name_key");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_id_branch_id_key" ON "dining_tables"("id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_table_open_key_key" ON "orders"("table_open_key");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_branch_id_fkey" FOREIGN KEY ("table_id", "branch_id") REFERENCES "dining_tables"("id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_branch_id_brand_id_fkey" FOREIGN KEY ("branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The rules the database keeps itself (docs/specs/023-floor-plan.md, rules 1, 3, 4 and 7).
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_place_check" CHECK (
    "seats" BETWEEN 1 AND 50
    AND "width" BETWEEN 1 AND 4
    AND "height" BETWEEN 1 AND 4
    AND "x" >= 0
    AND "y" >= 0
    AND "x" + "width" <= 24
    AND "y" + "height" <= 16
);

ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_name_check" CHECK (
    char_length("name") BETWEEN 1 AND 10
    AND "name" = btrim("name")
    AND char_length("area") BETWEEN 1 AND 40
    AND "area" = btrim("area")
    AND "name_key" = lower("name")
);

-- Only a dine-in order has a table, and the open key is the table exactly while the order is open.
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_check" CHECK (
    ("table_id" IS NULL OR "type" = 'dine_in')
    AND "table_open_key" IS NOT DISTINCT FROM (CASE WHEN "status" = 'open' THEN "table_id" END)
);
