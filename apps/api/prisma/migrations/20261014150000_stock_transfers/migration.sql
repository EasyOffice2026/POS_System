-- CreateEnum
CREATE TYPE "transfer_status" AS ENUM ('sent', 'received', 'cancelled');

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "brand_id" UUID NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "status" "transfer_status" NOT NULL DEFAULT 'sent',
    "note" TEXT,
    "sent_by_id" UUID,
    "sent_by_name" TEXT,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    "received_by_id" UUID,
    "received_by_name" TEXT,
    "received_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancelled_by_name" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(15,3) NOT NULL,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_transfers_from_branch_id_sent_at_idx" ON "stock_transfers"("from_branch_id", "sent_at");

-- CreateIndex
CREATE INDEX "stock_transfers_to_branch_id_sent_at_idx" ON "stock_transfers"("to_branch_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_id_brand_id_key" ON "stock_transfers"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_lines_transfer_id_ingredient_id_key" ON "stock_transfer_lines"("transfer_id", "ingredient_id");

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_brand_id_fkey" FOREIGN KEY ("from_branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_brand_id_fkey" FOREIGN KEY ("to_branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_brand_id_fkey" FOREIGN KEY ("transfer_id", "brand_id") REFERENCES "stock_transfers"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_ingredient_id_brand_id_fkey" FOREIGN KEY ("ingredient_id", "brand_id") REFERENCES "ingredients"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the database keeps as well (docs/specs/014-stock-transfers.md): a transfer goes to
-- another branch, and sends more than nothing of each ingredient.
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_branches_check" CHECK ("from_branch_id" <> "to_branch_id");
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_quantity_check" CHECK ("quantity" > 0);
