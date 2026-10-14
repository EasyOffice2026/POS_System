-- CreateEnum
CREATE TYPE "promotion_kind" AS ENUM ('percent_off', 'buy_get', 'amount_off');

-- CreateEnum
CREATE TYPE "promotion_scope" AS ENUM ('all', 'categories', 'items');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "promo_code" TEXT,
ADD COLUMN     "promotion_discount" DECIMAL(15,3) NOT NULL DEFAULT 0,
ADD COLUMN     "promotions" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "kind" "promotion_kind" NOT NULL,
    "value" DECIMAL(12,3),
    "buy_quantity" INTEGER,
    "get_quantity" INTEGER,
    "applies_to" "promotion_scope" NOT NULL DEFAULT 'all',
    "category_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "item_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "branch_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "starts_on" DATE,
    "ends_on" DATE,
    "days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "start_time" TEXT,
    "end_time" TEXT,
    "code" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotions_brand_id_is_active_idx" ON "promotions"("brand_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_brand_id_code_key" ON "promotions"("brand_id", "code");

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the database keeps as well (docs/specs/021-promotions.md). The total of an order is now the
-- subtotal less what promotions took off, less the manual discount.
ALTER TABLE "orders" DROP CONSTRAINT "orders_amounts_check";
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check"
  CHECK ("subtotal" >= 0 AND "promotion_discount" >= 0 AND "discount_amount" >= 0
         AND "promotion_discount" + "discount_amount" <= "subtotal"
         AND "total" = "subtotal" - "promotion_discount" - "discount_amount");

-- A promotion has the numbers of its kind; a code is in capitals.
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_kind_check"
  CHECK (("kind"::text = 'buy_get') = ("buy_quantity" IS NOT NULL AND "get_quantity" IS NOT NULL)
         AND ("kind"::text = 'buy_get') = ("value" IS NULL)
         AND ("value" IS NULL OR "value" > 0)
         AND ("buy_quantity" IS NULL OR "buy_quantity" >= 1)
         AND ("get_quantity" IS NULL OR "get_quantity" >= 1));
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_code_check"
  CHECK ("code" IS NULL OR "code" ~ '^[A-Z0-9]{3,20}$');
