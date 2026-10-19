-- Platform commission (docs/specs/025-platform-commission.md): the rate of the way to pay is kept
-- on each payment with what it came to, and a refund keeps the commission it gave back. Payments
-- and refunds made before have none.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "commission" DECIMAL(15,3) NOT NULL DEFAULT 0,
ADD COLUMN     "commission_rate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "commission" DECIMAL(15,3) NOT NULL DEFAULT 0;

-- A rate is a percentage, and no commission is more than what it is charged on; cash has none.
ALTER TABLE "payments" ADD CONSTRAINT "payments_commission_check"
  CHECK ("commission_rate" BETWEEN 0 AND 100 AND "commission" >= 0 AND "commission" <= "amount"
    AND ("method" <> 'cash' OR ("commission_rate" = 0 AND "commission" = 0)));
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_commission_check"
  CHECK ("commission" >= 0 AND "commission" <= "amount");
