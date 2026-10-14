-- CreateEnum
CREATE TYPE "loyalty_entry_kind" AS ENUM ('earn', 'redeem', 'adjust');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customer_id" UUID,
ADD COLUMN     "points_discount" DECIMAL(15,3) NOT NULL DEFAULT 0,
ADD COLUMN     "points_earned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "points_redeemed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "search_text" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "total_spent" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "last_visit_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_entries" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID,
    "customer_id" UUID NOT NULL,
    "kind" "loyalty_entry_kind" NOT NULL,
    "points" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "order_id" UUID,
    "note" TEXT,
    "by_id" UUID,
    "by_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_id_brand_id_key" ON "customers"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_brand_id_phone_key" ON "customers"("brand_id", "phone");

-- CreateIndex
CREATE INDEX "loyalty_entries_customer_id_created_at_idx" ON "loyalty_entries"("customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_brand_id_fkey" FOREIGN KEY ("customer_id", "brand_id") REFERENCES "customers"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_customer_id_brand_id_fkey" FOREIGN KEY ("customer_id", "brand_id") REFERENCES "customers"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the database keeps as well (docs/specs/022-loyalty.md). The total of an order is now the
-- subtotal less the promotions, the manual discount and the points spent.
ALTER TABLE "orders" DROP CONSTRAINT "orders_amounts_check";
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check"
  CHECK ("subtotal" >= 0 AND "promotion_discount" >= 0 AND "discount_amount" >= 0
         AND "points_discount" >= 0
         AND "promotion_discount" + "discount_amount" + "points_discount" <= "subtotal"
         AND "total" = "subtotal" - "promotion_discount" - "discount_amount" - "points_discount");
ALTER TABLE "orders" ADD CONSTRAINT "orders_points_check"
  CHECK ("points_redeemed" >= 0 AND "points_earned" >= 0
         AND ("points_redeemed" = 0 OR "customer_id" IS NOT NULL));

-- Points never go below zero, and a phone is "+" and digits.
ALTER TABLE "customers" ADD CONSTRAINT "customers_points_check"
  CHECK ("points" >= 0 AND "visits" >= 0 AND "total_spent" >= 0);
ALTER TABLE "customers" ADD CONSTRAINT "customers_phone_check" CHECK ("phone" ~ '^\+[0-9]{8,15}$');
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_points_check"
  CHECK ("points" <> 0 AND "balance_after" >= 0);
