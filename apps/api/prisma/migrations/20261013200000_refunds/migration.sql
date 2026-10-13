-- What an order gave back so far (docs/specs/011-refunds.md).
ALTER TABLE "orders" ADD COLUMN "refunded" DECIMAL(15,3) NOT NULL DEFAULT 0;

-- Money given back for a paid order, in cash or by the way it was paid, with a manager's approval.
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "amount" DECIMAL(15,3) NOT NULL,
    "method" TEXT NOT NULL,
    "method_name" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT NOT NULL,
    "refunded_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");
CREATE INDEX "refunds_shift_id_idx" ON "refunds"("shift_id");
CREATE INDEX "refunds_branch_id_created_at_idx" ON "refunds"("branch_id", "created_at");

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_branch_id_brand_id_fkey" FOREIGN KEY ("order_id", "branch_id", "brand_id") REFERENCES "orders"("id", "branch_id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules the database keeps as well: a refund is above 0, and an order is never refunded more than
-- its total.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_check" CHECK ("amount" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_refunded_check"
  CHECK ("refunded" >= 0 AND "refunded" <= "total");
