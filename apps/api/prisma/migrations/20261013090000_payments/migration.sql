-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'card');

-- AlterEnum
ALTER TYPE "order_status" ADD VALUE 'paid';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paid_at" TIMESTAMPTZ(3),
ADD COLUMN     "paid_by_id" UUID;

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,
    "tendered" DECIMAL(15,3),
    "change" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "taken_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_branch_id_created_at_idx" ON "payments"("branch_id", "created_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_branch_id_brand_id_fkey" FOREIGN KEY ("order_id", "branch_id", "brand_id") REFERENCES "orders"("id", "branch_id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the database keeps as well, so no other path can break them (docs/specs/007-payments.md).
-- The status is compared as text: a value added to an enum cannot be used in the same migration.
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_check"
  CHECK (("status"::text = 'paid') = ("paid_at" IS NOT NULL AND "paid_by_id" IS NOT NULL));
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_check"
  CHECK (("method" = 'cash' AND "tendered" IS NOT NULL AND "tendered" >= "amount"
          AND "change" = "tendered" - "amount" AND "reference" IS NULL)
      OR ("method" = 'card' AND "tendered" IS NULL AND "change" = 0));
