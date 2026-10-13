-- CreateEnum
CREATE TYPE "order_type" AS ENUM ('dine_in', 'takeaway');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('open', 'voided');

-- CreateEnum
CREATE TYPE "order_line_kind" AS ENUM ('item', 'combo');

-- CreateEnum
CREATE TYPE "order_line_status" AS ENUM ('pending', 'sent', 'voided');

-- CreateEnum
CREATE TYPE "discount_kind" AS ENUM ('percent', 'amount');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "number" INTEGER NOT NULL,
    "type" "order_type" NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'open',
    "note" TEXT,
    "subtotal" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "discount_kind" "discount_kind",
    "discount_value" DECIMAL(12,3),
    "discount_amount" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "discount_reason" TEXT,
    "discount_by_id" UUID,
    "discount_approved_by_id" UUID,
    "total" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "opened_by_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" TEXT,
    "void_approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "kind" "order_line_kind" NOT NULL,
    "item_id" UUID,
    "combo_id" UUID,
    "name" JSONB NOT NULL,
    "unit_price" DECIMAL(12,3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" DECIMAL(15,3) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "status" "order_line_status" NOT NULL DEFAULT 'pending',
    "position" INTEGER NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" TEXT,
    "void_approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_counters" (
    "branch_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "brand_id" UUID NOT NULL,
    "last_number" INTEGER NOT NULL,

    CONSTRAINT "order_counters_pkey" PRIMARY KEY ("branch_id","business_date")
);

-- CreateIndex
CREATE INDEX "orders_branch_id_created_at_idx" ON "orders"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_brand_id_created_at_idx" ON "orders"("brand_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_branch_id_business_date_number_key" ON "orders"("branch_id", "business_date", "number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_id_branch_id_brand_id_key" ON "orders"("id", "branch_id", "brand_id");

-- CreateIndex
CREATE INDEX "order_lines_order_id_position_idx" ON "order_lines"("order_id", "position");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_brand_id_fkey" FOREIGN KEY ("branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_branch_id_brand_id_fkey" FOREIGN KEY ("order_id", "branch_id", "brand_id") REFERENCES "orders"("id", "branch_id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_item_id_brand_id_fkey" FOREIGN KEY ("item_id", "brand_id") REFERENCES "menu_items"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_combo_id_brand_id_fkey" FOREIGN KEY ("combo_id", "brand_id") REFERENCES "combos"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_branch_id_brand_id_fkey" FOREIGN KEY ("branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the database keeps as well, so no other path can break them (docs/specs/005-orders.md).
ALTER TABLE "orders" ADD CONSTRAINT "orders_number_check" CHECK ("number" >= 1);
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check"
  CHECK ("subtotal" >= 0 AND "discount_amount" >= 0 AND "discount_amount" <= "subtotal"
         AND "total" = "subtotal" - "discount_amount");
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_check"
  CHECK (("discount_kind" IS NULL) = ("discount_value" IS NULL));
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_amounts_check"
  CHECK ("unit_price" >= 0 AND "line_total" = "unit_price" * "quantity");
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_kind_check"
  CHECK (("kind" = 'item' AND "item_id" IS NOT NULL AND "combo_id" IS NULL)
      OR ("kind" = 'combo' AND "combo_id" IS NOT NULL AND "item_id" IS NULL));
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_last_number_check" CHECK ("last_number" >= 1);
