-- CreateEnum
CREATE TYPE "purchase_order_status" AS ENUM ('draft', 'sent', 'received', 'cancelled');

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" "purchase_order_status" NOT NULL DEFAULT 'draft',
    "expected_on" DATE,
    "note" TEXT,
    "total" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_by_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_by_id" UUID,
    "sent_by_name" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancelled_by_name" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(15,3) NOT NULL,
    "unit_price" DECIMAL(12,3) NOT NULL,
    "line_total" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_orders_branch_id_created_at_idx" ON "purchase_orders"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_id_brand_id_key" ON "purchase_orders"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_order_id_ingredient_id_key" ON "purchase_order_lines"("order_id", "ingredient_id");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_brand_id_fkey" FOREIGN KEY ("branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_brand_id_fkey" FOREIGN KEY ("supplier_id", "brand_id") REFERENCES "suppliers"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_brand_id_fkey" FOREIGN KEY ("order_id", "brand_id") REFERENCES "purchase_orders"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_ingredient_id_brand_id_fkey" FOREIGN KEY ("ingredient_id", "brand_id") REFERENCES "ingredients"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the database keeps as well (docs/specs/018-purchase-orders.md).
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_amounts_check" CHECK ("quantity" > 0 AND "unit_price" >= 0 AND "line_total" >= 0);
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_total_check" CHECK ("total" >= 0);
