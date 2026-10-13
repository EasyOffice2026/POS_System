-- CreateEnum
CREATE TYPE "shift_status" AS ENUM ('open', 'closed');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "shift_id" UUID;

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "shift_status" NOT NULL DEFAULT 'open',
    "opened_by_id" UUID NOT NULL,
    "opened_by_name" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "opening_cash" DECIMAL(15,3) NOT NULL,
    "closed_by_id" UUID,
    "closed_by_name" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "counted_cash" DECIMAL(15,3),
    "expected_cash" DECIMAL(15,3),
    "difference" DECIMAL(15,3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shifts_branch_id_status_opened_at_idx" ON "shifts"("branch_id", "status", "opened_at");

-- CreateIndex
CREATE INDEX "shifts_opened_by_id_status_idx" ON "shifts"("opened_by_id", "status");

-- CreateIndex
CREATE INDEX "payments_shift_id_idx" ON "payments"("shift_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_brand_id_fkey" FOREIGN KEY ("branch_id", "brand_id") REFERENCES "branches"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the database keeps as well (docs/specs/010-shifts.md): a closed shift has its count, an
-- open one has none, and the drawer never opens with a negative amount.
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_opening_cash_check" CHECK ("opening_cash" >= 0);
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_check"
  CHECK (("status" = 'closed') = ("closed_at" IS NOT NULL AND "closed_by_id" IS NOT NULL
         AND "counted_cash" IS NOT NULL AND "expected_cash" IS NOT NULL AND "difference" IS NOT NULL));
